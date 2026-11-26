# Prismux 插件创作完全指南

> 本文档面向插件作者与 Coding Agent，全部接口签名、目录约定、打包参数与安全校验均对照 Prismux 真实源码编写，可直接作为插件开发与验收标准。
>
> 配套参考：生命周期钩子与浅色 / 深色 / 液态玻璃主题样式请查阅 [官方 Hook 钩子与主题样式参考](./official-hooks-and-theme-tokens.md)。

## 1. 架构总览与核心工程红线

Prismux 插件生态运行在 `@prismux/cordis-kernel`（Cordis 时空可逆双域内核）之上，围绕以下 4 项核心架构契约设计：

1. **双域隔离（`daemon` + `ui`）**：
   - `daemon` 域运行于 24 小时常驻无头守护进程 `@prismux/daemon`（Node.js 24+ ESM），负责 HTTP 路由、生命周期钩子订阅、网络通信、定时任务与加密凭据读写。
   - `ui` 域运行于前端宿主环境，仅允许通过受限声明式液态玻璃组件协议（`ui: "components"`）渲染配置或交互面板，严禁向宿主注入原始 HTML、SVG 或脚本。
2. **时空可逆与卸载零残留（`ReversibleEffectScope`）**：
   - 宿主通过 `CordisPluginHost.mountPlugin()` 为每个插件创建独立的 `ReversibleEffectScope`。
   - 插件注册的路由、钩子、声明式面板、样式、定时器及自定义 `ctx.effect()` 清理函数均挂入该作用域；当插件停用、卸载或 `apply(ctx)` 抛错回滚时，内核按 **LIFO（后进先出）** 顺序原子释放全部资源，确保零残留监听与状态泄漏。
3. **官方插件零预装与托管单写锁（`distribution: "managed"`）**：
   - Prismux 主程序与安装包**默认不预装任何官方插件**（当前活跃官方插件仅 `qq` 与 `fishdock-hook`；原 `pet`、`ssh` 插件已停用并由内置能力取代）。
   - 所有通过官方目录、社区 npm 或本地 `.wb-plugin` 安装的插件均自动写入 `.prismux-install.json` 并锁定 `"distribution": "managed"`。受管插件严禁在运行时应用内热自更（内核会抛出 `ManagedPluginSelfUpdateError`），升级与回滚（默认最多保留 3 份 `.snapshots` 快照）统一由宿主插件中心原子替换目录。
4. **视觉层对模型 0 Token 红线**：
   - 纯宿主视觉、通知或配置插件必须声明 `"modelVisible": false`，不得向任何大模型或 Coding Agent 注入 Tool Schema 或 System Prompt。
   - 若插件确实需要向大模型暴露工具或修改提示词，必须显式声明 `"modelVisible": true`（或申请 `hooks:intercept`、`memory:private-chief` 等高敏权限），宿主会在安装与升级前弹出强制信任审计确认窗（`AUDIT_CONFIRMATION_REQUIRED` / HTTP `409`）。

## 2. 目录结构与清单规范

### 2.1 标准目录结构

```text
prismux-plugin-example/
├── package.json            # 必填：ESM 模块声明、入口路径与顶层 engines.prismux
├── plugin.manifest.json    # 必填：插件 ID、版本、运行域、权限与 modelVisible
├── tsconfig.json           # 推荐：TypeScript 5.8+ NodeNext 配置
├── src/
│   └── index.ts            # 插件源码（导出 manifest 与 apply）
└── dist/
    ├── index.js            # 编译后的 ESM 运行入口（打包时必须存在）
    └── index.d.ts          # 类型声明（可选）
```

### 2.2 `package.json` 强制规范

