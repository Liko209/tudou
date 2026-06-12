<div align="center">

# 🥔 Tudou（土豆）

**一个窗口，统一调度 Claude Code、Codex 等 AI CLI 的多智能体看板。**

[![Platform](https://img.shields.io/badge/platform-macOS-black?logo=apple)](https://github.com/Liko209/tudou/releases)
[![Release](https://img.shields.io/github/v/release/Liko209/tudou?include_prereleases)](https://github.com/Liko209/tudou/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

如果你经常同时跑好几个 AI 编程智能体，一定体会过这种痛苦：开了一排终端标签页，搞不清哪个 agent 在等你输入、哪个在烧 token、哪个十分钟前就已经挂了。**Tudou** 用一个看板取代这堆标签页——所有会话状态一目了然，agent 一需要你，它就第一时间提醒你。

<!-- TODO: 替换为真实截图 -->
<!-- ![Tudou 截图](docs/assets/screenshot.png) -->

## ✨ 功能特性

### 🗂 会话看板
- **多个 Claude Code / Codex 会话并排运行**，每个会话都是真实 PTY 终端（node-pty + xterm.js）——输入、滚动、`Ctrl-C`，和你的终端完全一致。
- 状态一目了然：🟢 工作中 · 🟡 等待输入 · ⚪ 空闲 · 🔴 出错 · ⚫ 已退出。
- 会话卡片展示项目与 git 分支、最新消息预览、消息数和预估花费。
- **一键恢复会话**：退出应用后再回来，通过 CLI 原生的 `--resume` 继续上次的对话。

### 🔔 再也不会错过"等待输入"
- macOS 原生通知（点击直达对应会话）、Dock 角标、菜单栏图标实时显示等待中的会话数。
- "回合完成"与"被阻塞/出错"使用不同音效，支持免打扰时段和按渠道开关。
- 可选的 **Claude Code Hook 集成**：等待状态约 3 秒内感知（默认轮询约 10 秒）。安全设计：随机本地端口 + Bearer Token + 会话白名单，一键卸载。

### 📊 用量仪表盘
- 实时聚合每个会话及全局的 token / 成本，包含上下文窗口占用。
- 扫描本地 Claude Code / Codex 会话日志，按天、模型、项目统计历史用量。
- GitHub 风格的 **AI 用量热力图**，还有趣味"等价换算"视图（你的 token 相当于写了几本小说、赚了几杯咖啡……）。
- Claude 限额追踪，带重置倒计时。

### 🧰 体验细节
- 三栏布局，侧栏可折叠；信息面板展示 token、分支、当前工具、最近消息；内置文件预览，文件在磁盘上变化时自动刷新。
- 菜单栏弹出面板，不用打开主窗口也能快速查看。
- 25+ 快捷键（`Cmd+/` 查看速查表），明暗主题跟随 macOS。
- 通过 GitHub Releases 自动更新。

## 🤖 支持的智能体

| Agent | 状态 |
|---|---|
| [Claude Code](https://claude.com/claude-code) | ✅ 完整支持（启动、恢复、状态与用量提取） |
| [Codex CLI](https://github.com/openai/codex) | ✅ 完整支持 |
| Gemini CLI | 🚧 规划中 |

适配器是插件化的（`electron/adapters/`）——接入新 CLI 主要就是教 Tudou 读懂它的会话日志。

## 📦 安装

> **环境要求：** macOS 11+（Apple Silicon 和 Intel 均支持），并已安装你要使用的 AI CLI。

1. 从 [**Releases**](https://github.com/Liko209/tudou/releases) 下载最新的 `.dmg`。
2. 把 **Tudou** 拖进「应用程序」。
3. 应用目前**未签名**，首次启动 macOS 会拦截。右键应用 → **打开**，或执行：
   ```bash
   xattr -cr /Applications/Tudou.app
   ```

## 🚀 快速上手

1. 启动 Tudou，按 `Cmd+T`（或点 **+ New Session**）。
2. 选择智能体（Claude Code / Codex）和项目目录，开跑。
3. 在不同项目上多开几个会话，用 `Cmd+1…9` 切换。
4. 关掉窗口，让它待在菜单栏里——任何 agent 等你时，Tudou 都会提醒你。

### 常用快捷键

| 快捷键 | 功能 |
|---|---|
| `Cmd+T` / `Cmd+Shift+N` | 新建会话 |
| `Cmd+1…9` | 跳转到第 N 个会话 |
| `Cmd+W` | 关闭当前会话 |
| `Cmd+B` / `Cmd+Shift+B` / `Cmd+Option+B` | 切换侧栏 / 右面板 / 底部面板 |
| `Cmd+E` → `Cmd+Enter` | 展开输入框 → 发送 |
| `Cmd+/` | 完整快捷键速查表 |

## 🏗 架构

```
┌──────────────────────────────────────────────────────┐
│ 渲染进程（Next.js 静态导出 · React 19 · xterm.js）     │
│   会话网格 · 终端视图 · 用量仪表盘                      │
└──────────────────────────┬───────────────────────────┘
                           │ 类型化 IPC（contextBridge）
┌──────────────────────────▼───────────────────────────┐
│ Electron 主进程（Node.js）                             │
│   PTY 管理（node-pty）· 会话注册表                      │
│   各 CLI 适配器（Claude / Codex）· Hook 服务            │
│   菜单栏 / Dock / 通知 · 自动更新                       │
└──────────────────────────┬───────────────────────────┘
                           │ 监听
        ~/.claude/projects/**/*.jsonl   ~/.codex/sessions/*.jsonl
```

- **`electron/`** —— 主进程：PTY 生命周期、会话注册表、CLI 适配器、macOS 集成、更新器。
- **`renderer/`** —— Next.js 应用（静态导出，经 `file://` 加载），Zustand 管理状态，Tailwind 处理样式。
- **`shared/`** —— 两个进程共享的 TypeScript IPC 契约和类型定义。
- Tudou 不代理、不篡改智能体的任何流量——它在真实 PTY 中启动官方 CLI，并读取它们本来就写在本地的会话日志。

## 🔒 数据与隐私

一切数据都留在你的本机。Tudou 读取 Claude Code / Codex 本就生成的本地会话日志，自身状态以 JSON 存放在 `~/Library/Application Support/agent-dashboard/`，除了到 GitHub Releases 检查更新之外不发起任何网络请求。界面中的消息预览会先对常见密钥格式（API Key 等）做脱敏再显示。

## 🛠 本地开发

```bash
git clone https://github.com/Liko209/tudou.git
cd tudou
npm install        # postinstall 会针对 Electron ABI 重新编译 node-pty
npm run dev        # Next.js 开发服务器 + Electron，支持热更新
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 热更新开发 |
| `npm run typecheck` / `lint` / `test` | TypeScript、ESLint、Vitest |
| `npm run package` | 构建 macOS `.dmg` / `.zip` 到 `release/` |

> **node-pty 说明：** 它是原生模块。`scripts/fix-node-pty.mjs`（postinstall）会针对 Electron 重新编译，打包后的 after-pack 钩子会把二进制从 asar 中解出——如果终端无法启动，重新执行一次 `npm install`。

## 🗺 路线图

- Gemini CLI 适配器
- 基于 Git worktree 的并行任务工作区
- 共享项目记忆（`AGENTS.md`）与 agent 间消息互通
- Markdown 驱动、可分配给 agent 的任务看板

更长期的思考见 [`docs/collaboration-roadmap.md`](docs/collaboration-roadmap.md)。

## 🤝 参与贡献

欢迎 Issue 和 PR！提交 PR 前请先跑一遍 `npm run typecheck && npm run lint && npm test`。

## 📄 许可证

[MIT](LICENSE)

---

<div align="center">

*"Tudou" 就是土豆——朴实、可靠，安静地待在后台，让你的 agent 们专心掌勺。* 🥔

</div>
