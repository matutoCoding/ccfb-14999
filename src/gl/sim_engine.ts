// 印制推演引擎：管理 GL 资源，按顺序逐版叠印，输出确定性结果与校验和

import type { Paper, Pigment, Plate, SimSettings, SimRun } from '../domain/types.ts'
import { pigmentAbsorbance, srgbToLinearRgb, hexToRgb, srgbBytesDeltaE } from '../domain/color.ts'
import {
  createGl, createProgram, createFullscreenVao, createFloatFbo,
  deleteFbo, drawFullscreen, type Fbo,
} from './gl_util.ts'
import {
  VERT_FULLSCREEN, FS_PAPER, FS_PRINT, FS_EMBOSS_ACC,
  FS_EMBOSS_LIGHT, FS_TONEMAP,
} from './shaders.ts'
import { MaskCache } from './mask_baker.ts'
import { checksumRGBA } from '../domain/math_util.ts'

export interface EnginePlate {
  plate: Plate
  pigment: Pigment
}

export interface RunInput {
  plates: EnginePlate[]
  paper: Paper
  settings: SimSettings
  seedBase: number
  physicalWidthMm: number
  physicalHeightMm: number
}

export interface RunStats {
  meanDE: number
  p95DE: number
  maxDE: number
  checksum: string
  width: number
  height: number
  timingMs: number
  // 落色序号 -> 版块 id（A 通道值为 0 表示纸基无版块）
  plateIndexToId: string[]
}

interface Programs {
  paper: WebGLProgram
  print: WebGLProgram
  embossAcc: WebGLProgram
  embossLight: WebGLProgram
  tonemap: WebGLProgram
}

export const computeSimSize = (
  srcW: number, srcH: number, maxSize: number,
): { width: number; height: number } => {
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH))
  return {
    width: Math.max(64, Math.round(srcW * scale)),
    height: Math.max(64, Math.round(srcH * scale)),
  }
}

export class SimEngine {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private programs: Programs
  private maskCache: MaskCache
  private colorA: Fbo | null = null
  private colorB: Fbo | null = null
  private heightA: Fbo | null = null
  private heightB: Fbo | null = null
  private plateIdFbo: Fbo | null = null
  private width = 0
  private height = 0
  private uniformCache = new Map<string, WebGLUniformLocation | null>()

  constructor(canvas: HTMLCanvasElement) {
    this.gl = createGl(canvas)
    const ext = this.gl.getExtension('EXT_color_buffer_float')
    if (!ext) throw new Error('缺少 EXT_color_buffer_float 扩展，无法做浮点推演')
    this.vao = createFullscreenVao(this.gl)
    this.programs = {
      paper: createProgram(this.gl, VERT_FULLSCREEN, FS_PAPER),
      print: createProgram(this.gl, VERT_FULLSCREEN, FS_PRINT),
      embossAcc: createProgram(this.gl, VERT_FULLSCREEN, FS_EMBOSS_ACC),
      embossLight: createProgram(this.gl, VERT_FULLSCREEN, FS_EMBOSS_LIGHT),
      tonemap: createProgram(this.gl, VERT_FULLSCREEN, FS_TONEMAP),
    }
    this.maskCache = new MaskCache(this.gl)
  }

  private ensureTargets(w: number, h: number): void {
    if (this.width === w && this.height === h && this.colorA) return
    if (this.colorA) {
      deleteFbo(this.gl, this.colorA)
      deleteFbo(this.gl, this.colorB!)
      deleteFbo(this.gl, this.heightA!)
      deleteFbo(this.gl, this.heightB!)
      deleteFbo(this.gl, this.plateIdFbo!)
    }
    this.width = w
    this.height = h
    this.colorA = createFloatFbo(this.gl, w, h)
    this.colorB = createFloatFbo(this.gl, w, h)
    this.heightA = createFloatFbo(this.gl, w, h)
    this.heightB = createFloatFbo(this.gl, w, h)
    // 版块索引快照：tonemap 前保存，供点击定位读取
    this.plateIdFbo = createFloatFbo(this.gl, w, h)
  }

  private uniform(name: string, program: WebGLProgram): WebGLUniformLocation | null {
    const key = `${program}@${name}`
    if (this.uniformCache.has(key)) return this.uniformCache.get(key)!
    const loc = this.gl.getUniformLocation(program, name)
    this.uniformCache.set(key, loc)
    return loc
  }

