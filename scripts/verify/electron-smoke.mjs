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
 * 超时、提前退出、Renderer Error、Preload Error、IPC 失败、版本不一致 → exit 1。
 * S0 验收模式禁止通过 DISABLE_ELECTRON_SMOKE 跳过。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs';
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

// ── 找 unpacked app 可执行文件 ──────────────────────────
function findUnpackedApp() {
  if (process.platform === 'darwin') {
    // release/mac-arm64/DesignWan.app 或 release/mac-x64/
    const dirs = ['mac-arm64', 'mac', 'mac-x64'];
    for (const d of dirs) {
      const appPath = join(releaseDir, d, 'DesignWan.app');
      const exe = join(appPath, 'Contents', 'MacOS', 'DesignWan');
      if (existsSync(exe)) return { exe, appPath };
    }
    return null;
  }
  if (process.platform === 'win32') {
    const exe = join(releaseDir, 'win-unpacked', 'DesignWan.exe');
    if (existsSync(exe)) return { exe, appPath: dirname(exe) };
    return null;
  }
  // Linux: release/linux-unpacked/designwan
  const exe = join(releaseDir, 'linux-unpacked', 'designwan');
  if (existsSync(exe)) return { exe, appPath: dirname(exe) };
  return null;
}

// ── 打包 unpacked app（如果不存在或 dist 更新） ──────────
async function ensurePackaged() {
  const existing = findUnpackedApp();
  const distMain = join(desktopDir, 'dist', 'main', 'index.js');
  const distMtime = existsSync(distMain) ? statSync(distMain).mtimeMs : 0;

  if (existing) {
    const asarPath = join(
      existing.appPath,
      process.platform === 'darwin' ? join('Contents', 'Resources', 'app.asar') : 'resources',
    );
    const appMtime = existsSync(asarPath) ? statSync(asarPath).mtimeMs : 0;
    if (appMtime >= distMtime) {
      step('unpacked app exists and up-to-date', true);
      return existing;
    }
  }

  step('packaging unpacked app (electron-builder --dir)', true);
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
    step('find unpacked app after build', false, 'no app found in release/');
    process.exit(1);
  }
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

  // 3. 确保 unpacked app 存在
  const app = await ensurePackaged();

  // 4. 创建 sentinel 文件路径
  const sentinelFile = join(tmpdir(), `designwan-smoke-${process.pid}-${Date.now()}.json`);
  rmSync(sentinelFile, { force: true });

  // 5. 启动 packaged app
  const SMOKE_TIMEOUT_MS = 30000;
  let stderrOutput = '';
  let exited = false;
  let sentinelContent = null;

  const child = spawn(app.exe, [], {
    cwd: dirname(app.exe),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_SENTINEL: sentinelFile,
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
    },
    timeout: SMOKE_TIMEOUT_MS,
  });

  const timeoutHandle = setTimeout(() => {
    if (!exited) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 3000);
    }
  }, SMOKE_TIMEOUT_MS);

  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  // 6. 轮询 sentinel 文件
  const pollStart = Date.now();
  while (!sentinelContent && Date.now() - pollStart < SMOKE_TIMEOUT_MS && !exited) {
    if (existsSync(sentinelFile)) {
      try {
        sentinelContent = JSON.parse(readFileSync(sentinelFile, 'utf8'));
      } catch {
        // 文件可能还在写入中，继续轮询
      }
    }
    if (!sentinelContent && !exited) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 等待进程退出
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (exited) return;
      exited = true;
      clearTimeout(timeoutHandle);
      resolve({ code, signal });
    });
    // 如果已经收到 sentinel，主动 kill
    if (sentinelContent) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 3000);
    }
  });

  // 7. 验证结果
  const fatalErrors = [
    'ERR_FILE_NOT_FOUND',
    'SyntaxError',
    'Cannot use import statement',
    'Error: Cannot find module',
    'Electron failed to install',
  ];
  const foundFatal = fatalErrors.filter((e) => stderrOutput.includes(e));

  step('no fatal errors in stderr', foundFatal.length === 0, foundFatal.join(', ') || '');
  step('sentinel file received', sentinelContent !== null, sentinelContent ? '' : 'timeout');

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

  // 清理 sentinel 文件
  rmSync(sentinelFile, { force: true });

  if (stderrOutput.trim()) {
    console.log('stderr (first 800 chars):');
    console.log(stderrOutput.slice(0, 800));
  }

  console.log('==============================================================');
  const ok =
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
