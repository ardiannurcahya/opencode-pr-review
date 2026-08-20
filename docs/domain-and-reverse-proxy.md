# 🌐 Custom Domain & Reverse Proxy Configuration Guide

To receive real-time webhooks from GitHub, your server must expose an HTTPS endpoint with a valid SSL/TLS certificate. This guide covers DNS setup, reverse proxy configuration (Caddy & Nginx), and firewall settings.

---

## Table of Contents
1. [DNS Record Configuration](#1-dns-record-configuration)
2. [Firewall Configuration](#2-firewall-configuration)
3. [Reverse Proxy Option A: Caddy (Recommended)](#3-reverse-proxy-option-a-caddy-recommended)
4. [Reverse Proxy Option B: Nginx + Certbot](#4-reverse-proxy-option-b-nginx--certbot)
5. [Reverse Proxy Option C: Cloudflare Tunnel (No Public IP Needed)](#5-reverse-proxy-option-c-cloudflare-tunnel)
6. [Testing & Verifying the Webhook Endpoint](#6-testing--verifying-the-webhook-endpoint)

---

## 1. DNS Record Configuration

In your DNS provider (Cloudflare, Namecheap, Route53, GoDaddy, etc.), create an **A Record** pointing your subdomain to your VPS public IPv4 address:

| Type | Name / Subdomain | Target / IP Address | TTL | Proxy Status |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `github` (or `review`) | `YOUR_SERVER_PUBLIC_IP` | Auto / 1 min | DNS Only (or Proxied) |

*Example Subdomain: `https://github.yourdomain.com`*

---

## 2. Firewall Configuration

Ensure incoming traffic on HTTP (80) and HTTPS (443) ports is allowed on your VPS firewall:

```bash
# Ubuntu / Debian (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload

# Verify status
sudo ufw status
```

---

## 3. Reverse Proxy Option A: Caddy (Recommended)

[Caddy](https://caddyserver.com/) automatically provisions and renews Let's Encrypt SSL/TLS certificates with zero manual intervention.

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

    # Enable gzip & zstd compression
    encode gzip zstd

    # Access logs
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

## 4. Reverse Proxy Option B: Nginx + Certbot

If your server already uses Nginx, follow these steps:

### Step 1: Create Nginx Virtual Host
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

        # Webhook timeout settings
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

# Obtain SSL certificate via Certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d github.yourdomain.com
```

---

## 5. Reverse Proxy Option C: Cloudflare Tunnel

If your VPS has a dynamic IP or is behind a NAT/firewall without open ports:

1. Install `cloudflared`:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. Login and create tunnel:
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

## 6. Testing & Verifying the Webhook Endpoint

### 1. Test Health Endpoint via cURL
Run from your local terminal:
```bash
curl -i https://github.yourdomain.com/health
```

Expected Output:
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
- **Active**: `[x] Active`
- **Webhook Secret**: Matches `WEBHOOK_SECRET` in `.env`
