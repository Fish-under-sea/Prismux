# Prismux 超级工作台 · Agent 必读

> 本文件是本仓的**跨机器统配入口与工程口径**，所有克隆者与执行代理通用；项目完整架构规格见 [`docs/specs/master-prompt-v1.3.md`](./docs/specs/master-prompt-v1.3.md)，世界级 UI/UX、主题与背景及安装包强制规范见 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md)，开源归属与第三方许可声明见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
> 本机路径、工具链版本、缓存目录与凭据文件磁盘路径等**本机环境事实**，统一放在 `docs/agents/local/<规范化用户名>.md`，不写入本文件。

## 零、先识别当前用户，再读取本机档案

本仓将「跨机器规则」与「本机事实」分成两层：本文件承载前者，`docs/agents/local/<规范化用户名>.md` 承载后者，**两者均随仓入库**，由各自作者维护。

开工前按顺序执行：

1. **读取当前用户名**：在 PowerShell（`pwsh`）中读取 `$env:USERNAME`（可结合 `$env:USERPROFILE` 确认主目录；Linux / macOS 回退读取 `$env:USER` 或 `whoami` 与 `$HOME`）。
2. **规范化用户名**：将用户名转为小写，空格、`\`、`/`、`:` 及非 ASCII 字符替换为 `-`，合并连续 `-` 并去除首尾多余 `-`，仅读取对应的 `docs/agents/local/<规范化用户名>.md`（例如 `Fish` → `docs/agents/local/fish.md`）。
3. **缺失建档流程**：若对应档案不存在，复制 [`docs/agents/local/_template.md`](./docs/agents/local/_template.md) 为 `docs/agents/local/<规范化用户名>.md`，按本机实际情况填写后，以精确路径单独提交入库（严禁写入任何 Token、密码或 API Key 正文）。
4. **两层优先级边界**：**路径、工具链安装位置、缓存 / Store 目录、凭据文件路径与本机网络现象以个人档案为准；工程红线、品牌常量、插件契约、验收门禁与提交规范以本文件为准。**
5. 详细命名规则与维护流程见 [`docs/agents/README.md`](./docs/agents/README.md)。

## 一、项目定位、品牌常量与统一 Monorepo 架构

Prismux 是一个「纯本地零遥测的 8 分区液态玻璃 AI 超级工作台与 24h 秘书系统」，采用**100% 统一的一方 `@prismux/*` pnpm Monorepo** 架构，原生整合 **Electron 44 桌面端（`apps/desktop`）、核心编排服务端（`apps/server`）、React 19 工作台前端（`apps/web`）与 24 小时常驻无头守护进程（`apps/daemon`）**，融合任意代理接任主秘书槽位（`Chief Thread Slot`）、单文件 SQLite 混合记忆引擎、Cordis 双域可逆插件内核、Magpie 端到端加密同步引擎、统一 Provider 鉴权探针与订阅风控护栏（`PrismuxProviderProbeService` + `SubscriptionOrchestrationGuard`）、夜间全自动工场，以及外置沉淀的 360° Fresnel 液态玻璃（`@prismux/appearance`）与多源壁纸引擎（`@prismux/wallpaper`）。

> 历史演进归档：早期阶段过渡使用的上游锁文件、同步脚本与补丁台账已完整归档至 [`docs/archive/`](./docs/archive/)，开源归属详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。现行架构已全面收编为单一原生 Monorepo，不再保留外部子仓边界。

### 品牌命名常量与远端仓库

| 常量标识 | 标准值 | 用途说明 |
| :--- | :--- | :--- |
| `APP_NAME` | `Prismux` | 软件正式显示名称、桌面窗口标题、GitHub 仓库名 |
| `APP_SLUG` | `prismux` | CLI 命令名、默认数据目录 `~/.prismux`、配置文件前缀、`.prismux-backup` |
| `NPM_SCOPE` | `@prismux` | Monorepo 内部包与官方认证插件的 npm 作用域 |
| `PLUGIN_PREFIX` | `prismux-plugin-` | 第三方社区插件标准包名前缀（GitHub Topic：`prismux-plugin`） |
| 远端仓库 | `https://github.com/Fish-under-sea/Prismux.git` | Prismux 官方上游仓库地址 |

> 约束：代码中禁止残留 `<APP_NAME>`、`<APP_SLUG>`、`<NPM_SCOPE>`、`<PLUGIN_PREFIX>` 等占位符；品牌级命名严禁混入 `fish` 词根（`plugins-official/plugin-fishdock-hook` 为专指外部 FISH-Dock 宿主桥接的官方插件，属唯一合法命名例外）。

### 统一 Monorepo 目录树与职责边界

```text
prismux/
├── AGENTS.md                          # 本文件：跨机器统配入口与工程红线
├── LICENSE                            # MIT 开源许可证
├── THIRD_PARTY_NOTICES.md             # 第三方开源许可与历史归属声明
├── README.md / README.en.md           # 中英双语项目概览与快速开始
├── pnpm-workspace.yaml                # 统一 Workspace 边界（apps/*、packages/*、plugins-official/plugin-*、oxlint-plugin-prismux、scripts）
├── package.json                       # 根编排脚本（typecheck / typecheck:core / build / build:desktop / test / test:scripts / lint / fmt / brand:rename / plugin:pack / release:build）
├── tsconfig.base.json                 # Prismux 守护进程与核心自研包 TS 严格基线（ES2024 + NodeNext + verbatimModuleSyntax）
├── tsconfig.core.json                 # 桌面端/服务端/前端/Effect 核心包共享 TS 基线
├── tsconfig.effect.json               # Effect Language Service 类型基线
├── vite.config.ts                     # 根 Vite+（vp）lint / fmt / test / workspace 运行配置
├── prismux.json                       # Prismux 项目配置清单
├── .cargo/                            # Rust Cargo 共享构建配置
├── .pnpmfile.cjs                      # pnpm 解析钩子
├── apps/
│   ├── daemon/                        # @prismux/daemon：24h 无头守护服务（主秘书槽位、五大原语、统一探针、订阅免责门禁、双源更新器、夜间工场）
│   ├── desktop/                       # @prismux/desktop：Electron 44 原生桌面宿主（窗口/托盘/IPC/防休眠/预览仿真/启动迁移）
│   ├── server/                        # @prismux/server：Effect 编排内核、Provider 驱动、Git/Worktree、终端 PTY、用法统计与 CLI（bin: prismux）
│   └── web/                           # @prismux/web：React 19 + TanStack 工作台界面、8 分区液态玻璃挂载、Orca 侧栏/分屏与设置中心
├── packages/
│   ├── protocol/                      # @prismux/protocol：品牌常量、Daemon <-> UI 扩展 RPC、Hook、Provider 探针、三域记忆、插件与更新契约
│   ├── cordis-kernel/                 # @prismux/cordis-kernel：时空可逆双域插件内核（daemon + ui）与双源流式安装器
│   ├── memory-core/                   # @prismux/memory-core：SQLite WAL + FTS5 + sqlite-vec 混合记忆与物理防泄密守卫
│   ├── sync-vault/                    # @prismux/sync-vault：Argon2id + AEAD 端到端加密同步（WebDAV / S3 / GitHub / 便携模式）
│   ├── prismux-appearance/            # @prismux/appearance：1:1 FISH-Dock 光学天体三态胶囊、8 分区液态玻璃、对比度钳制与玻璃桥接样式
│   ├── prismux-wallpaper/             # @prismux/wallpaper：右侧壁纸边栏、完整设置页、Z-0 多源渲染舞台（Image/Video/Web/WebWallGL）与 Steam 431960 扫描器
│   ├── contracts/                     # @prismux/core-contracts：桌面/服务端/前端核心 IPC、RPC、Provider 与编排 Schema 契约
│   ├── shared/                        # @prismux/core-shared：跨端工具集（Shell、Git、模型元数据、链接/搜索、预览视口、策略与项目配置）
│   ├── client-runtime/                # @prismux/client-runtime：前端状态规约、连接运行时、提供方展示与消息呈现逻辑
│   ├── provider-core/                 # @prismux/provider-core：Provider 驱动抽象基线、用量与兼容性工具
│   ├── provider-acp/                  # @prismux/provider-acp：通用 ACP 协议会话适配器
│   ├── provider-acp-registry/         # @prismux/provider-acp-registry：ACP Registry 与原生 DeepSeek Harness（dsh）本地探测桥接
│   ├── provider-opencode/             # @prismux/provider-opencode：OpenCode Provider 集成
│   ├── provider-fx/                   # @prismux/provider-fx：FX Provider 集成
│   ├── provider-testing/              # @prismux/provider-testing：Provider 回放测试套件
│   ├── effect-acp/                    # @prismux/effect-acp：Effect 封装的 ACP 传输层
│   ├── effect-codex-app-server/       # @prismux/effect-codex-app-server：Effect 封装的 Codex App Server 协议层
│   ├── source-control-*/              # @prismux/source-control-*：GitHub / GitLab / Bitbucket / Azure DevOps / Forgejo / GitCafe 等源码托管集成
│   ├── issue-tracker-linear/          # @prismux/issue-tracker-linear：Linear Issue 集成
│   ├── secret-provider-*/             # @prismux/secret-provider-*：凭据提供方抽象与 1Password 集成
│   ├── ssh/                           # @prismux/ssh：原生 SSH 隧道与远程宿主机运行时
│   └── tailscale/                     # @prismux/tailscale：Tailscale 私网发现与局域网/私网纯二维码远控支持
├── plugins-official/                  # 官方认证独立插件源码与索引（活跃 2 款默认全部不预装；pet / ssh 已停用：已被内置功能取代）
│   ├── catalog/official.json          # 官方插件权威索引（活跃 qq / fishdock-hook + retiredPlugins 停用说明）
│   ├── plugin-qq/                     # @prismux/plugin-qq：OneBot v11 私聊主秘书 + 群聊隔离陪聊插件
│   └── plugin-fishdock-hook/          # @prismux/plugin-fishdock-hook：FISH-Dock 灵动岛审批与回执桥接插件
├── native/                            # 原生二进制源码（Rust resource-monitor / Hyprland / KDE 截屏与浏览器密钥助手）
├── packaging/                         # Linux AUR 等平台打包清单
├── patches/                           # pnpm patchedDependencies 维护补丁
├── oxlint-plugin-prismux/             # Prismux 专属 Oxlint 静态规则插件（规则前缀 `prismux/`）
├── assets/                            # 品牌图标（assets/prismux/、dev/nightly/prod）与 README 立体像素视觉资产
├── scripts/                           # 运维、桌面打包、发布与 i18n/图标校验脚本（含 node:test 回归单测）
└── docs/
    ├── agents/                        # 个人本机环境档案说明、模板与按人档案
    ├── archive/                       # 历史演进归档（过渡期上游锁、补丁台账与同步脚本，仅供审计参考）
    ├── plans/                         # 版本迭代规划与演进路线图
    ├── plugins/                       # 插件开发指南、Hook 与 8 分区主题 Token 参考
    └── specs/
        ├── master-prompt-v1.3.md      # 全栈自主施工总指令书（历史归档宪法，严禁擅自删改）
        └── ui-ux-design-mandate.md    # 世界级 UI/UX、主题与背景及安装包强制设计规范（归档规范，严禁擅自删改）
