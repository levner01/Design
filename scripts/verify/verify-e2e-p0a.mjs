#!/usr/bin/env node
/**
 * DesignWan verify:e2e:p0a
 *
 * Gate G-A：两真实项目 Local-first 纵向首验。
 *
 * 由 GATE-P0A（M0–M5 全部 PASS）后才能通过。M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:e2e:p0a (G-A)');

failNotImplemented({
  gateName: 'verify:e2e:p0a',
  responsibleTask: 'GATE-P0A（M0–M5 全部 PASS 后由 Codex 下发 P0-A 纵向 E2E）',
  reason:
    'P0-A 场景需要 Capture/Asset/Search/Project/Brief/Evidence/Decision/Memory/Recall 全链路。' +
    'M0-01 仅建立骨架，无任何业务能力。',
  nextAction: '等待 M0–M5 全部 PASS 后 Codex 下发 P0-A 纵向 E2E 任务卡。',
});
