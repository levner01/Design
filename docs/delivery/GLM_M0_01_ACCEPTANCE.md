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

## 7. 第五次复验：`61810cd`

复验固定点：`dda2abdaad640f7e28cf0e819ff13f95e997bb9e`

复验交付点：`61810cdff4a587892340c5e89c8891a906e123a9`

复验结论：`REJECT（BLOCKED: REMOTE_REQUIRED + LOCAL_FIX_REQUIRED）`

### 7.1 已修复并通过

- Node 24.18.0 + pnpm 11.13.1 下，Frozen Install、TypeScript 强制检查、九 Workspace 无缓存 Build 与完整 `verify:quick` 均 exit 0；十五项本地门禁报告 PASS。
- Popup 已改为先创建 `about:blank` Target，附着并启用 Page/Runtime/Log 后再导航；Popup Ready 后 `console.error` 与延迟 Service Worker `throw` 反例当前均能触发非零。
- CDP 单请求 Deadline、Socket 关闭时 Reject Pending、Popup/SW 分 Session 错误汇总和 Browser.close 清理已实现。
- Sentinel 测试不再删除预置 Symlink，已覆盖指向不存在及已存在外部文件的真实链接夹具；App 端增加 `lstat` 拒绝 Symlink。
- Electron Runner 已使用 Node 脚本 Fixture 替代伪装成 `.exe` 的 Shell，并开始断言精确 exit 1。
- Browser Extension 已自行声明 `esbuild`，不再穿透 Desktop 私有依赖。

### 7.2 阻塞项

#### P0：真实 Node 24 三平台 CI Run / Artifact 仍未交付

`git remote -v` 仍为空；仓库没有 Run URL、同一交付 SHA 的三个 Job 结论、Artifact 文件清单、实际架构和下载验证。未跟踪的 `第五轮整改.md` 是任务提示词，不是交付报告。Workflow 声明不能替代真实运行证据。

修复要求：配置可运行 Remote，在同一交付 SHA 上完成 macOS arm64、macOS x64、Windows x64 三个 Node 24 Job，并交付 Run URL、Job/Artifact/SHA/架构/下载证据。完成前必须保持 `BLOCKED: REMOTE_REQUIRED`。

#### P1：CI 的“精确 Artifact”相对路径会让 Smoke 从错误目录启动

Workflow 的 Artifact Resolver 输出 `apps/desktop/release/...` 相对路径；`electron-smoke.mjs` 原样把该字符串作为 Spawn Command，同时将 `cwd` 设置为该相对路径的父目录，导致命令路径被重复拼接。按 CI 当前传参方式实测：Artifact 前置检查 PASS，随后 `spawn ... ENOENT`，Smoke exit 1。因此当前三平台 Job 即使获得 Remote 也无法通过。

修复要求：CLI 收到 Artifact 参数后立即基于 Repo Root 解析为绝对路径，CI 也应输出绝对路径；增加“从仓库根传入相对路径仍真实启动成功”的回归测试。

#### P1：Service Worker 附着失败不影响最终 PASS

十次 `Target.attachToTarget` 全失败时仅输出失败步骤，没有设置 `flowError`；最终 `ok` 不要求 `swAttached` 或独立 `swSessionId`。`swSessionId === null` 时还会把 Browser Bucket 当作 SW Summary，形成错误证据归属。

修复要求：SW 附着和 Runtime/Log Enable 必须是硬门；失败时输出唯一 Reason Code 并明确 exit 1；未建立独立 SW Session 时禁止生成 SW PASS 结论。最终条件必须包含 `swAttached && swSessionId !== null && !isOverdue()`。

#### P1：反例仍可因无关失败原因通过

- Electron Runner 多个原因正则仍包含通用 `FAIL`，而 Helper 已提前断言存在 `FAIL`；损坏 Sentinel 甚至接受 Early Exit 或 Timeout，未证明识别了坏 JSON。
- Popup/SW 反例接受 `console.error`、`exceptionThrown` 等固定步骤文字，而正常的 `no console.error` / `no Runtime.exceptionThrown` 行本身就包含这些词。
- `runSmoke()` 没有返回并断言 `spawnSync().error`；HTML 和 Preload 夹具恢复后也没有分别立即重打包并证明正向 exit 0。

修复要求：为每个失败场景输出唯一 Reason Code，反例精确匹配注入 Marker 所在 Session 的错误证据；删除所有 `|FAIL` 兜底和固定步骤名匹配；每个夹具恢复后立即执行正向 Smoke。

#### P1：Symlink 测试没有证明 App 明确拒绝

测试读端对任何 Symlink 都固定返回 `null`，最终又以 `sentinelContent === null` 作为“App 拒绝”证据。即使 App 没执行 `lstat` 拒绝逻辑，该测试仍会通过；目前只证明外部文件未改写，没有验证拒绝分支被命中。

