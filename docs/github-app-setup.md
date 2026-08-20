# GitHub App Creation and Setup Guide

This guide describes how to create, configure, and install a custom **GitHub App** for the **OpenCode PR Reviewer** service.

Using a GitHub App provides security via short-lived asymmetric installation tokens (JWT), granular repository permissions, and automated webhook event delivery.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Step 1: Create a New GitHub App](#step-1-create-a-new-github-app)
3. [Step 2: General Configuration](#step-2-general-configuration)
4. [Step 3: Webhook Configuration](#step-3-webhook-configuration)
5. [Step 4: Repository Permissions](#step-4-repository-permissions)
6. [Step 5: Event Subscriptions](#step-5-event-subscriptions)
7. [Step 6: Generate Private Key and Retrieve App ID](#step-6-generate-private-key-and-retrieve-app-id)
8. [Step 7: Install App on Your Repositories](#step-7-install-app-on-your-repositories)
9. [Troubleshooting and Verification](#troubleshooting-and-verification)

---

## Prerequisites
- A GitHub Account (Personal or Organization administrator).
- A public domain or HTTPS endpoint with an active SSL certificate for receiving webhooks (for example, `https://github.yourdomain.com`).

---

## Step 1: Create a New GitHub App

1. Navigate to:
   - **Personal Account**: [GitHub Settings > Developer Settings > GitHub Apps](https://github.com/settings/apps)
   - **Organization Account**: `https://github.com/organizations/<your-org>/settings/apps`
2. Click **New GitHub App**.

---

## Step 2: General Configuration

Provide the general application information:

| Field | Example Value | Description |
| :--- | :--- | :--- |
| **GitHub App name** | `OpenCode AI PR Reviewer` | Unique name displayed on PR reviews. |
| **Description** | `Automated AI Pull Request code reviewer powered by OpenCode.` | Plain text description of the application. |
| **Homepage URL** | `https://github.com/your-org` | Organization or project URL. |
| **Expire user authorization tokens** | Checked | Recommended security practice. |

---

## Step 3: Webhook Configuration

Configure where GitHub delivers Pull Request webhook events:

1. **Active**: Check `Active` to enable webhook delivery.
2. **Webhook URL**: Enter your public HTTPS webhook endpoint:
   ```text
   https://github.yourdomain.com/webhook/github
   ```
3. **Webhook secret**: Generate a cryptographically secure random string (for example, using `openssl rand -base64 32`) and paste it here. Save this value for your `.env` file (`WEBHOOK_SECRET`).
4. **SSL verification**: Select `Enable SSL verification`.

---

## Step 4: Repository Permissions

Under **Permissions** > **Repository permissions**, configure the following required access levels:

| Permission | Access Level | Rationale |
| :--- | :--- | :--- |
| **Pull requests** | **Read and Write** | Required to post PR reviews, standby comments, and inline code suggestions. |
| **Contents** | **Read-only** | Required to clone repository code and checkout PR branches. |
| **Metadata** | **Read-only** | Default mandatory permission for repository metadata access. |
| **Issues** | **Read and Write** | Required to manage standby status comments in the PR timeline. |

> [!NOTE]
> All other permissions (such as Administration, Checks, Deployments) can remain set to **No access**.

---

## Step 5: Event Subscriptions

Under **Subscribe to events**, select the following event:

- `Pull request`

This subscription triggers webhook deliveries for:
- `opened`: When a new Pull Request is created.
- `synchronize`: When new commits are pushed to an open PR.
- `reopened`: When a closed PR is reopened.
- `ready_for_review`: When a draft PR is marked ready.

---

## Step 6: Generate Private Key and Retrieve App ID

1. Click **Create GitHub App** at the bottom of the page.
2. After creation, copy your **App ID** (for example, `4660077`) located in the **About** section.
3. Scroll down to the **Private keys** section.
4. Click **Generate a private key**. A `.pem` file will be downloaded to your local environment.
5. Move the downloaded `.pem` file to the root of the `opencode-pr-review` project directory:
   ```bash
   mv ~/Downloads/*.private-key.pem ./github-app.private-key.pem
   ```
6. Set restricted file permissions:
   ```bash
   chmod 600 github-app.private-key.pem
   ```

---

## Step 7: Install App on Your Repositories

1. On your GitHub App settings page, click **Install App** in the left navigation sidebar.
2. Select your target account or organization.
3. Choose repository access:
   - **All repositories**: Enables automated reviews for all current and future repositories.
   - **Only select repositories**: Choose specific repositories (for example, `my-backend`, `my-frontend`).
4. Click **Install and Authorize**.

---

## Troubleshooting and Verification

### 1. Verify Webhook Delivery
- Navigate to **GitHub App Settings** > **Advanced** > **Recent Deliveries**.
- Review delivery logs for incoming events.
- Successful deliveries return **HTTP 200** with the response payload:
  ```json
  { "status": "ok", "message": "PR review job enqueued", "job_id": 1 }
  ```

### 2. Verify Private Key Matching
If service logs report `HttpError: Integration not found` or `Bad credentials`:
- Verify that the `App ID` in `config.yaml` matches the App ID displayed on GitHub.
- Verify that `github-app.private-key.pem` corresponds to the private key generated for that exact GitHub App.
