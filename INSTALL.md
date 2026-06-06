# Installation

## Docker (Recommended)

```bash
cd artificial-investigator_v1.0.1_2026-06-06
docker compose up -d
```

Open `https://localhost` and accept the self-signed certificate warning on first run.

A TLS certificate is auto-generated at container startup. To use your own:

```yaml
# docker-compose.yml
services:
  investigator:
    volumes:
      - ./certs/server.crt:/etc/nginx/certs/server.crt:ro
      - ./certs/server.key:/etc/nginx/certs/server.key:ro
```

## From Source (Development)

```bash
cd frontend
npm install
npm run dev        # Vite dev server, no TLS
npm run build      # Production build to frontend/dist/
```

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 80 | HTTP | Redirects to HTTPS |
| 443 | HTTPS | Application |

## Requirements

- Docker and Docker Compose
- Or: Node.js 20+ and npm
