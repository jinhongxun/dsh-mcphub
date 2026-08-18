# dsh-mcphub

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](#中文) | [English](#english)

---

## 中文

MCP 管理面板（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件）。在设置面板新增 **MCP** 分区：

- **连接状态**：绿点 = 该服务器的工具已注册进当前会话（AI 可调用）；灰点 = 已配置但未注册工具。显示传输类型（stdio / HTTP）、目标地址、工具数量与样例。
- **升级管理**：自动识别 pip 安装的 stdio 服务器（如 scrapling），比对 PyPI 最新版并显示「可升级」徽标，一键执行 `pip install --upgrade`（自动处理 Windows 文件锁：停占用进程 + 暂存旧 exe）；npx 型服务器比对 npx 缓存实际版本，提供「刷新缓存」；`@latest` 型（每次启动自动拉最新）不重复提示。
- **添加服务器**：表单录入 serverName / transport / URL+headers 或 command+args+env，追加写入 profile 的 `cordis.patch.yml`（重启 DSH 后生效）。
- **连通测试**：HTTP 服务器发真实 MCP `initialize` 握手（显示 serverInfo 与耗时）；stdio 服务器校验可执行文件存在。
- **使用说明**：工具命名规则（`mcp__<服务器名>__<工具名>`）、如何让 AI 调用、手动编辑配置示例、密钥安全提醒、排障指引。

### 安装

```powershell
# 从 GitHub
dsh plugin --profile web add github:jinhongxun/dsh-mcphub

# 或从 npm（如已发布）
dsh plugin --profile web add dsh-mcphub
```

安装后重启 DSH 生效。

### 隐私

配置文件中的 headers / env 密钥只在 Host 内存中用于探测握手，**永远不会发送到浏览器端**（面板只收到键名）。

### 常见问题：profile 是什么？


profile 是 DSH 的「独立配置环境」（类似浏览器的多用户配置）：每个 profile 有自己的插件和 MCP 列表，互不影响。例：机器上可以有 `web`（日常网页版）和 `open-design`（给设计软件用）两套，各配各的 MCP。添加表单里的 profile 选择就是决定写入哪套环境——只有一个 profile 时无需关心。

### 环境要求

- Node.js ≥ 20
- DeepSeek Harness（含 `dsh-client-connection` 通道，官方发行版自带）

### 状态怎么算的？

绿点/灰点不是插件自己维护的状态：插件读取运行中的工具注册表，某服务器存在 `mcp__<服务器名>__*` 工具注册即视为已连接。优点是零侵入、永远和真实能力一致；边界是「已连接但暴露 0 个工具」会显示为灰点。所有配置改动（新增/暂停/删除/升级）都在重启 DSH 后生效。

### 兼容性

Windows / macOS / Linux 均可运行（升级动作按平台分流：PowerShell ↔ pkill、`where` ↔ `command -v`、npm 缓存路径自动探测）。

---

## English

MCP management panel for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Adds an **MCP** section to the settings panel:

- **Connection status**: a green dot means the server's tools are registered in the live session (callable by the AI); grey means configured but not registered. Shows transport (stdio / HTTP), target, tool counts and samples.
- **Upgrades**: detects pip-installed stdio servers (e.g. scrapling), compares against PyPI, and upgrades in one click — including Windows file-lock handling (stop holders, park the old exe, restore on failure). npx-based servers are compared against the actual npx cache with a "refresh cache" action; `@latest` specs are never nagged (they self-update).
- **Add servers**: a form that appends proper `cordis.patch.yml` entries (serverName / transport / URL+headers or command+args+env). Takes effect after a DSH restart.
- **Connectivity probe**: HTTP servers get a real MCP `initialize` handshake (serverInfo + latency); stdio servers get an executable check.
- **Help**: tool naming (`mcp__<server>__<tool>`), how to invoke tools via the AI, manual config example, secret-safety notes, troubleshooting.

### Install

```powershell
# from GitHub
dsh plugin --profile web add github:jinhongxun/dsh-mcphub

# or from npm (once published)
dsh plugin --profile web add dsh-mcphub
```

Restart DSH after installing.

### Privacy

Secrets in headers / env stay in the host process for probing only — they are **never sent to the browser** (the panel receives key names only).

### FAQ: what is a profile?

A profile is DSH's isolated config environment (like browser profiles): each one keeps its own plugins and MCP server list. Example: a machine can have `web` (daily web UI) and `open-design` profiles, each with its own MCP servers. The profile picker in the add-server form decides which environment gets the new entry — with a single profile there is nothing to choose.

### Requirements

- Node.js ≥ 20
- DeepSeek Harness (ships the `dsh-client-connection` channel in official builds)

### Compatibility

Works on Windows / macOS / Linux (upgrade actions branch per platform: PowerShell ↔ pkill, `where` ↔ `command -v`, npm cache path auto-detected).

## License

MIT
