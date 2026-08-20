# OpenCode AI PR Reviewer (Self-Hosted)

A lightweight, self-hosted automated Pull Request code reviewer powered by **GitHub App** and **OpenCode**.

---

## Features

- **Multi-Repository Routing**: Configure different models, custom prompt rules, and base branches per repository.
- **Universal & Extensible Review Engine**: Master review rules out of the box with `prompts/review.md`, easily extendable per repository via `custom_prompt`.
- **Zero API Key Clutter**: Leverages your existing OpenCode authenticated session and custom OpenAI-compatible providers (`opencode.json`).
- **Smart Deduplication**: Automatically skips outdated commits if newer commits are pushed to the same PR, saving AI compute tokens.
- **Isolated Workspaces**: Pull requests are checked out in dedicated local workspaces without cross-branch contamination.
- **Resilient Review Posting**: Posts inline comments on specific lines, falling back to top-level review summaries if lines fall outside the diff.

---

## Architecture

```text
             GitHub
               │
        PR opened / updated
               │
               ▼
      https://review.domain.com/webhook/github
               │
        ┌──────▼────────┐
        │  Webhook API  │  (Express + Signature Verification)
        └──────┬────────┘
               │
          enqueue job
               │
        ┌──────▼────────┐
        │ SQLite Queue  │  (De-duplication per PR + HEAD SHA)
        └──────┬────────┘
               │
        ┌──────▼────────┐
        │ Review Worker │
        └──────┬────────┘
               │
        clone / git fetch PR
               │
               ▼
        ┌───────────────┐
        │   OpenCode    │  (opencode run --attach)
        └──────┬────────┘
               │
          review result
               │
               ▼
        GitHub REST API
               │
               ▼
      Inline Review Comments on PR
```

---

## 3-Minute Quick Start

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/your-org/opencode-pr-review.git
cd opencode-pr-review
npm install

# 2. Copy configuration files
cp config.example.yaml config.yaml
cp .env.example .env

# 3. Start development server
npm run dev
```

---

## Step-by-Step Installation Guide

### Step 1: Install Prerequisites

Ensure the following tools are installed on your machine or VPS:

- **Node.js**: v22 or higher ([Download Node.js](https://nodejs.org/))
- **Git**: Installed and available in PATH
- **OpenCode CLI**:
  ```bash
  npm install -g opencode-ai
  ```

### Step 2: Set Up GitHub App (One-Time Setup)

Using a GitHub App allows managing reviews across multiple repositories with installation tokens rather than personal access tokens (PAT).

1. Navigate to **GitHub Settings** > **Developer Settings** > **GitHub Apps** > **New GitHub App** (or `https://github.com/settings/apps/new`).
2. Fill in the basic settings:
   - **GitHub App name**: `My AI Reviewer` (or your preferred name)
   - **Homepage URL**: `https://github.com/your-org`
   - **Webhook URL**: `https://<your-domain-or-ngrok>/webhook/github`
   - **Webhook secret**: Generate a secure random string (e.g. using `openssl rand -hex 20`)
3. Configure **Repository Permissions**:
   - `Pull requests`: **Read & Write**
   - `Contents`: **Read**
   - `Metadata`: **Read** (default)
4. Under **Subscribe to events**, select:
   - `Pull request` (`opened`, `synchronize`, `reopened`, `ready_for_review`)
5. Click **Create GitHub App**.
6. On the App settings page:
   - Copy the **App ID**.
   - Scroll down to **Private keys** and click **Generate a private key**. Save the downloaded `.pem` file as `./github-app.private-key.pem` in the project root.
7. Click **Install App** on the left sidebar and install it to your target repositories.

### Step 3: Configure the Reviewer

1. Create `config.yaml` and `.env`:
   ```bash
   cp config.example.yaml config.yaml
   cp .env.example .env
   ```

2. Edit `.env` with your GitHub App details:
   ```ini
   PORT=8080
   WEBHOOK_SECRET=your_webhook_secret_from_step_2
   GITHUB_APP_ID=123456
   GITHUB_PRIVATE_KEY_PATH=./github-app.private-key.pem
   ```

