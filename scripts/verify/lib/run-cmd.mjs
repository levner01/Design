/**
 * 子进程执行工具：捕获 stdout/stderr/exit code，给 verify 脚本统一格式化输出。
 */
import { spawn } from 'node:child_process';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [opts]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (e) => {
      resolve({ code: -1, stdout, stderr: e.message });
    });
  });
}

/**
 * 截断长输出，仅保留首尾若干行。
 */
export function truncateOutput(text, maxLines = 200) {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const head = lines.slice(0, Math.floor(maxLines / 2)).join('\n');
  const tail = lines.slice(-Math.floor(maxLines / 2)).join('\n');
  return `${head}\n... [truncated ${lines.length - maxLines} lines] ...\n${tail}`;
}
