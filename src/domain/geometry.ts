// 几何工具：多边形裁剪、矩形切割、栅格化、轮廓追踪（marching squares + DP 抽稀）

import type { Vec2 } from './types.ts'
import { pointInPolygon, polygonArea } from './math_util.ts'

// Sutherland-Hodgman：用凸裁剪多边形（矩形）裁 subject，返回裁剪后的多边形
export const clipPolygon = (subject: Vec2[], clip: Vec2[]): Vec2[] => {
  let out = subject.slice()
  const inside = (p: Vec2, a: Vec2, b: Vec2): boolean =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0
  const intersect = (p: Vec2, q: Vec2, a: Vec2, b: Vec2): Vec2 => {
    const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
    const t = d1 / (d1 - d2)
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
  }
  for (let i = 0; i < clip.length; i++) {
    if (out.length === 0) break
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j]
      const q = input[(j + 1) % input.length]
      const pin = inside(p, a, b)
      const qin = inside(q, a, b)
      if (pin && qin) out.push(q)
      else if (pin && !qin) out.push(intersect(p, q, a, b))
      else if (!pin && qin) {
        out.push(intersect(p, q, a, b))
        out.push(q)
      }
    }
  }
  return out
}

export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// 用一个矩形把多边形集合切成两半（用于手动切版）
export const splitPolygonsByRect = (
  polygons: Vec2[][],
  rect: Rect,
): { inside: Vec2[][]; outside: Vec2[][] } => {
  const clip: Vec2[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
  const inside: Vec2[][] = []
  const outside: Vec2[][] = []
  for (const poly of polygons) {
    const inPart = clipPolygon(poly, clip)
    if (inPart.length >= 3 && polygonArea(inPart) > 1e-9) inside.push(inPart)
    // 外半部分：矩形补集拆成上/下/左/右四块，逐块裁剪
    for (const part of complementByRect(poly, rect)) outside.push(part)
  }
  return {
    inside,
    outside: dedupPolygons(outside),
  }
}

// 矩形补集 = 四个矩形区域（上/下/左/右），逐块裁剪后合并
const complementByRect = (poly: Vec2[], rect: Rect): Vec2[][] => {
  const regions: Vec2[][] = [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: rect.minY }, { x: 0, y: rect.minY }],
    [{ x: 0, y: rect.maxY }, { x: 1, y: rect.maxY }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    [{ x: 0, y: rect.minY }, { x: rect.minX, y: rect.minY }, { x: rect.minX, y: rect.maxY }, { x: 0, y: rect.maxY }],
    [{ x: rect.maxX, y: rect.minY }, { x: 1, y: rect.minY }, { x: 1, y: rect.maxY }, { x: rect.maxX, y: rect.maxY }],
  ]
  const out: Vec2[][] = []
  for (const region of regions) {
    const part = clipPolygon(poly, region)
    if (part.length >= 3 && polygonArea(part) > 1e-9) out.push(part)
  }
  return out
}

const dedupPolygons = (polys: Vec2[][]): Vec2[][] =>
  polys.filter((p) => polygonArea(p) > 1e-9)

// 多多边形栅格化到 Float32 覆盖缓冲（1=覆盖），size 为目标纹理宽高
export const rasterizePolygons = (
  polygons: Vec2[][],
  width: number,
  height: number,
): Float32Array => {
  const mask = new Float32Array(width * height)
  for (const poly of polygons) {
    let minX = 1
    let minY = 1
    let maxX = 0
    let maxY = 0
    for (const p of poly) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const x0 = Math.max(0, Math.floor(minX * width))
    const x1 = Math.min(width - 1, Math.ceil(maxX * width))
    const y0 = Math.max(0, Math.floor(minY * height))
    const y1 = Math.min(height - 1, Math.ceil(maxY * height))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = { x: (x + 0.5) / width, y: (y + 0.5) / height }
        if (pointInPolygon(p, poly)) mask[y * width + x] = 1
      }
    }
  }
  return mask
}

// Moore 邻域边界追踪：提取二值掩膜各连通块的外轮廓，返回归一化多边形集合
export const traceContours = (
  mask: Float32Array,
  width: number,
  height: number,
  threshold = 0.5,
): Vec2[][] => {
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] > threshold
  const componentSeen = new Uint8Array(width * height)
  const polys: Vec2[][] = []
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const startIdx = sy * width + sx
      if (!filled(sx, sy) || componentSeen[startIdx]) continue
      // 洪水填充标记整个连通块，同时取最上-最左的边界起点
      const stack = [startIdx]
      let start = { x: sx, y: sy }
      while (stack.length) {
        const idx = stack.pop()!
        if (componentSeen[idx]) continue
        const x = idx % width
        const y = (idx / width) | 0
        componentSeen[idx] = 1
        if (y < start.y || (y === start.y && x < start.x)) start = { x, y }
        const neighbors = [
          x > 0 ? idx - 1 : -1,
          x < width - 1 ? idx + 1 : -1,
          y > 0 ? idx - width : -1,
          y < height - 1 ? idx + width : -1,
        ]
        for (const n of neighbors) {
          if (n >= 0 && !componentSeen[n] && filled(n % width, (n / width) | 0)) stack.push(n)
        }
      }
      const boundary = mooreTrace(filled, start, width, height)
      if (boundary.length >= 3) {
        // 小环（<=6 点，如 2x2 块）抽稀会退化，直接保留；大环走 DP
        const simplified = boundary.length <= 6 ? boundary : simplifyDP(boundary, 1.0)
        if (simplified.length >= 3) {
          polys.push(simplified.map(([x, y]) => ({ x: x / width, y: y / height })))
        }
      }
    }
  }
  return polys
}

// 8 邻域顺时针偏移：N, NE, E, SE, S, SW, W, NW
const MOORE8: [number, number][] = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
]

// 标准 Moore 边界追踪，输出像素中心坐标的闭合外轮廓
const mooreTrace = (
  filled: (x: number, y: number) => boolean,
  start: { x: number; y: number },
  width: number,
  height: number,
): [number, number][] => {
  const points: [number, number][] = [[start.x + 0.5, start.y + 0.5]]
  let cur = { ...start }
  // 起点最上-最左，西邻为背景；从西北（7）开始顺时针扫描
  let checkDir = 7
  const maxSteps = width * height * 8
  for (let step = 0; step < maxSteps; step++) {
    let next: { x: number; y: number } | null = null
    let movedDir = -1
    for (let k = 1; k <= 8; k++) {
      const dir = (checkDir + k) % 8
      const [dx, dy] = MOORE8[dir]
      const candidate = { x: cur.x + dx, y: cur.y + dy }
      if (filled(candidate.x, candidate.y)) {
        next = candidate
        movedDir = dir
        break
      }
    }
    if (!next) break // 孤立单点
    // 下一轮从移动方向逆时针两格继续，保证背景始终在右手侧
    checkDir = (movedDir + 6) % 8
    cur = next
    if (cur.x === start.x && cur.y === start.y) break
    points.push([cur.x + 0.5, cur.y + 0.5])
  }
  return points
}

// Douglas-Peucker 抽稀，epsilon 单位为像素
const simplifyDP = (pts: [number, number][], epsilon: number): [number, number][] => {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let maxD = 0
    let idx = -1
    const a = pts[lo]
    const b = pts[hi]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    for (let i = lo + 1; i < hi; i++) {
      const p = pts[i]
      const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return pts.filter((_, i) => keep[i])
}
