// 确定性随机与基础数学：全项目禁用 Math.random，保证推演可复现

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export const clamp01 = (v: number): number => clamp(v, 0, 1)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// mulberry32 种子化伪随机，同一种子序列完全一致
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 一维高斯核权重，归一化到和为 1
export const gaussianKernel = (radius: number, sigma: number): number[] => {
  const r = Math.max(1, Math.round(radius))
  const out: number[] = []
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    out.push(w)
    sum += w
  }
  return out.map((w) => w / sum)
}

// FNV-1a 32 位哈希，用于像素校验和
export const fnv1aBytes = (data: ArrayLike<number>): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// 对 RGBA 缓冲算校验和，忽略完全透明之外的 alpha 差异
export const checksumRGBA = (data: Uint8Array | Uint8ClampedArray): string =>
  fnv1aBytes(data)

export const bbox = (pts: { x: number; y: number }[]) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export const polygonArea = (poly: { x: number; y: number }[]): number => {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  }
  return Math.abs(a) * 0.5
}

export const pointInPolygon = (p: Vec2Like, poly: Vec2Like[]): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

interface Vec2Like {
  x: number
  y: number
}

// 质心
export const centroid = (poly: Vec2Like[]): Vec2Like => {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p.x
    y += p.y
  }
  return { x: x / poly.length, y: y / poly.length }
}

// 角度差（度），结果落在 -180..180
export const angleDeltaDeg = (a: number, b: number): number => {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}
