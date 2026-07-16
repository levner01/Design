/**
 * manifest 可解析性测试 + 构建产物引用完整性测试。
 * - 源 manifest.json 是有效 MV3 manifest
 * - 若 dist/ 存在，验证 manifest 引用的文件全部在 dist/ 中
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..');
const manifestPath = join(extRoot, 'manifest.json');
const distPath = join(extRoot, 'dist');
const distManifestPath = join(distPath, 'manifest.json');

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

// 构建产物引用完整性：仅在 dist 存在时检查
test('dist artifacts: all manifest-referenced files exist', () => {
  if (!existsSync(distManifestPath)) {
    // dist 尚未构建，跳过（CI build 后会触发）
    return;
  }
  const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
  const required = [];
  if (distManifest.background?.service_worker) {
    required.push(distManifest.background.service_worker);
  }
  if (distManifest.action?.default_popup) {
    required.push(distManifest.action.default_popup);
    const popupHtml = readFileSync(join(distPath, distManifest.action.default_popup), 'utf8');
    const scriptMatch = popupHtml.match(/<script[^>]+src=["']\.\/([^"']+)["']/);
    if (scriptMatch) {
      required.push(scriptMatch[1]);
    }
  }
  for (const f of required) {
    assert.ok(existsSync(join(distPath, f)), `dist artifact missing: ${f}`);
  }
});
