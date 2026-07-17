/**
 * Native Messaging Host 协议测试。
 *
 * 覆盖场景（Chrome Native Messaging stdio 协议）：
 *   1. 单 chunk：header+body 在同一 write()
 *   2. 拆 chunk：header 和 body 分开 write()
 *   3. 连续帧粘包：两帧在同一 write()
 *   4. 半帧后 EOF：只发 header 不发 body
 *   5. 零长度 → 进程退出
 *   6. 超过 1MB → 进程退出
 *   7. 非法 JSON → 跳过继续
 *   8. 连续 ACK 同一 stdout chunk
 *   9. 50 轮连续稳定性测试
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
 * 持久缓冲区 ACK 解码器。
 * 保留同一 stdout chunk 中未消费的后续帧。
 */
class AckReader {
  constructor(stream) {
    this.stream = stream;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this._onData = (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this._tryResolve();
    };
    this.stream.on('data', this._onData);
  }

  _tryResolve() {
    while (this.waiters.length > 0 && this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const json = JSON.parse(this.buf.subarray(4, 4 + len).toString('utf8'));
      this.buf = this.buf.subarray(4 + len);
      const waiter = this.waiters.shift();
      waiter.resolve(json);
    }
  }

  readAck(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf({ resolve, reject });
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`readAck timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiters.push({
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this._tryResolve();
    });
  }

  cleanup() {
    this.stream.removeListener('data', this._onData);
  }
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

// ── 1. 单 chunk ──────────────────────────────────────────
test('single chunk: header+body in one write', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    host.stdin.write(encodeMessage({ type: 'hello', v: '0.1.0' }));
    const ack = await reader.readAck();
    assert.equal(ack.type, 'ack');
    assert.equal(ack.payload.received, true);
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});

// ── 2. 拆 chunk ──────────────────────────────────────────
test('split chunks: header and body in separate writes', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    const msg = encodeMessage({ type: 'hello', v: '0.1.0' });
    host.stdin.write(msg.subarray(0, 4));
    await new Promise((r) => setTimeout(r, 50));
    host.stdin.write(msg.subarray(4));
    const ack = await reader.readAck();
    assert.equal(ack.type, 'ack');
    assert.equal(ack.payload.received, true);
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});

// ── 3. 连续帧粘包 ────────────────────────────────────────
test('continuous frames: two messages in one write', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    const msg1 = encodeMessage({ type: 'hello', seq: 1 });
    const msg2 = encodeMessage({ type: 'hello', seq: 2 });
    host.stdin.write(Buffer.concat([msg1, msg2]));
    const ack1 = await reader.readAck();
    const ack2 = await reader.readAck();
    assert.equal(ack1.type, 'ack');
    assert.equal(ack1.payload.received, true);
    assert.equal(ack2.type, 'ack');
    assert.equal(ack2.payload.received, true);
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});

// ── 4. 半帧后 EOF ────────────────────────────────────────
test('half frame then EOF: only header sent, body missing', async () => {
  const host = startHost();
  try {
    // 只发 4 字节 header，声明 body 长度 100，但不发 body
    const header = Buffer.alloc(4);
    header.writeUInt32LE(100, 0);
    host.stdin.write(header);
    host.stdin.end();
    // 等待进程退出
    const exitCode = await new Promise((resolve) => {
      host.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 3000);
    });
    // 进程应该退出（stdin 关闭）
    assert.notEqual(exitCode, null, 'host should exit on stdin EOF');
  } finally {
    host.kill();
  }
});

// ── 5. 零长度 → 进程退出 ─────────────────────────────────
test('zero length: host terminates session', async () => {
  const host = startHost();
  try {
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(0, 0);
    host.stdin.write(badHeader);
    const exitCode = await new Promise((resolve) => {
      host.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 3000);
    });
    assert.notEqual(exitCode, null, 'host should exit on zero-length message');
    assert.notEqual(exitCode, 0, 'host should exit non-zero on zero-length');
  } finally {
    host.kill();
  }
});

// ── 6. 超过 1MB → 进程退出 ───────────────────────────────
test('over 1MB length: host terminates session', async () => {
  const host = startHost();
  try {
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(2_000_000, 0); // 2MB > 1MB limit
    host.stdin.write(badHeader);
    const exitCode = await new Promise((resolve) => {
      host.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 3000);
    });
    assert.notEqual(exitCode, null, 'host should exit on oversized message');
    assert.notEqual(exitCode, 0, 'host should exit non-zero on oversized');
  } finally {
    host.kill();
  }
});

// ── 7. 非法 JSON → 跳过继续 ──────────────────────────────
test('invalid JSON: host skips and continues', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    // 发非法 JSON body
    const badBody = Buffer.from('not json at all');
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(badBody.length, 0);
    host.stdin.write(Buffer.concat([badHeader, badBody]));
    // 等一下让 host 处理
    await new Promise((r) => setTimeout(r, 200));
    // 发正常消息验证 host 仍可响应
    host.stdin.write(encodeMessage({ type: 'hello' }));
    const ack = await reader.readAck();
    assert.equal(ack.type, 'ack');
    assert.equal(ack.payload.received, true);
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});

// ── 8. 连续 ACK 同一 stdout chunk ─────────────────────────
test('continuous ACK in same stdout chunk', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    // 快速发送 3 条消息，ACK 可能在同一 stdout chunk 返回
    for (let i = 0; i < 3; i++) {
      host.stdin.write(encodeMessage({ type: 'hello', seq: i }));
    }
    const acks = [];
    for (let i = 0; i < 3; i++) {
      acks.push(await reader.readAck());
    }
    for (const ack of acks) {
      assert.equal(ack.type, 'ack');
      assert.equal(ack.payload.received, true);
    }
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});

// ── 9. 50 轮连续稳定性测试 ───────────────────────────────
test('50-round stability: continuous single-chunk messages', async () => {
  const host = startHost();
  const reader = new AckReader(host.stdout);
  try {
    for (let i = 0; i < 50; i++) {
      host.stdin.write(encodeMessage({ type: 'hello', round: i }));
      const ack = await reader.readAck(8000);
      assert.equal(ack.type, 'ack', `round ${i}: expected ack`);
      assert.equal(ack.payload.received, true, `round ${i}: expected received=true`);
    }
  } finally {
    reader.cleanup();
    host.stdin.end();
    host.kill();
  }
});
