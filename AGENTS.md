# Prismux 超级工作台 · Agent 必读

> 本文件是本仓的**跨机器统配入口与工程口径**，所有克隆者与执行代理通用；项目完整架构规格见 [`docs/specs/master-prompt-v1.3.md`](./docs/specs/master-prompt-v1.3.md)，世界级 UI/UX、主题与背景及安装包强制规范见 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md)。
> 本机路径、工具链版本、缓存目录与凭据文件磁盘路径等**本机环境事实**，统一放在 `docs/agents/local/<规范化用户名>.md`，不写入本文件。

## 零、先识别当前用户，再读取本机档案

本仓将「跨机器规则」与「本机事实」分成两层：本文件承载前者，`docs/agents/local/<规范化用户名>.md` 承载后者，**两者均随仓入库**，由各自作者维护。

开工前按顺序执行：

1. **读取当前用户名**：在 PowerShell（`pwsh`）中读取 `$env:USERNAME`（可结合 `$env:USERPROFILE` 确认主目录；Linux / macOS 回退读取 `$env:USER` 或 `whoami` 与 `$HOME`）。
2. **规范化用户名**：将用户名转为小写，空格、`\`、`/`、`:` 及非 ASCII 字符替换为 `-`，合并连续 `-` 并去除首尾多余 `-`，仅读取对应的 `docs/agents/local/<规范化用户名>.md`（例如 `Fish` → `docs/agents/local/fish.md`）。
3. **缺失建档流程**：若对应档案不存在，复制 [`docs/agents/local/_template.md`](./docs/agents/local/_template.md) 为 `docs/agents/local/<规范化用户名>.md`，按本机实际情况填写后，以精确路径单独提交入库（严禁写入任何 Token、密码或 API Key 正文）。
4. **两层优先级边界**：**路径、工具链安装位置、缓存 / Store 目录、凭据文件路径与本机网络现象以个人档案为准；工程红线、品牌常量、插件契约、验收门禁与提交规范以本文件为准。**
5. 详细命名规则与维护流程见 [`docs/agents/README.md`](./docs/agents/README.md)。

## 一、项目定位、品牌常量与 Monorepo 边界

Prismux 是一个「极简液态玻璃 AI 超级工作台与 24h 秘书系统」，由 24 小时常驻无头守护进程（`apps/daemon`）、任意代理接任主秘书槽位（`Chief Thread Slot`）、单文件 SQLite 混合记忆引擎、Cordis 双域可逆插件内核、Magpie 端到端加密同步引擎、夜间全自动工场，以及基于 Tauri v2 + React 19 的 360° Fresnel 液态玻璃原生桌面端共同组成。

### 品牌命名常量与远端仓库

| 常量标识 | 标准值 | 用途说明 |
| :--- | :--- | :--- |
| `APP_NAME` | `Prismux` | 软件正式显示名称、桌面窗口标题、GitHub 仓库名 |
| `APP_SLUG` | `prismux` | CLI 命令名、默认数据目录 `~/.prismux`、配置文件前缀、`.prismux-backup` |
| `NPM_SCOPE` | `@prismux` | Monorepo 内部包与官方认证插件的 npm 作用域 |
| `PLUGIN_PREFIX` | `prismux-plugin-` | 第三方社区插件标准包名前缀（GitHub Topic：`prismux-plugin`） |
| 远端仓库 | `https://github.com/Fish-under-sea/Prismux.git` | Prismux 官方上游仓库地址 |

> 约束：代码中禁止残留 `<APP_NAME>`、`<APP_SLUG>`、`<NPM_SCOPE>`、`<PLUGIN_PREFIX>` 等占位符；品牌级命名严禁混入 `fish` 词根（`plugins-official/plugin-fishdock-hook` 为专指外部 FISH-Dock 宿主桥接的官方插件，属唯一合法命名例外）。

### Monorepo 目录树与职责边界

