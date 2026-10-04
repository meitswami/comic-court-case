# 🚢 Deployment (VPS)

eNyayaSetu runs on our own VPS at
**https://enyayasetu.meitcybersolutions.com/**. There is no third-party
hosting platform involved.

```
Browser ──HTTPS──▶ nginx ──┬── /            static files from dist/ (SPA fallback to index.html)
                           ├── /api/*       ─▶ Express (server/index.js) on 127.0.0.1:3000
                           ├── /health      ─▶ Express
                           └── /uploads/*   ─▶ Express
                                                   │
                                                   ▼
                                                 MySQL
```

- **nginx** terminates HTTPS, serves the built frontend and proxies the API.
- **Express** (`server/index.js`) is one long-running Node process.
- Frontend and API share one origin, so `VITE_API_URL` stays blank.

> The nginx and systemd snippets below are **reference configs**. Adjust
> paths, user and port to match the server before using them.

## 1. First-time setup

```bash
# Node.js 18+ and nginx must be installed on the server
sudo mkdir -p /var/www/enyayasetu
cd /var/www/enyayasetu
git clone https://github.com/meitswami/comic-court-case.git .

npm ci

cp .env.example .env
nano .env          # DB_*, JWT_SECRET, API_PORT=3000, NODE_ENV=production; leave VITE_API_URL blank

# Apply every numbered file in mysql/migrations/ (mysql CLI or phpMyAdmin)
mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" < mysql/migrations/001_initial_schema.sql

npm run build      # writes the frontend to dist/
```

## 2. Run the API as a service

`/etc/systemd/system/enyayasetu-api.service`:

```ini
[Unit]
Description=eNyayaSetu API (Express)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/enyayasetu
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` must be the repo root: the server reads `.env` from
there and stores evidence uploads in `public/uploads/`, so the service
user needs write access to that folder.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now enyayasetu-api
sudo systemctl status enyayasetu-api
journalctl -u enyayasetu-api -f      # live logs
```

(pm2 works just as well: `pm2 start server/index.js --name enyayasetu-api`.)

## 3. nginx site

`/etc/nginx/sites-available/enyayasetu`:

```nginx
server {
    listen 80;
    server_name enyayasetu.meitcybersolutions.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name enyayasetu.meitcybersolutions.com;

    # Issued by: sudo certbot --nginx -d enyayasetu.meitcybersolutions.com
    ssl_certificate     /etc/letsencrypt/live/enyayasetu.meitcybersolutions.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/enyayasetu.meitcybersolutions.com/privkey.pem;

    root /var/www/enyayasetu/dist;
    index index.html;

    # Evidence uploads are limited to 10 MB by the API
    client_max_body_size 10m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Camera and microphone are needed for identity checks and hearings
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=()" always;

    # API, health check and uploaded files -> Express
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }

    # Hashed build assets can be cached for a year
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }

    # Everything else is the React app; deep links fall back to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/enyayasetu /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS is required, not optional: browsers block the camera and
microphone on plain HTTP.

## 4. Deploying an update

```bash
cd /var/www/enyayasetu
git pull
npm ci
npm run build                          # frontend changes
sudo systemctl restart enyayasetu-api  # backend changes
```

Apply any new files in `mysql/migrations/` before restarting the API.

## 5. Checks after every deploy

```bash
curl https://enyayasetu.meitcybersolutions.com/health        # {"status":"ok",...}
curl https://enyayasetu.meitcybersolutions.com/api/health    # {"status":"ok",...}
curl -o /dev/null -w "%{http_code}\n" https://enyayasetu.meitcybersolutions.com/dashboard   # 200
```

Then sign in once as a normal user and once as an admin.

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| `502 Bad Gateway` on `/api/*` | API service is not running, or `API_PORT` differs from the nginx `proxy_pass` port |
| `/dashboard` returns 404 on refresh | `try_files … /index.html` missing from the `location /` block |
| Login returns "JWT_SECRET is not set" | `.env` missing or the service's `WorkingDirectory` is not the repo root |
| API starts but every call returns 500 | MySQL unreachable: check `DB_*` and that the DB host allows the VPS's IP |
| Camera / microphone never prompts | Site opened over HTTP, or `Permissions-Policy` blocks them |
