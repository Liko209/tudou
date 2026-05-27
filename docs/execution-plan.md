# Agent Dashboard — Execution Plan

**Companion to:** `design.md`
**Date:** 2026-05-27
**Phase 1 scope:** Claude Code + Codex（Gemini 推后到 Phase 2）

---

## Module Map

```
M0  Project Scaffold ────────┐
                             ▼
M1  PTY + xterm Spike ──────────────┐
                                    │
                             ┌──────┴────────┐
                             ▼               ▼
M2 CLI Adapter Foundation   M3 Renderer Shell
   (Claude + Codex JSONL)    (Next.js + Tailwind + xterm host)
                             │               │
                             └───────┬───────┘
                                     ▼
M4  Session Registry + IPC bus
                                     │
                                     ▼
M5  Session UI (cards + active + side panel)
                                     │
                                     ▼
M6  macOS Lifecycle + Single Instance + Tray/Dock/Notif
                                     │
                                     ▼
M7  Hook Pipeline (双轨制)
                                     │
                                     ▼
M8  Resume + Persistence
                                     │
                                     ▼
M9  Polish + E2E Smoke Test
```

**预估时间线（按 1 人投入业余时间）：** ~6–8 周到 P1 完成。M0–M2 是地基（1.5 周），M3–M6 是主体功能（3 周），M7 是 hook（1 周），M8–M9 是 resume 和打磨（1.5 周）。

**关键风险关口**：M1（xterm spike 验证 Claude 渲染）必须先通过，再投入 M3+ 的 UI 工作。如果 xterm 不能正确渲染 Claude 的交互式 UI，整个架构需要回炉。

---

## M0 — Project Scaffold

**Goal:** Electron + Next.js + TypeScript 三件套跑起来，能 `npm start` 看到 hello。

| Feature | 描述 | 验证 |
|---|---|---|
| **F0.1** Electron + Next.js 集成 | 用 `electron-vite` 或 `nextron` 模板初始化；renderer 用 Next.js SPA mode | `npm start` 打开窗口显示 "Hello"；devtools 可开 |
| **F0.2** TypeScript 严格模式 + ESLint + Prettier | tsconfig `strict: true`；eslint config；prettier 集成；pre-commit hook（husky + lint-staged） | `npm run lint && npm run typecheck` 全绿 |
| **F0.3** Vitest 配置 | main 进程 + renderer 都能跑单测；coverage 报告 | `npm test` 跑通 ≥1 demo 测试 |
| **F0.4** electron-builder 打包 | 能产出 .dmg/.app | `npm run build:mac` 输出可双击运行的 .app |

**Test strategy:** scaffold 阶段以"能跑通"为目标，不写业务测试。

---

## M1 — PTY + xterm Spike（关键关口）

**Goal:** **证伪式 spike** —— 在最小代码里跑通"electron 主进程 spawn `claude`，stdout 流到 renderer 的 xterm.js，键盘输入回传"，验证 R1（xterm 渲染 Claude 交互式 UI）这个最大未知。

| Feature | 描述 | 验证 |
|---|---|---|
| **F1.1** node-pty 安装 + electron-rebuild | Apple Silicon 上 native 模块编译；Electron 主进程能 `import('node-pty')` 成功 | 主进程跑 `pty.spawn('/bin/bash', [])`，写入 `ls\n` 收到 ls 输出 |
| **F1.2** Main↔Renderer IPC 把 PTY 流双向 | `ipcMain.handle('pty:write')` + `webContents.send('pty:data:<id>')`；contextBridge 暴露安全 API | 在 renderer console 调 `window.pty.write('echo hi\n')`，能收到回显 |
| **F1.3** xterm.js 终端组件 | React 包装 xterm；addons：fit、web-links、unicode11；onData 转 IPC | 渲染 bash session，输入命令可见输出；resize 窗口 xterm 跟着 fit |
| **F1.4** Claude Code 真跑 | 用上面的栈跑 `claude` CLI 一次 | **冒烟项**：Claude 启动 → 输入提问 → 收到回答 → 出现 permission prompt → 用方向键选 yes/no 工作正常 → `/exit` 退出干净 |
| **F1.5** Codex 真跑 | 同上 | 同冒烟项，针对 codex |

**Test strategy:** F1.1–F1.3 用 vitest 集成测（spawn bash 真跑，断言输出）。F1.4/F1.5 是手动 smoke test —— 这两步**没过就停下来重新设计**，不能进 M2。