```text
prismux/
├── AGENTS.md                          # 本文件：跨机器统配入口与工程红线
├── README.md                          # 项目中文概览与快速开始
├── UPSTREAM_LOCK.json                 # 锁定 vendor/t3code 的上游仓库、分支、Commit SHA、同步时间与必需路径
├── pnpm-workspace.yaml                # Workspace 边界定义（显式排除 vendor/t3code 与 apps/desktop-tauri）
├── package.json                       # 根脚本（typecheck / build / test:scripts / upstream:* / brand:rename / plugin:pack）
├── tsconfig.base.json                 # 公共 TS 严格基线（ES2024 + NodeNext + verbatimModuleSyntax）
├── docs/
│   ├── agents/                        # 个人本机环境档案说明、模板与按人档案
│   └── specs/
│       ├── master-prompt-v1.3.md      # 全栈自主施工总指令书（最高架构宪法）
│       └── ui-ux-design-mandate.md    # 世界级 UI/UX、主题与背景及安装包强制设计规范
├── scripts/                           # 零第三方依赖运维工具脚本（Node 24 原生 TS 运行）与原生单测
│   ├── rename-brand.ts                # 全局品牌标识安全替换脚本
│   ├── sync-t3-upstream.ts            # 只读校验（--check）与上游同步（--sync）脚本
│   ├── pack-plugin.ts                 # 确定性 ustar + gzip 回环自检打包与 SHA-256 生成脚本
│   └── __tests__/scripts.test.ts      # node:test 脚本回归测试
├── vendor/
│   └── t3code/                        # 100% 原样只读 Git 子模块（pingdotgg/t3code），严禁纳入 pnpm-workspace.yaml
├── packages/
│   ├── protocol/                      # @prismux/protocol：品牌常量、Daemon <-> UI 扩展 RPC、Hook 类型、三域记忆与插件契约
│   ├── cordis-kernel/                 # @prismux/cordis-kernel：时空可逆双域插件内核（daemon + ui）与双轨安装器
│   ├── memory-core/                   # @prismux/memory-core：SQLite WAL + FTS5 + sqlite-vec 混合记忆与物理防泄密守卫
│   └── sync-vault/                    # @prismux/sync-vault：Argon2id + AEAD 端到端加密同步（WebDAV / S3 / GitHub / 便携模式）
├── apps/
│   ├── daemon/                        # @prismux/daemon：24h 无头守护服务（托管 t3code server、主秘书槽位、五大原语、夜间工场）
│   ├── workbench-ui/                  # @prismux/workbench-ui：React 19 + Vite 前端（分屏网格、浮动胶囊、液态玻璃、WebWallGL、插件市场）
│   └── desktop-tauri/                 # prismux-desktop：Rust 1.85+ / Tauri v2 轻量透明原生壳（不纳入 pnpm workspace）
└── plugins-official/                  # 官方认证独立插件源码与索引（默认全部不预装）
    ├── catalog/official.json          # 官方插件权威索引（version / engines / sha256 / bytes / status）
    ├── plugin-qq/                     # @prismux/plugin-qq：OneBot v11 私聊主秘书 + 群聊隔离陪聊插件
    ├── plugin-pet/                    # @prismux/plugin-pet：带租约锁与分阶段交还的桌宠联动插件
    ├── plugin-fishdock-hook/          # @prismux/plugin-fishdock-hook：FISH-Dock 灵动岛审批与回执桥接插件
    ├── plugin-ssh/                    # @prismux/plugin-ssh：按需选装的 SSH 主机池、Web PTY 与 SFTP 插件
    └── plugin-purge/                  # @prismux/plugin-purge：按需单装的模型提示词清洗与红队回滚插件
```

### Workspace 与技术栈边界

- **基础工具链要求**：`Node.js >= 24.12.0`、`pnpm >= 10.0.0`（仓库声明 `pnpm@12.3.4`）、`TypeScript >= 5.8`（`NodeNext` + `verbatimModuleSyntax`，包内相对导入必须显式带 `.js` 后缀，纯类型导入使用 `import type`）、`Rust >= 1.85`（M4 `apps/desktop-tauri`）。
- **`pnpm-workspace.yaml` 白名单**：仅包含 `packages/*`、`apps/daemon`、`apps/workbench-ui`、`plugins-official/plugin-*`。
- **`vendor/t3code/` 只读隔离**：`vendor/t3code/` 是由 `UPSTREAM_LOCK.json` 锁定的只读 Git 子模块，**绝不纳入根 `pnpm-workspace.yaml`**，防止其上游依赖污染主仓锁文件或触发无意修改。
- **`apps/desktop-tauri/` Rust 隔离**：属于独立 Cargo crate，仅在 M4 桌面原生壳阶段由 Cargo 构建，不纳入 `pnpm` workspace。

