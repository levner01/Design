#!/usr/bin/env node
/**
 * M0-02 02-D：Spike 编排器
 *
 * 串行执行 02-A + 02-B + 02-C + 负例注入器，汇总：
 *   - 各阶段 PASS/FAIL 数
 *   - 性能门（Fixture 构建 / FTS p95 / vec p95 / Crash Recovery）
 *   - 体积报告（DB / WAL / vec 扩展 / driver native）
 *   - 全部 PASS 才 exit 0
 *
 * 严禁 DISABLE / SKIP / CI-only 假绿开关：任一子阶段失败立即 exit 1。
 *
 * 退出码：0=全部 PASS，1=任一 FAIL
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

import { runCmd, truncateOutput } from '../lib/run-cmd.mjs';
import { runNegativeCases } from './negative-cases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SPIKE_DIR = join(REPO_ROOT, 'tests', 'spikes', 'local-persistence');
const RUN_DIR = join(SPIKE_DIR, 'run');

/**
 * Spike 子阶段定义。
 * @typedef {{name: string, script: string, report: string}} Stage
 */
const stages = [
  {
    name: '02-a-candidate-harness',
    script: join(SPIKE_DIR, '02-a-candidate-harness.test.mjs'),
    report: join(RUN_DIR, '02-a-candidate-harness.json'),
  },
  {
    name: '02-b-encrypted-sqlite-recovery',
    script: join(SPIKE_DIR, '02-b-encrypted-sqlite-recovery.test.mjs'),
    report: join(RUN_DIR, '02-b-encrypted-sqlite-recovery.json'),
  },
  {
    name: '02-c-search-lifecycle',
    script: join(SPIKE_DIR, '02-c-search-lifecycle.test.mjs'),
    report: join(RUN_DIR, '02-c-search-lifecycle.json'),
  },
];

/**
 * Spike Guardrail 阈值（来自 m2-02.md §四 02-D）。
 */
const GUARDRAILS = {
  fixtureBuildSec: 120,
  ftsP95Ms: 250,
  vecP95Ms: 250,
  crashRecoverySec: 5,
};

/**
 * 跑单个 Spike 子阶段。
 * @param {Stage} stage
 * @returns {Promise<{name: string, ok: boolean, exitCode: number, durationMs: number, report: object|null, stdoutTail: string, stderrTail: string}>}
 */
async function runStage(stage) {
  const start = Date.now();
  const r = await runCmd(process.execPath, [stage.script], {
    cwd: REPO_ROOT,
    timeout: 180000,
  });
  const durationMs = Date.now() - start;
  let report = null;
  if (existsSync(stage.report)) {
    try {
      report = JSON.parse(readFileSync(stage.report, 'utf8'));
    } catch {
      // ignore parse error
    }
  }
  return {
    name: stage.name,
    ok: r.code === 0,
    exitCode: r.code,
    durationMs,
    report,
    stdoutTail: truncateOutput(r.stdout || '', 30),
    stderrTail: truncateOutput(r.stderr || '', 30),
  };
}

/**
 * 从各阶段报告汇总性能门与体积。
 * @param {Array} stageResults
 * @returns {object}
 */
function aggregateMetrics(stageResults) {
  const findReport = (name) => stageResults.find((s) => s.name === name)?.report;
  const reportA = findReport('02-a-candidate-harness');
  const reportB = findReport('02-b-encrypted-sqlite-recovery');
  const reportC = findReport('02-c-search-lifecycle');

  const fixtureBuildMs = reportC?.environment?.fixtureBuildMs ?? null;
  const ftsPerf = reportC?.environment?.ftsPerf ?? null;
  const vecPerf = reportC?.environment?.vecPerf ?? null;
  const recoveryMetrics = reportB?.environment?.recoveryMetrics ?? null;
  const artifactSizes = reportC?.environment?.artifactSizes ?? null;

  // 性能门检查
  const fixtureBuildMet =
    fixtureBuildMs !== null && fixtureBuildMs <= GUARDRAILS.fixtureBuildSec * 1000;
  const ftsP95Met = ftsPerf !== null && ftsPerf.p95Ms <= GUARDRAILS.ftsP95Ms;
  const vecP95Met = vecPerf !== null && vecPerf.p95Ms <= GUARDRAILS.vecP95Ms;
  const crashRecoveryMet =
    recoveryMetrics !== null &&
    recoveryMetrics.recoveryDurationMs <= GUARDRAILS.crashRecoverySec * 1000;

  return {
    guardrails: {
      fixtureBuildSec: GUARDRAILS.fixtureBuildSec,
      ftsP95Ms: GUARDRAILS.ftsP95Ms,
      vecP95Ms: GUARDRAILS.vecP95Ms,
      crashRecoverySec: GUARDRAILS.crashRecoverySec,
    },
    metrics: {
      fixtureBuildMs,
      fixtureBuildMet,
      ftsPerf,
      ftsP95Met,
      vecPerf,
      vecP95Met,
      recoveryMetrics,
      crashRecoveryMet,
      artifactSizes,
    },
    allGuardrailsMet: fixtureBuildMet && ftsP95Met && vecP95Met && crashRecoveryMet,
  };
}