**Exit criteria:** Claude 和 Codex 都能在 xterm 里完成一次完整对话 + 工具调用 + 退出，无视觉残缺、无键盘异常。

---

## M2 — CLI Adapter Foundation

**Goal:** 实现 `CliAdapter` 抽象 + Claude/Codex 两个具体 adapter；能从一个真实 JSONL 文件解析出统一的 `SessionUpdate` 流。

| Feature | 描述 | 验证 |
|---|---|---|
| **F2.1** `CliAdapter` 接口 + 通用 JSONL tail 工具 | chokidar 监听文件追加，分行 yield；处理 partial line | 单测：模拟一个文件 append 几行，断言全部正确 yield；末尾不完整行不 yield，下次完整后再 yield |
| **F2.2** ClaudeAdapter — buildSpawnArgs + locateSessionFile | spawn args 支持 `--resume <id>` / `-c` / `--name`；locate 通过 `~/.claude/projects/<cwd-encoded>/sessions-index.json` 找最新 entry | 单测用 fixture sessions-index 文件，断言能匹配到正确 sessionId |
| **F2.3** ClaudeAdapter — JSONL → SessionUpdate | 解析 `type=user/assistant/tool_use/tool_result`；累加 `usage.input_tokens/output_tokens`；推断 status；提取 latestMessage 预览（截 200 字符） | 单测：吃 fixture JSONL（在 `tests/fixtures/claude-sample.jsonl`，从真实 session 提取脱敏），断言生成的 SessionUpdate 序列符合预期 |
| **F2.4** ClaudeAdapter — listResumable | 读 sessions-index.json + 按 cwd 过滤 | 单测：fixture index 文件，验证返回列表正确 |
| **F2.5** CodexAdapter — buildSpawnArgs + locateSessionFile | spawn args 支持 `resume <id>` / `resume --last`；locate 通过 `~/.codex/session_index.jsonl` 最新 entry + 时间窗口匹配 | 单测同 F2.2 模式 |
| **F2.6** CodexAdapter — JSONL → SessionUpdate | 解析 `session_meta / event_msg / response_item / turn_context`；从 `event_msg.payload.type=token_count` 取 token；从 `task_started/task_complete` 推 status；从 `response_item.payload.type=function_call` 推 currentTool | 单测吃 fixture codex rollout（脱敏后存入 `tests/fixtures/codex-sample.jsonl`） |
| **F2.7** CodexAdapter — listResumable | 读 session_index.jsonl 过滤 cwd（cwd 在 session_meta 里，需要预先建索引） | 单测：fixture 索引 + 多个 rollout 文件，按 cwd 过滤正确 |
| **F2.8** Cost 表 + 估算工具 | 本地 model→price 表（input/output 分价）；估算函数 | 单测：fixture token 数 → 期望成本；表里没有的 model fallback 到 "—" |

**Test strategy:**
- **真文件 fixture** 而非纯 mock：从你真实的 Claude/Codex sessions 复制几条脱敏后入库
- LLM 不调用，纯解析逻辑
- 覆盖：正常 session、被 Ctrl-C 中断的 session、长 session（>50 行）、空 session

**Exit criteria:** 给一个 fixture JSONL 文件，adapter 能在 100ms 内完整解析并 emit 正确的 SessionUpdate 序列。

---

## M3 — Renderer Shell

**Goal:** Next.js + Tailwind + shadcn/ui + Zustand 的渲染端骨架，包含路由、布局、状态管理。**不**包含真业务数据。

| Feature | 描述 | 验证 |
|---|---|---|
| **F3.1** Next.js SPA 骨架 + 路由 | App Router；output: 'export'；basePath 兼容 Electron file:// | dev 跑通；build 产物能被 electron 加载 |
| **F3.2** Tailwind + shadcn/ui setup | tailwind config；安装 button/dialog/sheet/dropdown-menu 等基础组件 | 一个 demo 页面用各组件，视觉正常 |
| **F3.3** 三栏 layout 组件 | 左 220px session list / 中央 flex-1 active area / 右 260px side panel；可折叠左右栏（Cmd+\ 切换） | 手动：拖窗口大小，中央 area 正确缩放；快捷键能折叠 |
| **F3.4** Zustand store 骨架 | `sessionsStore`（sessions map + active id）；`uiStore`（折叠状态、modal 等） | 单测：派发 action 后状态正确变更 |
| **F3.5** Mock session 数据生成器（dev only） | dev mode 启动时塞 5 个假 session 进 store，状态各异 | UI 展示 5 个卡片，颜色对应状态 |