## 二、五大绝对工程红线

任何代理与开发者在施工过程中必须无条件遵守以下 5 条红线：

1. **严禁修改 `vendor/t3code/` 内任何一行上游源码**
   - `vendor/t3code/` 必须保持 `git status --porcelain` 完全为空且 `HEAD` 与 `UPSTREAM_LOCK.json` 一致。
   - 所有扩展能力必须外置实现：通过 T3 Code 暴露的鉴权 WebSocket RPC、`packages/client-runtime` 状态订阅以及 Orchestrator V2 MCP 在外层桥接与编排。
2. **严禁混入已明确砍掉的 5 项冗余模块**
   - **禁止实现**：① 权威任务看板（Task Board）、② 多代理组队 DAG（AgentTeam）、③ 技能中心面板（Skill Lens）、④ 网页视觉伴侣（Visual Companion）、⑤ 重型会话归档系统（Session Archive）。
   - 上述场景统一由五大内化原语替代：`PersistentPtyPool`、`HandoffEngine`（`/handoff` 与 `agent / oracle / review` 三档拨盘）、`CollectorAndGuard`、`LifecycleHookBus` 与 `WorktreeSandbox`。
3. **内生单文件 SQLite 记忆中枢与物理防泄密**
   - 记忆引擎固定为单文件 `~/.prismux/data/memory.db`（`SQLite WAL + FTS5 + sqlite-vec`），**零 PostgreSQL、零 Qdrant、零 MinIO、零本地 Obsidian 客户端运行依赖**（仅在 `apps/daemon` 暴露 `POST /v1/memory/import-obsidian` 接口承接历史笔记迁移）。
   - 查询层强制在传输层通过 `forwardIdentity` 注入并覆写 `_callerScope`，**绝不信任模型自报参数**；当 `_callerScope` 为 `qq_group:<gid>` 时，SQL 构造器底层硬编码绑定 `WHERE namespace = 'social/qq-group-' || :gid AND deleted_at IS NULL`，物理杜绝读取 `private/chief` 与 `workspace/*`。
4. **五大官方插件默认绝不预装**
   - `qq`、`pet`、`fishdock-hook`、`ssh`、`purge` 全部独立存放在 `plugins-official/`，通过独立 `.wb-plugin` 归档或 `@prismux/plugin-*` 按需安装；核心主程序与默认守护进程启动链路保持极简，不捆绑预装。
5. **视觉层对模型 0 Token 开销与强制设计规范**
   - `WebWallGL` 动态壁纸、360° Fresnel 液态玻璃、字体调色、系统音频律动、桌宠演出与安装包向导属于纯宿主视觉层，**严禁**向任何大模型或 Coding Agent 注入工具定义（Tool Schema）或 System Prompt，保持对模型 **0 Token 开销**。
   - M4 工作台前端、`apps/desktop-tauri/installer/` 与 UI 域插件必须严格遵守 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md) 的视觉、动效、主题同步、无障碍对比度及降级兜底红线。

## 三、M1–M5 分阶段路线图与自动化验收门禁（DoD）

施工严格按 **M1 → M5** 顺序推进，当前里程碑未跑通全部自动化验收门禁前，不得跳入下一阶段：

