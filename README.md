<div align="center">

# 🥔 Tudou

**A multi-agent dashboard for orchestrating Claude Code, Codex, and other AI CLI sessions — in one window.**

[![Platform](https://img.shields.io/badge/platform-macOS-black?logo=apple)](https://github.com/Liko209/tudou/releases)
[![Release](https://img.shields.io/github/v/release/Liko209/tudou?include_prereleases)](https://github.com/Liko209/tudou/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

If you run several AI coding agents in parallel, you know the pain: half a dozen terminal tabs, no idea which agent is waiting for you, which one is burning tokens, and which one died ten minutes ago. **Tudou** replaces that pile of tabs with a single dashboard that shows every session's status at a glance — and taps you on the shoulder the moment an agent needs your input.

<!-- TODO: replace with a real screenshot -->
<!-- ![Tudou screenshot](docs/assets/screenshot.png) -->

## ✨ Features

### 🗂 Session dashboard
- Run **multiple Claude Code and Codex sessions side by side**, each in its own real PTY-backed terminal (node-pty + xterm.js) — type, scroll, `Ctrl-C`, exactly like your terminal.
- Status at a glance: 🟢 working · 🟡 waiting for input · ⚪ idle · 🔴 errored · ⚫ exited.
- Session cards show the project & git branch, last message preview, message count, and estimated cost.
- **One-click resume**: quit the app, come back later, and resume previous sessions via the CLIs' native `--resume`.

### 🔔 Never miss a "waiting for input" again
- Native macOS notification (click to jump straight to that session), Dock badge, and a menu bar icon with a live count of waiting sessions.
- Distinct sound cues for "turn finished" vs "blocked/errored", with quiet hours and per-channel toggles.
- Optional **Claude Code hook integration** for ~3-second waiting detection instead of polling (security-gated: random local port + bearer token + session allowlist, one-click uninstall).

### 📊 Usage dashboard
- Live token & cost aggregation per session and across all sessions, including context-window usage.
- Historical usage scanned from your local Claude Code / Codex session logs, broken down by day, model, and project.
- A GitHub-style **activity heatmap** of your AI usage, plus a fun "in perspective" view (your tokens as novels written, coffees earned…).
- Claude rate-limit tracking with reset countdowns.

### 🧰 Quality of life
- Three-pane layout with foldable sidebars, an info sheet (tokens, branch, current tool, recent messages), and an in-app file preview that auto-refreshes when the file changes on disk.
- Menu bar popover for quick glances without opening the main window.
- 25+ keyboard shortcuts (`Cmd+/` shows the cheatsheet), light/dark themes synced with macOS.
- Auto-update via GitHub Releases.

## 🤖 Supported agents

| Agent | Status |
|---|---|
| [Claude Code](https://claude.com/claude-code) | ✅ Full support (spawn, resume, state & metrics extraction) |
| [Codex CLI](https://github.com/openai/codex) | ✅ Full support |
| Gemini CLI | 🚧 Planned |

Adapters are pluggable (`electron/adapters/`) — adding a new CLI mostly means teaching Tudou how to read its session logs.

## 📦 Installation

> **Requirements:** macOS 11+ (Apple Silicon & Intel), with the AI CLIs you want to use already installed.

1. Download the latest `.dmg` from [**Releases**](https://github.com/Liko209/tudou/releases).
2. Drag **Tudou** to Applications.
3. The app is currently **unsigned**, so on first launch macOS will warn you. Either right-click the app → **Open**, or run:
   ```bash
   xattr -cr /Applications/Tudou.app
   ```

## 🚀 Quick start

1. Launch Tudou and hit `Cmd+T` (or **+ New Session**).
2. Pick an agent (Claude Code / Codex), choose a project directory, go.
3. Open more sessions across different projects; switch with `Cmd+1…9`.
4. Close the window and let it live in your menu bar — Tudou notifies you whenever any agent is waiting.

### Key shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+T` / `Cmd+Shift+N` | New session |
| `Cmd+1…9` | Jump to session N |
| `Cmd+W` | Close current session |
| `Cmd+B` / `Cmd+Shift+B` / `Cmd+Option+B` | Toggle sidebar / right panel / bottom panel |
| `Cmd+E` → `Cmd+Enter` | Expand compose box → send |
| `Cmd+/` | Full shortcuts cheatsheet |

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────┐
│ Renderer (Next.js static export · React 19 · xterm.js)│
│   session grid · terminal view · usage dashboard      │
└──────────────────────────┬───────────────────────────┘
                           │ typed IPC (contextBridge)
┌──────────────────────────▼───────────────────────────┐
│ Electron main process (Node.js)                       │
│   PTY manager (node-pty) · session registry           │
│   per-CLI adapters (Claude / Codex) · hook server     │
│   tray / Dock / notifications · auto-updater          │
└──────────────────────────┬───────────────────────────┘
                           │ watches
        ~/.claude/projects/**/*.jsonl   ~/.codex/sessions/*.jsonl
```

- **`electron/`** — main process: PTY lifecycle, session registry, CLI adapters, macOS integration, updater.
- **`renderer/`** — Next.js app (static export, loaded via `file://`), Zustand for state, Tailwind for styling.
- **`shared/`** — TypeScript IPC contracts and types shared across both processes.
- Tudou never proxies or modifies your agents' traffic — it spawns the official CLIs in real PTYs and reads the session logs they already write locally.

## 🔒 Data & privacy

Everything stays on your machine. Tudou reads the local session logs that Claude Code / Codex already produce, stores its own state as JSON under `~/Library/Application Support/agent-dashboard/`, and makes no network calls of its own except checking GitHub Releases for updates. Message previews in the UI mask common secret patterns (API keys etc.) before display.

## 🛠 Development

```bash
git clone https://github.com/Liko209/tudou.git
cd tudou
npm install        # postinstall rebuilds node-pty against Electron's ABI
npm run dev        # Next.js dev server + Electron, with live reload
```

| Command | What it does |
|---|---|
| `npm run dev` | Develop with hot reload |
| `npm run typecheck` / `lint` / `test` | TypeScript, ESLint, Vitest |
| `npm run package` | Build a macOS `.dmg` / `.zip` into `release/` |

> **node-pty note:** it's a native module. `scripts/fix-node-pty.mjs` (postinstall) rebuilds it for Electron, and an after-pack hook unpacks its binaries from the asar — if terminals fail to spawn, re-run `npm install`.

## 🗺 Roadmap

- Gemini CLI adapter
- Git worktree workspaces for parallel tasks on one repo
- Shared project memory (`AGENTS.md`) and agent-to-agent messaging
- A markdown-driven task board with agent assignment

See [`docs/collaboration-roadmap.md`](docs/collaboration-roadmap.md) for the longer-term thinking.

## 🤝 Contributing

Issues and PRs are welcome! Before submitting a PR please run `npm run typecheck && npm run lint && npm test`.

## 📄 License

[MIT](LICENSE)

---

<div align="center">

*"Tudou" (土豆) is Chinese for potato — humble, dependable, and happy to sit quietly in the background while your agents do the cooking.* 🥔

</div>
