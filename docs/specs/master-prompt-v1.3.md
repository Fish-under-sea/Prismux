# 极简液态玻璃 AI 超级工作台与 24h 秘书系统 —— AGY 全栈自主施工总指令书 (v1.3 Final)

> **使用说明（给人类开发者）**：选定项目名称后，只需修改下方「全局命名占位变量表」里的 4 个值，把整份文档直接拖入 **Google Antigravity (AGY)** 会话（或保存为项目根目录的 `AGENTS.md` / `PROMPT.md`），让执行猫猫从 **Milestone 1** 开始按顺序自主施工即可。

## 0. 给 AGY 执行猫猫的开工总守则与全局命名变量

你好，负责写代码的猫猫！请把这份文档当作当前仓库的**最高工程宪法**，严格按以下规则自主推进开发，不要反复停下来问显而易见的确认问题：

1. **沟通与推进节奏**：先给出当前里程碑（M1–M5）的简短改动清单就立刻动手写代码；每跑通一个里程碑的编译与单测门禁，用 1–2 句大白话汇报结果并直接进入下一阶段，遇到真正缺少外部账号密钥的地方统一留到最后列清单交接。
2. **全局命名占位变量（初始化仓库时统一替换）**：

| 变量占位符 | 默认示例值（无 fish 词根） | 用途说明 |
| :--- | :--- | :--- |
| `<APP_NAME>` | `Prismux` | 软件正式显示名称、桌面窗口标题、GitHub 仓库名 |
| `<APP_SLUG>` | `prismux` | CLI 命令名、数据目录 `~/.prismux`、配置文件前缀 |
| `<NPM_SCOPE>` | `@prismux` | Monorepo 内部包与官方认证插件的 npm 作用域 |
| `<PLUGIN_PREFIX>` | `prismux-plugin-` | 第三方社区插件与 npm 市场自动检索的标准包名前缀 |