| 阶段 | 核心施工内容 | 必须通过的自动化验收门禁（DoD） |
| :--- | :--- | :--- |
| **M1：骨架、只读 T3 桥接与守护中枢** | 初始化 pnpm Monorepo 与 `scripts/` 工具链；拉取只读 `vendor/t3code` 并写入 `UPSTREAM_LOCK.json`；实现 `apps/daemon` 进程监督、环境变量清洗、主秘书槽位（`Chief Thread Slot`）与 `PersistentPtyPool`（默认每终端 `2 MB` 环形缓冲） | `pnpm -r typecheck`、`pnpm -r build`、`pnpm test:scripts` 与 `pnpm upstream:check` 全绿；`node apps/daemon/dist/cli.js start --headless` 可无界面连上 T3 Server RPC 并在重连后无损回放 PTY 历史流 |
| **M2：内生三域记忆库与五大标杆原语** | 实现 `packages/memory-core`（SQLite WAL + FTS5 + `sqlite-vec` + Obsidian 导入）；实现 `forwardIdentity` 作用域硬隔离与 60 s 熔断、`LifecycleHookBus`（6 类事件、退出码 `2` 拦截、安全钩子默认 `onFailure: "block"`、四档权限）、`HandoffEngine`（`/handoff` + 三档拨盘）与 `WorktreeSandbox`（OS 级写隔离 + 域名白名单网关） | 越权单测验证 `qq_group:<gid>` 查询 `private/chief` 与 `workspace/*` **100% 返回空集**；安全 Hook 超时或抛错时必定阻断执行；`/handoff` 可无损提纯 `{ goal, decisions, touchedFiles, openQuestions }` 并续跑新线程 |
| **M3：Cordis 双轨插件商城与 Magpie 同步** | 实现 `packages/cordis-kernel`（顶层 `engines.prismux` SemVer 校验、`ctx.effect()` 卸载零残留、官方 SHA-256 校验、免 Git 无脚本 `npm` Tarball 安装器 + `distribution: "managed"` 锁）；实现 `packages/sync-vault`（Argon2id + AEAD 密封、WebDAV/S3/Git 独立开关、`If-Match` 乐观锁、60 s 停滞看门狗与 `data/` 便携模式） | 慢速流模拟测试 3 分钟持续低速传输不断连、连续 60 s 零字节准时触发停滞报错；双机并发上传验证 `If-Match`（及降级 `HEAD ETag`）拦截覆盖；`npm` 插件启停与卸载无残留监听、路由或 DOM |
| **M4：Tauri v2 液态玻璃壳、四把手术刀与壁纸引擎** | 搭建 `apps/desktop-tauri`（无边框透明合成、WASAPI/CoreAudio/PipeWire 音频 FFT、`visibility: occluded` 0 FPS 挂起、Steam `431960` 扫描、克制 5 步 NSIS/首次引导安装包）与 `apps/workbench-ui`（严格按 `docs/specs/ui-ux-design-mandate.md` 实现全宽内凹天体三态胶囊、四区域 360° Fresnel 液态玻璃、独立浅/深文字调色、自由分屏 + 浮动胶囊双预设、`WebWallGL`、`.wb-theme` 导入导出，以及内置 `ApprovalGuide`、`ReasoningEffortCard`、`UsageLedger`、`NavAndCommandOrder`） | `cargo check`（必要时 `-j 1`）与前端生产构建全绿；对照 `docs/specs/ui-ux-design-mandate.md` 完成控件八态、对比度、`prefers-reduced-motion` 与禁 GPU 实底兜底核验；实测切换浅色 / 深色 / 液态玻璃天体三态胶囊、切换「秘书待机 / 多代理编码」布局预设、窗口最小化或全屏遮挡时壁纸渲染立即暂停至 0 FPS，安装包组件页明确声明五大官方插件默认不预装 |
| **M5：夜间全自动工场与官方独立插件** | 完成 `OvernightFactory`（Gmail OAuth2 / IMAP `#factory` 监听 → 记忆补全与 Handoff 立项 → Worktree 沙箱编码与提交 → Oracle 只读 `review` 挑刺 → HTML 完工早报回信与 `prismux://review/<threadId>` 深链）；完成 `plugins-official/` 下 `plugin-qq`、`plugin-pet`（定向实例、Lease 锁、进度订阅、分阶段交还）、`plugin-fishdock-hook`、`plugin-ssh` 与 `plugin-purge` | 跑通端到端模拟邮件入站 → 自动拉分支改代码过单测 → 产出带 Diff 与 Oracle 评语的 HTML 邮件全文；使用 `pnpm plugin:pack` 生成官方插件 `.wb-plugin` 与 `.sha256` 并通过市场导入验签 |

## 四、核心工具脚本与插件打包契约

`scripts/` 下所有脚本均为**零第三方依赖的纯 Node 24 原生 TypeScript**（可直接通过 `node scripts/<name>.ts` 执行；因此脚本中禁止使用 `enum` 或构造函数参数属性等需运行时编译转换的语法）：

### 1. `scripts/rename-brand.ts`（`pnpm brand:rename`）