| 字段 | 要求 | 说明 |
| :--- | :--- | :--- |
| `name` | 社区插件使用 `prismux-plugin-<name>` | 官方插件保留 `@prismux/plugin-<id>` 作用域；第三方社区插件统一使用 `prismux-plugin-` 前缀 |
| `version` | 严格 SemVer 2.0 | 须与 `plugin.manifest.json` 中的 `version` 保持一致（如 `0.1.0`、`0.2.3-rc.1`） |
| `type` | 必须为 `"module"` | 守护进程通过原生 ESM `import()` 动态加载插件入口 |
| `engines.prismux` | **必填顶层字段** | 宿主内核直接解析顶层 `engines.prismux` SemVer 范围，**绝不回退读取 `peerDependencies`** |
| `exports` / `main` | 指向包内编译后 JS 文件 | 守护进程加载顺序：`exports["./daemon"]` → `exports["."]`（字符串或 `{ import }`）→ `main`，禁止越界跳出插件目录 |
| `scripts` | 禁止包含安装生命周期脚本 | `preinstall`、`install`、`postinstall`、`prepare` 会被流式安装器**强制忽略且绝不执行**，同时会触发安装安全警告 |
| `keywords` | 推荐包含 `"prismux-plugin"` | 便于社区检索与 GitHub Topic `prismux-plugin` 对齐 |

> [!IMPORTANT]
> **关于 `engines.prismux` 与预发布版本兼容**：Prismux 当前处于 `0.2.3-rc.*` 预发布阶段。依据 `@prismux/cordis-kernel` 的 SemVer 引擎规则，当范围下界包含预发布标记（如 `>=0.1.0-0 <2.0.0`）时，可同时匹配 `0.2.3-rc.1` 与后续 `0.2.x` / `1.x` 正式版；若只写 `^0.1.0`，则不会匹配 `0.2.3-rc.*` 预发布宿主。建议统一声明：
>
> ```json
> "engines": {
>   "prismux": ">=0.1.0-0 <2.0.0"
> }
> ```

> [!WARNING]
> **零外部运行时依赖规范**：`scripts/pack-plugin.ts` 会跳过 `node_modules/`，且插件流式安装器不会运行 `npm install` 或任何安装脚本。因此插件运行态代码**只应依赖 Node.js 内置模块（`node:*`）**；若确需引用第三方纯 JS 工具库，请在发布前打包进 `dist/` 单文件；引用 `@prismux/protocol` 时请使用纯类型导入 `import type { ... } from "@prismux/protocol"`。

### 2.3 `plugin.manifest.json` 规范

```json
{
  "id": "example-notifier",
  "version": "0.1.0",
  "realms": ["daemon", "ui"],
  "permissions": ["hooks:subscribe", "notifications:push", "ui:panel"],
  "modelVisible": false,
  "behaviors": {
    "autostart": true,
    "requiresConfiguration": false,
    "supportsLoopbackTest": false
  }
}
```

字段校验规则（与 `scripts/pack-plugin.ts` 及 `CordisPluginHost.validateManifest()` 一致）：

