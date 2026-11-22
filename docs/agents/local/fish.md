# 本机环境档案 · Fish

> 机器：Fish（`$env:USERNAME`），用户目录 `C:\Users\Fish`。
> 跨机器工程红线、脚本契约与提交规范见仓库根 [`AGENTS.md`](../../../AGENTS.md)；命名与维护规范见 [`../README.md`](../README.md)。
> **安全提示**：本文件仅记录路径与版本事实，严禁写入任何 Token、密码、API Key 或凭据正文。

## 一、工作区与仓库路径

| 项 | 值 | 备注 |
| :--- | :--- | :--- |
| 本仓路径 | `D:\Fish-code\AGY\Prismux` | 主开发工作区 |
| 数据与运行目录 | `C:\Users\Fish\.prismux`（即 `~/.prismux`） | 默认运行态数据、SQLite 记忆库与插件凭据根目录 |
| 一次性产物目录 | `D:\Fish-code\AGY\Prismux\.work` | 临时输出与实验目录，收尾按精确路径清理 |
| 可复用脚本根 | `D:\Fish-code\工具\可复用脚本与经验\` | 本机跨项目可复用脚本与排障经验沉淀目录 |

## 二、本仓工具链

| 工具 | 路径与版本 | 用途与备注 |
| :--- | :--- | :--- |
| PowerShell | `pwsh` | 默认命令行入口 |
| Node（常规 / TS 脚本 / 测试） | `C:\Program Files\nodejs\node.exe`（`v24.14.0`） | 默认 `PATH` 入口，直接运行 `scripts/*.ts` 与 `node --test` |
| Node（大包发布备用版） | `D:\Fish-code\工具\可复用工具集\Node22`（`v22.23.4`） | 发布 npm 大包或避开 Node 24 zlib 异常时前置入 `PATH` |
| pnpm | `12.3.4` | Workspace 包管理与全局任务执行 |
| Rust / Cargo（M4 Tauri v2 构建） | `D:\Fish-code\工具\可复用工具集\Rust\1.99.1`（`rustc` / `cargo` `1.99.1`） | 运行 `cargo test` / `cargo check` 固定传入 `-j 1` |
| Git / GitHub CLI | `git 2.52.0.windows.1`、`gh 2.89.0` | `gh` 已登录账号 `Fish-under-sea` |

## 三、环境变量与包缓存目录

| 变量 / 目录 | 建议值或路径 | 说明 |
| :--- | :--- | :--- |
| `pnpm` Store | `D:\Fish-code\工具\可复用工具集\pnpm-store\v11` | `pnpm` 持久化包缓存仓库 |
| `npm_config_cache` | `D:\Fish-code\工具\可复用工具集\npm-cache` | npm 可复用缓存目录 |
| `RUSTUP_HOME` | `D:\Fish-code\工具\可复用工具集\Rust\1.99.1\rustup` | 自定义 Rustup 工具链目录 |
| `CARGO_HOME` | `D:\Fish-code\工具\可复用工具集\Rust\1.99.1\cargo` | 自定义 Cargo 缓存与二进制目录 |
| Rust `PATH` 前置 | `D:\Fish-code\工具\可复用工具集\Rust\1.99.1\cargo\bin` | 执行 M4 Tauri / Cargo 命令前将此目录前置到 `PATH` |

```powershell
# M4 Tauri v2 / Cargo 构建环境快速激活示例（pwsh）
$env:RUSTUP_HOME = 'D:\Fish-code\工具\可复用工具集\Rust\1.99.1\rustup'
$env:CARGO_HOME  = 'D:\Fish-code\工具\可复用工具集\Rust\1.99.1\cargo'
$env:PATH        = "D:\Fish-code\工具\可复用工具集\Rust\1.99.1\cargo\bin;$env:PATH"
cargo test -j 1
```

## 四、凭据文件位置（仅写磁盘路径，严禁写凭据正文）

| 凭据类型 | 磁盘文件路径 | 备注 |
| :--- | :--- | :--- |
| npm 凭据 | `C:\Users\Fish\.npmrc` | 仅记录磁盘路径；认证失效时由本机用户刷新 |
| Git 凭据 | `C:\Users\Fish\.git-credentials` | 本机 Git HTTPS 凭据文件 |
| GitHub CLI | `C:\Users\Fish\AppData\Roaming\GitHub CLI\hosts.yml` | `gh` 登录状态文件（对应账号 `Fish-under-sea`） |

## 五、本机特有现象与处置

| 现象 | 处置 |
| :--- | :--- |
| `schannel` HTTPS 凭证异常（`SEC_E_NO_CREDENTIALS`）或 TLS 握手中断 | 改走 Node TLS 脚本（见 `D:\Fish-code\工具\可复用脚本与经验\`）或为 `git` 显式追加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1` |
| Clash 开启 TUN 模式时命令行同时残留 `HTTP_PROXY` / `HTTPS_PROXY` 导致请求抖动 | 在当前 `pwsh` 会话清空 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`（及小写变量）后直走原生 TUN |
| Rust MSVC 链接阶段偶发 `0xC0000005` 访问冲突 | 执行 `cargo check -j 1` / `cargo test -j 1` / `cargo build -j 1` 强制单线程链接，偶发失败时直接重试 |

## 六、最近一次核对

- 日期：2026-11-22
- 核对人：Fish
