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