- **用途**：一键安全替换仓库中的品牌标识符，方便二开或改名时全仓同步。
- **常用参数**：`--app-name <Name>`、`--app-slug <slug>`、`--npm-scope <@scope>`、`--plugin-prefix <prefix>`、`--from-app-name`（默认 `Prismux`）、`--from-app-slug`（默认 `prismux`）、`--from-npm-scope`（默认 `@prismux`）、`--from-plugin-prefix`（默认 `prismux-plugin-`）、`--root <dir>`、`--dry-run`。
- **安全边界**：严格跳过 `.git`、`vendor`、`node_modules`、`dist`、`.work`、`target` 目录及二进制/媒体扩展名；按长前缀优先顺序替换（`fromPluginPrefix` → `fromNpmScope` → `fromAppName` → `fromAppSlug`）；`--dry-run` 模式仅输出结构化变更报告，绝不落盘。

### 2. `scripts/sync-t3-upstream.ts`（`pnpm upstream:check` / `pnpm upstream:sync`）

- **`--check`（默认）**：
  1. 校验根 `UPSTREAM_LOCK.json` 格式完整且 `readOnly === true`；
  2. 检查 `vendor/t3code/` 目录存在；
  3. 校验 `git -C vendor/t3code rev-parse HEAD` 与 `UPSTREAM_LOCK.json.commit` 一致；
  4. 校验 `git -C vendor/t3code status --porcelain` **完全为空**（任何本地脏改动立即报错阻断，守住只读红线）；
  5. 检查 `requiredPaths`（`apps/server/package.json`、`packages/client-runtime`、`packages/contracts`、`docs/internals/overview.md`）存在且 `apps/server/package.json` 为合法 JSON。
- **`--sync`**：
  - 使用 `git -c core.longpaths=true -c http.sslBackend=openssl -c http.version=HTTP/1.1` 拉取上游目标分支（`--depth 1`）并检出至 `vendor/t3code`，更新 `UPSTREAM_LOCK.json` 的 `commit` 与 `syncedAt`，随后自动执行一次完整 `--check` 门禁。

### 3. `scripts/pack-plugin.ts`（`pnpm plugin:pack`）

- **用途与参数**：将单个插件目录打包为确定性归档包并输出校验摘要：`--plugin <dir>`、`--out <dir>`（默认 `.work/plugin-dist`）、`--update-catalog <path>`（可选，自动回写 `catalog/official.json` 中的 `version`、`sha256`、`bytes` 与 `status: "verified"`）。
- **确定性打包与回环自检**：
  - 纯 TS 序列化确定性 POSIX ustar `.tar`（跳过 `node_modules`、`.git`、`.work`、`*.wb-plugin`、`*.sha256`、`.DS_Store`；按 POSIX 字典序排列；固定 `mtime = 0`、`uid = 0`、`gid = 0`）。
  - 使用 `zlib.gzipSync` 压缩为 `<id>-<version>.wb-plugin`，**立即执行 `zlib.gunzipSync` 逐字节回环核对与原始 `.tar` 完全一致**（规避 Node 24 大 buffer zlib 异常），一致后写出 `<id>-<version>.sha256`（`<sha256>  <filename>`）。

### 4. 插件打包、安装与运行安全契约

- **顶层 `engines.prismux` SemVer 强制校验**：每个插件的 `package.json` 必须声明顶层 `"engines": { "prismux": "<semver-range>" }`，内核直接按顶层 SemVer 判定兼容性，**绝不回退到 `peerDependencies`**；同时 `plugin.manifest.json` 必须包含 `id`、`version`、非空 `realms`、`permissions` 与布尔值 `modelVisible`。
- **托管单写锁（`distribution: "managed"`）**：通过官方目录或社区市场安装的插件自动写入 `"distribution": "managed"`，禁止插件在运行时私自应用内热自更，统一由宿主插件中心原子替换目录。
- **免 Git 流式 tar 解包且禁安装脚本**：社区 `npm` 插件导入直接通过 HTTPS 请求 npm Registry（支持自动回退镜像）流式拉取 `.tgz` 并校验解包，**完全不调用本机 `git` 命令**，且**强制禁用一切 `preinstall / install / postinstall` 脚本**；若插件声明 `modelVisible: true` 或涉及修改系统提示词，安装前必须弹出醒目权限审计卡片二次确认。
- **独立加密凭据与 `0600` 权限**：每个插件的敏感配置与密钥独立存放于 `~/.prismux/credentials/<plugin-id>.enc`，文件权限严格设为 `0600`，插件间物理隔离不共享密钥。

