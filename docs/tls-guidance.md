# TLS / Reverse Proxy Guidance

`code-intel` ships an HTTP server (default `:4747`) that **does not terminate
TLS** itself. For any networked deployment, place it behind a reverse proxy
that handles TLS termination, HTTP/2, and (optionally) WebSocket upgrades.

This document covers tested configurations for:

- [nginx](#nginx) — battle-tested, ubiquitous
- [caddy](#caddy) — automatic Let's Encrypt, simple config
- [Notes for production](#production-checklist)

---

## nginx

### Minimal HTTPS reverse proxy

```nginx
# /etc/nginx/sites-available/code-intel.conf
server {
    listen 443 ssl http2;
    server_name code-intel.example.com;

    # TLS — managed by certbot or your own pipeline
    ssl_certificate     /etc/letsencrypt/live/code-intel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/code-intel.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # HSTS — match what `helmet` already sets, but also enforce at edge
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Body size — keep in sync with the app's express.json({ limit: '1mb' })
    client_max_body_size 1m;

    location / {
        proxy_pass         http://127.0.0.1:4747;
        proxy_http_version 1.1;

        # Forward client info so app.set('trust proxy', 1) sees the real IP
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # WebSocket upgrade support
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        $connection_upgrade;

        # Reasonable timeouts; raise for long-running analyze jobs
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

# Redirect plain HTTP → HTTPS
server {
    listen 80;
    server_name code-intel.example.com;
    return 301 https://$host$request_uri;
}
```

Add this to `nginx.conf` (http block) for the WebSocket Connection-upgrade
mapping:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Then enable the site and reload:

```bash
sudo ln -s /etc/nginx/sites-available/code-intel.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## caddy

Caddy auto-provisions Let's Encrypt certificates and renews them.

```caddy
# /etc/caddy/Caddyfile
code-intel.example.com {
    encode gzip

    # Body size cap (matches express.json limit)
    request_body {
        max_size 1MB
    }

    reverse_proxy 127.0.0.1:4747 {
        # Forward client IP for app.set('trust proxy', 1)
        header_up X-Real-IP        {remote_host}
        header_up X-Forwarded-For  {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

---

## Environment variables

When deployed behind a proxy, set these in the `code-intel` environment:

| Variable                       | Example                                    | Purpose                                          |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| `NODE_ENV`                     | `production`                               | Enables `Secure` cookies, strict SameSite, HSTS  |
| `CODE_INTEL_CORS_ORIGINS`      | `https://code-intel.example.com`           | Comma-separated allowlist; rejects all others    |
| `CODE_INTEL_CSRF_SECRET`       | (a 32+ byte random hex string)             | Required in prod; do **not** use the default     |
| `CODE_INTEL_SESSION_TTL_HOURS` | `8`                                        | Session lifetime (sliding window)                |

Example `.env`:

```bash
NODE_ENV=production
CODE_INTEL_CORS_ORIGINS=https://code-intel.example.com
CODE_INTEL_CSRF_SECRET=$(openssl rand -hex 32)
```

---

## Production checklist

- [ ] TLS certificate obtained (Let's Encrypt or corporate CA)
- [ ] `NODE_ENV=production` set on the app process
- [ ] `CODE_INTEL_CORS_ORIGINS` contains **only** the public hostname(s)
- [ ] `CODE_INTEL_CSRF_SECRET` is a strong random value (not the default)
- [ ] Reverse proxy forwards `X-Forwarded-For` / `X-Forwarded-Proto`
- [ ] Reverse proxy enforces `client_max_body_size` ≤ `1m` (matches app cap)
- [ ] WebSocket `Connection: upgrade` mapping configured (nginx) or implicit (caddy)
- [ ] HSTS active at the edge (`Strict-Transport-Security`)
- [ ] HTTP → HTTPS redirect in place
- [ ] Firewall blocks direct access to `:4747` from the public internet

---

## Verifying the setup

```bash
# Should return 200 with HSTS header
curl -I https://code-intel.example.com/health/live

# Should reject requests with bad Origin
curl -I -H "Origin: https://evil.example.com" https://code-intel.example.com/api/v1/repos
# → no Access-Control-Allow-Origin header echoed

# Should reject payloads > 1MB
dd if=/dev/zero bs=1M count=2 | \
  curl -X POST -H 'Content-Type: application/json' --data-binary @- \
       https://code-intel.example.com/api/v1/search
# → 413 Payload Too Large
```
