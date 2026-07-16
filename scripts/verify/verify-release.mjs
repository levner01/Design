#!/usr/bin/env node
/**
 * DesignWan verify:release
 *
 * Gate G-R：双平台包/迁移/容量/删除/签名/回滚。
 *
 * 由 GLM-M7-02 + GLM-M7-03 实现。M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:release (G-R)');

failNotImplemented({
  gateName: 'verify:release',
  responsibleTask: 'GLM-M7-02 可观测/容量/成本/更新 + GLM-M7-03 双平台打包与 MVP Release',
  reason:
    '尚未产出 macOS/Windows 签名安装包、SBOM、回滚证据、删除证书、容量压测。' +
    'M0-01 仅配置 electron-builder smoke，未执行真实打包。',
  nextAction: '等待 M6 全部 PASS 后 Codex 下发 GLM-M7 系列任务卡。',
});
