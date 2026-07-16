#!/usr/bin/env node
/**
 * DesignWan verify:evals:quick
 *
 * Gate G-EV：AI Schema/来源/Scope/Route/外发/冻结样本。
 *
 * 由 GLM-M2-04（Vision/Embedding/Search）+ GLM-M7-01（Evals 与红队）实现。
 * M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:evals:quick (G-EV)');

failNotImplemented({
  gateName: 'verify:evals:quick',
  responsibleTask: 'GLM-M2-04 Vision/Embedding/Search + GLM-M7-01 Evals 与安全红队',
  reason:
    '尚未建立 Prompt/Schema Manifest、Eval Dataset、来源/Scope/Route 校验。' +
    'M0-01 仅建立 evals/ 目录与 prompts/ Manifest 骨架。',
  nextAction: '等待 GLM-M2-04 与 GLM-M7-01 实现冻结样本与红队。',
});