**Test strategy:** vitest + @testing-library/react；快照测主要组件；store 单测覆盖所有 action。

---

## M4 — Session Registry + IPC Bus

**Goal:** 把 M1（PTY）+ M2（adapter）粘起来，把数据通过 IPC 推到 M3 的 renderer store。

| Feature | 描述 | 验证 |
|---|---|---|
| **F4.1** Main 侧 SessionRegistry 类 | 内存 `Map<SessionId, Session>`；订阅 PtyManager + adapter 的事件；emit `session:update` | 单测：mock pty + adapter 事件，断言 registry 的 Session 字段正确合并 |
| **F4.2** IPC channels 定义 + 类型共享 | `session:list`, `session:spawn`, `session:write`, `session:resize`, `session:kill`, `session:update` (push)；types 放共享 d.ts | typecheck 通过；契约测试（main↔renderer 跑一遍空 payload） |
| **F4.3** Renderer ↔ store 桥接 | `useEffect` 监听 IPC push 把 SessionUpdate 写入 zustand store；spawn/write 通过 IPC 调用 | 集成测：renderer dispatch spawn → main spawn PTY → JSONL 出现 → registry 更新 → IPC push → store 更新（用 fixture CLI 模拟） |
| **F4.4** PtyManager 真实接入 SessionRegistry | spawn 后注册 session 元数据 + 启动对应 adapter watch；exit 时更新状态 | 集成测：跑一个真 `echo hello && sleep 0.1 && exit`，验证 registry 经历 starting→exited |

**Test strategy:** 这一层引入第一个**真集成测**：跑真 bash / 真 claude `--help`（不是完整 session），验证整条链路；adapter 用 fixture 文件触发。

---

## M5 — Session UI

**Goal:** 用户真能看到 + 操作 session。

| Feature | 描述 | 验证 |
|---|---|---|
| **F5.1** SessionCard 组件 | 显示 status 圆点 + cli icon + displayName + branch + msgCount + cost + latestMessage 预览（截断） | 视觉测：用 store 5 个 mock session 渲染，截图比对（playwright） |
| **F5.2** SessionList + 按 project 分组 + 搜索 | virtualize 用 react-window；按 cwd 分组折叠；Cmd+K 聚焦搜索框 | 单测：50 个 mock session 渲染流畅（perf）；搜索过滤正确 |
| **F5.3** ActiveSession view（中央） | 渲染 xterm；从 store 取 active id；IPC 双向 | 手动 smoke：选中卡片 → 中央显示对应 PTY 输出 |
| **F5.4** SidePanel | 显示 cwd、branch、metrics、currentTool、最近 5 条消息 | 单测：传入 fixture Session 渲染快照 |
| **F5.5** New Session modal | 选 cli / 选 cwd（带最近路径缓存）/ 可选 resume 已有 / Claude 额外的 --name --model --effort | 手动 smoke：从 UI 点新建 → 真启动一个 claude session |
| **F5.6** 键盘快捷 | Cmd+1..9 切换；Cmd+T 新建；Cmd+W 关闭当前 session（带 confirm） | 手动测每个快捷 |
| **F5.7** statusConfidence 视觉提示 | low confidence 时状态圆点加边框/虚线，hover 提示"polling mode" | 视觉测 |

**Test strategy:** Playwright E2E 跑通"启动 dashboard → 新建 session → 输入 → 看到回复 → 关闭"完整路径。

---

## M6 — macOS Lifecycle + Single Instance + Tray/Dock/Notif

**Goal:** 完成 §2 Process Model 描述的标准 macOS 体验。

| Feature | 描述 | 验证 |
|---|---|---|
| **F6.1** Single instance lock | `app.requestSingleInstanceLock()`；第二实例 → focus 已有窗口 | 手动测：跑两次 .app，第二次焦点回到第一个 |
| **F6.2** Cmd+W 不退出 app | `window-all-closed` 阻止；Dock 点击重开窗口 | 手动测：关窗 → app 仍在 → Dock 点开恢复 |
| **F6.3** Cmd+Q 时若有 working session 弹 confirm | electron `before-quit` 拦截，列出活跃 session，Cancel/Quit Anyway | 手动测 + 单测 confirm 逻辑 |
| **F6.4** Tray (menubar) | tray 图标显示 waiting 数；菜单列出每个 waiting session，点击聚焦该 session | 手动测：触发一个 waiting → tray 图标变化 |
| **F6.5** Dock badge | `app.setBadgeCount(waitingCount)` | 手动测同上 |
| **F6.6** macOS Notification | `new Notification({title, body})`；click 聚焦对应 session；首次启动检测权限 | 手动测；权限被拒后 fallback 到 tray+dock |
| **F6.7** Notification 声音 | 仅当 app 不在前台时播放 `<audio>` | 手动测：切到其他 app → 触发 → 听到 |
| **F6.8** PowerSaveBlocker | 任一 session=working 时阻止 app suspension；全 idle 时释放 | 手动测：跑长任务 → 合上盖子（外接显示器场景）→ 任务继续 |

