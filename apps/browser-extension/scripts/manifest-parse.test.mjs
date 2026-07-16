/**
 * manifest 可解析性测试：验证 manifest.json 是有效 MV3 manifest。
 * 此测试被 pnpm test 调用，作为 GLM-M0-01 "Chrome Extension Manifest 可以解析" 的证据。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', 'manifest.json');
const raw = readFileSync(manifestPath, 'utf8');

test('manifest.json is valid JSON', () => {
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('manifest_version is 3', () => {
  const m = JSON.parse(raw);
  assert.equal(m.manifest_version, 3);
});

test('service_worker is declared', () => {
  const m = JSON.parse(raw);
  assert.ok(m.background?.service_worker, 'background.service_worker must be declared');
});

test('nativeMessaging permission is declared', () => {
  const m = JSON.parse(raw);
  assert.ok(
    Array.isArray(m.permissions) && m.permissions.includes('nativeMessaging'),
    'nativeMessaging permission required for Native Host',
  );
});
