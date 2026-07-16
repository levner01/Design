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
 */
async function readMessage(): Promise<unknown | null> {
  const header = await readExact(4);
  if (header === null) return null;
  const length = header.readUInt32LE(0);
  if (length <= 0 || length > 1_000_000) {
    log(`invalid message length: ${length}`);
    return null;
  }
  const body = await readExact(length);
  if (body === null) return null;
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (e) {
    log(`invalid json: ${(e as Error).message}`);
    return null;
  }
}

function readExact(n: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let acc = Buffer.alloc(0);
    const onChunk = (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      if (acc.length >= n) {
        const exact = acc.subarray(0, n);
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
    const msg = await readMessage();
    if (msg === null) {
      log('stdin closed, exiting');
      break;
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
