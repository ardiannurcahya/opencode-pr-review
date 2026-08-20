# 🚀 Running & Deployment Guide

This guide covers running, managing, and deploying the **OpenCode PR Reviewer** service in production using **systemd**, **Docker Compose**, or standalone Node.js.

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [OpenCode Engine Configuration](#2-opencode-engine-configuration)
3. [Environment Variables & Configuration Files](#3-environment-variables--configuration-files)
4. [Deployment Option 1: systemd Service (Recommended on Linux VPS)](#4-deployment-option-1-systemd-service-recommended)
5. [Deployment Option 2: Docker Compose](#5-deployment-option-2-docker-compose)
6. [Deployment Option 3: Manual Node.js](#6-deployment-option-3-manual-nodejs)
7. [Service Management & Monitoring Commands](#7-service-management--monitoring-commands)
8. [Configuring and Switching AI Models](#8-configuring-and-switching-ai-models)

---

## 1. Prerequisites

Ensure the following are installed on your host system:
- **Node.js**: `v20.0.0` or higher (`v22+` recommended).
- **Git**: Installed and configured in system `PATH`.
- **OpenCode CLI**: Installed globally:
  ```bash
  npm install -g opencode-ai
  ```

---

## 2. OpenCode Engine Configuration

The reviewer leverages your existing OpenCode authentication and custom OpenAI-compatible providers configured in `~/.config/opencode/opencode.json`.

### Example Provider Setup in `~/.config/opencode/opencode.json`:
```json
{
  "server": {
    "hostname": "127.0.0.1",
    "port": 4096
  },
  "provider": {
    "trade": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLM Agent Trade",
      "options": {
        "baseURL": "https://api.llm-agent-trade.my.id/v1",
        "apiKey": "{file:~/.config/opencode/secrets/llm-agent-trade.key}"
      },
      "models": {
        "fireworks/accounts/fireworks/models/deepseek-v4-flash-0731": {
          "name": "DeepSeek V4 Flash 0731",
          "limit": {
            "context": 1000000,
            "output": 131072
          }
        },
        "cx/gpt-5.6-luna": {
          "name": "GPT-5.6 Luna",
          "limit": {
            "context": 262144,
            "output": 131072
          }
        }
      }
    }
  }
}
```

Verify your model works directly in terminal:
```bash
opencode run --model trade/fireworks/accounts/fireworks/models/deepseek-v4-flash-0731 "ping"
```

---

## 3. Environment Variables & Configuration Files

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
GITHUB_APP_ID=4660077

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
  app_id: 4660077
  private_key_path: "./github-app.private-key.pem"

# OpenCode Engine configuration
opencode:
  default_model: "trade/fireworks/accounts/fireworks/models/deepseek-v4-flash-0731"
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
    model: "trade/fireworks/accounts/fireworks/models/deepseek-v4-flash-0731"

  your-org/my-frontend:
    enabled: true
    base_branch: "main"
    model: "trade/cx/gpt-5.6-luna"
    custom_prompt: |
      - Prioritize accessibility (a11y), responsive design, and React re-render optimization.
```

---

## 4. Deployment Option 1: systemd Service (Recommended)

Running as a systemd service ensures automatic restart on boot, crash recovery, and centralized logging via `journalctl`.

### Step 1: Create systemd Unit File
Create `/etc/systemd/system/opencode-pr-review.service`:

```ini
[Unit]
Description=OpenCode AI Pull Request Reviewer Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/opencode-pr-review
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/path/to/opencode-pr-review/.env

# Standard output and error to systemd journal
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Step 2: Build, Enable & Start Service
```bash
# Build TypeScript code
npm run build

# Reload systemd, enable service on boot, and start
sudo systemctl daemon-reload
sudo systemctl enable opencode-pr-review
sudo systemctl start opencode-pr-review

# Check status
sudo systemctl status opencode-pr-review
```

---

## 5. Deployment Option 2: Docker Compose

If you prefer running in containerized environments:

### `docker-compose.yml`:
```yaml
version: '3.8'

services:
  opencode-pr-reviewer:
    build: .
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

Run container in background:
```bash
docker compose up -d --build
```

---

## 6. Deployment Option 3: Manual Node.js

```bash
# Development Mode (Hot-reload)
npm run dev

# Production Mode
npm run build
npm start
```

---

## 7. Service Management & Monitoring Commands

### View Live Execution Logs:
```bash
# Follow logs in real-time
sudo journalctl -u opencode-pr-review -f

# View last 50 lines
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

To switch models, simply edit `opencode.default_model` or the per-repo `model` field in `config.yaml` and restart the service:

```bash
# Edit config.yaml
# Change: default_model: "trade/cx/gpt-5.6-luna"

# Restart service to apply
sudo systemctl restart opencode-pr-review
```