3. **绝对红线与明确砍掉的冗余功能（严禁擅自加戏）**：
   - **严禁直接修改 `vendor/t3code/` 目录内的任何一行上游源码**：所有扩展必须通过 [T3 Code 内部架构](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md) 暴露的鉴权 WebSocket RPC、`packages/client-runtime` 状态订阅以及 [Orchestrator V2 MCP](https://github.com/MajesteitBart/t3code-cli) 在外层完成。
   - **明确不做的 5 项冗余模块（已砍掉，严禁混入底座）**：**不要做**权威任务看板（Task Board）、**不要做**多代理组队 DAG（AgentTeam）、**不要做**技能中心面板（Skill Lens）、**不要做**网页视觉伴侣（Visual Companion）、**不要做**重型会话归档系统（Session Archive）。
   - **外部记忆零重型依赖**：内生记忆中枢严禁依赖外部 PostgreSQL / Qdrant / MinIO，也严禁依赖本地 Obsidian 客户端运行；必须做成守护进程内置的单文件 `SQLite (WAL) + FTS5 + sqlite-vec` 引擎，并暴露标准迁移与查询接口供后续 [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock) 把记忆层从 Obsidian 反向迁入本软件。
   - **桌宠与 QQ 机器人默认绝不预装**：桌宠（`pet`）、QQ 机器人（`qq`）、SSH 运维（`ssh`）、灵动岛上岛钩子（`fishdock-hook`）与红队清洗（`purge`）全部作为独立可选插件放入插件市场，主程序安装包只保留极简高效内核。
   - **视觉层零 Token 铁律**：动态壁纸、360° Fresnel 液态玻璃、字体调色与桌宠演出属于纯宿主视觉层，**严禁**向任何大模型或 Coding Agent 注入工具定义或 System Prompt，保持对模型 **0 Token 开销**。

## 1. 仓库完整 Monorepo 目录结构与技术栈

请使用 `Node.js >= 24.12`、`pnpm >= 10`（Workspace 模式）、`TypeScript 5.8+` 与 `Rust 1.85+ (Tauri v2)` 初始化如下目录树：

```text
<APP_SLUG>/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── UPSTREAM_LOCK.json                 # 记录 vendor/t3code 当前锁定的上游仓库 URL、Commit SHA 与同步日期
├── scripts/
│   ├── sync-t3-upstream.ts            # 拉取并更新只读 vendor/t3code 子树，跑 RPC 契约兼容性回归
│   ├── rename-brand.ts                # 一键将全局占位符替换为最终选定的软件名与包作用域
│   └── pack-plugin.ts                 # 可控 tar 打包与 SHA-256 清单生成脚本（规避大包 npm pack 坏 gzip 问题）
├── vendor/
│   └── t3code/                        # 100% 原样只读保留的 pingdotgg/t3code 上游源码树
├── packages/
│   ├── protocol/                      # Daemon <-> UI 扩展 RPC 契约、统一生命周期 Hook 类型、Island Hook 协议
│   ├── cordis-kernel/                 # 基于 Cordis 思想的时空可逆插件内核（daemon 域 + ui 域）与双轨 npm 安装器
│   ├── memory-core/                   # 单文件 SQLite WAL + FTS5 + sqlite-vec 混合记忆引擎与三域物理隔离守卫
│   └── sync-vault/                    # 对标 Magpie 的口令密封加密同步引擎（WebDAV / S3 path-style / GitHub / 本地备份）
├── apps/
│   ├── daemon/                        # 24h 常驻无头守护服务（托管 t3code server、主秘书槽位、Hook 总线、沙箱、Gmail 夜间工场）
│   ├── workbench-ui/                  # React 19 + Vite 前端（自由拖拽分屏网格、浮动胶囊、液态玻璃调色台、内置 WebWallGL、插件市场）
│   └── desktop-tauri/                 # Rust + Tauri v2 轻量透明原生壳（无边框透明合成、系统音频频谱采集、遮挡检测、Steam 壁纸扫描）
└── plugins-official/                  # 官方认证独立插件源码仓（构建为独立归档与 npm 包，默认不随核心启动安装）
    ├── catalog/
    │   └── official.json              # 官方插件权威发布索引（版本号、engines 范围、SHA-256、权限声明）
    ├── plugin-qq/                     # OneBot v11 QQ 私聊小秘书 + 群友高情商隔离记忆陪聊插件
    ├── plugin-pet/                    # 支持实例租约（Lease）、进度回执与阶段交还的桌宠/吉祥物插件
    ├── plugin-fishdock-hook/          # 审批与完工通知原生推送至 FISH-Dock 灵动岛的桥接插件
    ├── plugin-ssh/                    # 按需选装的 SSH 主机池、Web PTY 与 SFTP 插件
    └── plugin-purge/                  # 按需单装的模型提示词清洗与红队回滚插件
```

## 2. 六大核心技术底座详细实现规格

### 2.1 只读挂载 `vendor/t3code` 与“任意代理接任主秘书”机制

1. **进程托管与环境变量净化**：
   - `apps/daemon` 启动时作为监督进程拉起 `vendor/t3code/apps/server`（监听内部环回端口或 Unix Socket），支持传入 `--headless` 参数在 Debian NAS / Linux VPS（Docker 或 `systemd`）上 24 小时无界面独立运行。
   - **强制环境变量清洗**：参考 [T3 Code Issue #26966](https://github.com/pingdotgg/t3code/issues/26966)，在拉起任何 Provider 会话或子 Shell 前，显式剔除 `ELECTRON_RUN_AS_NODE` 等宿主污染变量。
2. **任意代理担任小秘书（Agent-Agnostic Chief Supervisor）**：
   - 不要用写死的第三方 SDK 重写聊天循环！直接在 `~/.<APP_SLUG>/chief-workspace` 初始化一个受保护的常驻协调工作区，通过 [T3 Code ProviderService](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md) 创建一个特权主秘书线程（`Chief Thread Slot`）。
   - 用户在顶部状态栏切换 Claude Code、Codex、Antigravity（`gemini-4-neon`）、OpenCode 或任意 ACP 代理时，主秘书大脑当场切换并直接复用该代理已登录的订阅额度。
   - `apps/daemon` 自动向该主秘书线程注入两个本地回环 MCP 服务：`<APP_SLUG>-memory`（读写三域记忆）与 `<APP_SLUG>-orchestrator`（配合内置 `t3-code` MCP 创建夜间 Worktree、发起 `Handoff`、调用 `Oracle` 审阅、发送汇报邮件）。

### 2.2 五大行业标杆核心原语内化规格（替代所有重型冗余面板）

请将 [Orca](https://github.com/stablyai/orca)、[Amp](https://ampcode.com/)、[AnythingLLM](https://github.com/mintplex-labs/anything-llm)、[Claude Code](https://pasqualepillitteri.it/en/news/35204/claude-code-the-complete-2026-guide-from-installation) 与 [OpenAI Codex](https://openagents.org/blog/posts/2026-09-28-codex-vs-claude-code) 的最佳工程原语精确实现为以下 5 个子模块：

| 原语模块路径 | 对标来源 | 必须落地的核心数据结构与行为逻辑 |
| :--- | :--- | :--- |
| `apps/daemon/src/pty/PersistentPtyPool.ts` | [Orca](https://github.com/stablyai/orca) & [#10671](https://github.com/stablyai/orca/issues/10671) | 服务端环形缓冲区（默认每终端 `2MB` 序列化帧）持久化 PTY 输出流，关闭或重启桌面 Tauri 窗口重连后无损回放全部终端历史；自动扫描并折叠代理自建的 `.claude/worktrees/*` 至 `agent-scratch` 分组，支持一键收编为正式项目线程；支持远程 Daemon 配对连接 |
| `apps/daemon/src/handoff/HandoffEngine.ts` | [Amp Handoff](https://ampcode.com/news/ask-to-handoff) & [Dial](https://ampcode.com/news/a-dial-for-you) | 实现 `/handoff` 动作：调用当前模型将长线程提纯为 `{ goal, decisions, touchedFiles, openQuestions }` 摘要包，自动开启一条干净的新线程续跑（彻底替代重型会话归档与 AgentTeam）；实现三档角色拨盘 `agent`（读写执行）、`oracle`（高阶只读架构参谋）、`review`（独立 Diff 挑刺审阅官） |
| `packages/memory-core/src/CollectorAndGuard.ts` | [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm/releases) | 内置轻量邮件/HTML/Markdown/纯文本切片收集器（`Collector`）；实现 **MCP `forwardIdentity` 硬件级作用域注入**（由 Daemon 在传输层强制覆写 `_callerScope`，绝不信任模型自报参数）与单 MCP 工具调用 **60 秒超时熔断器**；前端输入框支持键盘方向键导航的 `/` 斜杠快捷指令 |
| `apps/daemon/src/hooks/LifecycleHookBus.ts` | [Claude Code 2.1](https://pasqualepillitteri.it/en/news/35204/claude-code-the-complete-2026-guide-from-installation) | 将所有底层代理会话统一映射为确定性代码级钩子：`SessionStart`、`PreToolUse`、`PostToolUse`、`Notification`、`SubagentStop`、`Stop`；钩子退出码 `2` 将 `stderr` 作为拦截反馈退回给代理；安全类钩子强制默认 `"onFailure": "block"`（脚本崩溃或超时一律阻断动作，严禁放行）；内置 `plan / acceptEdits / auto / supervised` 四档权限 |
| `apps/daemon/src/sandbox/WorktreeSandbox.ts` | [Codex Sandbox](https://openagents.org/blog/posts/2026-09-28-codex-vs-claude-code) & [#21753](https://github.com/openai/codex/issues/21753) | 为无人值守的夜间 Worktree 提供操作系统级写入隔离（Linux 使用 `bwrap` / `Landlock`，macOS 使用 `sandbox-exec`，Windows 使用受限作业令牌，仅允许写入当前 Worktree 与临时缓存目录）；内置本地 HTTP 代理网关，默认关闭夜间子代理外网或仅放行可配置域名白名单（如 `github.com`、`registry.npmjs.org`） |

### 2.3 内生 SQLite 混合记忆中枢与三域物理防泄密 Schema

在 `packages/memory-core` 中使用 `better-sqlite3` 加 `sqlite-vec` 扩展创建单文件 `~/.<APP_SLUG>/data/memory.db`（启动时执行 `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;`）：

```sql
-- 1. 记忆主表（物理强制 namespace 前缀枚举校验）
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,                          -- ULID
  namespace TEXT NOT NULL CHECK (
    namespace = 'private/chief'
    OR namespace LIKE 'workspace/%'
    OR namespace LIKE 'social/qq-group-%'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('episodic', 'fact', 'preference', 'member_profile', 'handoff_note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_ref TEXT,                              -- 如 gmail:<msgId> / qq:<groupId>:<msgId> / thread:<id>
  importance REAL NOT NULL DEFAULT 0.5,
  machine_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                            -- 软删除墓碑，供多端增量同步合并使用
);

CREATE INDEX IF NOT EXISTS idx_memory_ns_updated ON memory_entries(namespace, updated_at DESC);

-- 2. FTS5 全文分词索引（支持中英混合 trigram / unicode61 检索）
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id UNINDEXED,
  namespace UNINDEXED,
  title,
  content,
  tokenize = 'trigram'
);

-- 3. sqlite-vec 稠密向量表（默认 768/1024 维自适应，离线无嵌入模型时优雅降级纯 FTS5 BM25）
-- CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[768]);
```

- **物理防泄密铁律（Query-Level Isolation）**：
  - 当 `_callerScope` 为 `qq_group:<gid>` 时，SQL 查询构造器在底层硬编码绑定 `WHERE namespace = 'social/qq-group-' || :gid AND deleted_at IS NULL`，**在代码路径上彻底杜绝读取 `private/chief`（个人邮件、隐私偏好）与 `workspace/*`（未公开源码仓库）的任何可能**。
  - 当 `_callerScope` 为 `owner_chief`（本人私聊或工作台主窗口）时，可跨 `private/chief` 与指定 `workspace/<repo>` 执行 RRF（BM25 + 向量余弦）混合检索。
- **承接 FISH-Dock 记忆迁移接口**：
  - 在 `apps/daemon` 暴露鉴权 REST 端点 `POST /v1/memory/query`、`POST /v1/memory/upsert` 与 `POST /v1/memory/import-obsidian`（递归扫描指定 Obsidian Vault 的 `.md` 笔记、YAML Frontmatter 与双链，自动按目录映射导入 `private/chief` 或 `workspace/<folder>`），让后续 FISH-Dock 无需再绑定 Obsidian。

### 2.4 精简版 `dsh-fish` 四项底座内置增强（仅此四项，绝不多加）

参考 [`@fish-under-sea/dsh-fish` (v2.2.3)](https://github.com/Fish-under-sea/dsh-fish)，直接在 `apps/daemon` 与 `apps/workbench-ui` 原生内建以下 4 个高频体验模块：

1. **中文审批风险解说与空输入续跑（`ApprovalGuide`）**：
   - 拦截所有 `PreToolUse` 审批请求，通过本地规则词典将 Shell 命令、文件删除、外网请求实时翻译为三栏中文提示：**「准备干什么（大白话动作）」「潜在风险等级（低/中/高危）」「触发拦截依据」**。
   - 输入框为空时点击发送按钮（或按快捷键），自动转为发送标准“继续执行（Continue）”指令，并在提交门闩处做**单路径幂等去重**，严防连点触发双发。
2. **模型卡片思考强度与模态直调（`ReasoningEffortCard`）**：
   - 在模型选择器卡片内直接渲染每个模型的思考预算档位（`low / medium / high / xhigh` 或具体 Token 预算数值）与图片/多模态输入开关，通过线协议下发真实推理参数而非拼接提示词。
   - **视觉细节保留**：暗色模式下，DeepSeek 系列模型轨道采用专属**深海军蓝轨道 + 深蓝至浅蓝进度填充 + `#6cb6ff` 高亮文字**，不偏紫、与浅色模式白蓝轨道清晰区分。
3. **Token 台账与订阅配额速览（`UsageLedger`）**：
   - 侧栏底部常驻紧凑速览条，展示各 Provider 今日/本周 Token 消耗、API 余额、订阅窗口配额占比与夜间工场峰谷成本估算；每条流水记录写入当前设备的 `machine_id`，避免多机同步恢复备份时重复累加（参考 [Magpie #6987](https://github.com/yetone/magpie/issues/6987)）。
4. **设置侧栏重排隐藏与命令排序恢复（`NavAndCommandOrder`）**：
   - 支持在设置页拖拽重排或隐藏不常用的侧栏项；`/` 斜杠命令菜单与快捷键面板支持全量自定义排序、中文标题与图标覆写，并随同步引擎跨设备恢复。

### 2.5 Cordis 双域可逆插件内核与双轨 `npm` 插件市场

参考 [DSH Cordis 时空可逆框架](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)、[FISH-DOCK-Plugins (v2.5.0)](https://github.com/Fish-under-sea/FISH-DOCK-Plugins) 与 [`dsh-our-free-model-fish`](https://github.com/Fish-under-sea/dsh-our-free-model-fish) 实战经验实现 `packages/cordis-kernel`：

1. **时空可组合生命周期（卸载零残留）**：
   - 每个插件包内含顶层 `package.json`（必须声明顶层 `"engines": { "<APP_SLUG>": ">=1.0.0 <2.0.0" }`，内核直接用顶层 SemVer 判定兼容性，绝不退化为 peer 枚举）与 `plugin.manifest.json`：
     ```json
     {
       "id": "qq",
       "version": "1.0.0",
       "realms": ["daemon", "ui"],
       "permissions": ["network:outbound", "memory:social-qq", "hooks:subscribe"],
       "modelVisible": false,
       "behaviors": { "autostart": true }
     }
     ```
   - 插件在 `apply(ctx)` 中注册的所有 HTTP 路由、Hook 监听器、定时任务、分屏面板类型与 CSS 样式均挂在 `ctx.effect()` 上；在插件页点击“停用”或“卸载”时自动逆向全部销毁，零内存泄漏、零残留 DOM。
   - 每个插件拥有独立加密凭据文件 `~/.<APP_SLUG>/credentials/<plugin-id>.enc`（文件权限严格设为 `0600`），插件间物理隔离不共享密钥。
2. **双轨插件市场（Official Verified vs. Community `npm`）**：
   - **第一轨：官方认证专区**：读取 `catalog/official.json`，带蓝色官方认证徽章，下载 `.wb-plugin`（或官方 npm 单包）时强制核对包内记录的 `SHA-256` 哈希。
   - **第二轨：第三方社区与免 Git `npm` 导入**：
     - 支持检索 GitHub Topic（`<APP_SLUG>-plugin`）及直接在输入框粘贴任意 npm 包名（如 `@scope/<PLUGIN_PREFIX>foo`）或拖入本地归档包。
     - **免本机 Git 纯流式安装器**：直接通过 HTTPS 请求 npm Registry（支持自动回退 npmmirror 镜像）获取 `.tgz` Tarball 流，在内存与临时目录中校验并解包，**强制禁用一切 `preinstall / install / postinstall` 脚本**，完全不调用用户本机的 `git` 命令（彻底规避本机 `git insteadOf` SSH 重写导致的拉包失败）。
     - **托管单写锁（`distribution: "managed"`）**：市场安装的插件自动写入 `"distribution": "managed"`，停用插件私自应用内热自更，统一由宿主插件中心原子替换目录，防止双写损坏。
     - **醒目权限审计卡片**：安装第三方插件前弹窗展示权限面标签（特别是声明了 `modelVisible: true` 或修改系统提示词的插件，必须标黄二次确认）。
3. **首批官方独立插件规格（置于 `plugins-official/`，默认全部不预装）**：
   - **`<NPM_SCOPE>/plugin-qq`**：内置“本机常见 OneBot 端口自动探测 + 正向/反向 WebSocket 连接”（适配 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 与 [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core)），无需预装任何 QQ 客户端即可在面板里先做“直聊回环测试”。**私聊主人账号**时映射至主秘书线程（可查邮件、派发夜间编码任务、查进度）；**在已授权 QQ 群开启陪聊开关**时，启用防刷屏节奏器（`@` 必回、关键词接茬、随机概率插话、群冷却窗口、拟人分段短句延迟发送）并严格锁定 `social/qq-group-<gid>` 独立记忆域。
   - **`<NPM_SCOPE>/plugin-pet`**：完整实现你在 [dsh-pet Issue #122](https://github.com/PC2005-cloud/dsh-pet/issues/122) 提出的正式联动契约——**定向实例绑定**（多开网页或桌面端互不误驱）、**带过期校验的租约锁（Lease Token，旧租约迟到请求直接拒绝）**、**只读播放进度订阅（`currentTime / duration / buffering` 与 `playbackId` 回执）**、以及**动作与气泡分阶段独立交还**（演出结束先恢复原生走位但保留新邮件气泡，卸载时清空自身命名空间扩展动作且不改用户全局配置）。
   - **`<NPM_SCOPE>/plugin-fishdock-hook`**：松耦合连接本机或局域网运行的 [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock)——将 `PreToolUse` 中文风险审批单、重要邮件提醒与夜间工场完工回执转化为原生灵动岛卡片上岛，支持在灵动岛直接快捷键放行或驳回。
   - **`<NPM_SCOPE>/plugin-ssh`** 与 **`<NPM_SCOPE>/plugin-purge`**：分别承接主机连接池 / Web PTY / SFTP 运维能力与红队清洗提示词演练台，按需单装。

### 2.6 对标 Magpie 的多端零知识加密同步与备份引擎（`packages/sync-vault`）

严格参照 [yetone/magpie](https://github.com/yetone/magpie)（含 [#296](https://github.com/yetone/magpie/issues/296)、[#657](https://github.com/yetone/magpie/issues/657)、[#2205](https://github.com/yetone/magpie/issues/2205)、[#3032](https://github.com/yetone/magpie/issues/3032)、[#5961](https://github.com/yetone/magpie/issues/5961) 与 [Portable 规范](https://usemagpie.ai/docs/start)）实现：

1. **三远端通道独立启停 + 离线备份 + 便携模式**：
   - 支持 **WebDAV**（坚果云、Nextcloud、OpenMediaVault NAS）、**S3 兼容存储**（AWS S3、Cloudflare R2 `region=auto`、Backblaze B2、MinIO / NAS 勾选 `path-style` 路径风格 + 允许信任局域网自签名 TLS 证书）与 **加密 GitHub 私有仓库**（带变更预览与历史提交回滚）。三个远端通道拥有**各自独立的启停开关**，关闭某一项时保留已填配置不清空。
   - **便携模式（Portable Mode）**：当检测到可执行文件同级存在名为 `data` 的目录时，自动将所有 SQLite 数据库、缓存、日志与配置收敛至该 `data/` 目录内，不在系统用户目录写任何残留。
2. **口令端到端密封加密（Passphrase-Sealed AEAD）**：
   - 使用 `Argon2id` 派生密钥配合 `XChaCha20-Poly1305`（或 `AES-256-GCM`）将同步载荷密封为 `.<APP_SLUG>-backup` 密文块；**强校验加密口令不得与 S3 Secret Access Key 或 WebDAV 密码相同**。
   - 手动导出的本地离线备份默认剥离所有 API Key；仅在勾选“包含登录态与插件密钥”并二次确认口令后才密封入包。
3. **多机防覆盖与弱网不断连**：
   - **条件写入乐观锁**：上传携带 `If-Match: "<etag>"`；遇到不支持条件写入的旧版 NAS/MinIO 自动退化为写入前 `HEAD` 核对 `ETag`，发现远端已被另一台设备更新时触发增量三路合并（记忆按 ULID + `updated_at` 幂等合并，配置给出冲突对比提示），绝不静默覆盖。
   - **60 秒停滞看门狗（Stall Watchdog）**：禁止对备份上传/下载设死板固定总超时！采用流式字节进度监听——只要每 60 秒内仍有任意字节收发就一直传下去；仅在连续 `60s` 零字节传输时才中断并明确报错“连续 60 秒无数据收发”，`PROPFIND / HEAD` 等元数据小请求保留 `30s` 快速超时。
4. **分设备同步矩阵与本机标记**：
   - 设置页提供“上传 / 下载”双向勾选矩阵（私密记忆、项目记忆、群聊记忆、斜杠指令与 MCP、已装插件清单、外观排版预设、用量台账）；任意本机专属路径（如本机 Steam 壁纸目录或 `127.0.0.1` 本地 MCP）支持打上 `"local": true` 或 `allowedMachines` 白名单，同步时自动跳过下发给其他机器。

## 3. 全自动夜间工场与邮件闭环工作流规格

在 `apps/daemon/src/workflows/OvernightFactory.ts` 实现从 **Gemini App 灵感邮件 → 凌晨自动交付代码分支 → 完工邮件早报** 的全自动闭环：

1. **Gmail 入站增量监听**：支持 OAuth2 Gmail API（History ID 增量拉取）与通用 IMAP IDLE + SMTP 双模式配置。监听特定收件别名（如 `user+factory@gmail.com`）或主题/标签含 `#factory`、`[Idea]` 的邮件。
2. **四阶段无人值守流水线**：
   - **Stage A（记忆补全与 Handoff 立项）**：解析邮件正文（例如从 Gemini App 转发的对话草稿），唤醒主秘书代理检索 `workspace/<target-repo>` 记忆，自动补全该仓库的技术栈与代码规范，通过 `HandoffEngine` 提纯生成一份结构化任务单（含目标仓库、新建分支名 `factory/MMDD-<slug>`、验收测试命令）。
   - **Stage B（Worktree + Codex 内核沙箱编码）**：通过 Orchestrator V2 在目标仓库创建隔离 `git worktree`，挂载 `WorktreeSandbox`（锁死工作树外部写权限 + 网络域名白名单）并以 `auto` 权限模式启动指定 Coding Agent 完成代码编写、类型检查与单测自愈循环，最终在独立分支完成 Git Commit（绝不自动强推覆盖 `main` 主分支）。
   - **Stage C（Amp `Oracle / Review` 独立挑刺）**：自动以只读 `review` 拨盘模式唤起一次独立审阅，对生成的 `git diff` 检查潜在空指针、安全越界或遗漏边界，生成简明审阅评语。
   - **Stage D（精美 HTML 完工早报回信）**：`Stop` 钩子触发邮件渲染器，将 **「一句话成果总结 + 修改文件统计 + 关键 Diff 高亮块 + 单测输出 + Oracle 审阅意见 + 本次 Token 消耗 + 一键唤醒桌面工作台审阅合并的 `<APP_SLUG>://review/<threadId>` 深链」** 发送回用户邮箱（若装了 `plugin-fishdock-hook` 或 `plugin-qq`，同步推送简短完工卡片）。

## 4. 360° Fresnel 液态玻璃、自由分屏画布与内置 `WebWallGL` 壁纸规格

结合 [dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) 与 [FISH-DOCK-Plugins v2.5.0](https://github.com/Fish-under-sea/FISH-DOCK-Plugins) 外观规范构建 `apps/workbench-ui` 与 `apps/desktop-tauri`：

1. **分层 Z 轴渲染管线（玻璃与壁纸解耦，可独立开关）**：
   - **Z-0 动态壁纸视口层（内置 `WebWallGL`）**：Tauri Rust 端自动探测并扫描本机 Steam `steamapps/workshop/content/431960` 目录及用户自定义上传目录；内置 MIT 开源引擎 `WebWallGL` 实时 WebGL2 渲染 Wallpaper Engine 的 `Scene` 壁纸（粒子、骨骼、SceneScript、鼠标视差，异常时自动无缝降级内嵌 MP4 或静态预览帧），严格沙箱隔离承载 `Web` 壁纸，原生 `<video>` 播放视频壁纸（支持帧率上限控制）。
   - **Z-1 系统音频频谱与环境律动层**：Tauri Rust 层通过 Windows WASAPI Loopback / macOS CoreAudio / Linux PipeWire 采集低延迟 FFT 频谱与系统 Now Playing 元数据推送至前端驱动壁纸音频反应与底栏音波；**节能铁律**：当窗口最小化、被其他全屏窗口完全遮挡、锁屏或笔记本处于省电阈值时，Rust 层发出 `visibility: occluded` 信号，壁纸渲染立即挂起至 **0% GPU / 0 FPS**。
   - **Z-2 360° Fresnel 高级光学液态玻璃层**：采用 SVG 位移折射滤镜 + 360° 菲涅尔边缘高光（Fresnel Specular Rim）+ 微噪点抗色带，彻底告别廉价灰雾毛玻璃。外观设置面板完全对齐 FISH-Dock 直觉体验：**三态拟物胶囊秒切（浅色 / 深色 / 液态玻璃）**、玻璃模式下顶部服务条自动透明、自动收敛强调色对玻璃底色的过度染色、**深色与浅色字体颜色独立调节**、字体家族/字重/折射模糊度/暗角滑块，并支持一键开启“跟随本机 FISH-Dock 主题（`FishDock.theme` 桥接）”。玻璃层本身做成可一键单独停用的内部 UI 模块，停用后秒回纯净原生扁平外观而壁纸不受影响。
   - **Z-3 高对比前景交互层**：确保代码编辑器、行级 Diff 绿红条与终端文字始终具备高可读对比度。
2. **自由拖拽分屏网格 + 浮动玻璃胶囊（双预设一键秒切）**：
   - 基于二元分割树（Dockview / Mosaic 模型）实现任意面板自由拖拽分屏、标签合并与比例缩放，并在顶层叠加可自由拖放吸附的**浮动玻璃胶囊（Floating Capsules）**。
   - 顶栏内置两枚核心场景预设胶囊，支持一键丝滑切换并允许用户新建自定义预设：
     - **「秘书待机预设」**：自动收起所有重型代码面板，留出 **85%–90% 纯净动态壁纸画幅**，仅悬浮“主秘书快捷对话条”与“待办审批/未读邮件灵动小胶囊”。
     - **「多代理编码预设」**：自动展开左侧精简 Worktree 实时状态树（参考 Orca）、中部并行持久 PTY 终端分屏 + 行级 Git Diff 审查器、右侧实时浏览器预览（参考 [Paradev](https://github.com/paradevai/paradev)）与顶部统一待办审批收件箱（参考 [tuios](https://github.com/andyrewlee/awesome-agent-orchestrators)）。
   - 支持一键导入导出整套 `.wb-theme` 外观与排版预设包（含壁纸配置、液态玻璃折射参数、字体与分屏树结构，自动剔除一切个人路径与凭据），方便社区分享传播。

## 5. 分阶段自主施工路线图与自动化验收门禁（Milestones）

请严格按 **M1 → M5** 顺序逐步推进，每完成一阶段必须跑通对应自动化测试后再进入下一阶段：

| 阶段 | 施工内容 | 必须通过的工程验收门禁（DoD） |
| :--- | :--- | :--- |
| **M1：骨架、只读 T3 桥接与守护中枢** | 初始化 pnpm Monorepo 与 `scripts/rename-brand.ts`；拉取只读 `vendor/t3code` 并写入 `UPSTREAM_LOCK.json`；实现 `apps/daemon` 进程监督、环境变量清洗、主秘书线程槽位绑定与 `PersistentPtyPool` | `pnpm -r typecheck` 零报错；无界面执行 `node apps/daemon/dist/cli.js start --headless` 可正常连上 T3 Server RPC 并在重连后完整恢复 PTY 历史流 |
| **M2：内生三域记忆库与五大标杆原语** | 实现 `packages/memory-core`（SQLite WAL + FTS5 + `sqlite-vec` + Obsidian 导入器）；实现 `forwardIdentity` 作用域硬隔离、`LifecycleHookBus`（含 `onFailure: "block"`）、`HandoffEngine`（含 `Oracle / Review` 拨盘）与 `WorktreeSandbox` | 编写越权单测验证 `qq_group` 身份查询 `private/chief` 100% 返回空集；验证安全 Hook 超时或抛错时必定阻断工具执行；验证 `/handoff` 可无损生成新线程摘要 |
| **M3：Cordis 双轨插件商城与 Magpie 同步** | 实现 `packages/cordis-kernel`（顶层 `engines` 校验、卸载零残留回滚、官方 SHA-256 目录与免本机 Git 的 `npm` Tarball 无脚本安装器 + `managed` 锁）；实现 `packages/sync-vault`（口令 AEAD 密封、WebDAV/S3/Git 独立开关、`If-Match` 乐观锁、60s 停滞看门狗与 `data/` 便携模式） | 模拟慢速流测试 3 分钟持续低速传输不断连、连续 60s 零字节准时触发停滞报错；模拟双机并发上传验证 `If-Match` 拦截覆盖；验证 `npm` 插件启停无残留监听 |
| **M4：Tauri v2 液态玻璃壳、四把手术刀与壁纸引擎** | 搭建 `apps/desktop-tauri`（无边框透明合成、系统音频 FFT、遮挡 `0 FPS` 暂停、Steam `431960` 壁纸扫描）与 `apps/workbench-ui`（360° Fresnel 液态玻璃调色台、自由分屏 + 浮动胶囊双预设、`WebWallGL` 集成，以及内置中文审批解说、思考强度直调、Token 台账、导航排序 4 项功能） | `cargo check` 与前端生产构建全绿；实测切换浅色/深色/液态玻璃三态胶囊、切换待机与编码布局预设、窗口最小化时壁纸渲染循环立即暂停 |
| **M5：夜间全自动工场与四大官方可选插件** | 完成 `OvernightFactory`（Gmail `#factory` 监听 → Handoff → 沙箱 Worktree 编码 → Oracle 自审 → HTML 完工汇报发信）；在 `plugins-official/` 完成独立打包的 `plugin-qq`、`plugin-pet`（含租约与阶段交还测试）、`plugin-fishdock-hook` 与 `plugin-ssh` | 跑通端到端模拟邮件入站 → 自动拉分支改代码过单测 → 产出带 Diff 与 Oracle 评语的 HTML 邮件全文；使用 `scripts/pack-plugin.ts` 生成官方插件包并通过市场导入 |
