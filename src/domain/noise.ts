// 种子化值噪声：纸纹、水色颗粒、笔触飞白都走这里，保证两次推演完全一致

const uint = (n: number): number => n >>> 0

// 整数格点哈希 -> 0..1
export const hash2i = (x: number, y: number, seed: number): number => {
  let h = uint(seed)
  h = uint(Math.imul(h ^ uint(x), 0x27d4eb2d))
  h = uint(Math.imul(h ^ uint(y), 0x165667b1))
  h ^= h >>> 15
  h = uint(Math.imul(h, 0x85ebca6b))
  h ^= h >>> 13
  h = uint(Math.imul(h, 0xc2b2ae35))
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

// 二维值噪声，输入连续坐标
export const valueNoise2 = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const v00 = hash2i(x0, y0, seed)
  const v10 = hash2i(x0 + 1, y0, seed)
  const v01 = hash2i(x0, y0 + 1, seed)
  const v11 = hash2i(x0 + 1, y0 + 1, seed)
  const top = v00 + (v10 - v00) * fx
  const bot = v01 + (v11 - v01) * fx
  return top + (bot - top) * fy
}

// 分形叠加，返回 0..1
export const fbm2 = (
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number => {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + o * 1013)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}
