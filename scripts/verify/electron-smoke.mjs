#!/usr/bin/env node
/**
 * Electron 启动 smoke 测试。
 *
 * 启动 Electron Desktop，等待窗口创建，检查 stderr 无 fatal error，然后退出。
 * 防止 build 通过但运行时 ERR_FILE_NOT_FOUND 或 Preload SyntaxError。
 *
 * 退出码：0 = 启动成功；1 = 启动失败或超时。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const desktopDir = join(root, 'apps/desktop');
// pnpm workspace: desktop devDeps 安装在子包 node_modules/.bin，不在根
const electronBin = join(desktopDir, 'node_modules/.bin/electron');

banner('electron-startup-smoke (M0-01)');

// 前置检查：electron 二进制是否存在
if (!existsSync(electronBin)) {
  step('electron binary exists', false, 'electron not installed');
  process.exit(1);
}
step('electron binary exists', true);

// 前置检查：dist 产物是否存在
const mainJs = join(desktopDir, 'dist/main/index.js');
if (!existsSync(mainJs)) {
  step('dist/main/index.js exists', false, 'run build first');
  process.exit(1);
}
step('dist/main/index.js exists', true);

const SMOKE_TIMEOUT_MS = 8000;
let stderrOutput = '';
let exited = false;

const exitCode = await new Promise((resolve) => {
  const child = spawn(electronBin, ['.'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // CI 环境无显示器时使用 offscreen rendering
      ELECTRON_DISABLE_GPU: '1',
    },
    timeout: SMOKE_TIMEOUT_MS,
  });

  const timeoutHandle = setTimeout(() => {
    if (!exited) {
      child.kill('SIGTERM');
      // 给 SIGTERM 2 秒宽限期
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 2000);
    }
  }, SMOKE_TIMEOUT_MS);

  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  child.on('error', (err) => {
    if (exited) return;
    exited = true;
    clearTimeout(timeoutHandle);
    step('electron started without spawn error', false, err.message);
    console.log('==============================================================');
    console.log('electron-startup-smoke: FAIL');
    resolve(1);
  });

  child.on('exit', (code, signal) => {
    if (exited) return;
    exited = true;
    clearTimeout(timeoutHandle);

    // 检查 stderr 中是否有致命错误
    const fatalErrors = [
      'ERR_FILE_NOT_FOUND',
      'SyntaxError',
      'Cannot use import statement',
      'Error: Cannot find module',
      'Electron failed to install',
    ];
    const foundFatal = fatalErrors.filter((e) => stderrOutput.includes(e));

    // 如果进程是被 SIGTERM/SIGKILL 杀掉的（超时），说明没有立即崩溃
    const killedByTimeout = signal === 'SIGTERM' || signal === 'SIGKILL';
    const ok = foundFatal.length === 0 && (killedByTimeout || code === 0);

    step('no fatal errors in stderr', foundFatal.length === 0, foundFatal.join(', ') || '');
    step('process did not crash immediately', ok, `code=${code} signal=${signal}`);

    if (stderrOutput.trim()) {
      console.log('stderr (first 500 chars):');
      console.log(stderrOutput.slice(0, 500));
    }

    console.log('==============================================================');
    if (ok) {
      console.log('electron-startup-smoke: PASS');
      resolve(0);
    } else {
      console.log('electron-startup-smoke: FAIL');
      resolve(1);
    }
  });
});
process.exit(exitCode);
