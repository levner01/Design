# GLM-M0-01 验收记录

结论：`REJECT`

固定点：`d2bbcb55e9b494a73c932a7891d8775ad67236cf`

交付点：`ee5dd826dea49e732ef571f8e96fa6d713a521fb`

验收日期：2026-07-16

## 1. 已通过

- `corepack pnpm install --frozen-lockfile`：exit 0；当前机器 Node 22.16.0，存在目标 Node 24 未复验警告。
- `corepack pnpm exec tsc -b --force`：exit 0。
- `corepack pnpm exec turbo run build --force`：9/9 包通过，0 cache。
- `corepack pnpm verify:quick`：exit 0。
- macOS arm64/x64 DMG 构建：exit 0；未签名，仅作为 smoke。
- Renderer 安全配置静态项：Sandbox、Context Isolation、Node Integration、导航与窗口限制符合骨架基线。

## 2. 阻塞缺陷

### P0：Electron 冷安装后不能启动

`pnpm-workspace.yaml` 将 `electron` 的 build/install script 配为 `false`。冻结安装虽然 exit 0，但 Electron 二进制不存在；`pnpm --filter @designwan/desktop exec electron --version` exit 1，报 `Electron failed to install correctly`。

### P0：Packaged Desktop 不能加载 Renderer 与 Preload

- Desktop build 只执行 `tsc -b`，没有复制 `src/renderer/index.html`。
- Main 从 `app.asar/renderer/index.html` 加载，而实际 JS 位于 `app.asar/dist/renderer/`。
- Preload 编译为 ESM `.js`，Sandbox preload 运行时报 `Cannot use import statement outside a module`。
- 实际启动 macOS arm64 Artifact 复现 `ERR_FILE_NOT_FOUND` 与 Preload SyntaxError。

### P0：Extension 构建产物不可加载

`tsc -b` 生成 JS 后，`copy-manifest.mjs` 删除整个 `dist`，最终只剩 `manifest.json` 与 `popup.html`；Manifest 声明的 `background.js` 和 popup 引用脚本不存在。当前测试只解析源 Manifest，没有校验构建产物引用完整性。

### P1：Native Host 单帧输入无 ACK

`readExact(4)` 收到“header + body”同一 chunk 时只保留前 4 字节并丢弃剩余 body；标准单帧实测 stdout 0 bytes，进程直接退出。应使用跨读取持久缓冲区，并覆盖单 chunk、多 chunk、连续多帧与畸形长度测试。

### P1：冻结技术栈缺少 React

架构基线冻结为 Electron + React + TypeScript，但 Desktop 没有 React/ReactDOM 和 Renderer 构建链，当前使用原生 DOM。验收矩阵将技术栈漂移列为直接 REJECT。

### P1：缺少 Windows Artifact 与目标 Node 24 证据

仓库没有远端，无法获得声明中的 macOS/Windows CI Artifact；本机只验证了 macOS。当前 Node 22 结果不能代替 Node 24 冷安装、Build、启动和打包证据。

## 3. 复验完成定义

GLM 修复后必须提交新 SHA，并同时满足：

1. Node 24 + pnpm 11 冷安装后 Electron 二进制可运行。
2. React Renderer 建链；Desktop `dist` 与 ASAR 包含正确 HTML/JS/CSS，Preload 模块格式可运行。
3. macOS Artifact 真实启动，无 `ERR_FILE_NOT_FOUND`、Preload error 或 Node capability 泄漏。
4. Extension Artifact 校验 Manifest 引用文件全部存在，并可由 Chrome 加载。
5. Native Host 覆盖单 chunk、拆 chunk、连续帧测试并返回正确 ACK。
6. `verify:quick` 增加产物完整性与真实启动 smoke，防止 TypeScript 假绿。
7. macOS arm64/x64 与 Windows x64 在 Node 24 CI 生成 Artifact；交付日志包含 SHA、平台、命令与退出码。

