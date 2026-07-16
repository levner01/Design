/**
 * 测试 Fixture 工厂骨架。
 *
 * 真实业务 Fixture（Asset、Project、Memory、Capture 等）由后续卡填充。
 * 当前仅提供无业务含义的占位工具，避免 verify:quick 用空 assert 伪装通过。
 */
import type { IpcRequest, IpcScope } from '@designwan/contracts/ipc';
import type { Result } from '@designwan/contracts/result';

/**
 * 构造一个最小的 IpcRequest Envelope，用于 IPC 契约测试。
 */
export function makeIpcRequestEnvelope<Payload>(payload: Payload): IpcRequest<Payload> {
  return {
    action: 'test.placeholder',
    schemaVersion: '0.1.0',
    actorSessionId: 'test-session',
    payload,
  };
}

/**
 * 构造一个最小 IpcScope，用于测试 Main 复核逻辑。
 */
export function makeIpcScope(): IpcScope {
  return { workspaceId: 'test-workspace' };
}

/**
 * 断言一个 Result 是 Ok。
 * 测试失败时抛出明确错误，避免静默通过。
 */
export function assertOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Expected Ok, got Err: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
