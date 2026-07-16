#!/usr/bin/env node
/**
 * DesignWan verify:e2e:p0b
 *
 * Gate G-B：五采集/导入/Fragment/复盘/词典/反向记忆。
 *
 * 由 GLM-M6 系列实现。M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:e2e:p0b (G-B)');

failNotImplemented({
  gateName: 'verify:e2e:p0b',
  responsibleTask: 'GLM-M6-01..M6-08 (P0-B 完整 MVP)',
  reason:
    'P0-B 场景需要 Extension 全页采集、框选、单图、本地 Import Batch、Fragment、' +
    'Project Review、Personal Dictionary、Reverse Memory。M0-01 仅建立骨架。',
  nextAction: '等待 GATE-P0A 通过后 Codex 下发 GLM-M6 系列任务卡。',
});
