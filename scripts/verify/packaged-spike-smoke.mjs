#!/usr/bin/env node
/**
 * M0-02 02-E：Packaged Spike Smoke
 *
 * spawn 真实 Electron Packaged App，设置双开关环境变量，
 * 等待 Spike Sentinel 文件出现，解析结构化 JSON 结果。
 *
 * 用法：
 *   node scripts/verify/packaged-spike-smoke.mjs --artifact=<path-to-executable>
 *
 * 双开关：
 *   - DESIGNWAN_SPIKE_MODE=1
 *   - DESIGNWAN_SPIKE_SENTINEL=<tmpdir>/designwan-spike-<random>/sentinel.json
 *
 * 安全：
 *   - Sentinel 路径在 <tmpdir>/designwan-spike-* 专用临时目录下
 *   - 超时 30s（spike 最小集 <1s，留足打包启动时间）
 *   - 子进程 exit code 与 sentinel.ok 一致
 *
 * 退出码：0=PASS（sentinel.ok=true 且 exit code=0），1=FAIL
 */
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
let artifactPath = null;
let outputPath = null;
for (const a of args) {
  if (a.startsWith('--artifact=')) {
    artifactPath = a.slice('--artifact='.length);
  } else if (a.startsWith('--output=')) {
    outputPath = a.slice('--output='.length);
  }
}

if (!artifactPath) {
  console.error('ERROR: --artifact=<path> is required');
  console.error(
    'Usage: node packaged-spike-smoke.mjs --artifact=<path-to-electron-executable> [--output=<path-to-spike.json>]',
  );
  process.exit(2);
}

if (!existsSync(artifactPath)) {
  console.error(`ERROR: artifact not found: ${artifactPath}`);
  process.exit(2);
}

const SPIKE_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 50;

console.log('==============================================================');
console.log('DesignWan verify: packaged-spike-smoke (02-E)');
console.log('--------------------------------------------------------------');
console.log(`started at ${new Date().toISOString()} on ${process.platform}`);
console.log(`artifact: ${artifactPath}`);
console.log(`timeout: ${SPIKE_TIMEOUT_MS}ms`);
console.log('==============================================================');

// 创建专用临时目录（与 spike-runner 的路径校验一致：<tmpdir>/designwan-spike-*/sentinel.json）
const spikeTmpDir = mkdtempSync(join(realpathSync(tmpdir()), 'designwan-spike-'));
const sentinelPath = join(spikeTmpDir, 'sentinel.json');
console.log(`sentinel: ${sentinelPath}`);

// spawn packaged Electron
const child = spawn(artifactPath, [], {
  env: {
    ...process.env,
    DESIGNWAN_SPIKE_MODE: '1',
    DESIGNWAN_SPIKE_SENTINEL: sentinelPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdoutBuf = '';
let stderrBuf = '';
child.stdout.on('data', (d) => {
  stdoutBuf += d.toString();
});
child.stderr.on('data', (d) => {
  stderrBuf += d.toString();
});

// 等待 sentinel 或 exit
let exitInfo = null;
const exitPromise = new Promise((resolve) => {
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal };
    resolve(exitInfo);
  });
  child.on('error', (err) => {
    exitInfo = { code: -1, signal: null, error: err };
    resolve(exitInfo);
  });
});

const sentinelPromise = (async () => {
  const start = Date.now();
  while (Date.now() - start < SPIKE_TIMEOUT_MS) {
    if (existsSync(sentinelPath)) {
      try {
        const content = JSON.parse(readFileSync(sentinelPath, 'utf8'));
        return content;
      } catch (e) {
        // 文件可能还没写完，继续 poll
      }
    }
    // 如果 child 已经 exit，直接跳出
    if (exitInfo) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
})();

const [sentinelResult] = await Promise.all([sentinelPromise, exitPromise]);

console.log('\n--------------------------------------------------------------');
console.log('Packaged Spike Result');
console.log('--------------------------------------------------------------');
console.log(`exit code:     ${exitInfo?.code}`);
console.log(`exit signal:   ${exitInfo?.signal}`);
if (exitInfo?.error) {
  console.log(`spawn error:   ${exitInfo.error.message}`);
}
console.log(`sentinel ok:   ${sentinelResult?.ok}`);
if (sentinelResult) {
  console.log(`duration:      ${sentinelResult.durationMs}ms`);
  console.log(`timestamp:     ${sentinelResult.timestamp}`);
  console.log(`environment:`);
  console.log(`  runtime:     ${sentinelResult.environment?.runtime}`);
  console.log(`  electron:    ${sentinelResult.environment?.electronVersion}`);
  console.log(`  node:        ${sentinelResult.environment?.nodeVersion}`);
  console.log(`  platform:    ${sentinelResult.environment?.platform}`);
  console.log(`  arch:        ${sentinelResult.environment?.arch}`);
  console.log(
    `  sqlite:      ${sentinelResult.environment?.sqlite?.version} (fts5=${sentinelResult.environment?.sqlite?.fts5})`,
  );
  console.log(`  vec:         ${sentinelResult.environment?.vec?.version}`);
  console.log(`  vec path:    ${sentinelResult.environment?.vec?.loadablePath}`);
  console.log(`  driver path: ${sentinelResult.environment?.driverNativePath}`);
  console.log(`checks (${sentinelResult.checks?.length || 0}):`);
  for (const c of sentinelResult.checks || []) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${c.name} (${c.durationMs}ms)${c.error ? ' — ' + c.error : ''}`);
  }
}
if (stdoutBuf) {
  console.log(`\nstdout (tail):\n${stdoutBuf.slice(-500)}`);
}
if (stderrBuf) {
  console.log(`\nstderr (tail):\n${stderrBuf.slice(-500)}`);
}

// 保存 Spike JSON 到指定路径（供 CI 上传 artifact）
if (outputPath && sentinelResult) {
  try {
    writeFileSync(outputPath, JSON.stringify(sentinelResult, null, 2));
    console.log(`\nspike json saved: ${outputPath}`);
  } catch (e) {
    console.error(`\nfailed to save spike json to ${outputPath}: ${e.message}`);
  }
}

// 清理
try {
  rmSync(spikeTmpDir, { recursive: true, force: true });
} catch {
  // ignore
}

// 断言：sentinel.ok=true 且 exit code=0
const allOk =
  !!sentinelResult &&
  sentinelResult.ok === true &&
  (sentinelResult.checks || []).every((c) => c.ok) &&
  exitInfo?.code === 0;

console.log('\n==============================================================');
if (allOk) {
  console.log('packaged-spike-smoke: PASS');
  process.exit(0);
} else {
  console.log('packaged-spike-smoke: FAIL');
  if (!sentinelResult) {
    console.log('  reason: sentinel not written within timeout');
  } else if (!sentinelResult.ok) {
    console.log('  reason: sentinel.ok=false');
  } else if (exitInfo?.code !== 0) {
    console.log(`  reason: exit code ${exitInfo?.code} (expected 0)`);
  }
  process.exit(1);
}
