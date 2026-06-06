# AI Conversation Investigator v1.0.1

**Release Date:** 2026-06-06

## About

Browser-based forensic extraction tool for AI chat session logs. Drop in a session file from any major AI coding assistant and get two clean, human-readable exports — extracted prompts and full conversation transcripts with thinking, tool calls, and tool outputs. All processing happens locally in the browser; no data leaves the machine.

## Supported Formats (6)

| Format | Source |
|---|---|
| Claude Code | `~/.claude/projects/*.jsonl` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Continue | `~/.continue/dev_data/*.jsonl` |
| Cursor | `~/.cursor/projects/*/agent-transcripts/*.jsonl` |
| ChatGPT | `conversations.json` (OpenAI data export) |
| Aider | `.aider.chat.history.md` |

## Changes Since v1.0.0

- Added Codex CLI session support
- Fixed cycle detection in ChatGPT parser mapping walk
- Added file size DoS guard (250 MB cap)
- Fixed JSON.stringify crash protection on circular refs
- Fixed Aider turn numbering gaps on slash-commands
- Fixed null dereference in content coercion
- Fixed Codex orphan assistant blocks at turn 0
- Added null guards on assistant blocks in output builder and preview
- Fixed falsy coercion bugs (0, false, empty string) in tool result content
- Renamed from Claude JSONL Recon to AI Conversation Investigator
- Forensic terminal UI theme with scan-line overlay
- Moved to standard ports 80/443

## Tech Stack

React 18 + Vite | nginx (Alpine) | Docker Compose | TLS via OpenSSL

## License

GNU General Public License v3.0
