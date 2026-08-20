# Custom Domain and Reverse Proxy Configuration Guide

To receive webhooks from GitHub, your server must expose an HTTPS endpoint with a valid SSL/TLS certificate. This guide covers DNS setup, reverse proxy configuration (Caddy and Nginx), and firewall settings.

---

## Table of Contents
1. [DNS Record Configuration](#1-dns-record-configuration)
2. [Firewall Configuration](#2-firewall-configuration)
3. [Reverse Proxy Option A: Caddy (Recommended)](#3-reverse-proxy-option-a-caddy-recommended)
4. [Reverse Proxy Option B: Nginx and Certbot](#4-reverse-proxy-option-b-nginx-and-certbot)
5. [Reverse Proxy Option C: Cloudflare Tunnel (No Public IP Required)](#5-reverse-proxy-option-c-cloudflare-tunnel)
6. [Testing and Verification](#6-testing-and-verification)

---

## 1. DNS Record Configuration

In your DNS management console (such as Cloudflare, Route53, Namecheap, or GoDaddy), create an **A Record** pointing your subdomain to your VPS public IPv4 address:

| Record Type | Host / Subdomain | Target / IPv4 Address | TTL | Proxy Status |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `github` (or `review`) | `YOUR_SERVER_PUBLIC_IP` | Auto / 1 min | DNS Only (or Proxied) |

*Example Fully Qualified Domain Name (FQDN): `https://github.yourdomain.com`*

---

## 2. Firewall Configuration

Ensure incoming traffic on HTTP (port 80) and HTTPS (port 443) is allowed on your server firewall:

```bash
# Ubuntu / Debian (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload

# Verify active status
sudo ufw status
```

---

## 3. Reverse Proxy Option A: Caddy (Recommended)

[Caddy](https://caddyserver.com/) automatically handles certificate issuance and renewals via Let's Encrypt with minimal configuration.

### Step 1: Install Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

### Step 2: Configure Caddyfile
Edit `/etc/caddy/Caddyfile`:

```caddy
github.yourdomain.com {
    reverse_proxy localhost:8088 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    encode gzip zstd

    log {
        output file /var/log/caddy/github_webhook.log
    }
}
```

### Step 3: Restart Caddy
```bash
sudo systemctl restart caddy
sudo systemctl status caddy
```

---

## 4. Reverse Proxy Option B: Nginx and Certbot

For environments using Nginx:

### Step 1: Create Nginx Virtual Host Configuration
Create `/etc/nginx/sites-available/github-webhook`:

```nginx
server {
    server_name github.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

### Step 2: Enable Site and Obtain SSL Certificate
```bash
sudo ln -s /etc/nginx/sites-available/github-webhook /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Issue Let's Encrypt certificate via Certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d github.yourdomain.com
```

---

## 5. Reverse Proxy Option C: Cloudflare Tunnel

For environments with dynamic IP addresses or private networks behind NAT:

1. Install `cloudflared`:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. Authenticate and create tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create github-reviewer
   ```
3. Route traffic to `localhost:8088`:
   ```bash
   cloudflared tunnel route dns github-reviewer github.yourdomain.com
   cloudflared tunnel run --url http://localhost:8088 github-reviewer
   ```

---

## 6. Testing and Verification

### 1. Test Health Endpoint via cURL
Run from an external terminal:
```bash
curl -i https://github.yourdomain.com/health
```

Expected Response:
```http
HTTP/2 200
content-type: application/json; charset=utf-8

{
  "status": "ok",
  "service": "opencode-pr-reviewer",
  "version": "1.0.0"
}
```

### 2. Configure GitHub Webhook URL
In your GitHub App settings, set:
- **Webhook URL**: `https://github.yourdomain.com/webhook/github`
- **Active**: Checked
- **Webhook Secret**: Matches `WEBHOOK_SECRET` defined in `.env`
