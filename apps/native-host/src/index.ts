/**
 * DesignWan Native Messaging Host 入口（骨架）。
 *
 * 约束（STACK_AND_ARCHITECTURE.md §8.1 / HANDOFF_PROTOCOL.md §1）：
 * - 只接受登记过的 Extension ID（与 Native Manifest allowed_origins 一致）
 * - 只转发小型 JSON 命令；截图、整页 HTML、PDF 走 Local Bridge
 * - 不持久化业务内容；stdout 只用于 Chrome 协议，不当日志
 * - 握手、Token、Nonce 由 GLM-M1-01 实现
 *
 * Chrome Native Messaging 协议：
 * - stdin/stdout 前 4 字节是 little-endian 消息长度，后接 JSON
 * - 单条消息最大 1 MB
 */
import { stdin, stdout } from 'node:process';
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

const TAG = '[designwan:native-host]';

// 静默 stdout 协议；日志走 stderr
function log(msg: string): void {
  process.stderr.write(`${TAG} ${msg}\n`);
}

/**
 * 读取一条 Native Messaging 消息（4 字节长度 + JSON payload）。
 * 返回值：
 *   { closed: true } — stdin 关闭，调用方应退出
 *   { closed: false, msg: undefined } — 畸形消息，已跳过，调用方应继续
 *   { closed: false, msg: unknown } — 有效消息
 */
async function readMessage(): Promise<{
  closed: boolean;
  msg?: unknown;
}> {
  const header = await readExact(4);
  if (header === null) return { closed: true };
  const length = header.readUInt32LE(0);
  if (length <= 0 || length > 1_000_000) {
    log(`invalid message length: ${length}`);
    return { closed: false };
  }
  const body = await readExact(length);
  if (body === null) return { closed: true };
  try {
    return { closed: false, msg: JSON.parse(body.toString('utf8')) };
  } catch (e) {
    log(`invalid json: ${(e as Error).message}`);
    return { closed: false };
  }
}

// 持久缓冲区：跨 readExact 调用保留已读取但未消费的数据。
// 修复单 chunk 包含 header+body 时 body 被丢弃的 bug。
let readBuffer = Buffer.alloc(0);

function readExact(n: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    // 如果缓冲区已有足够数据，直接返回
    if (readBuffer.length >= n) {
      const exact = readBuffer.subarray(0, n);
      readBuffer = readBuffer.subarray(n);
      resolve(exact);
      return;
    }

    const onChunk = (chunk: Buffer) => {
      readBuffer = Buffer.concat([readBuffer, chunk]);
      if (readBuffer.length >= n) {
        const exact = readBuffer.subarray(0, n);
        readBuffer = readBuffer.subarray(n);
        stdin.removeListener('data', onChunk);
        stdin.removeListener('end', onEnd);
        resolve(exact);
      }
    };
    const onEnd = () => {
      stdin.removeListener('data', onChunk);
      stdin.removeListener('end', onEnd);
      resolve(null);
    };
    stdin.on('data', onChunk);
    stdin.on('end', onEnd);
  });
}

/**
 * 写一条 Native Messaging 消息。
 */
function writeMessage(payload: unknown): void {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  stdout.write(Buffer.concat([header, json]));
}

async function main(): Promise<void> {
  log(`starting host protocol=${PROTOCOL_VERSION} app=${APP_VERSION}`);

  while (true) {
    const result = await readMessage();
    if (result.closed) {
      log('stdin closed, exiting');
      break;
    }
    if (result.msg === undefined) {
      // 畸形消息已跳过，继续读取下一条
      continue;
    }
    // M0-01 骨架：仅 echo hello；真实握手由 GLM-M1-01 实现
    writeMessage({
      v: PROTOCOL_VERSION,
      type: 'ack',
      payload: { received: true },
    });
  }
}

void main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