  // 完整推演：返回统计并把 sRGB 结果留在画布上
  run(input: RunInput, srcW: number, srcH: number): RunStats {
    const start = performance.now()
    const { plates, paper, settings } = input
    // 配置缺失快速失败，不用默认色掩盖版块未配料的问题
    for (const item of plates) {
      if (item.plate.type === 'color' && !item.pigment?.id) {
        throw new Error(`版块「${item.plate.name}」尚未指定色料，无法推演`)
      }
    }
    if (!paper?.id) throw new Error('尚未选择纸张，无法推演')
    const { width, height } = computeSimSize(srcW, srcH, settings.simMaxSize)
    this.ensureTargets(width, height)
    const gl = this.gl
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)

    // 1. 纸基
    const paperLin = srgbToLinearRgb(hexToRgb(paper.baseHex))
    gl.useProgram(this.programs.paper)
    gl.uniform3f(this.uniform('u_paperLinear', this.programs.paper),
      paperLin.r, paperLin.g, paperLin.b)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.colorA!.framebuffer)
    drawFullscreen(gl, this.vao)
    // 高度缓冲清零（纸基高度 0）
    gl.clearColor(0, 0, 0, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.heightA!.framebuffer)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.heightB!.framebuffer)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const bakeOpts = {
      width, height, paper,
      bleedScale: settings.bleedScale,
      seedBase: input.seedBase,
    }
    const expansionX = 1 + settings.expansionPctX / 100
    const expansionY = 1 + settings.expansionPctY / 100

    // 2. 按印制顺序逐版落色/压花
    let colorSrc = this.colorA!
    let colorDst = this.colorB!
    let heightSrc = this.heightA!
    let heightDst = this.heightB!
    let plateIndex = 1
    const plateIndexToId: string[] = []
    for (const item of plates) {
      const { plate } = item
      if (!plate.visible) continue
      plateIndexToId[plateIndex] = plate.id
      const { texture } = this.maskCache.getOrCreate(plate, bakeOpts)
      const offUvX = plate.offsetXMm / input.physicalWidthMm
      const offUvY = plate.offsetYMm / input.physicalHeightMm
      if (plate.type === 'color') {
        const absorbance = pigmentAbsorbance(
          item.pigment.colorHex,
          item.pigment.concentration * plate.concentration,
          item.pigment.transparency,
        )
        gl.useProgram(this.programs.print)
        const p = this.programs.print
        gl.uniform1i(this.uniform('u_acc', p), 0)
        gl.uniform1i(this.uniform('u_mask', p), 1)
        gl.uniform3f(this.uniform('u_absorbance', p),
          absorbance.r, absorbance.g, absorbance.b)
        gl.uniform1f(this.uniform('u_passes', p), plate.passes)
        gl.uniform2f(this.uniform('u_uvOffset', p), offUvX, offUvY)
        gl.uniform2f(this.uniform('u_expansion', p), expansionX, expansionY)
        gl.uniform1f(this.uniform('u_plateIndex', p), plateIndex)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, colorSrc.texture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, colorDst.framebuffer)
        drawFullscreen(gl, this.vao)
        const tmp = colorSrc
        colorSrc = colorDst
        colorDst = tmp
      } else {
        gl.useProgram(this.programs.embossAcc)
        const p = this.programs.embossAcc
        gl.uniform1i(this.uniform('u_height', p), 0)
        gl.uniform1i(this.uniform('u_mask', p), 1)
        gl.uniform1f(this.uniform('u_strength', p), settings.embossStrength)
        gl.uniform2f(this.uniform('u_uvOffset', p), offUvX, offUvY)
        gl.uniform2f(this.uniform('u_expansion', p), expansionX, expansionY)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, heightSrc.texture)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.bindFramebuffer(gl.FRAMEBUFFER, heightDst.framebuffer)
        drawFullscreen(gl, this.vao)
        const tmp = heightSrc
        heightSrc = heightDst
        heightDst = tmp
      }
      plateIndex++
    }

    // 3. 拱花侧光作用于成品
    const az = (settings.lightAngleDeg * Math.PI) / 180
    const el = (settings.lightElevationDeg * Math.PI) / 180
    const lightDir = [
      Math.cos(el) * Math.cos(az),
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
    ]
    gl.useProgram(this.programs.embossLight)
    const lp = this.programs.embossLight
    gl.uniform1i(this.uniform('u_acc', lp), 0)
    gl.uniform1i(this.uniform('u_height', lp), 1)
    gl.uniform2f(this.uniform('u_texel', lp), 1 / width, 1 / height)
    gl.uniform3f(this.uniform('u_lightDir', lp),
      lightDir[0], lightDir[1], lightDir[2])
    gl.uniform1f(this.uniform('u_intensity', lp), settings.lightIntensity)
    gl.uniform1f(this.uniform('u_ambient', lp), settings.ambient)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, colorSrc.texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, heightSrc.texture)
    gl.bindFramebuffer(gl.FRAMEBUFFER, colorDst.framebuffer)
    drawFullscreen(gl, this.vao)
    const finalColor = colorDst

    // 3.5 保存版块索引快照（A 通道），tonemap 会覆盖默认 framebuffer
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, finalColor.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.plateIdFbo!.framebuffer)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)

    // 4. 输出到画布（sRGB）
    gl.useProgram(this.programs.tonemap)
    gl.uniform1i(this.uniform('u_acc', this.programs.tonemap), 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, finalColor.texture)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.canvas.width = width
    gl.canvas.height = height
    gl.viewport(0, 0, width, height)
    drawFullscreen(gl, this.vao)

    const rgba = this.readCanvas()
    const stats = this.statistics(rgba)
    stats.timingMs = performance.now() - start
    stats.plateIndexToId = plateIndexToId
    return stats
  }

  // 读回画布像素（Uint8 RGBA）
  readCanvas(): Uint8ClampedArray {
    const gl = this.gl
    const w = gl.canvas.width as number
    const h = gl.canvas.height as number
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    // WebGL 原点在左下，翻转成图像坐标（左上原点）
    const flipped = new Uint8ClampedArray(w * h * 4)
    const row = w * 4
    for (let y = 0; y < h; y++) {
      flipped.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row)
    }
    return flipped
  }

  // 定位某个像素点最后落色的版块索引（读 tonemap 前保存的版块索引快照 A 通道）
  locatePlateIndex(nx: number, ny: number): number {
    const gl = this.gl
    const px = Math.min(this.width - 1, Math.max(0, Math.floor(nx * this.width)))
    const py = Math.min(this.height - 1, Math.max(0, Math.floor((1 - ny) * this.height)))
    const buf = new Float32Array(4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.plateIdFbo!.framebuffer)
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, buf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return Math.round(buf[3])
  }

  private statistics(rgba: Uint8ClampedArray): RunStats {
    return {
      meanDE: 0, p95DE: 0, maxDE: 0,
      checksum: checksumRGBA(rgba),
      width: this.width, height: this.height, timingMs: 0,
      plateIndexToId: [],
    }
  }

  // 与原画 sRGB 缓冲逐像素比对（CPU 精确 dE00，抽稀控制耗时）
  compareReference(ref: Uint8ClampedArray, sim: Uint8ClampedArray, step = 2, plateIndexToId: string[] = []): RunStats {
    const values: number[] = []
    let sum = 0
    let maxDE = 0
    const pixelCount = sim.length / 4
    for (let i = 0; i < pixelCount; i += step) {
      const o = i * 4
      const de = srgbBytesDeltaE(
        sim[o], sim[o + 1], sim[o + 2],
        ref[o], ref[o + 1], ref[o + 2],
      )
      values.push(de)
      sum += de
      if (de > maxDE) maxDE = de
    }
    values.sort((a, b) => a - b)
    return {
      meanDE: sum / values.length,
      p95DE: values[Math.floor(values.length * 0.95)] ?? 0,
      maxDE,
      checksum: checksumRGBA(sim),
      width: this.width,
      height: this.height,
      timingMs: 0,
      plateIndexToId,
    }
  }

  get simWidth(): number {
    return this.width
  }

  get simHeight(): number {
    return this.height
  }

  clearMaskCache(): void {
    this.maskCache.dispose()
    this.maskCache = new MaskCache(this.gl)
  }

  dispose(): void {
    this.maskCache.dispose()
    if (this.colorA) {
      deleteFbo(this.gl, this.colorA)
      deleteFbo(this.gl, this.colorB!)
      deleteFbo(this.gl, this.heightA!)
      deleteFbo(this.gl, this.heightB!)
      deleteFbo(this.gl, this.plateIdFbo!)
    }
    for (const program of Object.values(this.programs)) this.gl.deleteProgram(program)
    this.gl.deleteVertexArray(this.vao)
    glDeleteAll(this.gl)
  }
}

const glDeleteAll = (gl: WebGL2RenderingContext): void => {
  // 上下文随画布回收；这里主动 lose 防止后台驻留
  const ext = gl.getExtension('WEBGL_lose_context')
  ext?.loseContext()
}

export const makeSimRun = (
  artworkId: string, stats: RunStats, plateCount: number,
): SimRun => ({
  id: `run_${Date.now().toString(36)}_${stats.checksum}`,
  artworkId,
  createdAt: Date.now(),
  checksum: stats.checksum,
  meanDE: stats.meanDE,
  p95DE: stats.p95DE,
  maxDE: stats.maxDE,
  timingMs: stats.timingMs,
  plateCount,
})
