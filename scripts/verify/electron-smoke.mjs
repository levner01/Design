#!/usr/bin/env node
/**
 * Electron Packaged Artifact Ready Smoke。
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
 * 第五次整改 §C：Runner 级负例真实性
 * - 测试模式注入接口（双开关限制，生产不可用）：
 *   DESIGNWAN_SMOKE_MODE === '1' + DESIGNWAN_SMOKE_TEST_COMMAND 存在时，
 *   用注入的 command/args 代替真实 packaged app，跳过打包。
 *   用于跨平台 Fixture（Node.js 脚本），不用 Unix shell 脚本当 Windows .exe。
 *
 * 第五次整改 §D：CI Matrix 与 Artifact 一一对应
 * - --artifact=<path>：精确指定 packaged artifact 路径，避免选错架构。
 *   CI 每 Job 清理 release 后只生成目标架构，Smoke 用 --no-repackage --artifact=<path>。
 *
 * S0 验收模式禁止通过 DISABLE_ELECTRON_SMOKE 跳过。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const desktopDir = join(root, 'apps/desktop');
const releaseDir = join(desktopDir, 'release');

banner('electron-packaged-ready-smoke (M0-01 R5)');

// S0 验收模式禁止跳过
if (process.env.DISABLE_ELECTRON_SMOKE === '1') {
  console.error('[FAIL] DISABLE_ELECTRON_SMOKE is forbidden in S0 acceptance mode');
  process.exit(1);
}

// ── 测试模式注入接口（第五次整改 §C）─────────────────────
// 双开关限制：必须同时满足 SMOKE_MODE === '1' 和 TEST_COMMAND 存在
// 生产环境（SMOKE_MODE !== '1'）完全不受影响，无法被环境变量注入故障
const testCommand = process.env.DESIGNWAN_SMOKE_TEST_COMMAND;
const isTestMode = !!testCommand && process.env.DESIGNWAN_SMOKE_MODE === '1';
let testArgs = [];
if (isTestMode) {
  try {
    testArgs = process.env.DESIGNWAN_SMOKE_TEST_ARGS
      ? JSON.parse(process.env.DESIGNWAN_SMOKE_TEST_ARGS)
      : [];
    if (!Array.isArray(testArgs)) {
      throw new Error('DESIGNWAN_SMOKE_TEST_ARGS must be a JSON array');
    }
  } catch (e) {
    step('parse DESIGNWAN_SMOKE_TEST_ARGS', false, e.message);
    process.exit(1);
  }
}

// ── --artifact：精确指定 packaged artifact 路径（第五次整改 §D）──
const artifactArg = process.argv.find((a) => a.startsWith('--artifact='));
// CLI paths are repo-relative by contract. Resolve once here so a later cwd change
// cannot accidentally duplicate a relative path (the R5 CI ENOENT regression).
const explicitArtifact = artifactArg
  ? resolve(root, artifactArg.slice('--artifact='.length))
  : null;

// ── 按 process.arch 选择 unpacked app ─────────────────────
function findUnpackedApp() {
  // 精确指定 artifact 路径（CI Matrix 用，避免选错架构）
  if (explicitArtifact) {
    if (!existsSync(explicitArtifact)) {
      step(`explicit artifact exists`, false, explicitArtifact);
      return null;
    }
    step(`use explicit artifact`, true, explicitArtifact);
    return { exe: explicitArtifact, appPath: dirname(explicitArtifact), arch: 'explicit' };
  }

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
  if (explicitArtifact) {
    // --artifact 已在 findUnpackedApp 中处理
    const app = findUnpackedApp();
    if (!app) {
      step(`find explicit artifact`, false, explicitArtifact);
      process.exit(1);
    }
    return app;
  }

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
  let spawnTarget;
  let spawnCwd;
  let spawnArgs = [];

  if (isTestMode) {
    // 测试模式：用注入的 command/args 代替真实 packaged app
    // 用于 runner 级失败测试（exit 0、exit 1、timeout、sentinel corrupted 等）
    // 跨平台：用 Node.js 脚本作为 fake exe，不用 Unix shell 脚本
    step(
      'test mode: use injected command (SMOKE_MODE required)',
      true,
      `${testCommand} ${testArgs.join(' ')}`,
    );
    spawnTarget = testCommand;
    spawnCwd = process.cwd();
    spawnArgs = testArgs;
  } else {
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

    // 3. 强制重新打包（或用精确 artifact 路径，或用 --no-repackage 跳过）
    const app = ensurePackaged();
    spawnTarget = app.exe;
    spawnCwd = dirname(app.exe);
  }

  // 4. 创建专用临时目录 + sentinel 文件路径（满足 main 的路径安全校验）
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const sentinelFile = join(smokeDir, 'sentinel.json');
  rmSync(sentinelFile, { force: true });

  // 5. 启动 packaged app + 立即注册 error/exit/close
  const requestedTestTimeout = Number(process.env.DESIGNWAN_SMOKE_TEST_TIMEOUT_MS);
  const SMOKE_TIMEOUT_MS =
    isTestMode && Number.isFinite(requestedTestTimeout) && requestedTestTimeout >= 250
      ? requestedTestTimeout
      : 30000;
  let stderrOutput = '';
  let invalidSentinelObserved = false;
  let recoveredSentinelContent = null;
  let stopPolling = false;

  const child = spawn(spawnTarget, spawnArgs, {
    cwd: spawnCwd,
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
    while (!stopPolling && Date.now() - pollStart < SMOKE_TIMEOUT_MS) {
      if (existsSync(sentinelFile)) {
        try {
          return { kind: 'sentinel', content: JSON.parse(readFileSync(sentinelFile, 'utf8')) };
        } catch {
          // 文件可能还在写入中；记录证据并继续轮询。若进程随后退出，
          // 该证据会稳定归类为 SENTINEL_CORRUPT，而不是笼统 early exit。
          invalidSentinelObserved = true;
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
  stopPolling = true;

  // 进程可能在轮询器第一次读取前就写坏 sentinel 并退出；同步补采证据。
  if (raceResult.kind !== 'sentinel' && existsSync(sentinelFile)) {
    try {
      recoveredSentinelContent = JSON.parse(readFileSync(sentinelFile, 'utf8'));
    } catch {
      invalidSentinelObserved = true;
    }
  }

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
  const sentinelContent =
    raceResult.kind === 'sentinel' ? raceResult.content : recoveredSentinelContent;
  const earlyExit =
    raceResult.kind === 'exit' || raceResult.kind === 'close' || raceResult.kind === 'error';
  const timedOut = raceResult.kind === 'timeout';
  const spawnError = raceResult.kind === 'error';

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
  step('no timeout (sentinel received within deadline)', !timedOut, timedOut ? 'timeout' : '');
  step('no spawn error', !spawnError, spawnError ? String(raceResult.err?.message) : '');
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
    !timedOut &&
    !spawnError &&
    foundFatal.length === 0 &&
    sentinelContent?.ok === true &&
    sentinelContent?.readyState === 'complete' &&
    sentinelContent?.hasBridge === true &&
    sentinelContent?.negotiate?.result?.ok === true &&
    sentinelContent?.negotiate?.result?.value?.protocol === '0.1.0' &&
    sentinelContent?.negotiate?.result?.value?.app === '0.0.0';

  if (ok) {
    console.log('electron-packaged-ready-smoke: PASS');
    process.exitCode = 0;
    return;
  } else {
    let reasonCode = 'ELECTRON_SMOKE_VALIDATION_FAILED';
    if (spawnError) {
      reasonCode = 'ELECTRON_SMOKE_SPAWN_ERROR';
    } else if (invalidSentinelObserved) {
      reasonCode = 'ELECTRON_SMOKE_SENTINEL_CORRUPT';
    } else if (sentinelContent?.negotiate?.result?.ok === false) {
      reasonCode = 'ELECTRON_SMOKE_NEGOTIATE_FAILED';
    } else if (
      sentinelContent?.hasBridge === false ||
      /preload bridge missing/i.test(sentinelContent?.error || '')
    ) {
      reasonCode = 'ELECTRON_SMOKE_PRELOAD_MISSING';
    } else if (/did-fail-load|ERR_FILE_NOT_FOUND/i.test(sentinelContent?.error || '')) {
      reasonCode = 'ELECTRON_SMOKE_RENDERER_LOAD_FAILED';
    } else if (timedOut) {
      reasonCode = 'ELECTRON_SMOKE_TIMEOUT';
    } else if (earlyExit) {
      reasonCode = 'ELECTRON_SMOKE_EARLY_EXIT';
    } else if (foundFatal.length > 0) {
      reasonCode = 'ELECTRON_SMOKE_FATAL_STDERR';
    } else if (sentinelContent?.ok !== true) {
      reasonCode = 'ELECTRON_SMOKE_SENTINEL_REJECTED';
    }
    console.log(`REASON_CODE: ${reasonCode}`);
    console.log('electron-packaged-ready-smoke: FAIL');
    process.exitCode = 1;
    return;
  }
}

main().catch((e) => {
  console.log('REASON_CODE: ELECTRON_SMOKE_INTERNAL_ERROR');
  console.error('[smoke] fatal:', e);
  process.exitCode = 1;
});