修复要求：Helper 收集 stderr 与退出状态，精确断言 App 输出 Symlink 拒绝 Reason/Marker；或通过正式 Smoke Runner 断言专用非零结果。不能用读端主动忽略链接代替 App 拒绝证据。

#### P1：Windows x64 与跨平台门仍不成立

- Windows 架构正则接受 `80386`，32 位 PE 也会被标记为 x64；所谓“无其他架构旧产物”只有 `ls`，没有失败断言。
- Chrome Early Exit Fixture 仍创建 POSIX `#!/bin/sh` 文件；Windows Job 无法把它作为 Chrome Executable 运行，Chrome Spawn 也没有受控 `error` Listener。
- Chrome Smoke 内部总 Deadline 与 `verify:quick` 外层 Timeout 同为 60 秒，慢速 CI 可能在 Browser.close/Profile 清理前被外层直接杀死。

修复要求：Windows 精确校验 PE32+ 与 AMD64/x86-64，并显式拒绝 80386；Release 使用可失败白名单；Chrome Fixture 改用 `process.execPath + .cjs` 并捕获 Spawn Error；外层 Timeout 必须覆盖内层最坏时间和清理预算。

### 7.3 第六次复验最小范围

1. 修复相对 Artifact 路径，提交能真实启动精确 Artifact 的回归证据。
2. SW 附着成为硬门；所有 Popup/SW/Electron/Symlink 反例使用唯一 Reason Code，不能依赖通用文字假绿。
3. Windows x64 架构、跨平台 Chrome Fixture、Release 白名单与 Deadline 闭环。
4. 提交同一 SHA 的真实 Node 24 三平台 CI Run / Artifact / 下载证据。

上述四项完成前，不得进入 S1 / GLM-M0-02。

## 8. Codex 本地整改：`cbaeca1`

整改固定点：`8be773640f0b649fd6a016e99cbd64a4ce77814b`

整改交付点：`cbaeca129b210070b42ddaa2b47e8bcb12a796ba`

整改结论：`LOCAL PASS；S0 BLOCKED: REMOTE_AUTH_REQUIRED`

### 8.1 本地整改结果

- `--artifact` 统一解析为绝对路径；Runner 已增加从仓库根传入相对 Artifact 并真实启动成功的回归测试。
- Electron Smoke 为 Spawn Error、提前退出、超时、损坏 Sentinel、negotiate 失败、Renderer 加载失败和 Preload 缺失输出唯一 Reason Code；负例精确断言 exit 1、Reason Code、无 `spawnSync.error`，每个夹具后执行正向恢复证明。
- Service Worker Attach、Runtime Enable、Log Enable 和独立 Session 成为 Chrome Smoke 硬门；未附着不再使用 Browser Bucket 冒充 SW 证据。
- Popup/SW 反例精确匹配 `[popup]` / `[sw]` 注入 Marker；Chrome Early Exit 改为 `process.execPath + .cjs` 跨平台 Fixture，并覆盖受控 Spawn Error。
- Chrome 增加总 Deadline 主动中断和统一 `finally` 清理；`verify:quick` 外层 Timeout 已包含内层执行与清理预算。
- Sentinel Symlink 测试收集 stderr，并精确断言 App 的 `SENTINEL_SYMLINK_REJECTED` 证据；Helper 等待 Electron `close` 后才进入下一用例。
- CI 使用当前 GitHub Runner 标签 `macos-15`、`macos-15-intel`、`windows-latest`；Artifact Resolver 输出绝对唯一路径，Windows x64 明确要求 PE32+ AMD64 并拒绝 80386，Release 目录执行可失败白名单。

### 8.2 验证证据

验证环境：Node 24.18.0；pnpm 11.13.1；macOS arm64。

- `pnpm install --frozen-lockfile`：exit 0。
- `pnpm exec tsc -b --force`：exit 0。
- `pnpm exec turbo run build --force`：9/9 Workspace、0 cache、exit 0。
- `pnpm verify:quick`：15/15 门禁 PASS、exit 0。
- Electron Runner 包含相对 Artifact 真启动、四类跨平台 Fixture、negotiate/HTML/Preload 失败和正向恢复，整套 PASS。
- Chrome Extension 九项正反例整套 PASS；Popup/SW Marker、Early Exit 和 Spawn Error 均命中专用 Reason Code。
- Sentinel 路径安全整套 PASS；两个真实 Symlink 场景均命中 App 拒绝证据。

### 8.3 唯一剩余阻塞

仓库仍无 Git Remote，且 `gh auth status` 显示 GitHub 账号 `levner01` 的 Token 已失效。本地代码和 CI 门已完成，但无法在没有远端与有效授权的情况下生成真实 macOS arm64、macOS x64、Windows x64 Run / Artifact / 下载证据。

解除条件：重新执行 `gh auth login -h github.com`，创建或绑定目标 GitHub Repository，Push `cbaeca1` 之后的最终交付 SHA，并等待三平台 Job 与 Artifact 全部通过。完成前 S0 不得标记为最终 PASS，也不得进入 M0-02。
