# Architecture and Workflow Specification

This document details the internal architecture, event lifecycle, and subsystems of the **OpenCode PR Reviewer**.

---

## 1. High-Level System Architecture

```mermaid
flowchart TD
    subgraph GitHub["GitHub Platform"]
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

        Formatter -->|Step 5: Post Review & Delete Standby| ReviewPoster[GitHub REST Client]
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
    Server->>DB: Enqueue Job (repository, PR number, HEAD SHA)
    Server-->>GitHub: HTTP 200 OK (Job Enqueued)

    loop Worker Loop (Every 3 seconds)
        Worker->>DB: Dequeue Next Job
        DB-->>Worker: Return Job Details
        Worker->>Worker: Check if superseded by newer commit
        alt Is Superseded
            Worker->>DB: Mark status = 'superseded' (Skip execution)
        else Is Active Job
            Worker->>Client: Generate Installation Token (JWT)
            Worker->>Client: Post Instant Standby Comment ("Analyzing...")
            Worker->>Worker: Prepare isolated Git Workspace (fetch origin/main & checkout HEAD)
            Worker->>Engine: Run OpenCode review with prompts/review.md
            Engine-->>Worker: Stream NDJSON output (step_start, tool_use, text)
            Worker->>Worker: Parse balanced JSON review payload
            
            alt Verdict is APPROVE
                Worker->>Client: Submit Review (APPROVE, Clean Summary, 0 inline threads)
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
Incoming payloads from GitHub are verified using HMAC SHA-256 against `WEBHOOK_SECRET`:
- Raw request body buffers are captured before JSON parsing.
- Constant-time buffer comparison (`crypto.timingSafeEqual`) prevents timing attack vulnerabilities.
- Non-actionable PR events (such as `labeled`, `assigned`, `closed`) are filtered out immediately.

### 3.2. SQLite Queue and Smart Deduplication (`src/queue/queue.ts`)
- **Zero Heavy Dependencies**: Implemented using Node.js experimental SQLite module or SQLite3.
- **Smart Deduplication**: When multiple commits are pushed rapidly to the same PR, older queued jobs are marked as superseded and bypassed, conserving LLM token capacity.

### 3.3. GitHub App Token Management (`src/github/auth.ts`)
- The service generates an RS256 JWT signed with the GitHub App private key (`github-app.private-key.pem`).
- The JWT is exchanged with GitHub for a short-lived **Installation Access Token** (valid for 1 hour).
- Eliminates the need for long-lived Personal Access Tokens (PAT).

### 3.4. Git Workspace Isolation (`src/workspace/git.ts`)
- Repositories are cloned into dedicated directories (`workspaces/<owner>/<repo>/pr-<number>`).
- Re-fetches the latest target base branch (`origin/main`) and resets the working tree cleanly prior to analysis.

### 3.5. OpenCode NDJSON Stream Parser (`src/reviewer/parser.ts`)
OpenCode outputs a structured event stream (`step_start`, `tool_use`, `step_finish`, `text`). The parser:
1. Isolates the **trailing contiguous block of `text` events** (the final model output, excluding intermediate agent thoughts).
2. Applies a **balanced brace parser** (`findBalancedJsonObject`) to extract the JSON payload without truncation from nested markdown code blocks.
3. Normalizes verdicts (`PASS` to `APPROVE`, `FAIL` to `REQUEST_CHANGES`).

### 3.6. Standby Comment Lifecycle (`src/worker/worker.ts` & `src/github/client.ts`)
1. **Immediate Acknowledgment**:
   ```markdown
   > **AI Code Reviewer** is currently analyzing your code changes...
   > *Estimated completion time: ~30-60 seconds.*
   ```
2. **Automated Cleanup**:
   Upon publishing the official review, the standby comment is deleted to keep the PR timeline clean.
3. **Orphan Cleanup**:
   Stale standby comments from interrupted previous runs are swept and removed on each execution cycle.

### 3.7. GitHub Native Alert Formatting (`src/github/client.ts`)
Review comments utilize GitHub markdown callout formatting:
- `[!CAUTION]` for **CRITICAL** security vulnerabilities and fatal bugs.
- `[!WARNING]` for **WARNING** logic issues.
- `[!NOTE]` for **INFO** suggestions.
