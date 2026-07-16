/**
 * DesignWan 测试工具入口。
 *
 * 提供共享的 Fixture 工厂、Assertion Helper 和 Test Adapter 占位。
 * 严禁包含真实密钥、真实用户数据或可还原业务内容的 Fixture。
 */
export * from './fixtures/index.js';

/**
 * 标记当前测试为"骨架占位"。
 * 用于 verify:quick 在没有真实业务测试时区分"未实现"与"已通过"。
 */
export const SKELETON_MARKER = 'designwan:skeleton:m0-01' as const;