3. Edit `config.yaml` to specify repositories and review behaviors:
   ```yaml
   server:
     port: 8080
     webhook_secret: "${WEBHOOK_SECRET}"

   github:
     app_id: 123456
     private_key_path: "./github-app.private-key.pem"

   opencode:
     server_url: "http://127.0.0.1:4096"
     default_model: "custom/claude-sonnet-4-6"

   repositories:
     your-org/repository-1:
       enabled: true
       base_branch: "main"
       model: "custom/claude-sonnet-4-6"

     your-org/repository-2:
       enabled: true
       base_branch: "main"
       model: "custom/gpt-5-model"
       custom_prompt: |
         - Ensure no internal API keys or secrets are committed.
         - Guard against N+1 database queries.
   ```

### Step 4: Run the Reviewer Service

#### Option A: Local Development Mode
```bash
npm run dev
```

#### Option B: Production Build
```bash
npm run build
npm start
```

#### Option C: Running with Persistent Headless OpenCode Server
Starting OpenCode in headless server mode eliminates cold-boot overhead on each review run:
```bash
# Terminal 1: Start OpenCode Server
OPENCODE_SERVER_PASSWORD=secret opencode serve --port 4096

# Terminal 2: Start Reviewer
npm start
```

#### Option D: Deployment via Docker Compose
```bash
docker compose up -d
```

---

## Verification and Testing

1. **Verify Health Endpoint**:
   ```bash
   curl http://localhost:8080/health
   ```
   Response:
   ```json
   {
     "status": "ok",
     "service": "opencode-pr-reviewer",
     "timestamp": "2026-08-20T13:30:00.000Z"
   }
   ```

2. **Check Queue Status**:
   ```bash
   curl http://localhost:8080/api/jobs
   ```

3. **Test with a Pull Request**:
   Open or push a commit to a Pull Request on any repository where the GitHub App is installed. The webhook receiver will log the event, enqueue the job, run OpenCode review, and post comments on the PR automatically.

---

## Model Selection and Custom Providers

OpenCode handles authentication and custom OpenAI-compatible endpoints directly through your local OpenCode configuration (`~/.config/opencode/opencode.json`).

### Key Benefits
- **No LLM API keys required in this service**: The reviewer service delegates model execution directly to OpenCode.
- **Custom Provider Support**: Use any custom OpenAI-compatible router, gateway, or self-hosted endpoint configured in `opencode.json`.

### Model Identification Format
Specify models using the `<provider_id>/<model_id>` format matching your `opencode.json`:

```yaml
# Global default model
opencode:
  default_model: "custom/claude-sonnet-4-6"

# Per-repository overrides
repositories:
  your-org/repository-1:
    model: "custom/claude-sonnet-4-6"

  your-org/repository-2:
    model: "custom/gpt-5-model"
```

---

## Project Structure

```text
src/
├── config.ts              # YAML and environment variable configuration loader
├── index.ts               # HTTP server and Webhook endpoints
├── github/
│   ├── auth.ts            # GitHub App JWT and Installation token manager
│   ├── client.ts          # GitHub REST API client for reviews and inline comments
│   └── webhook.ts         # HMAC SHA-256 signature verification and payload parser
├── queue/
│   ├── db.ts              # SQLite database initialization
│   └── queue.ts           # Job queue manager and deduplication engine
├── workspace/
│   └── git.ts             # Workspace manager for isolated git clone and fetch
├── reviewer/
│   ├── opencode.ts        # OpenCode runner and server attach client
│   └── parser.ts          # Structured LLM review result JSON parser
└── worker/
    └── worker.ts          # Asynchronous review loop worker
prompts/
├── review.md              # Universal PR code review prompt template (Default)
└── examples/              # Reference prompt templates for specific needs
    ├── opensource-community.md  # Welcoming tone & supply chain checks
    ├── internal-backend.md      # Direct tone & secret / database checks
    └── frontend-app.md          # UI, a11y, and bundle size checks
```