- `id`：必填非空字符串，匹配 `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`，禁止包含 `..`、`/`、`\` 或空字符。
- `version`：必填严格 SemVer 2.0 字符串。
- `realms`：必填非空数组，元素仅允许 `"daemon"` 或 `"ui"`。
- `permissions`：必填字符串数组（无额外权限时传 `[]`）。
- `modelVisible`：必填布尔值（`true` 或 `false`）。
- `behaviors`（可选）：支持 `autostart?: boolean`、`requiresConfiguration?: boolean`、`supportsLoopbackTest?: boolean`。

### 2.4 官方已知权限列表与信任审计级别

定义于 `packages/protocol/src/plugin.ts`（`KnownPluginPermission`）及 `packages/cordis-kernel/src/StreamingInstaller.ts`：

| 权限标识 | 说明 | 审计级别 |
| :--- | :--- | :--- |
| `network:outbound` | 发起出站网络请求 | 敏感（插件中心提示审计） |
| `network:inbound` | 监听入站网络请求与本地端口 | 高敏 |
| `memory:private-chief` | 读写主人私密主秘书记忆（`private/chief`） | 高敏 |
| `memory:workspace` | 读写工作区项目记忆（`workspace/*`） | 常规 |
| `memory:social-qq` | 读写隔离 QQ 群聊记忆（`social/qq-group-*`） | 常规 |
| `hooks:subscribe` | 只读订阅生命周期钩子事件 | 常规 |
| `hooks:intercept` | 拦截并改写工具调用与模型生命周期钩子 | **高危（强制二次确认）** |
| `pty:spawn` | 创建本地或远程交互式终端（PTY） | 高敏 |
| `fs:read` | 读取本地文件系统 | 常规 / 插件中心敏感提示 |
| `fs:write` | 写入或修改本地文件系统 | 高敏 |
| `ui:panel` | 注册工作台声明式分屏 / 配置面板 | 常规（0 Token 宿主层） |
| `ui:status-bar` | 注册状态栏与顶部胶囊组件 | 常规（0 Token 宿主层） |
| `pet:lease` | 控制桌宠实例租约与演出状态 | 常规 |
| `notifications:push` | 推送系统或灵动岛通知卡片 | 常规 |

### 2.5 `0600` 独立加密凭据隔离

每个插件的密钥、Token 或 Webhook 秘钥严禁明文写入配置文件或日志文件，必须通过 `ctx.credentials` 读写：

```ts
await ctx.credentials.set("webhookSecret", secretValue);
const secret = await ctx.credentials.get("webhookSecret");
await ctx.credentials.delete("webhookSecret");
```

底层由 `EncryptedPluginCredentialStore` 提供物理隔离保障：

- 存储路径：`~/.prismux/credentials/<plugin-id>.enc`（目录权限 `0700`，文件权限严格 `0600`，原子临时文件 + `renameSync` 写入）。
- 加密算法：基于宿主主密钥通过 `HKDF-SHA256`（`info = "prismux-plugin-cred-v1"`，`salt = pluginId`）为每个插件派生独立 32 字节密钥，采用 `ChaCha20-Poly1305`（12 B 随机 IV + 16 B AuthTag）加密，并绑定 AAD `prismux-plugin-cred-v1:<plugin-id>`。
- 跨插件物理隔离：即使拷贝另一插件的 `.enc` 文件，也无法在当前插件 ID 下解密。

## 3. 生命周期、`ctx.effect()` 与零残留卸载

### 3.1 模块导出与 `PluginContext` 能力

守护进程加载入口模块时支持以下任一导出方式：

- 命名导出：`export const manifest: PluginManifest = ...` 与 `export function apply(ctx: PluginContext): void | Promise<void>`；
- 默认导出：`export default { manifest, apply(ctx) { ... } }`。

> 注意：`module.manifest.id` 必须与 `plugin.manifest.json` 的 `id` 完全一致，否则 `CordisPluginHost.mountPlugin()` 将拒绝挂载。

`CordisPluginContext`（扩展自 `@prismux/protocol` 的 `PluginContext`）提供以下宿主能力：

| 成员 | 所属域 / 说明 | 卸载清理方式 |
| :--- | :--- | :--- |
| `ctx.manifest` / `ctx.realm` / `ctx.distribution` | 只读元信息 | — |
| `ctx.effect(disposable)` | 注册任意同步或异步清理回调（支持 `Promise<void>`） | 卸载或 `apply()` 异常时按 LIFO 顺序执行 |
| `ctx.credentials` | 隔离加密凭据句柄（`get` / `set` / `delete`） | 凭据持久化保留，不随卸载泄露 |
| `ctx.logger` | 结构化日志（`info` / `warn` / `error`），写入插件运行日志查看器 | — |
| `ctx.onHook?.(event, handler)` | 订阅 6 大官方生命周期钩子 | 宿主自动托管，卸载零残留 |
| `ctx.registerRoute?.(method, path, handler)` | 注册 Daemon 扩展路由（`GET`/`POST`/`PUT`/`DELETE`），建议统一前缀 `/plugins/<id>/*` | 宿主自动托管，冲突抛错，卸载零残留 |
| `ctx.registerPanel?.(panelId, { title, component })` | 注册面板（若 `component` 为声明式 Spec 将自动走声明式校验） | 宿主自动托管，卸载零残留 |
| `ctx.registerDeclarativePanel(panelId, spec, handlers?)` | 注册受限声明式液态玻璃面板，返回 `DeclarativePanelHandle` | 宿主自动通过 `ctx.effect()` 销毁 |
| `ctx.registerStyle(styleId, cssText)` | 注册受管样式表（仅使用 `--pmx-*` / 语义变量，见主题参考文档） | 宿主自动移除样式表，零残留 |
| `ctx.setInterval` / `ctx.setTimeout` / `ctx.registerTimer` | 受管定时器（替代裸全局定时器） | 卸载时自动 `clearInterval` / `clearTimeout` |

### 3.2 `ctx.effect()` 卸载零残留写法

任何在 `apply(ctx)` 中创建的外部资源（WebSocket 连接、HTTP Server、事件监听、内存 Map、自定义定时器）都必须第一时间登记到 `ctx.effect()`：

```ts
export async function apply(ctx: PluginContext): Promise<void> {
  if (ctx.realm === "daemon") {
    const controller = new AbortController();
    const state = new Map<string, number>();

    // 1. 注册受管路由与钩子（宿主自动追踪清理）
    ctx.registerRoute?.("GET", "/plugins/example/status", () => ({
      active: !controller.signal.aborted,
      items: state.size
    }));

    ctx.onHook?.("Stop", (hookCtx) => {
      state.set(hookCtx.threadId, hookCtx.timestamp);
      ctx.logger.info("Captured Stop hook", { threadId: hookCtx.threadId });
    });

    // 2. 自定义资源统一通过 ctx.effect() 逆序释放
    ctx.effect(async () => {
      controller.abort();
      state.clear();
      ctx.logger.info("Disposed example plugin cleanly");
    });
  }
}
```

如果 `apply(ctx)` 在中途抛出异常，`CordisPluginHost` 会立即执行已登记的 `scope.disposeAll()`，将插件回滚为未启用状态，绝不会留下半初始化的路由或僵尸监听器。

## 4. UI 侧受限声明式原语（零原始 HTML 注入）

Prismux UI 域禁止插件注入原始 DOM、HTML 字符串、`<iframe>` 或内联脚本，统一采用 `ui: "components"` 声明式液态玻璃协议（定义于 `packages/cordis-kernel/src/DeclarativeUi.ts`，由 `@prismux/appearance` 的 `DeclarativeGlassRenderer` 渲染）。

### 4.1 允许的 8 大声明式原语

| 原语 `type` | 核心属性 | 用途说明 |
| :--- | :--- | :--- |
| `Stack` | `direction`（`row`/`column`）、`gap`（`none`/`xs`/`sm`/`md`/`lg`）、`align`、`justify`、`wrap`、`children` | 弹性布局容器 |
| `Card` | `title`、`subtitle`、`tone`（`default`/`subtle`/`accent`/`warning`/`danger`）、`padded`、`children` | 自动适配浅色 / 深色 / 液态玻璃的分组卡片 |
| `Text` | `content`、`variant`（`title`/`heading`/`body`/`muted`/`caption`/`code`）、`tone`、`tabularNums` | 语义排版文本（自动转义防 XSS） |
| `Badge` | `label`、`variant`（`default`/`info`/`success`/`warning`/`danger`/`outline`） | 状态与能力徽章 |
| `Button` | `label`、`actionId`、`payload`（JSON-Safe）、`variant`（`primary`/`secondary`/`outline`/`ghost`/`danger`）、`size`（`sm`/`md`）、`disabled`、`disabledReason`、`loading` | 触发已声明的受控动作（内置 `500 ms` 点击防劫持稳定期） |
| `Switch` | `label`、`description`、`atomKey`、`checked`、`actionId`、`disabled`、`disabledReason` | 绑定布尔型 Atom 的开关控件 |
| `Input` | `label`、`labelHidden`、`description`、`atomKey`、`value`、`placeholder`、`inputType`（`text`/`number`/`password`/`search`/`url`）、`actionId`、`readOnly`、`maxLength` | 绑定字符串 / 数值型 Atom 的输入框 |
| `Table` | `caption`、`columns`（`key`/`label`/`align`/`mono`/`sortable`）、`rows`、`emptyText`、`compact` | 支持前端排序的结构化数据表 |

### 4.2 状态原子（`atoms`）、受控动作（`actions`）与安全硬边界

- **`atoms` 持久化作用域**：支持 `type: "string" | "number" | "boolean"`；`persist` 支持 `true` / `"plugin"`（插件级持久化）、`"workspace"`（按工作区隔离持久化）、`false` / `"memory"`（仅内存）；修改 `version` 可触发结构迁移或重置默认值。
- **`actions` 声明**：动作 ID 匹配 `/^[a-zA-Z][a-zA-Z0-9._:-]{0,63}$/`，支持 `confirm: true` 与 `confirmMessage` 二次确认。
- **结构与安全预算**：
  - 嵌套深度默认上限 `12`（硬上限 `24`）；
  - 节点数量默认上限 `250`（硬上限 `1000`）；
  - 节点树计量体积默认上限 `512 KiB`（硬上限 `1 MiB`）；
  - 严禁原型污染键（`__proto__`、`constructor`、`prototype`）及任意注入键（`dangerouslySetInnerHTML`、`innerHTML`、`outerHTML`、`html`、`rawHtml`、`svg`、`script`、`style`、`css`、`className`、`class`、`srcDoc`、`iframe`、`eval` 与所有 `on[A-Z]*` 事件处理键），违规将直接抛出 `DeclarativeUiValidationError`。

## 5. 打包、回环自检与发布

### 5.1 使用 `pnpm plugin:pack` 生成确定性 `.wb-plugin` 归档

Prismux 提供零第三方依赖的 Node 24 原生 TS 打包脚本 `scripts/pack-plugin.ts`：

```powershell
# 1. 先编译 TypeScript 到 dist/
pnpm --dir ./path/to/my-plugin build

# 2. 执行确定性打包与 gunzip 逐字节回环自检
pnpm plugin:pack -- --plugin ./path/to/my-plugin --out .work/plugin-dist

# 3. 可选：同时回写插件目录清单（如官方或私有 catalog JSON）
pnpm plugin:pack -- --plugin ./path/to/my-plugin --out .work/plugin-dist --update-catalog ./catalog.json
```

打包脚本会自动完成以下校验与产物生成：

1. 校验 `package.json` 顶层 `engines.prismux`（缺失则直接报错，绝不回退 `peerDependencies`）与 `plugin.manifest.json` 必填字段；
2. 递归收集文件（自动跳过 `node_modules`、`.git`、`.work`、`.DS_Store`、`*.wb-plugin`、`*.sha256` 与符号链接），按 POSIX 字节序排列；
3. 写入确定性 POSIX ustar `.tar`（固定 `mtime = 0`、`uid = 0`、`gid = 0`、`mode = 0644`），`gzip` 压缩为 `prismux-plugin-<id>-<version>.wb-plugin`；
4. 立即执行 `gunzipSync` 逐字节回环对比原始 `.tar`，校验完全一致后写出对应的 `.sha256` 文件。

### 5.2 社区 npm 发布与免 Git 流式导入

发布社区插件至 npm Registry 时请遵循以下约定：

1. 包名采用 `prismux-plugin-<name>`，GitHub 仓库添加 Topic `prismux-plugin`；
2. `package.json` 包含 `"files": ["dist/", "plugin.manifest.json", "README.md", "LICENSE"]`，严禁配置 `preinstall` / `install` / `postinstall` / `prepare`；
3. 运行 `npm publish --access public` 发布后，用户即可在 Prismux **设置 → 插件中心** 直接输入包名或 `.tgz` 地址安装：
   - 宿主通过 `CordisStreamingInstaller` 直接经 HTTPS 流式拉取 `.tgz`（自动在 `registry.npmjs.org` ↔ `registry.npmmirror.com` 间测速与故障回退）；
   - 全程不调用本机 `git`，强制拒绝 Tar-Slip 路径穿越、符号链接（`typeflag = '2'`）、硬链接（`typeflag = '1'`）与设备节点；
   - 校验顶层 `engines.prismux`、构建中文权限审计卡，并写入 `distribution: "managed"` 锁。

> [!TIP]
> 官方两款独立插件另通过 `node scripts/build-npm-plugin-packages.ts --dir <release-dir> --out <out-dir>` 生成携带已验签 `.wb-plugin` 归档与防覆盖导出 CLI 的无脚本 npm 单包，适合离线或企业私有源分发。

## 6. 完整最小可运行插件骨架

以下 4 个文件构成一个 0 外部依赖、支持 Daemon 钩子与声明式 UI、可直接通过 `pnpm plugin:pack` 打包并导入 Prismux 的最小完整插件。

### `package.json`

```json
{
  "name": "prismux-plugin-hello-hooks",
  "version": "0.1.0",
  "type": "module",
  "description": "Minimal Prismux plugin recording Stop hook events with declarative liquid-glass UI.",
  "license": "MIT",
  "keywords": ["prismux", "prismux-plugin"],
  "engines": {
    "prismux": ">=0.1.0-0 <2.0.0"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist/", "plugin.manifest.json", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

### `plugin.manifest.json`

```json
{
  "id": "hello-hooks",
  "version": "0.1.0",
  "realms": ["daemon", "ui"],
  "permissions": ["hooks:subscribe", "ui:panel"],
  "modelVisible": false,
  "behaviors": {
    "autostart": true
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

### `src/index.ts`

```ts
import { readFileSync } from "node:fs";
import type { PluginContext, PluginManifest } from "@prismux/protocol";

function readBundledVersion(fallback: string): string {
  try {
    const raw = readFileSync(new URL("../plugin.manifest.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // 静态回退版本
  }
  return fallback;
}

export const manifest: PluginManifest = {
  id: "hello-hooks",
  version: readBundledVersion("0.1.0"),
  realms: ["daemon", "ui"],
  permissions: ["hooks:subscribe", "ui:panel"],
  modelVisible: false,
  behaviors: {
    autostart: true
  }
};

export function apply(ctx: PluginContext): void {
  const recentStops: Array<{ threadId: string; timestamp: number }> = [];

  if (ctx.realm === "daemon") {
    ctx.onHook?.("Stop", (hookCtx) => {
      recentStops.unshift({
        threadId: hookCtx.threadId,
        timestamp: hookCtx.timestamp
      });
      if (recentStops.length > 20) {
        recentStops.pop();
      }
      ctx.logger.info("Recorded Stop lifecycle event", {
        threadId: hookCtx.threadId,
        total: recentStops.length
      });
    });

    ctx.registerRoute?.("GET", "/plugins/hello-hooks/status", async () => {
      const hasToken = (await ctx.credentials.get("webhookToken")) !== null;
      return {
        pluginId: manifest.id,
        version: manifest.version,
        hasToken,
        recentStopCount: recentStops.length
      };
    });
  }

  if (ctx.realm === "ui") {
    ctx.registerPanel?.("hello-hooks.panel", {
      title: "任务完工记录",
      component: {
        ui: "components",
        schemaVersion: 1,
        title: "Hello Hooks 控制台",
        description: "纯宿主声明式液态玻璃界面，对大模型保持 0 Token 开销。",
        atoms: [
          {
            key: "notifyOnStop",
            type: "boolean",
            defaultValue: true,
            persist: "plugin"
          }
        ],
        actions: [
          {
            id: "hello:ping",
            label: "发送自检日志"
          }
        ],
        root: {
          type: "Stack",
          direction: "column",
          gap: "sm",
          children: [
            {
              type: "Card",
              title: "事件订阅状态",
              subtitle: "自动继承浅色 / 深色 / 液态玻璃主题与 ≥ 4.5:1 对比度。",
              children: [
                {
                  type: "Stack",
                  direction: "row",
                  gap: "xs",
                  wrap: true,
                  children: [
                    { type: "Badge", label: "0 Token 纯净", variant: "success" },
                    { type: "Badge", label: "Hook: Stop", variant: "info" }
                  ]
                },
                {
                  type: "Switch",
                  label: "记录任务完工事件",
                  atomKey: "notifyOnStop"
                },
                {
                  type: "Button",
                  label: "发送自检日志",
                  actionId: "hello:ping",
                  variant: "primary",
                  size: "sm"
                }
              ]
            }
          ]
        }
      }
    });
  }

  ctx.effect(() => {
    recentStops.length = 0;
    ctx.logger.info("Disposed hello-hooks plugin with zero residue");
  });
}
```

## 7. 官方参考范例与扩展阅读

- **双域 + 凭据隔离 + 路由 + Hook 完整范例**：[`plugins-official/plugin-qq`](../../plugins-official/plugin-qq/src/index.ts)（OneBot v11 私聊主秘书与群聊硬隔离插件）
- **纯 Daemon 钩子桥接范例**：[`plugins-official/plugin-fishdock-hook`](../../plugins-official/plugin-fishdock-hook/src/index.ts)（FISH-Dock 灵动岛 `PreToolUse` / `Notification` 审批回执插件）
- **官方 Hook 钩子与浅色 / 深色 / 液态玻璃主题样式参考**：[`docs/plugins/official-hooks-and-theme-tokens.md`](./official-hooks-and-theme-tokens.md)
- **官方插件索引清单**：[`plugins-official/catalog/official.json`](../../plugins-official/catalog/official.json)
