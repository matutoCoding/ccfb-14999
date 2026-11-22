// 程序化画稿生成：离屏 canvas 绘制宣纸质感的花鸟/山水/拱花笺纸
// 绘制图元同时输出归一化多边形，作为种子版块的标准答案
// 全程种子化噪声，无 Math.random

import { mulberry32, clamp01 } from './math_util.ts'
import { fbm2 } from './noise.ts'
import { toBlob } from './art_gen_blob.ts'

export interface GenPolygon {
  name: string
  colorHex: string
  // 归一化多边形
  points: { x: number; y: number }[]
  emboss?: boolean
}

export interface GeneratedArt {
  blob: Blob
  width: number
  height: number
  polygons: GenPolygon[]
}

const drawWash = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number, seed: number, color: string,
  cx: number, cy: number, rx: number, ry: number,
): { x: number; y: number }[] => {
  const rng = mulberry32(seed)
  const pts: { x: number; y: number }[] = []
  const steps = 26
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const wobble = 0.75 + fbm2(Math.cos(a) * 2 + 4, Math.sin(a) * 2 + 4, seed, 3) * 0.5
    pts.push({
      x: clamp01(cx + Math.cos(a) * rx * wobble),
      y: clamp01(cy + Math.sin(a) * ry * wobble),
    })
  }
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = color
  ctx.filter = 'blur(2px)'
  ctx.beginPath()
  ctx.moveTo(pts[0].x * w, pts[0].y * h)
  for (const p of pts.slice(1)) ctx.lineTo(p.x * w, p.y * h)
  ctx.closePath()
  ctx.fill()
  // 笔触飞白：细亮线扫过色块
  ctx.filter = 'none'
  ctx.globalAlpha = 0.25
  ctx.strokeStyle = '#f5efe2'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 6; i++) {
    const t = rng()
    ctx.beginPath()
    ctx.moveTo((cx - rx * 0.6 + t * rx * 1.2) * w, (cy - ry * 0.7) * h)
    ctx.quadraticCurveTo(cx * w, cy * h, (cx + rx * 0.3) * w, (cy + ry * 0.6) * h)
    ctx.stroke()
  }
  ctx.restore()
  return pts
}

const drawLeaf = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number, cx: number, cy: number,
  len: number, angle: number, color: string,
): { x: number; y: number }[] => {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const nx = -dy
  const ny = dx
  const tip = { x: cx + dx * len * 0.5, y: cy + dy * len * 0.5 }
  const base = { x: cx - dx * len * 0.5, y: cy - dy * len * 0.5 }
  const wf = len * 0.18
  const c1 = { x: cx + nx * wf, y: cy + ny * wf }
  const c2 = { x: cx - nx * wf, y: cy - ny * wf }
  ctx.save()
  ctx.fillStyle = color
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.moveTo(base.x * w, base.y * h)
  ctx.quadraticCurveTo(c1.x * w, c1.y * h, tip.x * w, tip.y * h)
  ctx.quadraticCurveTo(c2.x * w, c2.y * h, base.x * w, base.y * h)
  ctx.fill()
  ctx.restore()
  return [base, c1, tip, c2]
}

const drawBranch = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number, pts: [number, number][], widthMm: number, color: string,
): void => {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = widthMm
  ctx.beginPath()
  ctx.moveTo(pts[0][0] * w, pts[0][1] * h)
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0] * w, pts[1][1] * h)
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * w
      const my = ((pts[i][1] + pts[i + 1][1]) / 2) * h
      ctx.quadraticCurveTo(pts[i][0] * w, pts[i][1] * h, mx, my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last[0] * w, last[1] * h)
  }
  ctx.stroke()
  ctx.restore()
}

// 枝干用胶囊多边形近似（供分版）
const capsulePolygon = (
  pts: [number, number][], thickness: number,
): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = []
  const r = thickness / 2
  for (const p of pts) out.push({ x: p[0], y: p[1] - r })
  for (let i = pts.length - 1; i >= 0; i--) out.push({ x: pts[i][0], y: pts[i][1] + r })
  return out
}

const paperBackground = (
  ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, base = '#f5efe2',
): void => {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const n = (fbm2(x * 0.05, y * 0.05, seed, 3) - 0.5) * 14
      img.data[i] = clampByte(img.data[i] + n)
      img.data[i + 1] = clampByte(img.data[i + 1] + n)
      img.data[i + 2] = clampByte(img.data[i + 2] + n * 0.8)
    }
  }
  ctx.putImageData(img, 0, 0)
}

const clampByte = (v: number): number => Math.max(0, Math.min(255, v))