```

### Workspace 与技术栈边界

- **基础工具链要求**：`Node.js >= 24.12.0`、`pnpm >= 10.0.0`（仓库锁定 `pnpm@12.3.4`）、`vite-plus`（`vp` 统一驱动核心包 typecheck / build / lint / fmt / vitest）、`TypeScript >= 5.8`（自研包遵守 `NodeNext` + `verbatimModuleSyntax`，相对导入显式带 `.js` 后缀，纯类型导入使用 `import type`）、`Electron 44`、`React 19`、`Rust >= 1.85`（`native/resource-monitor`）。
- **统一单一锁文件与 `node_modules`**：全仓由根 `pnpm-workspace.yaml` 与单份根 `pnpm-lock.yaml` 统一管理（纳入 `apps/*`、`packages/*`、`plugins-official/plugin-*`、`oxlint-plugin-prismux`、`scripts`）。
- **包职责分层**：视觉光学与壁纸能力继续外置沉淀在 `packages/prismux-appearance` 与 `packages/prismux-wallpaper`，守护进程与安全门禁沉淀在 `apps/daemon` 与 `packages/{protocol,memory-core,cordis-kernel,sync-vault}`，与 `apps/{desktop,server,web}` 通过清晰 workspace 包契约解耦协作。
- **Git Hooks 洁净红线**：运行 `pnpm install` 或 `vp` 命令时保持 `VP_GIT_HOOKS=0`，且本仓 `.git/config` 禁止写入 `core.hookspath`，严禁触碰 `~/.gitconfig`。

## 二、绝对工程红线

任何代理与开发者在施工过程中必须无条件遵守以下工程红线：

1. **统一原生底座、纯本地零遥测与独立去耦合原则**
   - Prismux 是完整独立的第一方 Electron 44 + Effect + React 19 Monorepo，所有运行时代码、包作用域（`@prismux/*`）、协议 Scheme（`prismux://` / `prismux-dev://`）、环境变量（`PRISMUX_*`）、Oxlint 规则（`prismux/*`）与界面文案均须保持纯净一致。
   - **纯本地零遥测**：彻底切断一切静默遥测、远端账号指纹与冷启动外联；远控仅保留局域网 / Tailscale 纯二维码配对，严禁恢复云端账号登录或付费导流入口。
   - **架构文档不可变**：已归档的 [`docs/specs/master-prompt-v1.3.md`](./docs/specs/master-prompt-v1.3.md) 与 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md) 为历史宪法文档，未经明确授权严禁修改。
2. **严禁混入已明确砍掉的 4 项冗余模块（保留原生轻量线程归档与 Orca 轻量工作区/任务视图）**
   - **禁止实现**：① 脱离会话体系的重型权威项目看板（Task Board）、② 多代理组队 DAG（AgentTeam）、③ 独立技能中心面板（Skill Lens）、④ 网页视觉伴侣（Visual Companion）；同时仍禁止自建重型独立会话归档系统，保留原生轻量线程归档（`/settings/archived`）。
   - **保留并持续打磨**：Orca 风格轻量「**工作区板（Workspace Board，4 列会话/工作区状态流转）**」与「**任务（Tasks，GitHub Issue / PR 聚合检索）**」视图（均直接映射当前会话/工作区与上游 Issue/PR 数据流）。
   - 其余裁撤场景统一由五大内化原语替代：`PersistentPtyPool`、`HandoffEngine`（`/handoff` 与 `agent / oracle / review` 三档拨盘）、`CollectorAndGuard`、`LifecycleHookBus` 与 `WorktreeSandbox`。
3. **内生单文件 SQLite 记忆中枢与物理防泄密**
   - 记忆引擎固定为单文件 `~/.prismux/data/memory.db`（`SQLite WAL + FTS5 + sqlite-vec`），**零 PostgreSQL、零 Qdrant、零 MinIO、零本地 Obsidian 客户端运行依赖**（仅在 `apps/daemon` 暴露 `POST /v1/memory/import-obsidian` 接口承接历史笔记迁移）。
   - 查询层强制在传输层通过 `forwardIdentity` 注入并覆写 `_callerScope`，**绝不信任模型自报参数**；当 `_callerScope` 为 `qq_group:<gid>` 时，SQL 构造器底层硬编码绑定 `WHERE namespace = 'social/qq-group-' || :gid AND deleted_at IS NULL`，物理杜绝读取 `private/chief` 与 `workspace/*`。
4. **Antigravity 纯官方合规、统一探针（`PrismuxProviderProbeService`）与订阅编排风控门禁**
   - **纯官方 CLI / ACP 接入**：Antigravity 全部对话调用与额度查询严格且唯一走用户本机官方 `agy` CLI / `agy acp`；严禁任何非官方 OAuth 登录通道、第三方伪装 Client ID/Secret、窃读 `state.vscdb` / Keyring / Cookie 或调用私密端点（`cloudcode-pa`、`v1internal` 等）。
   - **统一鉴权模式探针**：通过 `apps/daemon/src/system/PrismuxProviderProbeService.ts`（`GET /v1/providers/probe`）无侵入识别各 Provider 鉴权模式（`api_or_custom` / `local` / `subscription_oauth` / `unknown`），严禁将 CCS / Magpie / 自定义端点 / API Key / Cloud IAM / `unknown` 误判为 `subscription_oauth`，且零读取 OAuth 令牌正文或系统密钥链。
   - **统一订阅风控免责护栏**：通过 `SubscriptionWaiverStore` + `SubscriptionOrchestrationGuard` 对个人 AGY 及外部 `subscription_oauth` 的跨代理 / Swarm 编排统一返回 HTTP 403 `ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED`（需用户在 `/settings/providers#subscription-risk-waiver` 明确签署免责后方可手动解锁）；`cron` / `overnight_factory` 无人值守路径对个人 AGY 永久硬拦截（`AGY_UNATTENDED_FORBIDDEN`），`api_or_custom` 与 `local` 100% 免签直通。
5. **官方独立插件默认绝不预装（活跃 2 款；`pet` / `ssh` 已停用）**
   - 活跃官方插件 `qq` 与 `fishdock-hook` 全部独立存放在 `plugins-official/`，通过独立 `.wb-plugin` 归档或 `@prismux/plugin-*` 按需安装；核心主程序、Electron 安装包与默认守护进程启动链路保持极简，严禁捆绑预装。
   - 原 `pet`（桌宠联动）与 `ssh`（SSH 远程主机终端）插件已彻底移除并标注为「已停用：已被 Prismux 内置功能取代」，不再打包或上架安装。
6. **视觉层对模型 0 Token 开销与强制设计规范**
   - `WebWallGL` 动态壁纸、8 分区 360° Fresnel 液态玻璃、24 小时动态天穹、字体调色、系统音频律动、思考强度滑条与安装包向导属于纯宿主视觉层，**严禁**向任何大模型或 Coding Agent 注入工具定义（Tool Schema）或 System Prompt，保持对模型 **0 Token 开销**。
   - `@prismux/appearance`、`@prismux/wallpaper`、桌面端/前端界面、安装包向导与 UI 域插件必须严格遵守 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md) 的视觉、动效、主题同步、≥ 4.5:1 无障碍对比度及降级兜底红线。

## 三、M1–M5 演进基线与自动化验收门禁（DoD）

| 阶段 | 核心施工内容 | 必须通过的自动化验收门禁（DoD） |
| :--- | :--- | :--- |
| **M1：骨架、核心服务桥接与守护中枢** | 初始化 pnpm Monorepo 与 `scripts/` 工具链；实现 `apps/daemon` 进程监督、环境变量清洗、主秘书槽位（`Chief Thread Slot`）与 `PersistentPtyPool`（默认每终端 `2 MB` 环形缓冲） | 根 workspace 包 `build` / `typecheck`、`vp run --filter '!prismux-monorepo' typecheck` 与 `pnpm test:scripts` 全绿；`node apps/daemon/dist/cli.js start --headless` 可无界面连上核心 Server RPC 并在重连后无损回放 PTY 历史流 |
| **M2：内生三域记忆库与五大标杆原语** | 实现 `packages/memory-core`（SQLite WAL + FTS5 + `sqlite-vec` + Obsidian 导入）；实现 `forwardIdentity` 作用域硬隔离与 60 s 熔断、`LifecycleHookBus`（6 类事件、退出码 `2` 拦截、安全钩子默认 `onFailure: "block"`、四档权限）、`HandoffEngine`（`/handoff` + 三档拨盘）与 `WorktreeSandbox`（OS 级写隔离 + 域名白名单网关） | 越权单测验证 `qq_group:<gid>` 查询 `private/chief` 与 `workspace/*` **100% 返回空集**；安全 Hook 超时或抛错时必定阻断执行；`/handoff` 可无损提纯 `{ goal, decisions, touchedFiles, openQuestions }` 并续跑新线程 |
| **M3：Cordis 双轨插件商城与 Magpie 同步** | 实现 `packages/cordis-kernel`（顶层 `engines.prismux` SemVer 校验、`ctx.effect()` 卸载零残留、官方 SHA-256 校验、免 Git 无脚本 `npm` Tarball 安装器 + `distribution: "managed"` 锁）；实现 `packages/sync-vault`（Argon2id + AEAD 密封、WebDAV/S3/Git 独立开关、`If-Match` 乐观锁、60 s 停滞看门狗与 `data/` 便携模式） | 慢速流模拟测试 3 分钟持续低速传输不断连、连续 60 s 零字节准时触发停滞报错；双机并发上传验证 `If-Match`（及降级 `HEAD ETag`）拦截覆盖；`npm` 插件启停与卸载无残留监听、路由或 DOM |
| **M4：Electron 44 融合桌面端、8 分区液态玻璃与壁纸引擎** | 完成 `@prismux/appearance`（1:1 FISH-Dock 天体三态胶囊、8 分区液态玻璃、≥ 4.5:1 对比度钳制与玻璃桥接）与 `@prismux/wallpaper`（右侧壁纸边栏、完整设置页、Z-0 多源渲染舞台与 Steam `431960` 扫描器），与 `apps/{desktop,server,web}` 统一融合构建并交付 NSIS 安装包 | `@prismux/appearance`、`@prismux/wallpaper` 与 `apps/{desktop,server,web}` 编译及单测全绿；对照 `docs/specs/ui-ux-design-mandate.md` 完成八态、对比度、`prefers-reduced-motion` 与无 GPU 兜底核验；真实桌面二进制冷启动直达工作台、窗口拖拽区与三键 100% 可用，并完成多场景实机截屏自审 |
| **M5：夜间全自动工场、统一合规护栏与官方独立插件** | 完成 `OvernightFactory`、`PrismuxProviderProbeService` + `SubscriptionOrchestrationGuard` 统一风控门禁；维护 `plugins-official/` 下活跃官方插件 `plugin-qq` 与 `plugin-fishdock-hook`（原 `plugin-pet` 与 `plugin-ssh` 已停用并移除） | 跑通端到端模拟邮件入站 → Worktree 编码 → Oracle 只读评审 → HTML 完工早报；合规静态守卫与订阅风控单测全绿；使用 `pnpm plugin:pack` 生成官方插件 `.wb-plugin` 与 `.sha256` 并通过市场导入验签 |

## 四、核心工具脚本与插件打包契约

`scripts/` 下运维主脚本为**零第三方依赖的纯 Node 24 原生 TypeScript**（可直接通过 `node scripts/<name>.ts` 执行；因此纯运维脚本中禁止使用 `enum` 或构造函数参数属性等需运行时编译转换的语法）：

### 1. `scripts/rename-brand.ts`（`pnpm brand:rename`）

- **用途**：一键安全替换仓库中的品牌标识符，方便二开或改名时全仓同步。
- **常用参数**：`--app-name <Name>`、`--app-slug <slug>`、`--npm-scope <@scope>`、`--plugin-prefix <prefix>`、`--from-app-name`（默认 `Prismux`）、`--from-app-slug`（默认 `prismux`）、`--from-npm-scope`（默认 `@prismux`）、`--from-plugin-prefix`（默认 `prismux-plugin-`）、`--root <dir>`、`--dry-run`。
- **安全边界**：严格跳过 `.git`、`vendor`、`node_modules`、`dist`、`.work`、`target` 目录及二进制/媒体扩展名；按长前缀优先顺序替换（`fromPluginPrefix` → `fromNpmScope` → `fromAppName` → `fromAppSlug`）；`--dry-run` 模式仅输出结构化变更报告，绝不落盘。

### 2. `scripts/pack-plugin.ts`（`pnpm plugin:pack`）

- **用途与参数**：将单个插件目录打包为确定性归档包并输出校验摘要：`--plugin <dir>`、`--out <dir>`（默认 `.work/plugin-dist`）、`--update-catalog <path>`（可选，自动回写 `catalog/official.json` 中的 `version`、`sha256`、`bytes` 与 `status: "verified"`）。
- **确定性打包与回环自检**：
  - 纯 TS 序列化确定性 POSIX ustar `.tar`（跳过 `node_modules`、`.git`、`.work`、`*.wb-plugin`、`*.sha256`、`.DS_Store`；按 POSIX 字典序排列；固定 `mtime = 0`、`uid = 0`、`gid = 0`）。
  - 使用 `zlib.gzipSync` 压缩为 `<id>-<version>.wb-plugin`，**立即执行 `zlib.gunzipSync` 逐字节回环核对与原始 `.tar` 完全一致**（规避 Node 24 大 buffer zlib 异常），一致后写出 `<id>-<version>.sha256`（`<sha256>  <filename>`）。

### 3. `scripts/build-prismux-desktop.ts` 与 `scripts/release-all.ts`

- **`pnpm desktop:build` / `pnpm desktop:installer`**：统一编排 7 个核心依赖包构建 → 非 `.asar` `sqlite-vec`（`vec0.dll`）落地 → Rust `native/resource-monitor`（`-j 1` 防 MSVC 冲突）→ `pnpm exec vp run build:desktop` → 可选 Windows NSIS 安装包生成、7-Zip 完整性校验与合并 `SHA256SUMS`。
- **`pnpm release:build`**：汇总桌面安装包、2 款活跃官方插件 `.wb-plugin`、无脚本 npm 单包与校验清单，并强制断言桌面产物零包含任何官方插件。

### 4. 插件打包、安装与运行安全契约

- **顶层 `engines.prismux` SemVer 强制校验**：每个插件的 `package.json` 必须声明顶层 `"engines": { "prismux": "<semver-range>" }`，内核直接按顶层 SemVer 判定兼容性，**绝不回退到 `peerDependencies`**；同时 `plugin.manifest.json` 必须包含 `id`、`version`、非空 `realms`、`permissions` 与布尔值 `modelVisible`。
- **托管单写锁（`distribution: "managed"`）**：通过官方目录或社区市场安装的插件自动写入 `"distribution": "managed"`，禁止插件在运行时私自应用内热自更，统一由宿主插件中心原子替换目录。
- **免 Git 流式 tar 解包且禁安装脚本**：社区 `npm` 插件导入直接通过 HTTPS 请求 npm Registry（支持自动回退镜像）流式拉取 `.tgz` 并校验解包，**完全不调用本机 `git` 命令**，且**强制禁用一切 `preinstall / install / postinstall` 脚本**；若插件声明 `modelVisible: true` 或涉及修改系统提示词，安装前必须弹出醒目权限审计卡片二次确认。
- **独立加密凭据与 `0600` 权限**：每个插件的敏感配置与密钥独立存放于 `~/.prismux/credentials/<plugin-id>.enc`，文件权限严格设为 `0600`，插件间物理隔离不共享密钥。

## 五、跨机器环境坑与处置

| 现象 | 原因 | 标准处置 |
| :--- | :--- | :--- |
| `npm pack` / `npm publish` 报 `Z_DATA_ERROR: zlib: incorrect data check` 或产生损坏 gzip | 部分机器 Node 24 处理大 buffer 的 zlib 存在异常 | 插件打包统一走 `scripts/pack-plugin.ts`（内置 `gunzipSync` 回环核对）；发布 npm 大包时切换至本机档案记录的 Node 22 LTS 备用版 |
| Windows 检出深层依赖报 `Filename too long` | Windows 默认路径长度限制 | 仓库操作显式带 `-c core.longpaths=true`（或在本地 Git 开启 `git config --global core.longpaths true`） |
| Windows 下 Rust（`native/resource-monitor`）链接阶段报 `0xC0000005`（`STATUS_ACCESS_VIOLATION`） | MSVC `link.exe` 高并发链接偶发内存访问冲突 | 在 `native/resource-monitor` 执行 `cargo check` / `cargo test` / `cargo build` 时固定传入 `-j 1` 串行链接并重试 |
| 从 Electron 宿主或桌面终端拉起的子 Shell / Provider 行为异常、误入纯 Node 模式 | 宿主进程遗留 `ELECTRON_RUN_AS_NODE=1` 等环境变量 | `apps/daemon` 与 `apps/server` 在创建任何子进程、PTY 或 Coding Agent 会话前，强制从子进程 `env` 剔除 `ELECTRON_RUN_AS_NODE` |
| `node --test` 在受限沙箱报 `spawn EPERM` | 沙箱限制进程隔离管道 | 常规环境优先不加 flag 运行默认进程隔离 `node --test`；仅在沙箱受限被拒时降级为 `node --test --test-isolation=none "<glob>"`，真实子进程用例须申请单次授权重跑再计入通过 |
| `git` / 网络请求报 `TLS connect error: unexpected eof` 或 `schannel` 凭证异常 | 默认 TLS 后端波动或本机代理变量冲突 | Git 命令追加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`；若本机同时开启 TUN 代理并残留 `HTTP_PROXY` / `HTTPS_PROXY`，按本机档案清空代理环境变量后直连 |
| `npm` / `pnpm` 写用户默认缓存目录报 `EPERM` | 默认缓存位于受限系统目录 | 在命令行临时指定 `npm_config_cache` 或按个人环境档案配置的缓存 / Store 路径 |
| `vp` / `pnpm install` 误写 `.git/config` `core.hookspath` | `vite-plus` 默认自动安装 Git Hooks | 运行安装命令固定设 `VP_GIT_HOOKS=0`，提交前核验 `git config --local --get core.hookspath` 为空 |

## 六、提交与交付规范

- **默认命令行**：统一使用 PowerShell 7（`pwsh`）。
- **原子提交与中文规范**：遵循中文 Conventional Commits 格式 `<type>(<scope>): <简明中文描述>`（如 `feat(daemon): 实现主秘书槽位与 PTY 环形缓冲`、`fix(memory-core): 强制绑定 qq_group 查询隔离条件`、`docs(agents): 更新 <用户名> 的本机环境档案`、`chore(scripts): 补全插件打包回环校验`），保持单次提交单一职责。
- **精确路径暂存**：提交前严禁执行 `git add .` 或 `git add -A`，必须使用精确路径 `git add <path1> <path2> ...` 核对无误后再提交。
- **严禁误提交物**：禁止提交 `.work/` 临时目录、任何凭据正文（`.env`、`.env.local`、token 等）或构建产物（`dist/`、`dist-electron/`、`target/`、`*.wb-plugin`、`*.sha256`）；已正式归档的架构与设计宪法（[`docs/specs/master-prompt-v1.3.md`](./docs/specs/master-prompt-v1.3.md) 与 [`docs/specs/ui-ux-design-mandate.md`](./docs/specs/ui-ux-design-mandate.md)）应保持原规划语义，未经明确授权严禁擅自删改。
- **一次性产物管理与清理**：所有临时调试脚本、中间打包输出（如 `.work/plugin-dist`）与临时缓存统一放进本仓 `.work/`；任务收尾时仅按精确路径逐项删除自己产生的产物（`Remove-Item <精确路径>`），禁止误删他人产物。
- **规则与档案分流提交**：跨机器工程规则随对应功能提交一起入库；纯个人本机环境档案更新按 [`docs/agents/README.md`](./docs/agents/README.md) 规范单独提交。

## 七、标准发布流程与四端交付门禁

每次 Prismux 发版（预发布或正式版）必须严格按以下顺序完成**四端同步与清理**，全部验真通过后方可宣告交付完成：

1. **版本同步与 README 资产重绘**：
   - 全仓统一升级版本号（根 `package.json`、`apps/{daemon,desktop,server,web}/package.json`、`packages/*/package.json`、`packages/protocol/src/brand.ts`、活跃官方插件 `plugins-official/plugin-{qq,fishdock-hook}/{package.json,plugin.manifest.json,src/index.ts}`、`plugins-official/catalog/official.json`、`README.md` 与 `README.en.md`）。
   - 执行 `node scripts/render-readme.mjs` 全量重绘 `assets/readme/*.png` 与 `header-metadata.json`，并肉眼核验版本仪表卡图片。
2. **全量质量门禁与实机截屏自审**：
   - 清空代理环境变量后跑绿：核心自研包 `build`、`vp run --filter '!prismux-monorepo' typecheck`、各包单测（`daemon`、`appearance`、`wallpaper`、`plugin-qq`、`memory-core`、`cordis-kernel`、`sync-vault`、`web`、`server`、`desktop`、`provider-acp-registry`、`core-shared`、`pnpm test:scripts`）及 `vp run build:desktop`。
   - 核查仓库洁净：`docs/specs/*` diff 为 `0`、`.git/config` `core.hookspath` 为空、`~/.gitconfig` 未被修改。
   - 启动真实 Electron 44 桌面端截屏自审关键界面改动，核验后清理 `.work/` 临时目录并确保零残留 `electron.exe`。
3. **打包产物与安装包红线核验（`node scripts/release-all.ts`）**：
   - Windows NSIS 必须为 `perMachine: false`、默认安装至 `$LOCALAPPDATA\Programs\Prismux`、提供双语可选桌面快捷方式页、非 `.asar` 解包 `vec0.dll` 与随包 `7za.exe`，且严格零预装任何官方插件。
   - 仅打包活跃官方插件 `qq` 与 `fishdock-hook`（严禁打包已停用的 `pet` 与 `ssh`）。
4. **原子提交、打 Annotated Tag 并双远端推送**：
   - 按职责拆分中文 Conventional Commits，打 Annotated Tag `v<version>`，推送 `main` 与 `v<version>` 至 `origin`（GitHub）与 `gitee`。
5. **四端发布与自动清理核验**：
   - **GitHub Release**：发布为 `--latest`（非 prerelease 标记按发版策略对齐），上传全部完整安装包与活跃插件归档并校验服务器 SHA-256 摘要；**严禁删除 GitHub 历史 Release 或历史附件**。
   - **Gitee Release**：创建新版本 Release 并上传 80 MB 分卷压缩包与活跃插件附件，校验匿名 `HEAD 200` 字节数与匿名下载 SHA-256；**自动清理旧版本 Gitee Release 附件（保留历史 Release 说明页），仅保留最新版本的 Gitee 附件以节约配额**。
   - **GitHub Packages（`@fish-under-sea/prismux-plugin-*`）**：确认 `.github/workflows/publish-github-packages.yml` 自动发布活跃插件 `prismux-plugin-qq` 与 `prismux-plugin-fishdock-hook` 成功，并**确保已停用的废弃包（如 `prismux-plugin-ssh`、`prismux-plugin-pet`）已从 GitHub Packages 彻底清理（仅保留活跃官方插件包）**；如 `GITHUB_TOKEN` 权限受限于个人包删除作用域，须使用含 `delete:packages` 权限的 `gh` / 网页端完成清理并复核仓库右侧 `Packages` 计数严格等于活跃插件数。
   - **npm（`npmjs.org`）**：切换至本机档案记录的 Node 22 LTS（避开 Node 24 zlib 大包异常），发布 `prismux-plugin-qq` 与 `prismux-plugin-fishdock-hook`（预发布带 `--tag preview`），并确保已停用的 `prismux-plugin-ssh` / `prismux-plugin-pet` 已标注废弃（`npm deprecate`），最后通过 `npm view` 核验线上最新版本号。
