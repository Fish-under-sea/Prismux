# Prismux

极简液态玻璃 AI 超级工作台与 24 小时常驻秘书系统（Prismux）。

> 当前处于 **Milestone 1（M1）** 初始化阶段：已搭建 Monorepo 工程骨架、强类型协议契约、守护进程与前端壳骨架、Tauri v2 原生壳骨架及官方独立插件仓结构。

## 核心定位

- **代理无关主秘书（Agent-Agnostic Chief Supervisor）**：以只读方式托管上游 `vendor/t3code` 服务，在顶部栏热切换 Claude Code、Codex、Antigravity、OpenCode 等代理，复用现有订阅额度并驱动本地三域记忆与夜间编排。
- **360° Fresnel 液态玻璃工作台**：基于 React 19、Vite、Tauri v2 与内置 `WebWallGL` 动态壁纸渲染管线，支持「浅色 / 深色 / 液态玻璃」三态瞬切，以及「秘书待机 / 多代理编码」双布局预设一键切换。
- **单文件混合记忆与加密同步**：内置单文件 SQLite（WAL + FTS5 + `sqlite-vec`）记忆中枢与口令密封 AEAD 加密同步引擎，支持 WebDAV、S3（含 `path-style`）、GitHub 私有仓库与便携模式（`data/`）。

## 五大工程红线

1. **严禁修改 `vendor/t3code/`**：上游子树保持 100% 只读，且绝不纳入根 `pnpm-workspace.yaml`；所有扩展通过鉴权 WebSocket RPC、`client-runtime` 与外置 MCP 完成。
2. **严禁混入已砍掉的 5 项冗余模块**：不包含 Task Board、AgentTeam、Skill Lens、Visual Companion 与 Session Archive。
3. **记忆层零重型外部依赖**：仅使用守护进程内置单文件 SQLite WAL + FTS5 + `sqlite-vec`，零 PostgreSQL、Qdrant、MinIO 或 Obsidian 客户端依赖，查询层硬编码校验 `_callerScope`。
4. **官方插件默认绝不预装**：`qq`、`pet`、`fishdock-hook`、`ssh`、`purge` 均作为独立插件存放于 `plugins-official/`，主程序安装包仅保留极简内核。
5. **视觉层 0 Token 开销**：壁纸、液态玻璃、音频律动与桌宠演出仅运行在宿主视觉层，严禁向任何大模型注入额外提示词或工具定义。

## Monorepo 目录结构

```text
prismux/
├── pnpm-workspace.yaml              # Workspace 定义（显式排除 vendor/t3code 与 Rust crate）
├── package.json                     # 根脚本与工具链约束（Node >= 24.12.0, pnpm >= 10.0.0）
├── tsconfig.base.json               # TypeScript 5.8+ 严格共享配置（NodeNext + ES2024）
├── UPSTREAM_LOCK.json               # 上游 vendor/t3code 锁定元数据
├── scripts/                         # 品牌重命名、上游契约检查与无坏包 tar 插件打包脚本
├── vendor/
│   └── t3code/                      # 只读上游 pingdotgg/t3code 子模块
├── packages/
│   ├── protocol/                    # @prismux/protocol：RPC、Hook、Memory、Handoff、Plugin 强类型契约
│   ├── cordis-kernel/               # @prismux/cordis-kernel：时空可逆插件内核与免 Git 流式安装器
│   ├── memory-core/                 # @prismux/memory-core：单文件 SQLite 记忆中枢与作用域隔离守卫
│   └── sync-vault/                  # @prismux/sync-vault：口令密封 AEAD 加密同步与 60s 停滞看门狗
├── apps/
│   ├── daemon/                      # @prismux/daemon：24h 无头守护服务（PTY、Handoff、Hook、沙箱、夜间工场）
│   ├── workbench-ui/                # @prismux/workbench-ui：React 19 + Vite + WebWallGL 前端骨架
│   └── desktop-tauri/               # prismux-desktop：Rust + Tauri v2 透明原生壳骨架
└── plugins-official/
    ├── catalog/official.json        # 官方独立插件权威索引（SHA-256 与 engines 声明）
    ├── plugin-qq/                   # @prismux/plugin-qq（OneBot v11 私聊秘书 + 群隔离陪聊）
    ├── plugin-pet/                  # @prismux/plugin-pet（租约锁与分阶段动作交还桌宠）
    ├── plugin-fishdock-hook/        # @prismux/plugin-fishdock-hook（FISH-Dock 灵动岛桥接）
    ├── plugin-ssh/                  # @prismux/plugin-ssh（SSH 主机池 / Web PTY / SFTP）
    └── plugin-purge/                # @prismux/plugin-purge（提示词清洗与红队回滚演练）
```

## M1–M5 路线图

| 阶段 | 核心目标 | 验收门禁 |
| :--- | :--- | :--- |
| **M1** | Monorepo 骨架、只读 `t3code` 桥接、守护进程监督、环境变量清洗与 `PersistentPtyPool` | `pnpm -r typecheck` 全绿；`node apps/daemon/dist/cli.js start --headless` 可运行与恢复 PTY 流 |
| **M2** | 三域 SQLite 记忆中枢、`forwardIdentity` 隔离、`LifecycleHookBus`、`HandoffEngine` 与 `WorktreeSandbox` | 越权查询 `private/chief` 100% 返回空集；安全 Hook 异常必阻断；`/handoff` 无损续跑 |
| **M3** | Cordis 双轨插件市场（顶层 `engines` + SHA-256 + 免 Git 安装）与 `sync-vault` 加密同步 | 60s 停滞看门狗、`If-Match` 乐观锁与插件卸载零残留单测全绿 |
| **M4** | Tauri v2 透明壳（音频 FFT、遮挡 `0 FPS` 挂起）与 React 19 液态玻璃分屏工作台 | `cargo check` 与前端构建全绿；三态外观、双预设与遮挡挂起实测通过 |
| **M5** | `OvernightFactory` 夜间工场闭环与官方独立插件打包交付 | 端到端模拟邮件立项到 HTML 早报全绿；`scripts/pack-plugin.ts` 输出官方插件包 |

## 快速开始

> 前置要求：Node.js `>= 24.12.0`、pnpm `>= 10.0.0`、Rust `>= 1.85`（M4 构建桌面壳时需安装）。

```powershell
# 1. 安装工作区依赖（第二波初始化 Git 与依赖后执行）
pnpm install

# 2. 构建与类型检查全部 TypeScript 工作区包
pnpm build
pnpm typecheck

# 3. 运行内置运维脚本单元测试
pnpm test:scripts

# 4. 校验上游 vendor/t3code 只读锁定契约
pnpm upstream:check

# 5. 无界面启动守护进程 CLI（构建后可执行）
node apps/daemon/dist/cli.js start --headless

# 6. 打包指定官方独立插件（输出 .wb-plugin 与 .sha256）
pnpm plugin:pack -- --plugin plugins-official/plugin-qq
```
