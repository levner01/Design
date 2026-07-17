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

## 5. 第三次复验：`cd9c14f`

复验固定点：`eedad998b7b01e6f76de22d2b83ccd2bc865625a`

复验交付点：`cd9c14fc0a46bc1de33f8b63bb575999ca1e3aa6`

复验结论：`REJECT`

### 5.1 已修复并通过

- Node 24.18.0 + pnpm 11.13.1 下，TypeScript 强制检查、九 Workspace 无缓存 Build 与完整 `verify:quick` 均 exit 0。
- 正常 macOS arm64 Unpacked Artifact 可取得 Ready Sentinel：Renderer `complete`、Preload Bridge 存在、`negotiate()` 成功、Protocol/App 版本正确。
- Extension 构建已在编译前清理 `dist` 与增量状态；删除 `background.ts` 后 Build 失败的回归测试通过。
- Native Host 对零长度和超过 1 MB 帧改为非零退出，不再在未知 Body 边界继续解析；ACK 使用持久缓冲区。
- Native Host 九项完整测试连续执行 50 次，50/50 通过；覆盖拆包、粘包、半帧 EOF、非法 JSON、超长帧和连续 ACK。
- CI Workflow 已改为 Node 24 三平台矩阵，Artifact 缺失策略改为 `error`，不再使用 `if: always()` 上传掩盖失败。

### 5.2 阻塞反例

#### P0：Packaged App 提前退出仍被错误判为成功

`electron-smoke.mjs` 先轮询 Sentinel，最多等待 30 秒，之后才注册子进程 `exit` Listener。若 App 在 Listener 注册前退出，事件永久丢失；等待 Promise 无法完成，Node 在无活动 Handle 后最终以 code 0 退出。

实测把本地生成的 Packaged 可执行文件临时替换为立即 `exit 0` 的程序：Smoke 只输出 Electron/Dist/Unpacked 三个前置 PASS，没有收到 Sentinel，也没有输出最终 PASS/FAIL，但命令本身 `exit 0`。这违反“提前退出一律失败”，属于可复现假绿。

修复要求：Spawn 后立即注册 `exit`/`error`，以 `Promise.race` 或统一状态机竞争 Sentinel、提前退出和超时；没有完整正向 Sentinel 的任何路径必须显式 `process.exit(1)`。失败测试必须直接运行 Smoke Runner 并断言非零，不能只验证 Sentinel 不存在。

#### P0：三平台真实 CI 证据仍不存在

`git remote -v` 仍为空；仓库没有实际 GitHub Actions Run，也没有 Windows x64 Artifact、Run URL、SHA 和退出码。Workflow 声明不是验收证据，因此 S0 不能 PASS。

修复要求：配置 Git Remote 后，在交付 SHA 上实际运行 macOS arm64、macOS x64、Windows x64 矩阵，提交 Run URL、各 Job 结论、Artifact 名称和下载证据。无法配置远端时必须返回 `BLOCKED: REMOTE_REQUIRED`，不能声称已完成。

#### P1：Chrome Smoke 可把损坏 Popup 判为 PASS

当前 Chrome Smoke 接受任意 `service-worker` 或 `chrome-extension://` Target，没有核对它属于 DesignWan，也没有打开 Manifest 声明的 Popup、执行 `popup.js` 或通过 CDP 收集 Runtime/Log 异常。

实测把生成的 `popup.js` 临时替换为不可执行内容：Chrome Smoke 仍报告 `0 SW + 2 ext targets` 并 `exit 0 / PASS`。这证明当前“真实 Chrome 加载门”仍是假绿。

修复要求：从本扩展 Service Worker URL 确定 Extension ID，只接受该 ID；通过 CDP 打开 `chrome-extension://<id>/popup.html`，等待脚本执行并断言专用 Ready 标记，同时监听 `Runtime.exceptionThrown`、`Log.entryAdded`、Service Worker 和 Popup 错误。

### 5.3 工程补项

- `DESIGNWAN_SMOKE_SENTINEL` 当前可让正式 App 截断任意可写文件。必须仅在明确测试构建/开关下启用，并校验规范化路径位于应用专用临时目录。
- Electron negotiate 故障注入若字符串替换未命中会主动 PASS；必须改为明确 FAIL。
- Native Host `AckReader` 超时清理使用 `indexOf` 查找新建对象，永远无法移除原 Waiter；应保存同一 Waiter 引用后删除。
- macOS x64 Smoke 选择 Artifact 时必须按 `process.arch` 选择，不能固定优先 `mac-arm64`。

### 5.4 第四次复验最小范围

1. Electron Runner 提前退出反例必须非零，并补 Runner 级失败测试。
2. Chrome Smoke 必须锁定本扩展并实际执行 Popup；损坏 Popup 反例必须非零。
3. Sentinel 文件路径限制与两项测试可靠性补正。
4. 交付真实 Node 24 三平台 CI Run 与 Artifact 证据。

上述四项未完成前，不得进入 S1 / GLM-M0-02。

## 6. 第四次复验：`be804cd`

复验固定点：`b9d59b6252270994842c8481a52ceb1a7eacba3e`

复验交付点：`be804cd17bcf50da9b7250f5e6dd2c36adda7872`

复验结论：`REJECT（BLOCKED: REMOTE_REQUIRED）`

