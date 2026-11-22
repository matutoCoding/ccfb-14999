// 版块掩码烘焙：多边形栅格化 -> 纸纹颗粒（飞白）-> 吸水性晕化（各向异性）
// 烘焙结果按 版块+纸张+晕化参数 缓存，改颜色不触发重算

import type { Paper, Plate } from '../domain/types.ts'
import { rasterizePolygons } from '../domain/geometry.ts'
import { gaussianBlur2D } from '../domain/morphology.ts'
import { fbm2 } from '../domain/noise.ts'
import { clamp01 } from '../domain/math_util.ts'

export interface BakeOptions {
  width: number
  height: number
  paper: Paper
  bleedScale: number
  seedBase: number
}

export interface BakedMask {
  data: Float32Array
  width: number
  height: number
  cacheKey: string
}

// 纤维方向决定晕化椭圆的两轴：顺纤维方向晕得远
const fiberAxes = (paper: Paper): [number, number] => {
  const base = 2 + paper.absorbency * 10
  if (paper.fiberDirection === 'horizontal') return [base * 1.6, base * 0.7]
  if (paper.fiberDirection === 'vertical') return [base * 0.7, base * 1.6]
  return [base, base]
}

export const bakePlateMask = (plate: Plate, opts: BakeOptions): BakedMask => {
  const { width, height, paper, bleedScale, seedBase } = opts
  const seed = seedBase + hashString(plate.id)
  let mask: Float32Array = rasterizePolygons(plate.polygons, width, height)

  if (plate.type === 'color') {
    // 纸纹颗粒：低频 fbm 调制覆盖率，模拟水色吃纸与笔触飞白
    const grainFreq = 0.06 + paper.roughness * 0.08
    const grainDepth = 0.12 + paper.roughness * 0.25
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (mask[i] <= 0) continue
        const n = fbm2(x * grainFreq, y * grainFreq, seed, 3)
        mask[i] = clamp01(1 - grainDepth * (1 - n) * 1.4)
      }
    }
    // 吸水晕化：各向异性高斯，边缘自然过渡
    const [rx, ry] = fiberAxes(paper)
    const radiusX = Math.max(0.6, rx * bleedScale)
    const radiusY = Math.max(0.6, ry * bleedScale)
    if (radiusX > 0.8 || radiusY > 0.8) {
      mask = gaussianBlur2D(mask, width, height, radiusX, radiusY)
    }
  } else {
    // 拱花版边缘轻微柔化，模拟压痕渐变
    mask = gaussianBlur2D(mask, width, height, 0.9, 0.9)
  }

  return {
    data: mask,
    width,
    height,
    cacheKey: [
      plate.id,
      geometryHash(plate),
      plate.type,
      paper.id,
      paper.absorbency.toFixed(3),
      paper.roughness.toFixed(3),
      paper.fiberDirection,
      bleedScale.toFixed(3),
      `${width}x${height}`,
    ].join('|'),
  }
}

// 多边形与规矩点参与缓存键：几何一变必然重烘焙
const geometryHash = (plate: Plate): string => {
  let h = 2166136261
  const eat = (n: number): void => {
    h ^= Math.round(n * 1e6)
    h = Math.imul(h, 16777619)
  }
  for (const poly of plate.polygons) {
    for (const p of poly) {
      eat(p.x)
      eat(p.y)
    }
    eat(-1)
  }
  return (h >>> 0).toString(36)
}

// 字符串 -> 稳定整数哈希
export const hashString = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class MaskCache {
  private cache = new Map<string, BakedMask>()
  private textures = new Map<string, WebGLTexture>()
  private gl: WebGL2RenderingContext
  // 缓存上限：30 版作品切换分辨率/纸张后，旧纹理需要被淘汰而非无限累积
  private readonly maxEntries = 96

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }

  getOrCreate(plate: Plate, opts: BakeOptions): { texture: WebGLTexture; mask: BakedMask } {
    const mask = bakePlateMask(plate, opts)
    const cached = this.cache.get(mask.cacheKey)
    if (cached && this.textures.has(mask.cacheKey)) {
      // Map 的迭代顺序即插入顺序，重新 get/set 提到最新，实现 LRU
      this.cache.delete(mask.cacheKey)
      this.cache.set(mask.cacheKey, cached)
      return { texture: this.textures.get(mask.cacheKey)!, mask: cached }
    }
    this.evictIfNeeded()
    const texture = this.upload(mask)
    this.cache.set(mask.cacheKey, mask)
    this.textures.set(mask.cacheKey, texture)
    return { texture, mask }
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (!oldestKey) break
      const tex = this.textures.get(oldestKey)
      if (tex) this.gl.deleteTexture(tex)
      this.textures.delete(oldestKey)
      this.cache.delete(oldestKey)
    }
  }

  private upload(mask: BakedMask): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) throw new Error('纹理创建失败')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // 浮点覆盖率必须用 R16F，R8 定点格式与 RED/FLOAT 上传不兼容
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, mask.width, mask.height)
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, mask.width, mask.height,
      gl.RED, gl.FLOAT, mask.data,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  dispose(): void {
    for (const t of this.textures.values()) this.gl.deleteTexture(t)
    this.cache.clear()
    this.textures.clear()
  }
}
