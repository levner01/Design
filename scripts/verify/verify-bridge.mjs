#!/usr/bin/env node
/**
 * DesignWan verify:bridge
 *
 * Gate G-BR：Native Host/Loopback 认证/重放/来源/端口/Extension 离线队列。
 *
 * 由 GLM-M1-01 + GLM-M1-02 实现。M0-01 阶段尚未开始，本门故意失败。
 */
import { failNotImplemented, banner } from './lib/not-implemented.mjs';

banner('verify:bridge (G-BR)');

failNotImplemented({
  gateName: 'verify:bridge',
  responsibleTask:
    'GLM-M1-01 Native Messaging Host 与安全 Local Bridge + GLM-M1-02 Extension 离线队列',
  reason:
    'Native Host 仅有 stdio echo 骨架，未实现 Origin 校验、Token、Nonce、Loopback HTTP 服务、' +
    'Extension 离线队列。',
  nextAction: '等待 M0 全部 PASS 后 Codex 下发 GLM-M1-01。',
});
