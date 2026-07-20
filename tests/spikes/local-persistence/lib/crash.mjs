/**
 * M0-02 02-B：Crash 模拟工具
 *
 * spawn crash-target.mjs 子进程，等待 sentinel 文件出现后 SIGKILL。
 * 用于验证：
 *   - Migration 中途强杀后，重启只能见到旧版本或完整新版本，无半状态
 *   - 事务中途 Kill 后，未提交数据不可见，已提交数据保留
 *
 * 关键实现：exit 监听器必须在 spawn 后立即注册，否则 child 在 sentinel
 * 之前 exit（如 txn-committed 立即 process.exit(0)）会错过 exit 事件，
 * 导致 Promise 永不 resolve，主进程事件循环被抽空而 silent exit 0。
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRASH_TARGET = join(__dirname, 'crash-target.mjs');

/**
 * 等待 sentinel 文件出现，最多 timeoutMs。
 * @param {string} sentinelPath
 * @param {number} timeoutMs
 * @returns {Promise<object>} sentinel 文件内容
 */
export function waitForSentinel(sentinelPath, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (existsSync(sentinelPath)) {
        try {
          const content = JSON.parse(readFileSync(sentinelPath, 'utf8'));
          resolve(content);
        } catch (e) {
          reject(new Error(`Failed to parse sentinel: ${e.message}`));
        }
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Sentinel timeout after ${timeoutMs}ms: ${sentinelPath}`));
        return;
      }
      setTimeout(check, 50);
    }
    check();
  });
}

/**
 * 启动 crash-target 子进程，等待 sentinel 后 SIGKILL。
 *
 * 行为：
 *   - 持久类操作（migration-v1/v2, txn-uncommitted）：child 写 sentinel 后
 *     进入 hold，主进程 SIGKILL child，返回 killed=true
 *   - 即时类操作（txn-committed）：child 自己 commit 并 process.exit(0)，
 *     sentinel 在 exit 前已写入，主进程检测到 child exit，返回 killed=false
 *
 * @param {object} params
 * @param {string} params.dbPath
 * @param {string} params.key
 * @param {string} params.op
 * @param {string} params.sentinelPath
 * @param {number} [params.holdSec=30]
 * @param {number} [params.killTimeoutMs=10000]
 * @param {string} [params.nodePath]
 * @returns {Promise<{ sentinel: object|null, killed: boolean, exitCode: number|null, signal: string|null, durationMs: number, killDurationMs: number, stderr: string }>}
 */
export async function spawnAndKill(params) {
  const {
    dbPath,
    key,
    op,
    sentinelPath,
    holdSec = 30,
    killTimeoutMs = 10000,
    nodePath = process.execPath,
  } = params;

  // 清理旧 sentinel
  try {
    unlinkSync(sentinelPath);
  } catch {
    // ignore
  }

  const start = Date.now();
  const child = spawn(
    nodePath,
    [
      CRASH_TARGET,
      `--db=${dbPath}`,
      `--key=${key}`,
      `--op=${op}`,
      `--sentinel=${sentinelPath}`,
      `--hold-sec=${holdSec}`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  );

  let stderrBuf = '';
  child.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  // 关键：exit/error 监听器必须在 spawn 后立即注册，否则 child 在
  // sentinel 之前 exit（txn-committed 路径）会错过 exit 事件，导致
  // Promise 永不 resolve，主进程事件循环被抽空而 silent exit 0。
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

  // race：sentinel 先到 → 主动 kill；child 先 exit → 直接拿结果（即时类操作）
  const sentinelPromise = waitForSentinel(sentinelPath, killTimeoutMs);
  const winner = await Promise.race([
    sentinelPromise.then((s) => ({ type: 'sentinel', sentinel: s })),
    exitPromise.then(() => ({ type: 'exit' })),
  ]);

  if (winner.type === 'sentinel') {
    // 持久类操作：sentinel 先到，SIGKILL child 后等 exit
    const killStart = Date.now();
    child.kill('SIGKILL');
    if (!exitInfo) {
      await exitPromise;
    }
    return {
      sentinel: winner.sentinel,
      killed: true,
      exitCode: exitInfo.code,
      signal: exitInfo.signal,
      durationMs: Date.now() - start,
      killDurationMs: Date.now() - killStart,
      stderr: stderrBuf,
    };
  }

  // 即时类操作：child 自己 exit（txn-committed 立即 commit + process.exit(0)）
  // sentinel 可能在 exit 前已写入，尝试读取；读不到则置 null
  let sentinel = null;
  try {
    sentinel = JSON.parse(readFileSync(sentinelPath, 'utf8'));
  } catch {
    // child exit 时 sentinel 未写入或解析失败
  }
  return {
    sentinel,
    killed: false,
    exitCode: exitInfo.code,
    signal: exitInfo.signal,
    durationMs: Date.now() - start,
    killDurationMs: 0,
    stderr: stderrBuf,
  };
}