### 6.1 已修复并通过

- Node 24.18.0 + pnpm 11.13.1 下，`tsc -b --force`、九 Workspace 无缓存 Build 与完整 `verify:quick` 均 exit 0；十五项门禁均报告 PASS。
- Electron Smoke 在 Spawn 后立即监听 `error`/`exit`/`close`，以 Sentinel、提前退出和超时竞争；Runner 级立即 `exit 0/1` 反例已接入门禁。
- Chrome Smoke 已从 DesignWan Service Worker URL 提取 Extension ID，并通过 CDP 打开本扩展 Popup、检查专用 Ready 标记；损坏或缺失 Popup 反例已接入门禁。
- Sentinel 增加 Smoke Mode 双开关、应用专用临时目录、独占创建约束；negotiate 故障注入不再依赖字符串替换。
- Native Host `AckReader` 已按同一 Waiter 引用清理超时项，并新增“首个超时后第二个 ACK 仍可收到”的回归用例。
- macOS Artifact 选择已按 `process.arch` 区分 arm64/x64。

### 6.2 阻塞项

#### P0：真实 Node 24 三平台 CI Run / Artifact 仍不存在

`git remote -v` 仍为空；仓库没有 Run URL、交付 SHA 对应的各 Job 结论、Artifact 名称或下载证据。`be804cd` 提交说明也明确写明 `blocked locally without git remote`。`.github/workflows/ci.yml` 的矩阵声明不能代替实际执行，因此 S0 不能 PASS。

修复要求：配置可运行的 Git Remote，在同一交付 SHA 上实际完成 macOS arm64、macOS x64、Windows x64 三个 Node 24 Job，并提交 Run URL、Job 结论、Artifact 名称、下载/文件清单及 SHA。没有远端前，状态必须保持 `BLOCKED: REMOTE_REQUIRED`。

#### P1：Chrome Smoke 会忽略已采集的 Log 错误，也未采集 Service Worker 运行异常

Smoke 虽启用 `Runtime` 与 `Log`，最终只判断 Popup Ready 和 `Runtime.exceptionThrown`，未将 `Log.entryAdded` 纳入失败条件，也没有附着本扩展 Service Worker 采集异常。实测在 Popup 设置 Ready 后注入 `console.error("DESIGNWAN_ACCEPTANCE_INJECTED_POPUP_ERROR")`，Smoke 仍 `exit 0 / PASS`。

修复要求：先创建并附着空白 Target，启用 Page/Runtime/Log 后再导航 Popup，避免漏掉早期事件；附着本扩展 Service Worker；将 Popup/SW 的 Runtime 异常、错误级 Log 与必要的 Console 错误纳入非零门禁，并增加对应反例。

#### P1：Symlink 安全测试在启动前删除了攻击夹具

`sentinel-path-security.test.mjs` 的 Symlink 用例先创建链接，但 `runElectronAndWait()` 开头立即 `rmSync(sentinelPath)`，实际执行时 Symlink 已不存在；最后只断言外部目标未生成，因此当前用例是确定性假绿，不能证明 Symlink 拒绝逻辑。

修复要求：允许 Helper 保留预置路径；启动前断言该路径确为 Symlink；分别覆盖指向已存在和不存在外部目标的链接，并断言外部目标未创建/未改写以及 App 明确拒绝。

#### P1：CI Smoke 没有与 Matrix 目标 Artifact 建立一一对应

Workflow 先按 `matrix.arch` 打包，随后 `electron-smoke.mjs` 又无目标参数强制重新打包，并按宿主 `process.arch` 选包；Artifact 检查也只要求 `release/` 任意文件存在。该流程无法证明 `desktop-mac-arm64`、`desktop-mac-x64`、`desktop-win-x64` 各自验证和上传的是声明架构。

修复要求：每个 Job 先清理 Release 输出，只生成精确 Matrix 目标；对刚生成的固定路径执行 `--no-repackage` Smoke；上传前校验预期文件名和二进制架构，不接受目录中任意文件替代。

### 6.3 工程质量补项

- Electron Runner 负例只断言“非零”，超时、Spawn Error 或前一用例遗留的坏 Artifact 都能让后续用例因错误原因通过。各反例应隔离 Artifact，断言精确 exit 1、未超时并命中特定失败步骤；恢复后必须重打包并先证明正常路径 exit 0。
- Browser Extension 构建脚本直接加载 Desktop 私有 `node_modules/esbuild`，形成未声明的跨 App 构建依赖；应在 Extension 自身声明构建依赖或抽为正式共享工具包。
- CDP `send()` 无单请求 Deadline，Socket 关闭也不会 Reject Pending 请求；总超时在发现 Service Worker 后提前清除，存在永久挂起与遗留 Chrome 进程风险。

### 6.4 第五次复验最小范围

1. 提交真实 Node 24 三平台 CI Run / Artifact / SHA 证据，并证明每个 Matrix Job 验证的是对应架构 Artifact。
2. Chrome Smoke 对 Popup 与 Service Worker 的 Runtime/Log 错误闭环；注入错误但保留 Ready 的反例必须非零。
3. Symlink 反例必须在夹具真实存在的前提下通过；Electron Runner 反例不得因 Timeout、Spawn Error 或遗留坏包假绿。

以上三项完成前，不得进入 S1 / GLM-M0-02。
