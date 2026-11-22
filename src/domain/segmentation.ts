// 原画自动分版：Lab 空间确定性 k-means + 空间平滑 + 连通域归并
// 所有随机来源均为种子化伪随机，同一原画同一参数结果恒定

import type { AnalysisParams, CandidatePlate, Vec2 } from './types.ts'
import { srgbToLab, type Lab, rgbToHex } from './color.ts'
import { gaussianBlur, connectedComponents } from './morphology.ts'
import { traceContours } from './geometry.ts'
import { mulberry32, clamp01 } from './math_util.ts'

export interface AnalysisInput {
  rgba: Uint8ClampedArray
  width: number
  height: number
  params: AnalysisParams
  seed: number
}

// 确定性 k-means++，返回每个像素的聚类编号与中心（Lab）
const kmeansLab = (
  pixels: Lab[],
  k: number,
  rng: () => number,
  maxIter = 12,
): { labels: Int32Array; centers: Lab[] } => {
  const n = pixels.length
  const centers: Lab[] = []
  // k-means++ 初始化
  centers.push(pixels[Math.floor(rng() * n)])
  const closestDist = new Float32Array(n).fill(Infinity)
  while (centers.length < k) {
    let total = 0
    for (let i = 0; i < n; i++) {
      const c = centers[centers.length - 1]
      const d = distLab(pixels[i], c)
      if (d * d < closestDist[i]) closestDist[i] = d * d
      total += closestDist[i]
    }
    let target = rng() * total
    let pick = n - 1
    for (let i = 0; i < n; i++) {
      target -= closestDist[i]
      if (target <= 0) {
        pick = i
        break
      }
    }
    centers.push(pixels[pick])
  }
  const labels = new Int32Array(n)
  for (let iter = 0; iter < maxIter; iter++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = distLab(pixels[i], centers[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (labels[i] !== best) {
        labels[i] = best
        moved++
      }
    }
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, n: 0 }))
    for (let i = 0; i < n; i++) {
      const s = sums[labels[i]]
      s.l += pixels[i].l
      s.a += pixels[i].a
      s.b += pixels[i].b
      s.n++
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].n === 0) {
        // 空簇重新播种到当前距离中心最远的像素，避免死中心吞掉候选色
        let worst = 0
        let worstD = -1
        for (let i = 0; i < n; i++) {
          const d = distLab(pixels[i], centers[labels[i]])
          if (d > worstD) {
            worstD = d
            worst = i
          }
        }
        centers[c] = { ...pixels[worst] }
        continue
      }
      centers[c] = {
        l: sums[c].l / sums[c].n,
        a: sums[c].a / sums[c].n,
        b: sums[c].b / sums[c].n,
      }
    }
    if (moved === 0 && iter > 0) break
  }
  return { labels, centers }
}

