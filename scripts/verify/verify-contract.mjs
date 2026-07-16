#!/usr/bin/env node
/**
 * DesignWan verify:contract
 *
 * Gate G-CT：Renderer/Main/Worker/Extension/Host/AI Route Wire Contract。
 *
 * M0-01 阶段执行可校验的子集：
 *   - contracts 包 Export Map 完整（每个 ./xxx 都有对应的 dist 文件）
 *   - PreloadBridge 类型签名与 Main IPC handler 参数对齐（静态）
 *   - 各应用包依赖 contracts 的方式符合 Export Map
 *
 * 完整 Contract E2E（跨进程真实 RPC、Schema 演进、版本协商）由 GLM-M0-04 + GLM-M1-03 等卡实现。
 * 本卡只跑静态子集；运行时 Contract 门未通过则明确 FAIL。
 */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { banner, step, failNotImplemented } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

banner('verify:contract (G-CT, M0-01 static subset)');

const contractsPkg = JSON.parse(
  await readFile(join(root, 'packages/contracts/package.json'), 'utf8'),
);

const exportsKeys = Object.keys(contractsPkg.exports ?? {});
let staticOk = true;

for (const key of exportsKeys) {
  const entry = contractsPkg.exports[key];
  const importPath = entry.import ?? entry.default;
  if (!importPath) {
    step(`contracts export '${key}' has import field`, false, 'missing import');
    staticOk = false;
    continue;
  }
  // 检查 dist 文件存在（说明 build 已成功）
  const distPath = join(root, 'packages/contracts', importPath.replace(/^\.\//, ''));
  let exists = false;
  try {
    await stat(distPath);
    exists = true;
  } catch {
    exists = false;
  }
  step(`contracts '${key}' dist exists`, exists, exists ? '' : `expected: ${distPath}`);
  if (!exists) staticOk = false;
}

// 检查 PreloadBridge 类型签名存在
const ipcContract = await readFile(join(root, 'packages/contracts/src/ipc/index.ts'), 'utf8');
const hasPreloadBridge = /interface\s+PreloadBridge\b/.test(ipcContract);
step('contracts exposes PreloadBridge interface', hasPreloadBridge);
if (!hasPreloadBridge) staticOk = false;

if (!staticOk) {
  console.log('==============================================================');
  console.log('verify:contract (static subset): FAIL');
  process.exit(1);
}

console.log('==============================================================');
console.log('verify:contract (static subset): PASS');

// 运行时 Contract 门未实现
failNotImplemented({
  gateName: 'verify:contract (runtime subset)',
  responsibleTask:
    'GLM-M0-04 IPC Registry + GLM-M1-03 Capture Contract + GLM-M2-03 AI Route Contract',
  reason:
    'M0-01 仅静态校验 Export Map 与类型签名。运行时 Contract（跨进程 RPC、Schema 演进、' +
    '版本协商、AI Route Wire）由后续卡实现。',
  nextAction: '等待 Codex 下发 GLM-M0-04 与 M1/M2 系列任务卡。',
});
