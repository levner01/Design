/**
 * Native Messaging Host 协议测试。
 *
 * 覆盖场景（Chrome Native Messaging stdio 协议）：
 *   1. 单 chunk：header+body 在同一个 write() 中发送
 *   2. 拆 chunk：header 和 body 分两次 write() 发送
 *   3. 连续帧：两条消息在同一次 write() 中发送
 *   4. 畸形长度：长度字段为 0 时应优雅处理
 *
 * 每个 ACK 消息格式：4 字节 LE 长度 + JSON { v, type: 'ack', payload: { received: true } }
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const hostRoot = join(here, '..');
const hostBin = join(hostRoot, 'dist/index.js');

/**
 * 编码一条 Native Messaging 消息。
 */
function encodeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/**
 * 从 stream 读取一条 Native Messaging ACK。
 */
function readAck(stream) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('readAck timeout (5s)'));
      cleanup();
    }, 5000);

    let buf = Buffer.alloc(0);

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length >= 4 + len) {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
            cleanup();
            resolve(json);
          } catch (e) {
            cleanup();
            reject(e);
          }
        }
      }
    };

    function cleanup() {
      stream.removeListener('data', onData);
    }

    stream.on('data', onData);
  });
}

/**
 * 启动 Native Host 进程。
 */
function startHost() {
  return spawn('node', [hostBin], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: hostRoot,
  });
}

test('single chunk: header+body in one write', async () => {
  const host = startHost();
  try {
    const msg = encodeMessage({ type: 'hello', v: '0.1.0' });
    host.stdin.write(msg);
    const ack = await readAck(host.stdout);
    assert.equal(ack.type, 'ack');
    assert.equal(ack.payload.received, true);
  } finally {
    host.stdin.end();
    host.kill();
  }
});

test('split chunks: header and body in separate writes', async () => {
  const host = startHost();
  try {
    const msg = encodeMessage({ type: 'hello', v: '0.1.0' });
    const header = msg.subarray(0, 4);
    const body = msg.subarray(4);
    host.stdin.write(header);
    // 短暂延迟后发送 body
    await new Promise((r) => setTimeout(r, 50));
    host.stdin.write(body);
    const ack = await readAck(host.stdout);
    assert.equal(ack.type, 'ack');
    assert.equal(ack.payload.received, true);
  } finally {
    host.stdin.end();
    host.kill();
  }
});

test('continuous frames: two messages in one write', async () => {
  const host = startHost();
  try {
    const msg1 = encodeMessage({ type: 'hello', seq: 1 });
    const msg2 = encodeMessage({ type: 'hello', seq: 2 });
    host.stdin.write(Buffer.concat([msg1, msg2]));
    const ack1 = await readAck(host.stdout);
    const ack2 = await readAck(host.stdout);
    assert.equal(ack1.type, 'ack');
    assert.equal(ack1.payload.received, true);
    assert.equal(ack2.type, 'ack');
    assert.equal(ack2.payload.received, true);
  } finally {
    host.stdin.end();
    host.kill();
  }
});

test('malformed length: zero-length message does not crash host', async () => {
  const host = startHost();
  try {
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(0, 0);
    host.stdin.write(badHeader);
    // Host 应记录错误但不崩溃；发一条正常消息验证仍可响应
    await new Promise((r) => setTimeout(r, 100));
    const goodMsg = encodeMessage({ type: 'hello', v: '0.1.0' });
    host.stdin.write(goodMsg);
    const ack = await readAck(host.stdout);
    assert.equal(ack.type, 'ack');
  } finally {
    host.stdin.end();
    host.kill();
  }
});
