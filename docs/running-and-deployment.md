# Running and Deployment Guide

This guide covers configuring, managing, and deploying the **OpenCode PR Reviewer** service in production using **systemd**, **Docker Compose**, or standalone Node.js.

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [OpenCode Engine Configuration](#2-opencode-engine-configuration)
3. [Environment Variables and Configuration Files](#3-environment-variables-and-configuration-files)
4. [Deployment Option 1: NPM Global Package (Recommended)](#4-deployment-option-1-npm-global-package-recommended)
5. [Deployment Option 2: Prebuilt Docker Container (GHCR)](#5-deployment-option-2-prebuilt-docker-container-ghcr)
6. [Deployment Option 3: From Source Code](#6-deployment-option-3-from-source-code)
7. [Service Management and Monitoring Commands](#7-service-management-and-monitoring-commands)
8. [Configuring and Switching AI Models](#8-configuring-and-switching-ai-models)

---

## 1. Prerequisites

Ensure the following dependencies are installed on the host system:
- **Node.js**: Version 20.0.0 or higher (version 22+ recommended).
- **Git**: Installed and available in system `PATH`.
- **OpenCode CLI**: Installed globally:
  ```bash
  npm install -g opencode-ai
  ```

---

## 2. OpenCode Engine Configuration

The reviewer utilizes local OpenCode configuration and custom OpenAI-compatible providers defined in `~/.config/opencode/opencode.json`.

### Example Template Setup in `~/.config/opencode/opencode.json`:
```json
{
  "server": {
    "hostname": "127.0.0.1",
    "port": 4096
  },
  "provider": {
    "custom_ai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Custom OpenAI-Compatible Gateway",
      "options": {
        "baseURL": "https://api.your-ai-gateway.com/v1",
        "apiKey": "{file:~/.config/opencode/secrets/gateway.key}"
      },
      "models": {
        "deepseek-ai/deepseek-coder": {
          "name": "DeepSeek Coder V3",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "anthropic/claude-3-5-sonnet": {
          "name": "Claude 3.5 Sonnet",
          "limit": {
            "context": 200000,
            "output": 8192
          }
        }
      }
    }
  }
}
```

Verify model connectivity directly in terminal:
```bash
opencode run --model custom_ai/deepseek-ai/deepseek-coder "ping"
```

---

## 3. Environment Variables and Configuration Files

### 1. `.env` File
Create `.env` from template:
```bash
cp .env.example .env
```

```ini
# Server Port
PORT=8088

# Webhook Secret configured in GitHub App
WEBHOOK_SECRET=your_secure_webhook_secret_here

# GitHub App ID
GITHUB_APP_ID=123456

# Path to GitHub App Private Key PEM file
GITHUB_PRIVATE_KEY_PATH=./github-app.private-key.pem
```

### 2. `config.yaml` File
```yaml
# Server configuration
server:
  port: 8088
  webhook_secret: "${WEBHOOK_SECRET}"

# GitHub App configuration
github:
  app_id: 123456
  private_key_path: "./github-app.private-key.pem"

# OpenCode Engine configuration
opencode:
  default_model: "custom_ai/deepseek-ai/deepseek-coder"
  timeout_seconds: 300

# Git workspaces configuration
workspace:
  base_dir: "./workspaces"
  clean_after_review: false

# Per-Repository routing and configuration
repositories:
  your-org/my-backend:
    enabled: true
    base_branch: "main"
    model: "custom_ai/deepseek-ai/deepseek-coder"

  your-org/my-frontend:
    enabled: true
    base_branch: "main"
    model: "custom_ai/anthropic/claude-3-5-sonnet"
    custom_prompt: |
      - Prioritize accessibility (a11y), responsive design, and React re-render optimization.
```

---

## 4. Deployment Option 1: NPM Global Package (Recommended)

Installing the published package from the NPM registry provides a simple global executable `opencode-pr-review` with zero build overhead.

### Step 1: Install Globally
```bash
npm install -g opencode-pr-review
```

### Step 2: Setup Directory & Configurations
```bash
mkdir -p /etc/opencode-pr-review
cd /etc/opencode-pr-review

# Place your .env, config.yaml, and github-app.private-key.pem here
```

### Step 3: Create systemd Unit File
Create `/etc/systemd/system/opencode-pr-review.service`:

```ini
[Unit]
Description=OpenCode AI Pull Request Reviewer Service (NPM)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/etc/opencode-pr-review
ExecStart=/usr/bin/env opencode-pr-review
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/etc/opencode-pr-review/.env

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Step 4: Enable and Start Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode-pr-review
sudo systemctl start opencode-pr-review
sudo systemctl status opencode-pr-review
```

---

## 5. Deployment Option 2: Prebuilt Docker Container (GHCR)

Run the production container directly from the GitHub Container Registry without needing a Node.js or TypeScript compiler toolchain on the host.

### Using Docker CLI:
```bash
docker run -d \
  --name opencode-pr-reviewer \
  --restart unless-stopped \
  -p 8088:8088 \
  --env-file /etc/opencode-pr-review/.env \
  -v /etc/opencode-pr-review/config.yaml:/app/config.yaml:ro \
  -v /etc/opencode-pr-review/github-app.private-key.pem:/app/github-app.private-key.pem:ro \
  -v /var/lib/opencode-pr-review/data:/app/data \
  -v /var/lib/opencode-pr-review/workspaces:/app/workspaces \
  -v ~/.config/opencode:/root/.config/opencode:ro \
  ghcr.io/ardiannurcahya/opencode-pr-review:latest
```

### Using Docker Compose (`docker-compose.yml`):
```yaml
version: '3.8'

services:
  opencode-pr-reviewer:
    image: ghcr.io/ardiannurcahya/opencode-pr-review:latest
    container_name: opencode-pr-reviewer
    restart: unless-stopped
    ports:
      - "8088:8088"
    env_file:
      - .env
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./github-app.private-key.pem:/app/github-app.private-key.pem:ro
      - ./data:/app/data
      - ./workspaces:/app/workspaces
      - ~/.config/opencode:/root/.config/opencode:ro
```

Run in background:
```bash
docker compose up -d
```

---

## 6. Deployment Option 3: From Source Code

For active development or custom modifications:

### Step 1: Clone and Build
```bash
git clone https://github.com/ardiannurcahya/opencode-pr-review.git /opt/opencode-pr-review
cd /opt/opencode-pr-review
npm install
npm run build
```

### Step 2: Run Service
```bash
# Direct run
npm start

# Or via Development Watcher
npm run dev
```

---

## 7. Service Management and Monitoring Commands

### View Live Execution Logs:
```bash
# Follow logs in real-time
sudo journalctl -u opencode-pr-review -f

# View last 50 lines without paging
sudo journalctl -u opencode-pr-review -n 50 --no-pager
```

### Restart Service:
```bash
sudo systemctl restart opencode-pr-review
```

### Query Live Review Job Queue:
```bash
curl -s http://localhost:8088/api/jobs | jq .
```

### Service Health Check:
```bash
curl -s http://localhost:8088/health | jq .
```

---

## 8. Configuring and Switching AI Models

To switch models, update `opencode.default_model` or the per-repository `model` parameter in `config.yaml` and restart the service:

```bash
# Edit config.yaml
# Change: default_model: "custom_ai/anthropic/claude-3-5-sonnet"

# Restart service to apply changes
sudo systemctl restart opencode-pr-review
```