未满足以上七项前，不得进入 S1 / GLM-M0-02。

## 4. 第二次复验：`6db40f6`

复验固定点：`f9342ea9af64d72de3354c8901fe72b0d24638d8`

复验交付点：`6db40f6f986f1c6f6a80e0c8824e16775ace9a03`

复验结论：`REJECT`

### 4.1 已修复并通过

- Node 24.18.0 + pnpm 11.13.1 在独立 Git Archive 目录完成 frozen install；Electron postinstall 命中本机缓存并得到 Electron 33.4.11。
- Node 24 下 `tsc -b --force`、九 Workspace 无缓存 Build、`verify:quick` 均 exit 0。
- React 18 Renderer、esbuild Bundle、CJS Preload、HTML 路径和 ASAR 产物已建立。
- macOS arm64/x64 DMG 打包 exit 0；arm64 Packaged App 实际启动后，通过 CDP 读取到 `ready=complete`、`window.designwan=object`、Protocol/App 版本正文，未出现 `ERR_FILE_NOT_FOUND` 或 Preload SyntaxError。
- Extension 当前构建产物包含 Manifest、Background、Popup HTML/JS。
- Native Host 单 chunk、拆 chunk、连续帧和零长度测试通过；完整测试连续执行 20 轮未失败。

### 4.2 剩余阻塞

#### P0：Electron 自动 smoke 仍可假绿

`electron-smoke.mjs` 没有等待窗口、`did-finish-load` 或 Renderer→Preload→Main 协商成功。进程存活到超时后被 SIGTERM/SIGKILL 会被判为 PASS，甚至提前以 code 0 退出也可通过；坏 ASAR、空白窗口和 Renderer 未协商都可能逃过门禁。

修复要求：Packaged/Unpacked Artifact 启动后必须返回不可伪造的 ready 证据，至少包含 Renderer 完成加载、Preload Bridge 存在、`negotiate()` 成功和版本值；超时或提前退出一律失败。S0 验收模式禁止通过环境变量跳过 Electron smoke。

#### P0：Windows x64 与 CI Artifact 证据仍缺失

仓库仍无 Git Remote；Workflow 声明不能代替实际 CI Run。当前只有本机 macOS Artifact，没有 Windows x64 Artifact、运行日志、对应 SHA 与退出码。

修复要求：绑定可运行 CI 的远端后，交付 Node 24 下 macOS arm64、macOS x64、Windows x64 三个平台的 Run/Artifact/SHA/退出码；Artifact 上传不得使用 `if-no-files-found: warn` 掩盖缺包。

#### P1：Extension 没有真实 Chrome 加载门，且旧产物可冒充当前构建

当前只检查 Manifest 引用文件“存在”，没有启动 Chrome 验证 MV3 Service Worker 与 Popup 可加载。构建前也不清理 `dist`；实测删除 `src/background.ts` 后重新 Build，旧 `dist/background.js` 仍使门禁通过。

修复要求：构建前清理输出并全量重建；用 Chrome/Chromium `--load-extension` smoke 验证无 Manifest、Service Worker、Popup 错误。

#### P1：Native Host 超长帧处理会失步

长度大于 1 MB 时当前只消费四字节 Header 后继续，把攻击者 Body 当成新 Header 循环解析。应立即关闭输入/进程，或完整、安全地丢弃已声明帧；不能在未知边界继续解析。测试 ACK 解码器也应保留同一 stdout chunk 中未消费的后续帧，避免连续帧测试依赖 OS 分包。

### 4.3 第三次复验最小范围

GLM 只需修复以上四项，不得进入 M0-02，不得顺手扩展业务能力。第三次复验将只检查：

1. Packaged Artifact 正向 ready 门与所有失败路径。
2. Chrome Extension 全量干净构建与真实加载。
3. Native Host 超长帧和连续 ACK 稳定性。
4. Node 24 三平台 CI Run 与 Artifact 证据。