const distLab = (p: Lab, c: Lab): number => {
  const dl = p.l - c.l
  const da = p.a - c.a
  const db = p.b - c.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

const labToSrgbHex = (lab: Lab): string => {
  // 分析展示只需要近似色，用 Lab->XYZ->线性RGB 标准逆变换
  const y = (lab.l + 16) / 116
  const x = lab.a / 500 + y
  const z = y - lab.b / 200
  const fInv = (v: number) =>
    v > 0.206893 ? v * v * v : (v - 16 / 116) / 7.787
  const X = 0.95047 * fInv(x)
  const Y = 1 * fInv(y)
  const Z = 1.08883 * fInv(z)
  const lin = {
    r: clamp01(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    g: clamp01(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z),
    b: clamp01(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  }
  const enc = (v: number) =>
    v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return rgbToHex({ r: enc(lin.r), g: enc(lin.g), b: enc(lin.b) })
}

export const analyzeArtwork = (input: AnalysisInput): CandidatePlate[] => {
  const { rgba, width, height, params, seed } = input
  const rng = mulberry32(seed)
  const n = width * height
  // 1. 转 Lab（顺手做空间平滑，去掉纸纹噪点）
  const labFlat = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const lab = srgbToLab({
      r: rgba[i * 4] / 255,
      g: rgba[i * 4 + 1] / 255,
      b: rgba[i * 4 + 2] / 255,
    })
    labFlat[i * 3] = lab.l
    labFlat[i * 3 + 1] = lab.a
    labFlat[i * 3 + 2] = lab.b
  }
  const smoothR = Math.max(1, Math.round(params.smoothRadius * Math.max(width, height)))
  const smoothed = gaussianBlur(labFlat, width, height, smoothR, smoothR / 2, 3)
  const pixels: Lab[] = new Array(n)
  for (let i = 0; i < n; i++) {
    pixels[i] = {
      l: smoothed[i * 3],
      a: smoothed[i * 3 + 1],
      b: smoothed[i * 3 + 2],
    }
  }
  // 2. 色相/色料聚类
  const k = Math.max(2, params.clusterCount)
  const { labels, centers } = kmeansLab(pixels, k, rng)
  // 3. 浓淡分层：在每个聚类内部按 L 量化
  const toneLabels = new Int32Array(n)
  if (params.toneLevels > 1) {
    const lMin = new Float32Array(k).fill(Infinity)
    const lMax = new Float32Array(k).fill(-Infinity)
    for (let i = 0; i < n; i++) {
      const c = labels[i]
      const l = pixels[i].l
      if (l < lMin[c]) lMin[c] = l
      if (l > lMax[c]) lMax[c] = l
    }
    for (let i = 0; i < n; i++) {
      const c = labels[i]
      const span = Math.max(1, lMax[c] - lMin[c])
      const t = Math.min(
        params.toneLevels - 1,
        Math.floor(((pixels[i].l - lMin[c]) / span) * params.toneLevels),
      )
      toneLabels[i] = c * params.toneLevels + t
    }
  } else {
    labels.forEach((v, i) => (toneLabels[i] = v))
  }
  // 4. 连通域归并：碎块并入相邻大色块
  const finalLabels = mergeSmallComponents(
    toneLabels,
    width,
    height,
    params.minAreaRatio,
  )
  // 5. 汇总候选版块，追踪轮廓
  const ids = [...new Set(finalLabels)].sort((a, b) => a - b)
  const result: CandidatePlate[] = []
  for (const id of ids) {
    const mask = new Float32Array(n)
    let count = 0
    for (let i = 0; i < n; i++) {
      if (finalLabels[i] === id) {
        mask[i] = 1
        count++
      }
    }
    const baseCluster = Math.floor(id / Math.max(1, params.toneLevels))
    const polygons = traceContours(mask, width, height)
    if (polygons.length === 0) continue
    result.push({
      clusterId: id,
      colorHex: labToSrgbHex(centers[Math.min(baseCluster, centers.length - 1)]),
      areaRatio: count / n,
      polygons: polygons as Vec2[][],
      pixels: count,
    })
  }
  return result.sort((a, b) => b.areaRatio - a.areaRatio)
}

// 小连通域并入相邻最大色块（模拟老师傅"碎处归并"的判断）
const mergeSmallComponents = (
  labels: Int32Array,
  width: number,
  height: number,
  minAreaRatio: number,
): Int32Array => {
  const out = Int32Array.from(labels)
  const ids = [...new Set(out)].sort((a, b) => a - b)
  const minPixels = minAreaRatio * out.length
  for (const id of ids) {
    const { compMap, components } = connectedComponents(out, width, height, id)
    const small = components.filter((c) => c.pixels < minPixels)
    if (small.length === 0 || components.length <= 1) continue
    for (const comp of small) {
      // 只扫边界框外扩一圈，找接壤像素最多的邻居标签，避免全图 O(n²)
      const neighborVotes = new Map<number, number>()
      const x0 = Math.max(0, comp.minX - 1)
      const x1 = Math.min(width - 1, comp.maxX + 1)
      const y0 = Math.max(0, comp.minY - 1)
      const y1 = Math.min(height - 1, comp.maxY + 1)
      const vote = (idx: number) => {
        const nb = out[idx]
        if (nb !== id) neighborVotes.set(nb, (neighborVotes.get(nb) ?? 0) + 1)
      }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * width + x
          if (compMap[i] !== comp.id) continue
          if (x > 0) vote(i - 1)
          if (x < width - 1) vote(i + 1)
          if (y > 0) vote(i - width)
          if (y < height - 1) vote(i + width)
        }
      }
      let bestLabel = id
      let bestVotes = -1
      for (const [label, v] of neighborVotes) {
        if (v > bestVotes) {
          bestVotes = v
          bestLabel = label
        }
      }
      if (bestLabel !== id) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = y * width + x
            if (compMap[i] === comp.id) out[i] = bestLabel
          }
        }
      }
    }
  }
  return out
}
