#!/usr/bin/env node
/**
 * DesignWan verify:local-data
 *
 * Gate G-LD：加密 SQLite/Migration/FTS5/sqlite-vec/ObjectStore/删除。
 *
 * 由 GLM-M0-02（Spike）+ GLM-M0-03（LocalStore/ObjectStore/VectorIndex）实现。
 * M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:local-data (G-LD)');

failNotImplemented({
  gateName: 'verify:local-data',
  responsibleTask:
    'GLM-M0-02 Local Persistence Spike + GLM-M0-03 LocalStore/ObjectStore/VectorIndex',
  reason:
    '本地加密 SQLite、FTS5、sqlite-vec、ObjectStore、Migration、删除均未实现。' +
    'M0-01 仅建立 Monorepo/Electron 骨架，未引入任何数据库依赖。',
  nextAction: '等待 Codex 下发 GLM-M0-02 Spike 任务卡，产出双平台 packaged app 证据。',
});
