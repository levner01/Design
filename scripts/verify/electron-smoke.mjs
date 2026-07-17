#!/usr/bin/env node
/**
 * Electron Packaged Artifact Ready Smoke.
 *
 * 启动 electron-builder 生成的 Unpacked App（不是 `electron .` 源码目录），
 * 通过 Main 进程的 Sentinel 文件获取正向 Ready 证据：
 *   - document.readyState === 'complete'
 *   - Preload Bridge 存在（window.designwan）
 *   - negotiate() 成功
 *   - Protocol / App Version 符合 Contract
 *
 * 第四次复验 §5.2 修复：
 * - spawn 后立即注册 error/exit/close，用 Promise.race 竞争
 *   sentinel/提前退出/spawn error/timeout，没有完整 sentinel 一律 exit 1
 * - Artifact 按 process.arch 选择，不固定优先 mac-arm64
 * - 强制重新生成 artifact，不只比较 main/index.js mtime
 * - Sentinel 路径必须在 <tmpdir>/designwan-smoke-* 专用临时目录
 *
 * S0 验收模式禁止通过 DISABLE_ELECTRON_SMOKE 跳过。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const desktopDir = join(root, 'apps/desktop');
const releaseDir = join(desktopDir, 'release');

banner('electron-packaged-ready-smoke (M0-01)');

// S0 验收模式禁止跳过
if (process.env.DISABLE_ELECTRON_SMOKE === '1') {
  console.error('[FAIL] DISABLE_ELECTRON_SMOKE is forbidden in S0 acceptance mode');
  process.exit(1);
}

// ── 按 process.arch 选择 unpacked app ─────────────────────
function findUnpackedApp() {
  if (process.platform === 'darwin') {
    // arm64 只选 mac-arm64，x64 只选 mac-x64/mac
    const archDirs =
      process.arch === 'arm64' ? ['mac-arm64'] : process.arch === 'x64' ? ['mac-x64', 'mac'] : [];
    for (const d of archDirs) {
      const appPath = join(releaseDir, d, 'DesignWan.app');
      const exe = join(appPath, 'Contents', 'MacOS', 'DesignWan');
      if (existsSync(exe)) return { exe, appPath, arch: d };
    }
    return null;
  }
  if (process.platform === 'win32') {
    const exe = join(releaseDir, 'win-unpacked', 'DesignWan.exe');
    if (existsSync(exe)) return { exe, appPath: dirname(exe), arch: 'x64' };
    return null;
  }
  // Linux: release/linux-unpacked/designwan
  const exe = join(releaseDir, 'linux-unpacked', 'designwan');
  if (existsSync(exe)) return { exe, appPath: dirname(exe), arch: process.arch };
  return null;
}

// ── 强制重新打包 unpacked app ─────────────────────────────
// --no-repackage: runner 级测试用，跳过打包以注入假 exe 测试提前退出
const skipRepackage = process.argv.includes('--no-repackage');

function ensurePackaged() {
  if (skipRepackage) {
    const existing = findUnpackedApp();
    if (!existing) {
      step(`find unpacked app for arch=${process.arch}`, false, 'no app found (--no-repackage)');
      process.exit(1);
    }
    step(`use existing unpacked app (${existing.arch}, --no-repackage)`, true);
    return existing;
  }

  step('packaging unpacked app (electron-builder --dir, forced)', true);
  try {
    const electronBuilder = join(desktopDir, 'node_modules/.bin/electron-builder');
    execFileSync(electronBuilder, ['--dir', '--publish', 'never'], {
      cwd: desktopDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        ELECTRON_DISABLE_GPU: '1',
      },
      timeout: 120000,
    });
  } catch (e) {
    step('electron-builder --dir', false, e?.message || String(e));
    process.exit(1);
  }

  const app = findUnpackedApp();
  if (!app) {
    step(`find unpacked app for arch=${process.arch}`, false, 'no app found in release/');
    process.exit(1);
  }
  step(`unpacked app ready (${app.arch})`, true);
  return app;
}

// ── 主流程 ──────────────────────────────────────────────
async function main() {
  // 1. 前置检查：electron 二进制
  const electronBin = join(desktopDir, 'node_modules/.bin/electron');
  if (!existsSync(electronBin)) {
    step('electron binary exists', false, 'electron not installed');
    process.exit(1);
  }
  step('electron binary exists', true);

  // 2. 前置检查：dist 产物
  const mainJs = join(desktopDir, 'dist/main/index.js');
  if (!existsSync(mainJs)) {
    step('dist/main/index.js exists', false, 'run build first');
    process.exit(1);
  }
  step('dist/main/index.js exists', true);

  // 3. 强制重新打包（不复用旧 artifact，避免 stale 假绿）
  const app = ensurePackaged();

  // 4. 创建专用临时目录 + sentinel 文件路径（满足 main 的路径安全校验）
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const sentinelFile = join(smokeDir, 'sentinel.json');
  rmSync(sentinelFile, { force: true });

  // 5. 启动 packaged app + 立即注册 error/exit/close
  const SMOKE_TIMEOUT_MS = 30000;
  let stderrOutput = '';

  const child = spawn(app.exe, [], {
    cwd: dirname(app.exe),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: sentinelFile,
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
    },
  });

  // 立即注册 error/exit/close，避免事件丢失（§5.2 根因）
  const exitPromise = new Promise((resolve) => {
    child.on('error', (err) => resolve({ kind: 'error', err }));
    child.on('exit', (code, signal) => resolve({ kind: 'exit', code, signal }));
    child.on('close', (code, signal) => resolve({ kind: 'close', code, signal }));
  });

  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  // 6. Promise.race 竞争：sentinel / 提前退出 / spawn error / timeout
  const sentinelPromise = (async () => {
    const pollStart = Date.now();
    while (Date.now() - pollStart < SMOKE_TIMEOUT_MS) {
      if (existsSync(sentinelFile)) {
        try {
          return { kind: 'sentinel', content: JSON.parse(readFileSync(sentinelFile, 'utf8')) };
        } catch {
          // 文件可能还在写入中，继续轮询
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { kind: 'timeout' };
  })();

  let timeoutTimer = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutTimer = setTimeout(() => resolve({ kind: 'timeout' }), SMOKE_TIMEOUT_MS);
  });

  const raceResult = await Promise.race([sentinelPromise, exitPromise, timeoutPromise]);

  // 7. 收到 sentinel 或超时后，确保子进程退出
  if (raceResult.kind === 'sentinel' || raceResult.kind === 'timeout') {
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
    // 给进程 3s 优雅退出，否则 SIGKILL
    await new Promise((r) => setTimeout(r, 100));
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    } catch {
      // 已退出
    }
  }

  // 等待 exit/close 事件最终触发（最多 3s），避免 zombie
  await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]);

  // 清理 timeout timer
  if (timeoutTimer) clearTimeout(timeoutTimer);

  // 8. 验证结果
  const sentinelContent = raceResult.kind === 'sentinel' ? raceResult.content : null;
  const earlyExit =
    raceResult.kind === 'exit' || raceResult.kind === 'close' || raceResult.kind === 'error';

  const fatalErrors = [
    'ERR_FILE_NOT_FOUND',
    'SyntaxError',
    'Cannot use import statement',
    'Error: Cannot find module',
    'Electron failed to install',
  ];
  const foundFatal = fatalErrors.filter((e) => stderrOutput.includes(e));

  step('no fatal errors in stderr', foundFatal.length === 0, foundFatal.join(', ') || '');
  step(
    'no early exit (sentinel received before exit)',
    !earlyExit,
    earlyExit ? `early ${raceResult.kind}` : '',
  );
  step('sentinel file received', sentinelContent !== null, sentinelContent ? '' : raceResult.kind);

  if (sentinelContent) {
    step(
      'sentinel.ok === true',
      sentinelContent.ok === true,
      sentinelContent.ok ? '' : sentinelContent.error || '',
    );
    if (sentinelContent.ok) {
      step(
        'readyState === complete',
        sentinelContent.readyState === 'complete',
        sentinelContent.readyState,
      );
      step('hasBridge === true', sentinelContent.hasBridge === true);
      const neg = sentinelContent.negotiate?.result;
      step('negotiate.result.ok === true', neg?.ok === true, neg ? '' : 'missing');
      if (neg?.ok) {
        step('protocol === 0.1.0', neg.value.protocol === '0.1.0', neg.value.protocol);
        step('app === 0.0.0', neg.value.app === '0.0.0', neg.value.app);
      }
    }
  }

  // 清理
  rmSync(smokeDir, { force: true, recursive: true });

  if (stderrOutput.trim()) {
    console.log('stderr (first 800 chars):');
    console.log(stderrOutput.slice(0, 800));
  }

  console.log('==============================================================');
  const ok =
    !earlyExit &&
    foundFatal.length === 0 &&
    sentinelContent?.ok === true &&
    sentinelContent?.readyState === 'complete' &&
    sentinelContent?.hasBridge === true &&
    sentinelContent?.negotiate?.result?.ok === true &&
    sentinelContent?.negotiate?.result?.value?.protocol === '0.1.0' &&
    sentinelContent?.negotiate?.result?.value?.app === '0.0.0';

  if (ok) {
    console.log('electron-packaged-ready-smoke: PASS');
    process.exit(0);
  } else {
    console.log('electron-packaged-ready-smoke: FAIL');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[smoke] fatal:', e);
  process.exit(1);
});
