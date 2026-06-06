# ── Stage 1: build React app ──────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

COPY frontend/ ./
RUN npm run build

# ── Stage 2: nginx + TLS ─────────────────────────────
FROM nginx:alpine

# Install openssl for self-signed cert generation
RUN apk add --no-cache openssl

# Copy built React app
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config template
COPY nginx.conf /etc/nginx/nginx.conf

# Entrypoint generates a self-signed cert (if none mounted) then starts nginx
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
