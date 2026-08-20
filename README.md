<div align="center">

# 🤖 OpenCode AI PR Reviewer

### *Automated, Production-Grade AI Code Reviewer for GitHub Pull Requests*

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub App](https://img.shields.io/badge/GitHub%20App-Asymmetric%20Auth-181717?style=for-the-badge&logo=github&logoColor=white)](https://docs.github.com/en/apps)
[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Engine-8A2BE2?style=for-the-badge)](https://opencode.ai)
[![SQLite](https://img.shields.io/badge/SQLite-Zero%20Dependency-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)

<p align="center">
  <b>Instant Standby Feedback</b> • 
  <b>GitHub Native Alert Badges</b> • 
  <b>Smart Commit Deduplication</b> • 
  <b>Zero Noise on Clean PRs</b>
</p>

---

</div>

## 📖 Overview

**OpenCode PR Reviewer** is a lightweight, self-hosted automated Pull Request review system. It connects directly to your GitHub organization using a **GitHub App**, listens to PR events in real-time, conducts deep static and semantic analysis with **OpenCode AI**, and posts constructive inline comments with native **GitHub Alert Badges**.

```
Developer Opens PR ──> Webhook (<1s) ──> Standby Comment ("⏳ Analyzing...") ──> OpenCode Review ──> Clean Review / [!CAUTION] Alerts
```

---

## 📚 Complete Documentation Guides

| Guide | Description |
| :--- | :--- |
| 🔐 **[GitHub App Creation & Setup](docs/github-app-setup.md)** | Step-by-step instructions on creating the GitHub App, configuring permissions, generating private keys, and repository installation. |
| 🌐 **[Custom Domain & Reverse Proxy](docs/domain-and-reverse-proxy.md)** | Guide for DNS A-record setup, Caddy (auto SSL), Nginx + Certbot, and Cloudflare Tunnels. |
| 🚀 **[Running & Deployment Guide](docs/running-and-deployment.md)** | Production deployment using systemd services, Docker Compose, logging, and model switching. |
| 🏛️ **[Architecture & Workflow Deep Dive](docs/architecture-and-workflow.md)** | Technical breakdown with Mermaid flowcharts, sequence diagrams, NDJSON stream parsing, and queue deduplication. |

---

## ✨ Key Features

- **⚡ Instant Standby Feedback**: Posts an initial `⏳ AI Code Reviewer is analyzing...` comment within 2 seconds of PR creation, then automatically removes it once the official review is published.
- **🏷️ GitHub Native Alert Formatting**: Employs GitHub markdown callouts (`> [!CAUTION]`, `> [!WARNING]`, `> [!NOTE]`) for maximum visual clarity on code diffs.
- **🔇 Zero Conversation Clutter**: Clean PRs receive an **`APPROVE`** verdict with a concise summary and **zero inline threads**, eliminating repetitive "Resolve conversation" clicks.
- **🧠 Smart Commit Deduplication**: If a developer pushes multiple commits rapidly, outdated review jobs are automatically superseded, saving AI token compute.
- **🛡️ Asymmetric Security**: Uses short-lived GitHub App installation tokens (JWT) rather than static Personal Access Tokens.
- **🧩 Universal & Custom Prompts**: Global standardized review rules in [`prompts/review.md`](prompts/review.md) with per-repository customization support.
- **🔌 Multi-Provider LLM Engine**: Seamlessly route different repositories to different models (e.g. DeepSeek V4 Flash, GPT-5.6, Claude) via your local OpenCode configuration (`~/.config/opencode/opencode.json`).

---

## 🏗️ Architecture

```mermaid
flowchart LR
    GH[GitHub PR Event] -->|HTTPS Webhook| Caddy[Caddy / Reverse Proxy]
    Caddy -->|POST /webhook/github| App[Webhook Service]
    App -->|HMAC Verification| Queue[(SQLite Queue)]
    Queue -->|Superseded Check| Worker[Review Worker]
    Worker -->|1. Post Standby| GH
    Worker -->|2. Git Checkout| Workspace[Isolated Workspace]
    Worker -->|3. Run Review| Engine[OpenCode Engine]
    Engine -->|4. NDJSON Stream| Parser[Stream Parser]
    Parser -->|5. Post Review & Clean Standby| GH
```

---

## ⚡ 3-Minute Quick Start

### 1. Clone and Install Dependencies
```bash
git clone https://github.com/ardiannurcahya/opencode-pr-review.git
cd opencode-pr-review
npm install
```

### 2. Configure Environment & App Credentials
```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

Edit `.env`:
```ini
PORT=8088
WEBHOOK_SECRET=your_webhook_secret_from_github_app
GITHUB_APP_ID=4660077
GITHUB_PRIVATE_KEY_PATH=./github-app.private-key.pem
```

Edit `config.yaml`:
```yaml
server:
  port: 8088
  webhook_secret: "${WEBHOOK_SECRET}"

github:
  app_id: 4660077
  private_key_path: "./github-app.private-key.pem"

opencode:
  default_model: "trade/fireworks/accounts/fireworks/models/deepseek-v4-flash-0731"
  timeout_seconds: 300

repositories:
  your-org/your-repo:
    enabled: true
    base_branch: "main"
```

### 3. Build and Run
```bash
npm run build
npm start
```

---

## 📊 Sample Review Outputs

### 1. Clean PR Output (`APPROVE`)
```markdown
## 🤖 AI Code Review Summary

**Verdict**: ✅ `APPROVE`

### 📝 Summary
• Feature implementation is robust and follows repository standards.
• No security vulnerabilities, resource leaks, or breaking changes identified.
• Safe to merge.

**Status**: ✨ Clean! Code is approved and ready to merge.
```

### 2. Critical Security Defect Output (`REQUEST_CHANGES`)
```markdown
## 🤖 AI Code Review Summary

**Verdict**: ❌ `REQUEST_CHANGES`

### 📝 Summary
• Hardcoded production secret identified in source code.
• Raw SQL string concatenation creates critical SQL Injection risk. Do not merge.

**Blocking Issues**: 🚨 2 critical issue(s) identified. Must be resolved before merge.
```

**Inline Comment Example on Diff**:
```markdown
> [!CAUTION]
> **CRITICAL**: SQL injection vulnerability: raw string concatenation of `username` allows authentication bypass. Replace with parameterized query `db.QueryRow("SELECT ... WHERE user = ?", username)`.
```

---

## 📂 Project Structure

```text
opencode-pr-review/
├── docs/                                # Dedicated Documentation Guides
│   ├── github-app-setup.md              # GitHub App creation & installation
│   ├── domain-and-reverse-proxy.md      # DNS, Caddy, Nginx & SSL setup
│   ├── running-and-deployment.md        # systemd, Docker, and logging
│   └── architecture-and-workflow.md     # Deep-dive architecture & sequence
├── prompts/                             # Review Prompts
│   ├── review.md                        # Master pragmatic review prompt
│   └── examples/                        # Specialized prompts (backend/frontend/OSS)
├── src/                                 # TypeScript Source Code
│   ├── index.ts                         # Webhook server & health endpoints
│   ├── config.ts                        # YAML & ENV configuration loader
│   ├── github/                          # GitHub App JWT & REST Client
│   ├── queue/                           # SQLite Queue & Deduplication
│   ├── reviewer/                        # OpenCode Runner & NDJSON Parser
│   ├── worker/                          # Background Review Worker Loop
│   └── workspace/                       # Git Clone & Branch Checkout Manager
├── config.example.yaml                  # Configuration Template
├── docker-compose.yml                   # Docker Deployment Definition
├── Dockerfile                           # Container Buildfile
├── package.json                         # Project Metadata & Scripts
└── test-audit.mjs                       # Automated Audit Test Suite
```

---

## 🧪 Testing

Run the built-in test suite to verify queue deduplication, HMAC verification, NDJSON stream parsing, and prompt templates:

```bash
npm test
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
