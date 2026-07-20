#!/usr/bin/env node
/**
 * DesignWan verify:local-data (G-LD)
 *
 * 双模式开关（m2-02.md §四 02-D）：
 *
 * 1. pnpm verify:local-data -- --spike
 *    - 运行真实 M0-02 Spike（02-A + 02-B + 02-C + 负例注入器）
 *    - 全部成功才 exit 0
 *
 * 2. pnpm verify:local-data
 *    - 明确 exit 1
 *    - 提示完整 LocalStore/ObjectStore/VectorIndex 尚待 M0-03
 *    - 不得因为 Spike 通过而假装生产实现已经完成
 *
 * 严禁 DISABLE / SKIP / CI-only 假绿开关：默认模式必须真实 exit 1。
 * 生产 LocalStore/ObjectStore/VectorIndex 实现归属于 GLM-M0-03，不属于本 Spike。
 */
import { banner } from './lib/not-implemented.mjs';
import { runSpike } from './local-persistence/run-spike.mjs';

const args = process.argv.slice(2);
const spikeMode = args.includes('--spike');

banner('verify:local-data (G-LD)');

if (spikeMode) {
  // Spike 模式：跑真实 M0-02 Spike，全 PASS 才 exit 0
  runSpike()
    .then((r) => {
      process.exit(r.exitCode);
    })
    .catch((e) => {
      console.error('FATAL: uncaught error in verify:local-data --spike:', e);
      process.exit(1);
    });
} else {
  // 默认模式：明确 exit 1，提示生产实现尚待 M0-03
  // 即使 M0-02 Spike 已全 PASS，也不得伪装生产 LocalStore/ObjectStore/VectorIndex 已完成。
  console.error('==============================================================');
  console.error('DesignWan verify gate NOT IMPLEMENTED (production)');
  console.error('--------------------------------------------------------------');
  console.error('Gate:           verify:local-data');
  console.error('Mode:           default (no --spike flag)');
  console.error('Responsible:    GLM-M0-03 LocalStore/ObjectStore/VectorIndex');
  console.error('Reason:');
  console.error('  M0-02 Spike 已通过加密 SQLite + FTS5 + sqlite-vec 技术验证，');
  console.error('  但生产实现 LocalStore/ObjectStore/VectorIndex 尚未开始。');
  console.error('  Spike 证据仅用于 ADR 决策，不能替代生产门。');
  console.error('Next action:');
  console.error('  - 如需运行 Spike 技术验证：pnpm verify:local-data -- --spike');
  console.error('  - 如需推进生产实现：等待 GLM-M0-03 任务卡下发');
  console.error('==============================================================');
  console.error('This gate intentionally fails. It must not be marked as PASS.');
  process.exit(1);
}
