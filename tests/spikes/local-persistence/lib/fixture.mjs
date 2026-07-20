/**
 * M0-02 本地持久化 Spike — Fixture 工具
 *
 * 提供确定性 10k Fixture（中文/英文/混合文本 + 768 维向量），
 * 固定 ID 与 Seed，用于 02-C/02-D 性能与一致性测试。
 *
 * 严禁使用 Math.random() 或 Date.now()；所有"随机"来源必须是 seeded PRNG。
 */

import { mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 固定 Canary Token，用于明文扫描测试。
 * 02-B/02-C 在表中插入此 Canary，然后用 grep 扫描 DB/WAL/SHM/Temp 文件。
 * Canary 必须为 16 字节以上 ASCII，避免在 SQLite header 中误命中。
 */
export const CANARY_TOKEN = 'DESIGNWAN-CANARY-7f3a9c1e-b2d4-4e8a-9c5f-1a2b3c4d5e6f';
export const CANARY_TOKEN_ALT = 'DESIGNWAN-SECRET-b8e2-4d7a-9c1f-3e5a7b9c1d2e4f6a';

/**
 * 10k Fixture 的固定 Seed（用于 PRNG）。
 */
export const FIXTURE_SEED = 0x5eed1234;

/**
 * 向量维度（M0-02 约定 768 维）。
 */
export const VECTOR_DIM = 768;

/**
 * mulberry32 — 确定性 PRNG。
 * @param {number} seed
 * @returns {() => number} 返回 [0, 1) 的浮点数
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 基于固定 seed 与 ID 生成确定性 768 维 Float32Array。
 * 同一 (seed, id) 永远产生同一向量。
 * @param {number} id
 * @param {number} [seed=FIXTURE_SEED]
 * @returns {Float32Array}
 */
export function build768Vector(id, seed = FIXTURE_SEED) {
  const rng = mulberry32(seed ^ (id * 0x9e3779b9));
  const vec = new Float32Array(VECTOR_DIM);
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    const v = (rng() - 0.5) * 2; // [-1, 1)
    vec[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  // L2 归一化，便于 cosine similarity 测试
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec[i] = vec[i] / norm;
  }
  return vec;
}

/**
 * 中文文本片段池（确定性）。
 */
const ZH_POOL = [
  '品牌视觉系统在多场景下的延展性研究',
  '网页布局中的信息层级与视觉节奏',
  '色彩心理学在数字产品中的应用',
  '字体排印与中英文混排的可读性',
  '图标系统在跨平台一致性中的角色',
  '动效设计在用户引导中的作用',
  '设计 Token 与组件库的协作模式',
  '视觉资产的管理与版本控制',
  '设计决策的可追溯性与证据链',
  '反向记忆在长期项目中的召回策略',
];

/**
 * 英文文本片段池。
 */
const EN_POOL = [
  'A study on visual hierarchy in modern web interfaces',
  'Color systems and their psychological impact on users',
  'Typography decisions across Latin and CJK scripts',
  'Icon systems as anchors of cross-platform consistency',
  'Motion design as a tool for user guidance',
  'Design tokens and component library governance',
  'Visual asset management in long-running projects',
  'Decision traceability and evidence chains in design',
  'Reverse memory recall across multi-client contexts',
  'Layout rhythm and information density trade-offs',
];

/**
 * 基于 ID 生成确定性文本（中/英/混合）。
 * @param {number} id
 * @param {'zh'|'en'|'mixed'} [type='mixed']
 * @returns {string}
 */
export function buildText(id, type = 'mixed') {
  const rng = mulberry32(FIXTURE_SEED ^ (id * 0x85ebca6b));
  const pick = (pool) => pool[Math.floor(rng() * pool.length)];
  if (type === 'zh') {
    return `${pick(ZH_POOL)} #${id}`;
  }
  if (type === 'en') {
    return `${pick(EN_POOL)} #${id}`;
  }
  // mixed
  return `${pick(ZH_POOL)} | ${pick(EN_POOL)} #${id}`;
}

/**
 * 创建临时 Fixture 目录。
 * 路径位于 os.tmpdir()/designwan-spike-<random>/ 下，与 M0-01 Sentinel 路径策略一致。
 * @param {string} [prefix='spike']
 * @returns {string}
 */
export function createFixtureDir(prefix = 'spike') {
  const dir = mkdtempSync(join(tmpdir(), `designwan-${prefix}-`));
  return dir;
}

/**
 * 删除目录（递归）。
 * @param {string} dir
 */
export function cleanupFixtureDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * 构建 10k Fixture 数据集（不写入 DB，只返回数组）。
 * @param {object} [opts]
 * @param {number} [opts.count=10000]
 * @param {number} [opts.seed=FIXTURE_SEED]
 * @returns {Array<{id: number, text: string, vector: Float32Array, type: 'zh'|'en'|'mixed'}>}
 */
export function build10kFixture(opts = {}) {
  const count = opts.count ?? 10000;
  const seed = opts.seed ?? FIXTURE_SEED;
  const out = new Array(count);
  for (let id = 1; id <= count; id++) {
    const type = id % 3 === 0 ? 'zh' : id % 3 === 1 ? 'en' : 'mixed';
    out[id - 1] = {
      id,
      text: buildText(id, type),
      vector: build768Vector(id, seed),
      type,
    };
  }
  return out;
}

/**
 * 在 fixture 目录下创建子目录（用于多 DB 文件场景）。
 * @param {string} parent
 * @param {string} name
 * @returns {string}
 */
export function ensureSubdir(parent, name) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
