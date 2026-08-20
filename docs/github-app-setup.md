# 🔐 GitHub App Creation & Setup Guide

This guide walks you through creating, configuring, and installing a custom **GitHub App** for the **OpenCode PR Reviewer** bot.

Using a GitHub App provides production-grade security via short-lived asymmetric installation tokens (JWT), fine-grained repository permissions, and automated webhook event delivery.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Create a New GitHub App](#step-1-create-a-new-github-app)
3. [Step 2: General Configuration](#step-2-general-configuration)
4. [Step 3: Webhook Configuration](#step-3-webhook-configuration)
5. [Step 4: Repository Permissions](#step-4-repository-permissions)
6. [Step 5: Event Subscriptions](#step-5-event-subscriptions)
7. [Step 6: Generate Private Key & Retrieve App ID](#step-6-generate-private-key--retrieve-app-id)
8. [Step 7: Install App on Your Repositories](#step-7-install-app-on-your-repositories)
9. [Troubleshooting & Verification](#troubleshooting--verification)

---

## Prerequisites
- A GitHub Account (Personal or Organization admin).
- A public domain or HTTPS endpoint with an active SSL certificate for receiving Webhooks (e.g. `https://github.yourdomain.com`).

---

## Step 1: Create a New GitHub App

1. Navigate to:
   - **Personal Account**: [GitHub Settings > Developer Settings > GitHub Apps](https://github.com/settings/apps)
   - **Organization**: `https://github.com/organizations/<your-org>/settings/apps`
2. Click **New GitHub App**.

---

## Step 2: General Configuration

Fill in the general application information:

| Field | Example Value | Description |
| :--- | :--- | :--- |
| **GitHub App name** | `OpenCode AI PR Reviewer` | Unique name displayed on PR reviews. |
| **Description** | `Automated AI Pull Request code reviewer powered by OpenCode.` | Plain text description of the bot. |
| **Homepage URL** | `https://github.com/your-org` | Your organization or project URL. |
| **Expire user authorization tokens** | `[x]` Checked | Recommended security practice. |

---

## Step 3: Webhook Configuration

Configure where GitHub should send Pull Request events:

1. **Active**: Check `[x] Active` to enable webhook event delivery.
2. **Webhook URL**: Enter your public HTTPS webhook endpoint:
   ```text
   https://github.yourdomain.com/webhook/github
   ```
3. **Webhook secret**: Generate a cryptographically secure random string (e.g. run `openssl rand -base64 32` in terminal) and paste it here. Save this secret for your `.env` file (`WEBHOOK_SECRET`).
4. **SSL verification**: Select `Enable SSL verification`.

---

## Step 4: Repository Permissions

Under **Permissions** > **Repository permissions**, configure the following minimum required permissions:

| Permission | Access Level | Rationale |
| :--- | :--- | :--- |
| **Pull requests** | **Read & Write** | Required to post PR reviews, standby comments, and inline code suggestions. |
| **Contents** | **Read-only** | Required to clone repository code and checkout PR branches. |
| **Metadata** | **Read-only** | Mandatory default permission for repository metadata access. |
| **Issues** | **Read & Write** | Required to post and update standby status comments in the PR timeline. |

> [!NOTE]
> All other permissions (e.g. Administration, Checks, Deployments) can remain **No access**.

---

## Step 5: Event Subscriptions

Under **Subscribe to events**, check the following event:

- `[x] Pull request`

This will trigger webhooks for:
- `opened`: When a new Pull Request is created.
- `synchronize`: When new commits are pushed to an open PR.
- `reopened`: When a closed PR is reopened.
- `ready_for_review`: When a draft PR is marked ready.

---

## Step 6: Generate Private Key & Retrieve App ID

1. Click **Create GitHub App** at the bottom of the page.
2. After creation, copy your **App ID** (e.g. `4660077`) located in the **About** section.
3. Scroll down to the **Private keys** section.
4. Click **Generate a private key**. A `.pem` file will automatically download to your computer.
5. Move the downloaded `.pem` file to the root of your `opencode-pr-review` project directory and name it:
   ```bash
   github-app.private-key.pem
   ```
6. Set secure file permissions:
   ```bash
   chmod 600 github-app.private-key.pem
   ```

---

## Step 7: Install App on Your Repositories

1. On your GitHub App settings page, click **Install App** in the left sidebar.
2. Select your account or organization.
3. Choose repository access:
   - **All repositories**: Enables automated reviews for all current and future repositories.
   - **Only select repositories**: Choose specific repositories (e.g., `ogm-lightweight`, `my-backend`).
4. Click **Install & Authorize**.

---

## Troubleshooting & Verification

### 1. Verify Webhook Delivery
- Go to **GitHub App Settings** > **Advanced** > **Recent Deliveries**.
- You will see live delivery logs for every PR event.
- Successful deliveries return **HTTP 200** with response body:
  ```json
  { "status": "ok", "message": "PR review job enqueued", "job_id": 1 }
  ```

### 2. Verify Private Key Matching
If the service logs show `HttpError: Integration not found` or `Bad credentials`:
- Ensure the `App ID` in `config.yaml` matches the App ID displayed on GitHub.
- Ensure `github-app.private-key.pem` is the private key generated from that exact App.