/**
 * 主入口：跑全部 Spike 阶段 + 负例，汇总报告。
 * @returns {{exitCode: number, summary: object}}
 */
export async function runSpike() {
  console.log('==============================================================');
  console.log('DesignWan verify: local-data (G-LD) --spike mode');
  console.log('--------------------------------------------------------------');
  console.log(`started at ${new Date().toISOString()} on ${process.platform}`);
  console.log(`node: ${process.version}`);
  console.log(
    `guardrails: fixture<=${GUARDRAILS.fixtureBuildSec}s, fts p95<=${GUARDRAILS.ftsP95Ms}ms, vec p95<=${GUARDRAILS.vecP95Ms}ms, crash<=${GUARDRAILS.crashRecoverySec}s`,
  );
  console.log('==============================================================');

  let allOk = true;

  // 1. 跑 02-A/B/C Spike 子阶段
  const stageResults = [];
  for (const stage of stages) {
    console.log(`\n>>> running ${stage.name}`);
    const r = await runStage(stage);
    stageResults.push(r);
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${stage.name} — exit=${r.exitCode}, duration=${r.durationMs}ms`);
    if (r.report?.summary) {
      console.log(`       summary: ${r.report.summary.passed}/${r.report.summary.total} PASS`);
    }
    if (!r.ok) {
      allOk = false;
      if (r.stderrTail) {
        console.log(`       stderr (tail):\n${r.stderrTail}`);
      }
    }
  }

  // 2. 跑负例注入器
  console.log(`\n>>> running negative-cases (02-D)`);
  const negResult = runNegativeCases();
  console.log(
    `[${negResult.exitCode === 0 ? 'PASS' : 'FAIL'}] negative-cases — ${negResult.passed}/${negResult.total} PASS`,
  );
  if (negResult.exitCode !== 0) {
    allOk = false;
    for (const c of negResult.cases.filter((x) => !x.ok)) {
      console.log(
        `       FAIL: ${c.name} (${c.reasonCode}) — neg:${c.negReason} pos:${c.posReason}` +
          (c.error ? ` error:${c.error}` : ''),
      );
    }
  }

  // 3. 汇总性能门与体积
  const metrics = aggregateMetrics(stageResults);
  console.log('\n==============================================================');
  console.log('Guardrails & Metrics');
  console.log('--------------------------------------------------------------');
  console.log(
    `fixture build:   ${metrics.metrics.fixtureBuildMs}ms (met=${metrics.metrics.fixtureBuildMet})`,
  );
  console.log(
    `fts p95:        ${metrics.metrics.ftsPerf?.p95Ms?.toFixed(2)}ms (met=${metrics.metrics.ftsP95Met})`,
  );
  console.log(
    `vec p95:        ${metrics.metrics.vecPerf?.p95Ms?.toFixed(2)}ms (met=${metrics.metrics.vecP95Met})`,
  );
  console.log(
    `crash recovery: ${metrics.metrics.recoveryMetrics?.recoveryDurationMs}ms (met=${metrics.metrics.crashRecoveryMet})`,
  );
  if (metrics.metrics.artifactSizes) {
    const a = metrics.metrics.artifactSizes;
    console.log(
      `artifact sizes: db=${a.dbFileMB}MB, wal=${a.walFileBytes}B, shm=${a.shmFileBytes}B, vec=${a.vecExtensionMB}MB, driver=${a.driverNativeMB}MB`,
    );
  }
  console.log(`all guardrails: ${metrics.allGuardrailsMet ? 'MET' : 'NOT MET'}`);

  // 4. 汇总
  console.log('==============================================================');
  const stagePass = stageResults.filter((s) => s.ok).length;
  const totalPass = stagePass + (negResult.exitCode === 0 ? 1 : 0);
  const totalStages = stages.length + 1;
  console.log(
    `spike summary: ${totalPass}/${totalStages} stages PASS, guardrails=${metrics.allGuardrailsMet ? 'MET' : 'NOT MET'}`,
  );
  console.log('==============================================================');

  const finalOk = allOk && metrics.allGuardrailsMet;
  return {
    exitCode: finalOk ? 0 : 1,
    summary: {
      stageResults: stageResults.map((s) => ({
        name: s.name,
        ok: s.ok,
        exitCode: s.exitCode,
        durationMs: s.durationMs,
        passed: s.report?.summary?.passed,
        total: s.report?.summary?.total,
      })),
      negativeCases: {
        passed: negResult.passed,
        total: negResult.total,
        cases: negResult.cases,
      },
      guardrails: metrics,
      finalOk,
    },
  };
}

// 直接执行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  runSpike()
    .then((r) => {
      process.exit(r.exitCode);
    })
    .catch((e) => {
      console.error('FATAL: uncaught error in run-spike:', e);
      process.exit(1);
    });
}