**Test strategy:** macOS 集成特性以**手动测**为主（自动化困难），但 F6.1/6.3 的状态机逻辑单测。

---

## M7 — Hook Pipeline（双轨制）

**Goal:** 实现可选的 hook 模式，把 Claude 通知 SLA 从 10s 降到 3s。

| Feature | 描述 | 验证 |
|---|---|---|
| **F7.1** Instance file + bearer token | 启动写 `~/Library/Application Support/agent-dashboard/instance.json` mode 0600，含 pid/port/token；退出删 | 单测：写入 → 读取 → 卸载流程 |
| **F7.2** 本地 HTTP endpoint | bind 127.0.0.1 随机端口；POST /hook 验 token + 验 session id 注册 → 转化为 SessionUpdate；其余请求 403 | 单测：合法/非法 token、不存在的 session id、超时 |
| **F7.3** Hook 脚本生成器 | 生成 `~/.claude/hooks/agent-dashboard.sh`（含 mtime 检查 + token 读取 + curl）；chmod +x | 手动跑脚本，POST 能命中 endpoint |
| **F7.4** Settings.json 注入器 | 备份原文件；merge hook 块；不破坏用户已有 hook | 单测：5 种 input fixture（无 hook / 有 user hook / 有冲突 hook 等），断言 merge 结果合法 |
| **F7.5** 授权 modal | 首次启动检测未注入 → 弹 modal：Auto / Manual / Skip(stay polling) 三选；点 Manual 显示要复制的 JSON 片段 | 手动测每个分支 |
| **F7.6** 卸载按钮 | Settings 里"Uninstall hook"按钮，恢复原 settings.json + 删脚本 | 手动测 |
| **F7.7** statusConfidence 升级逻辑 | hook 收到事件 → 该 session 标 `high`；hook 未启用时 → `low` | 单测：开/关 hook 切换状态 |

**Test strategy:** F7.2/F7.4 严格单测；F7.5/F7.6 手动 + Playwright E2E。

---

## M8 — Resume + Persistence

**Goal:** Cmd+Q 后再启动能 resume 上次的 session 列表。

| Feature | 描述 | 验证 |
|---|---|---|
| **F8.1** SessionRegistry → sessions.json 写入 | spawn 时 provisional write；cliSessionId 发现后 patch；before-quit flush | 单测：模拟 spawn/discover/quit 序列，断言文件正确 |
| **F8.2** 启动时读 + reconcile | 启动 read sessions.json + 调 ClaudeAdapter.listResumable / CodexAdapter.listResumable；标记 each PersistedSession 为 `resumable / orphan` | 单测：fixture sessions.json + fixture CLI index，验证分类正确 |
| **F8.3** "Resume previous" UI 区域 | 启动后主界面顶部显示"Last time you had N sessions: [Resume All] [Pick]"；点 Pick 弹列表多选 | 手动 + 视觉测 |
| **F8.4** 一键 resume | 选中 → spawn with `--resume <id>` / `resume <id>` → 接入 registry | E2E：跑 session → quit → 重启 → resume → 验证 PTY 接上历史（cli 视图显示之前消息） |
| **F8.5** 30 天 GC | 启动时清理 30 天未访问的 record | 单测：fixture timestamps |

**Test strategy:** F8.4 是关键 E2E，需要 Playwright 驱动 Electron 跑两次。

---

## M9 — Polish + E2E Smoke Test

**Goal:** Phase 1 success criteria 全部达标。

