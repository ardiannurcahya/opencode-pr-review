# 🏛️ Architecture & Workflow Deep Dive

This document details the internal architecture, event lifecycle, and subsystems of the **OpenCode PR Reviewer**.

---

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph GitHub["GitHub Ecosystem"]
        Dev[Developer] -->|Opens / Pushes PR| GH[GitHub API & Webhooks]
        GH -->|HMAC Webhook Event| Caddy[Caddy / Reverse Proxy]
        AppToken[GitHub App Auth] -->|Installation Token| GH
    end

    subgraph Service["OpenCode PR Reviewer Engine"]
        Caddy -->|HTTP POST| WebhookServer[Express Webhook Endpoint]
        WebhookServer -->|HMAC Verification| SignatureValidator{Valid HMAC?}
        SignatureValidator -->|Yes| JobQueueDB[(SQLite Job Queue)]
        SignatureValidator -->|No| Reject[Reject 401 Unauthorized]

        JobQueueDB -->|Superseded Check & Dequeue| Worker[Review Worker Loop]

        Worker -->|Step 1: JWT to Token| TokenManager[GitHub App Auth Manager]
        Worker -->|Step 2: Post Standby Comment| StandbyHelper[Standby Status Manager]
        Worker -->|Step 3: Isolated Clone/Fetch| GitWorkspace[Workspace Manager]
        Worker -->|Step 4: Execute Review| OpenCodeEngine[OpenCode AI Engine]
        
        OpenCodeEngine -->|NDJSON Event Stream| StreamParser[Stream & JSON Parser]
        StreamParser -->|Structured Review Result| Formatter[GitHub Alert Formatter]

        Formatter -->|Step 5: Post Inline Comments & Delete Standby| ReviewPoster[GitHub REST Client]
    end

    ReviewPoster -->|Official Review + Alert Badges| GH
```

---

## 2. End-to-End Review Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Developer
    participant GitHub as GitHub
    participant Server as Webhook Server (/webhook/github)
    participant DB as SQLite Job Queue
    participant Worker as Review Worker
    participant Engine as OpenCode CLI Engine
    participant Client as GitHub Client

    Developer->>GitHub: Open PR / Push new commit
    GitHub->>Server: POST /webhook/github (X-Hub-Signature-256)
    Server->>Server: Verify HMAC SHA-256 Signature
    Server->>DB: Enqueue Job (repository, PR#, HEAD SHA)
    Server-->>GitHub: HTTP 200 OK (Job Enqueued)

    loop Worker Loop (Every 3 seconds)
        Worker->>DB: Dequeue Next Job
        DB-->>Worker: Return Job Details
        Worker->>Worker: Check if superseded by newer commit
        alt Is Superseded
            Worker->>DB: Mark status = 'superseded' (Skip execution)
        else Is Active Job
            Worker->>Client: Generate Installation Token (JWT)
            Worker->>Client: Post Instant Standby Comment ("⏳ Analyzing...")
            Worker->>Worker: Prepare isolated Git Workspace (fetch origin/main & checkout HEAD)
            Worker->>Engine: Run opencode review with prompts/review.md
            Engine-->>Worker: Stream NDJSON output (step_start, tool_use, text)
            Worker->>Worker: Parse balanced JSON review payload
            
            alt Verdict is APPROVE
                Worker->>Client: Submit Review (APPROVE, Clean Summary, 0 noise threads)
                Worker->>Client: Auto-delete standby comment
            else Verdict is REQUEST_CHANGES
                Worker->>Client: Submit Review (REQUEST_CHANGES, [!CAUTION] Inline Comments)
                Worker->>Client: Auto-delete standby comment
            end
            
            Worker->>DB: Mark status = 'completed'
        end
    end
```

---

## 3. Core Subsystems

### 3.1. Webhook Signature Verification (`src/github/webhook.ts`)
Every incoming payload from GitHub is verified using HMAC SHA-256 against `WEBHOOK_SECRET`:
- Raw request body buffers are captured before JSON serialization.
- Timing-safe buffer comparison (`crypto.timingSafeEqual`) prevents timing attack vulnerabilities.
- Non-relevant PR actions (e.g. `labeled`, `assigned`, `closed`) are filtered out immediately.

### 3.2. SQLite Queue & Smart Deduplication (`src/queue/queue.ts`)
- **Zero Heavy Dependencies**: Powered by Node.js native experimental SQLite or SQLite3.
- **Smart Deduplication**: If a developer pushes 3 commits rapidly (`commit A` -> `commit B` -> `commit C`), the worker automatically identifies that `commit A` and `commit B` are superseded by `commit C`, marking them skipped and saving valuable LLM compute.

### 3.3. GitHub App Token Management (`src/github/auth.ts`)
- The service signs an RS256 JWT using the GitHub App's private key (`github-app.private-key.pem`).
- The JWT is exchanged for a short-lived **Installation Access Token** (valid for 1 hour).
- No long-lived Personal Access Tokens (PAT) are stored in the codebase.

### 3.4. Git Workspace Isolation (`src/workspace/git.ts`)
- Repositories are cloned into isolated directories (`workspaces/<owner>/<repo>/pr-<number>`).
- Re-fetches the latest target base branch (`origin/main`) and resets the working tree cleanly before running AI tools.

### 3.5. OpenCode NDJSON Stream Parser (`src/reviewer/parser.ts`)
OpenCode outputs a structured event stream (`step_start`, `tool_use`, `step_finish`, `text`). The parser:
1. Isolates the **trailing contiguous block of `text` events** (the final model answer, filtering out internal agent narration).
2. Uses a **balanced curly-brace parser** (`findBalancedJsonObject`) to extract the review payload without breaking on nested markdown code blocks.
3. Normalizes verdicts (`PASS` / `APPROVE`, `FAIL` / `REQUEST_CHANGES`).

### 3.6. Standby Comment Lifecycle (`src/worker/worker.ts` & `src/github/client.ts`)
1. **Instant Feedback (< 2 seconds)**:
   ```markdown
   > ⏳ **AI Code Reviewer** is currently analyzing your code changes...
   > *Estimated completion time: ~30–60 seconds.*
   ```
2. **Clean Auto-Deletion**:
   When the review completes, the temporary standby comment is cleanly deleted, leaving a pristine PR conversation history.
3. **Orphan Sweeper**:
   On every new run, stale standby comments from previously interrupted/crashed runs are automatically cleaned up.

### 3.7. GitHub Native Alert Formatting (`src/github/client.ts`)
Review comments leverage GitHub native Markdown alert syntax:
- 🔴 `[!CAUTION]` for **CRITICAL** security flaws and severe bugs.
- 🟡 `[!WARNING]` for **WARNING** logic bugs.
- 🔵 `[!NOTE]` for **INFO** suggestions.