## 五、跨机器环境坑与处置

| 现象 | 原因 | 标准处置 |
| :--- | :--- | :--- |
| `npm pack` / `npm publish` 报 `Z_DATA_ERROR: zlib: incorrect data check` 或产生损坏 gzip | 部分机器 Node 24 处理大 buffer 的 zlib 存在异常 | 插件打包统一走 `scripts/pack-plugin.ts`（内置 `gunzipSync` 回环核对）；发布 npm 大包时切换至本机档案记录的 Node 22 LTS 备用版 |
| Windows 检出 `vendor/t3code` 或深层依赖报 `Filename too long` | Windows 默认路径长度限制 | 所有子模块拉取与仓库操作显式带 `-c core.longpaths=true`（或在本地 Git 开启 `git config --global core.longpaths true`） |
| Windows 下 Tauri Rust 链接阶段报 `0xC0000005`（`STATUS_ACCESS_VIOLATION`） | MSVC `link.exe` 高并发链接偶发内存访问冲突 | 在 `apps/desktop-tauri` 执行 `cargo check` / `cargo test` / `cargo build` 时固定传入 `-j 1` 串行链接并重试 |
| 从 Electron 宿主或桌面终端拉起的子 Shell / Provider 行为异常、误入纯 Node 模式 | 宿主进程遗留 `ELECTRON_RUN_AS_NODE=1` 等环境变量 | `apps/daemon` 在创建任何 `vendor/t3code` 子进程、PTY 或 Coding Agent 会话前，强制从子进程 `env` 剔除 `ELECTRON_RUN_AS_NODE` |
| `node --test` 在受限沙箱报 `spawn EPERM` | 沙箱限制进程隔离管道 | 常规环境优先不加 flag 运行默认进程隔离 `node --test`；仅在沙箱受限被拒时降级为 `node --test --test-isolation=none "<glob>"`，真实子进程用例须申请单次授权重跑再计入通过 |
| `git` / 网络请求报 `TLS connect error: unexpected eof` 或 `schannel` 凭证异常 | 默认 TLS 后端波动或本机代理变量冲突 | Git 命令追加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`；若本机同时开启 TUN 代理并残留 `HTTP_PROXY` / `HTTPS_PROXY`，按本机档案清空代理环境变量后直连 |
| `npm` / `pnpm` 写用户默认缓存目录报 `EPERM` | 默认缓存位于受限系统目录 | 在命令行临时指定 `npm_config_cache` 或按个人环境档案配置的缓存 / Store 路径 |

## 六、提交与交付规范

- **默认命令行**：统一使用 PowerShell 7（`pwsh`）。
- **原子提交与中文规范**：遵循中文 Conventional Commits 格式 `<type>(<scope>): <简明中文描述>`（如 `feat(daemon): 实现主秘书槽位与 PTY 环形缓冲`、`fix(memory-core): 强制绑定 qq_group 查询隔离条件`、`docs(agents): 更新 <用户名> 的本机环境档案`、`chore(scripts): 补全插件打包回环校验`），保持单次提交单一职责。
- **精确路径暂存**：提交前严禁执行 `git add .` 或 `git add -A`，必须使用精确路径 `git add <path1> <path2> ...` 核对无误后再提交。
- **严禁误提交物**：禁止提交 `.work/` 临时目录、任何凭据正文（`.env`、`.env.local`、token 等）或构建产物（`dist/`、`target/`、`*.wb-plugin`、`*.sha256`）；已正式归档的架构与设计宪法（[`docs/specs/master-prompt-v1.3.md`](./docs/specs/master-prompt-v1.3.md) 与 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md)）应保持原规划语义，未经明确授权严禁擅自删改。
- **一次性产物管理与清理**：所有临时调试脚本、中间打包输出（如 `.work/plugin-dist`）与临时缓存统一放进本仓 `.work/`；任务收尾时仅按精确路径逐项删除自己产生的产物（`Remove-Item <精确路径>`），禁止误删他人产物。
- **规则与档案分流提交**：跨机器工程规则随对应功能提交一起入库；纯个人本机环境档案更新按 [`docs/agents/README.md`](./docs/agents/README.md) 规范单独提交。
