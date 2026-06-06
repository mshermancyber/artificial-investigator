# AI Conversation Investigator

**Forensic session extraction and evidence export for AI chat logs.**

Drop in a session file from any major AI coding assistant and get two clean, human-readable exports:

- **Extracted Prompts** — every user prompt, timestamped and numbered
- **Full Transcript** — complete conversation with thinking/reasoning, tool calls, and tool outputs

Runs entirely in your browser. No data leaves your machine.

## Supported Formats

| Source | Format | Auto-Detection |
|---|---|---|
| **Claude Code** | `~/.claude/projects/*.jsonl` | `type: user/assistant/system` |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `type: session_meta` |
| **Continue** | `~/.continue/dev_data/*.jsonl` | `eventName: chatInteraction` |
| **Cursor** | `~/.cursor/projects/*/agent-transcripts/*.jsonl` | `role: user/assistant` |
| **ChatGPT** | `conversations.json` (OpenAI data export) | JSON array with `mapping` tree |
| **Aider** | `.aider.chat.history.md` | Markdown with `####` / `>` markers |

## Quick Start

```bash
git clone https://github.com/mshermancyber/artificial-investigator.git
cd artificial-investigator
docker compose up -d
```

Open `https://localhost` (accept the self-signed certificate warning on first run).

Drop any supported file onto the page. Download the two export files.

## How It Works

- **100% client-side** — the browser parses the file, renders previews, and generates downloads via Blob URLs. No backend API, no data exfiltration.
- **Format auto-detection** — drop any supported file; the parser identifies the source and extracts accordingly.
- **Self-signed TLS** — a certificate is auto-generated on first container start. Mount your own via `docker-compose.yml` for production use.

### Ports

| Port | Protocol | Purpose |
|---|---|---|
| 80 | HTTP | Redirects to HTTPS |
| 443 | HTTPS | Application |

### Custom TLS Certificate

```yaml
# docker-compose.yml
services:
  investigator:
    volumes:
      - ./certs/server.crt:/etc/nginx/certs/server.crt:ro
      - ./certs/server.key:/etc/nginx/certs/server.key:ro
```

## Build From Source

```bash
# Frontend only (development)
cd frontend
npm install
npm run dev

# Docker build
docker compose build
docker compose up -d
```

## Tech Stack

- **Frontend:** React 18 + Vite
- **Server:** nginx (Alpine)
- **Container:** Docker Compose
- **TLS:** Self-signed via OpenSSL (auto-generated at startup)

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

## Contributing

Issues and pull requests welcome. When adding a new format:

1. Add a parser function in `frontend/src/utils/parser.js`
2. Add detection logic in the dispatch section
3. Add a format badge in `App.jsx` + `DropZone.jsx` + `App.css`
4. Test with a real session file from that tool
