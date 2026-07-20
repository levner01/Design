/**
 * M0-02 02-C：Exact-search Oracle
 *
 * 纯 JS 实现的 L2 Top-K Oracle，用于验证 sqlite-vec 结果的一致性。
 * vec0 默认使用 L2（欧氏）距离，Oracle 必须用相同度量才能比较 distance 绝对值。
 * 对于 L2 归一化向量，L2 距离和 cosine 距离单调相关，Top-K 排序相同，
 * 但绝对值不同（L2^2 = 2 - 2*cosine_sim），因此选 L2 以匹配 vec0 报告值。
 *
 * tie 处理：distance 差异 < 1e-9 时按 rowid 升序（确定性）。
 * 不能用模糊日志宣称"一致"，必须精确比较 rowid 序列与 distance。
 *
 * Oracle 独立于 sqlite-vec，用于反证 vec0 Top-K 的正确性。
 * 如果 vec0 与 Oracle 在冻结 Fixture 上 Top-10 不一致，说明 vec0 实现有 bug
 * 或调用方式有误，必须查明并记录。
 */

/**
 * 计算两个向量的 L2（欧氏）距离。
 * 匹配 vec0 默认距离度量。
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
export function l2Distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * 计算两个 L2 归一化向量的 cosine distance（参考用，不参与 Top-K 排序）。
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} distance in [0, 2]
 */
export function cosineDistance(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}

/**
 * Exact Top-K：纯 JS 实现，对 fixture 全量计算 L2 距离。
 * 复杂度 O(n*d)，仅用于 Spike 反证，不是生产实现。
 * @param {Array<{id: number, vector: Float32Array}>} fixture
 * @param {Float32Array} queryVec
 * @param {number} [k=10]
 * @returns {Array<{rowid: number, distance: number}>}
 */
export function exactTopK(fixture, queryVec, k = 10) {
  const scored = new Array(fixture.length);
  for (let i = 0; i < fixture.length; i++) {
    scored[i] = {
      rowid: fixture[i].id,
      distance: l2Distance(queryVec, fixture[i].vector),
    };
  }
  // 稳定排序：distance 升序，tie 按 rowid 升序（确定性）
  scored.sort((a, b) => {
    const diff = a.distance - b.distance;
    if (Math.abs(diff) < 1e-9) {
      return a.rowid - b.rowid;
    }
    return diff;
  });
  return scored.slice(0, k);
}

/**
 * 比较 sqlite-vec Top-K 与 exact Oracle Top-K 的一致性。
 * 必须逐 rank 比较 rowid；distance 允许浮点误差（< 1e-3），
 * 因为 vec0 的 SIMD 实现与 JS 标量实现在累加顺序上有差异。
 * @param {Array<{rowid: BigInt|number, distance: number}>} vecResult
 * @param {Array<{rowid: number, distance: number}>} oracleResult
 * @returns {{consistent: boolean, mismatches: Array, details: Array}}
 */
export function compareTopK(vecResult, oracleResult) {
  const mismatches = [];
  const details = [];
  const n = Math.max(vecResult.length, oracleResult.length);
  for (let i = 0; i < n; i++) {
    const v = vecResult[i];
    const o = oracleResult[i];
    if (!v || !o) {
      mismatches.push({ rank: i, reason: 'length_mismatch', vec: v, oracle: o });
      continue;
    }
    const vRowid = typeof v.rowid === 'bigint' ? Number(v.rowid) : v.rowid;
    const oRowid = o.rowid;
    details.push({
      rank: i,
      vecRowid: vRowid,
      oracleRowid: oRowid,
      vecDistance: v.distance,
      oracleDistance: o.distance,
      distanceDelta: Math.abs(v.distance - o.distance),
    });
    if (vRowid !== oRowid) {
      mismatches.push({
        rank: i,
        reason: 'rowid_mismatch',
        vec: { rowid: vRowid, distance: v.distance },
        oracle: { rowid: oRowid, distance: o.distance },
      });
    } else if (Math.abs(v.distance - o.distance) > 1e-3) {
      mismatches.push({
        rank: i,
        reason: 'distance_delta_too_large',
        vec: { rowid: vRowid, distance: v.distance },
        oracle: { rowid: oRowid, distance: o.distance },
        delta: Math.abs(v.distance - o.distance),
      });
    }
  }
  return { consistent: mismatches.length === 0, mismatches, details };
}

/**
 * 计算 p50/p95 分位数。
 * @param {number[]} sortedSamples 已排序的样本
 * @returns {{p50: number, p95: number, min: number, max: number}}
 */
export function percentiles(sortedSamples) {
  if (sortedSamples.length === 0) {
    return { p50: 0, p95: 0, min: 0, max: 0 };
  }
  const pick = (p) => {
    const idx = Math.min(
      sortedSamples.length - 1,
      Math.floor((p / 100) * sortedSamples.length),
    );
    return sortedSamples[idx];
  };
  return {
    p50: pick(50),
    p95: pick(95),
    min: sortedSamples[0],
    max: sortedSamples[sortedSamples.length - 1],
  };
}