| Feature | 描述 | 验证 |
|---|---|---|
| **F9.1** 4 小时稳定性测试 | 1 Claude + 1 Codex 同跑 4 小时，期间正常输入输出多轮对话；监控内存增长、CPU 占用、PTY 句柄泄漏 | 内存增长 <100MB；无 PTY 泄漏；崩溃次数 0 |
| **F9.2** 敏感信息 mask（R12） | latestMessage 预览自动 mask 检测到的 API key / token 模式 | 单测：fixture 含密钥的内容 → 预览被 mask |
| **F9.3** CLI 登录态检测（R11） | 启动 PTY 后 2s grace 检测登录提示；触发时 UI 给提示 | 手动测：临时退掉 claude 登录 → 验证提示 |
| **F9.4** Settings 页 | 通知偏好（每个 channel 开关）、勿扰时段、hook 状态、CLI 路径覆盖、清除缓存 | 手动测每个设置项生效 |
| **F9.5** 错误兜底 | PTY 崩溃 / endpoint 起不来 / 文件权限错误 → UI 友好提示而非白屏 | 注入故障测：rename node-pty 启动失败、占用端口启动 |
| **F9.6** README + 用户指南 | 安装步骤、首次配置、hook 模式说明、故障排查 | 用户审阅 |
| **F9.7** 打包签名 | electron-builder 签名（用 ad-hoc 或个人 Developer ID） | .dmg 安装无 Gatekeeper 警告 |

**Exit criteria:** §1 Success Criteria 中的 5 条全部达标。

---

## Test Strategy Summary（横向）

| 类别 | 用什么 | 覆盖范围 |
|---|---|---|
| **单元测试** | Vitest | adapter 解析、registry 合并逻辑、设置文件 merge、cost 估算、status 推断、hook endpoint 鉴权 |
| **组件测试** | Vitest + @testing-library/react | UI 组件渲染 + store 派发 |
| **集成测试** | Vitest 跑真 `bash` / `claude --help` | PtyManager + IPC 链路 |
| **E2E** | Playwright 驱动 Electron | 启动 → 新建 → 输入 → quit → resume |
| **Fixture-based** | 真实脱敏 JSONL | adapter 解析逻辑 |
| **手动 smoke** | 人工跑真 CLI | xterm 渲染细节、macOS 集成、长时间稳定性 |
| **不 mock**：真文件系统、真 chokidar、真 node-pty（除非测试隔离需要）
| **mock**：LLM 调用（不在我们 dashboard 内）、macOS API（用 stub）

**Fixture 准备清单**（M2 之前必须做）：
- [ ] `tests/fixtures/claude-sample.jsonl` — 一个完整 Claude session（含用户输入、assistant 回复、tool_use+tool_result、退出）
- [ ] `tests/fixtures/claude-sessions-index.json` — 3-5 个 entry，对应不同 cwd
- [ ] `tests/fixtures/codex-rollout.jsonl` — 一个完整 Codex session（含 session_meta、task_started/complete、token_count、function_call）
- [ ] `tests/fixtures/codex-session-index.jsonl` — 多条索引
- [ ] 脱敏：替换路径、用户名、key 模式

---

## 实施顺序原则

1. **M1 是死亡关口** —— 不通过就停止，重新设计或换栈
2. **M2 + M3 可并行**（adapter 和 UI 骨架不依赖）
3. **M4 是合流点** —— 之后所有功能依赖它
4. **M7 (hook) 可推迟到 M6 后** —— 不阻塞主线，polling 默认模式先用着
5. **每个 module 跑完做 §Phase 4: Integration Verification** —— 不允许带未通过的测试进下一 module

---

## Open Items（实施期间需补）

- Phase 0 spike 后回写 §M1 实际遇到的 xterm 兼容问题（如有）
- M2 写完 fixture 后补真实 Codex `event_msg.payload.type` 完整枚举到 `design.md §5.2`
- M7 完成后实测：在 `~/.claude/settings.json` 已有 hook 的几种真实场景下 merge 是否安全（用户自己有 hook 怎么办）

---

## M1 死亡关口验证结果（2026-05-27）

✅ **通过**：electron-vite + node-pty 1.1.0 + xterm.js v6 在 Electron 33 / macOS arm64 / Node 24 上完全工作。

**实测**：bash、Claude Code、Codex 三种 PTY 在 xterm 中正常 —— 输入、输出、ANSI 颜色、permission prompt（箭头键 + Enter 选择）、tool 调用动画、`/exit` 退出全部正常。

**遇到的 1 个 bug**：node-pty 1.1.0 的 `prebuilds/darwin-arm64/spawn-helper` 在 npm install 后没有 execute 权限，导致 `pty.spawn` 抛 `posix_spawnp failed`。
**Fix**：postinstall 脚本 `scripts/fix-node-pty.mjs` 自动 chmod +x。
**Ref**：https://github.com/microsoft/node-pty/issues/669

**意外好事**：electron-rebuild 没有也不需要跑 —— node-pty 的 prebuilds 用 N-API（Node-API ABI 稳定），Node 24 和 Electron 33 都能直接 load。
