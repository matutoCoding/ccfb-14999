// 拱花笺纸生成：素色笺面，纹样以极淡线描提示，真正信息在拱花多边形里

import { fbm2 } from './noise.ts'
import { toBlob as blobOf } from './art_gen_blob.ts'
import type { GenPolygon, GeneratedArt } from './art_gen.ts'

const clampByte = (v: number): number => Math.max(0, Math.min(255, v))

// 闭合环多边形（外轮廓 + 内孔），这里只取外轮廓做压花
const ringPoints = (
  cx: number, cy: number, rOuter: number, rInner: number, petals = 8,
): { outer: { x: number; y: number }[]; inner: { x: number; y: number }[] } => {
  const outer: { x: number; y: number }[] = []
  const inner: { x: number; y: number }[] = []
  const steps = petals * 12
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const wave = 1 + 0.18 * Math.sin(petals * a)
    outer.push({ x: cx + Math.cos(a) * rOuter * wave, y: cy + Math.sin(a) * rOuter * wave })
    inner.push({ x: cx + Math.cos(a) * rInner, y: cy + Math.sin(a) * rInner })
  }
  return { outer, inner }
}

export const generateEmbossPaper = async (): Promise<GeneratedArt> => {
  const w = 768
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // 笺纸暖白底 + 纤维纸纹
  ctx.fillStyle = '#f6f1e4'
  ctx.fillRect(0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const fiber = (fbm2(x * 0.09, y * 0.03, 57, 3) - 0.5) * 10
      img.data[i] = clampByte(img.data[i] + fiber)
      img.data[i + 1] = clampByte(img.data[i + 1] + fiber)
      img.data[i + 2] = clampByte(img.data[i + 2] + fiber * 0.7)
    }
  }
  ctx.putImageData(img, 0, 0)

  const polygons: GenPolygon[] = []

  // 主纹：宝相花（外瓣 + 花蕊两层拱花）
  const flower = ringPoints(0.5, 0.42, 0.16, 0.05, 8)
  // 极淡线描提示纹样位置，正面几乎看不出来
  ctx.save()
  ctx.strokeStyle = '#d8cfbc'
  ctx.lineWidth = 1.2
  ctx.globalAlpha = 0.55
  const trace = (pts: { x: number; y: number }[]) => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x * w, pts[0].y * h)
    for (const p of pts.slice(1)) ctx.lineTo(p.x * w, p.y * h)
    ctx.closePath()
    ctx.stroke()
  }
  trace(flower.outer)
  trace(flower.inner)
  polygons.push({ name: '拱花宝相外瓣', colorHex: '#e8e0cf', points: flower.outer, emboss: true })
  polygons.push({ name: '拱花花蕊', colorHex: '#e8e0cf', points: flower.inner, emboss: true })

  // 四角祥云卷草
  const cloud = (cx: number, cy: number, flip: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      const a = t * Math.PI * 2.4
      const r = 0.09 * (1 - t * 0.55)
      pts.push({
        x: cx + flip * Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 0.7,
      })
    }
    // 加宽成可压花的带状区域
    const wide = pts.map((p) => ({ x: p.x + 0.012, y: p.y + 0.01 }))
    for (let i = pts.length - 1; i >= 0; i--) {
      wide.push({ x: pts[i].x - 0.012, y: pts[i].y - 0.01 })
    }
    trace(wide)
    return wide
  }
  const clouds = [
    cloud(0.12, 0.12, 1),
    cloud(0.88, 0.12, -1),
    cloud(0.12, 0.88, 1),
    cloud(0.88, 0.88, -1),
  ]
  clouds.forEach((pts, i) =>
    polygons.push({ name: `拱花祥云 ${i + 1}`, colorHex: '#e8e0cf', points: pts, emboss: true }),
  )

  // 下方水波纹三道
  for (let band = 0; band < 3; band++) {
    const pts: { x: number; y: number }[] = []
    const yBase = 0.74 + band * 0.05
    for (let i = 0; i <= 60; i++) {
      const x = 0.16 + (i / 60) * 0.68
      const y = yBase + Math.sin((i / 60) * Math.PI * 4) * 0.012
      pts.push({ x, y })
    }
    const wide = pts.map((p) => ({ x: p.x, y: p.y + 0.008 }))
    for (let i = pts.length - 1; i >= 0; i--) wide.push({ x: pts[i].x, y: pts[i].y - 0.008 })
    trace(wide)
    polygons.push({ name: `拱花水波 ${band + 1}`, colorHex: '#e8e0cf', points: wide, emboss: true })
  }
  ctx.restore()

  return { blob: await blobOf(canvas), width: w, height: h, polygons }
}