// 花鸟：折枝、叶片、朱红花朵、淡墨鸟
export const generateFlowerBird = async (): Promise<GeneratedArt> => {
  const w = 768
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  paperBackground(ctx, w, h, 11)
  const polygons: GenPolygon[] = []

  const branchPts: [number, number][] = [[0.12, 0.82], [0.38, 0.62], [0.62, 0.45], [0.88, 0.28]]
  drawBranch(ctx, w, h, branchPts, 10, '#4a3b2e')
  polygons.push({ name: '墨褐枝干', colorHex: '#4a3b2e', points: capsulePolygon(branchPts, 0.028) })

  const leaves: { cx: number; cy: number; len: number; angle: number; color: string }[] = [
    { cx: 0.3, cy: 0.68, len: 0.16, angle: -2.2, color: '#5d7a4a' },
    { cx: 0.42, cy: 0.6, len: 0.14, angle: -0.8, color: '#6b8f56' },
    { cx: 0.55, cy: 0.5, len: 0.15, angle: -2.6, color: '#55753f' },
    { cx: 0.7, cy: 0.38, len: 0.13, angle: -1.0, color: '#6b8f56' },
    { cx: 0.78, cy: 0.32, len: 0.12, angle: -2.4, color: '#5d7a4a' },
  ]
  leaves.forEach((leaf, i) => {
    const pts = drawLeaf(ctx, w, h, leaf.cx, leaf.cy, leaf.len, leaf.angle, leaf.color)
    polygons.push({ name: `花青叶 ${i + 1}`, colorHex: leaf.color, points: pts })
  })

  const flowers = [
    { cx: 0.66, cy: 0.3, r: 0.075, color: '#c2453d' },
    { cx: 0.8, cy: 0.22, r: 0.06, color: '#d05a4f' },
    { cx: 0.52, cy: 0.42, r: 0.05, color: '#b53a34' },
  ]
  flowers.forEach((f, i) => {
    const pts = drawWash(ctx, w, h, 101 + i * 17, f.color, f.cx, f.cy, f.r, f.r * 0.92)
    polygons.push({ name: `朱红花 ${i + 1}`, colorHex: f.color, points: pts })
    // 花蕊鹅黄小点
    ctx.fillStyle = '#e3b94d'
    ctx.beginPath()
    ctx.arc(f.cx * w, f.cy * h, f.r * w * 0.18, 0, Math.PI * 2)
    ctx.fill()
  })

  // 淡墨小鸟，身体与翅膀两块色版
  const body = drawWash(ctx, w, h, 202, '#5b6068', 0.24, 0.5, 0.085, 0.06)
  polygons.push({ name: '淡墨鸟身', colorHex: '#5b6068', points: body })
  const wing = drawWash(ctx, w, h, 203, '#3d424a', 0.26, 0.49, 0.05, 0.035)
  polygons.push({ name: '浓墨鸟翅', colorHex: '#3d424a', points: wing })
  ctx.fillStyle = '#2c2620'
  ctx.beginPath()
  ctx.arc(0.185 * w, 0.47 * h, 4, 0, Math.PI * 2)
  ctx.fill()

  return { blob: await toBlob(canvas), width: w, height: h, polygons }
}

// 山水：远山、近山、水面、松树、苔点
export const generateLandscape = async (): Promise<GeneratedArt> => {
  const w = 1024
  const h = 768
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  paperBackground(ctx, w, h, 31, '#f7f2e7')
  const polygons: GenPolygon[] = []

  // 远山淡蓝
  const farMountain: { x: number; y: number }[] = []
  ctx.fillStyle = '#9fb4c4'
  ctx.globalAlpha = 0.75
  ctx.beginPath()
  ctx.moveTo(0, h * 0.55)
  for (let i = 0; i <= 10; i++) {
    const x = i / 10
    const y = 0.42 + fbm2(i * 0.9, 3, 77, 3) * 0.16
    farMountain.push({ x, y })
    ctx.lineTo(x * w, y * h)
  }
  ctx.lineTo(w, h * 0.62)
  ctx.lineTo(0, h * 0.62)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  polygons.push({ name: '花青远山', colorHex: '#9fb4c4', points: [{ x: 0, y: 0.62 }, ...farMountain, { x: 1, y: 0.62 }] })

  // 近山赭墨
  const nearMountain: { x: number; y: number }[] = []
  ctx.fillStyle = '#7c6a55'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.78)
  for (let i = 0; i <= 12; i++) {
    const x = i / 12
    const y = 0.58 + fbm2(i * 1.1, 8, 91, 4) * 0.2
    nearMountain.push({ x, y })
    ctx.lineTo(x * w, y * h)
  }
  ctx.lineTo(w, h * 0.82)
  ctx.lineTo(0, h * 0.82)
  ctx.closePath()
  ctx.fill()
  polygons.push({ name: '赭墨近山', colorHex: '#7c6a55', points: [{ x: 0, y: 0.82 }, ...nearMountain, { x: 1, y: 0.82 }] })

  // 水面淡染
  const water = drawWash(ctx, w, h, 121, '#cdd9d2', 0.5, 0.88, 0.42, 0.08)
  polygons.push({ name: '淡绿水波', colorHex: '#cdd9d2', points: water })

  // 松树：深墨针叶团 + 树干
  const trunk: [number, number][] = [[0.72, 0.78], [0.74, 0.6], [0.73, 0.48]]
  drawBranch(ctx, w, h, trunk, 9, '#3a3229')
  polygons.push({ name: '松干', colorHex: '#3a3229', points: capsulePolygon(trunk, 0.024) })
  const needles = [
    { cx: 0.73, cy: 0.44, r: 0.09 },
    { cx: 0.68, cy: 0.5, r: 0.07 },
    { cx: 0.79, cy: 0.48, r: 0.075 },
  ]
  needles.forEach((n, i) => {
    const pts = drawWash(ctx, w, h, 301 + i * 13, '#334733', n.cx, n.cy, n.r, n.r * 0.85)
    polygons.push({ name: `松针团 ${i + 1}`, colorHex: '#334733', points: pts })
  })

  // 苔点
  const moss = drawWash(ctx, w, h, 401, '#4f6340', 0.3, 0.74, 0.05, 0.025)
  polygons.push({ name: '苔点', colorHex: '#4f6340', points: moss })

  return { blob: await toBlob(canvas), width: w, height: h, polygons }
}
