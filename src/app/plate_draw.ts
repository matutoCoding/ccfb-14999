// 版块在查看器覆盖层上的统一绘制：轮廓、填充、规矩线
import type { Plate } from '../domain/types.ts'
import type { ImageViewer } from './image_view.ts'

// 稳定的版块配色：按 id 哈希取色，避免随机色；中性低饱和
const OUTLINE_COLORS = [
  '#b23a33', '#2f5d8a', '#5d7a4a', '#a06a3c', '#7a4a8a',
  '#3d7a7a', '#9e3a4b', '#6b5a2e', '#4a5d8a', '#8a5a3a',
]

export const plateColor = (id: string): string => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return OUTLINE_COLORS[h % OUTLINE_COLORS.length]
}

export const hexToRgba = (hex: string, alpha: number): string => {
  const s = hex.replace('#', '')
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export interface DrawOptions {
  selectedId?: string
  hiddenIds?: Set<string>
  regMarks?: boolean
}

export const drawPlates = (
  viewer: ImageViewer,
  plates: Plate[],
  options: DrawOptions = {},
): void => {
  const ctx = viewer.overlay.getContext('2d')!
  const rect = viewer.overlay.getBoundingClientRect()
  ctx.clearRect(0, 0, rect.width, rect.height)
  for (const plate of plates) {
    if (options.hiddenIds?.has(plate.id) || !plate.visible) continue
    const color = plateColor(plate.id)
    const selected = options.selectedId === plate.id
    ctx.lineWidth = selected ? 2.6 : 1.4
    ctx.strokeStyle = selected ? '#b23a33' : color
    ctx.fillStyle = hexToRgba(color, plate.type === 'emboss' ? 0.1 : 0.14)
    ctx.setLineDash(plate.type === 'emboss' ? [6, 4] : [])
    for (const poly of plate.polygons) {
      ctx.beginPath()
      poly.forEach((p, i) => {
        const pos = viewer.toCanvasPos(p.x, p.y)
        if (i === 0) ctx.moveTo(pos.x, pos.y)
        else ctx.lineTo(pos.x, pos.y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.setLineDash([])
    if (options.regMarks) drawRegMarks(ctx, viewer, plate, selected)
  }
}

const drawRegMarks = (
  ctx: CanvasRenderingContext2D,
  viewer: ImageViewer,
  plate: Plate,
  selected: boolean,
): void => {
  if (!selected) return
  ctx.save()
  ctx.strokeStyle = '#2f5d8a'
  ctx.lineWidth = 1.6
  ctx.setLineDash([3, 3])
  for (const mark of plate.regMarks) {
    const { x, y } = viewer.toCanvasPos(mark.x, mark.y)
    const r = 9
    ctx.beginPath()
    ctx.moveTo(x - r, y)
    ctx.lineTo(x + r, y)
    ctx.moveTo(x, y - r)
    ctx.lineTo(x, y + r)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

// 命中检测：归一化点落在哪个版块的多边形内，返回最上层版块 id
export const hitTestPlate = (
  plates: Plate[],
  nx: number,
  ny: number,
): Plate | null => {
  const point = { x: nx, y: ny }
  for (let i = plates.length - 1; i >= 0; i--) {
    const plate = plates[i]
    if (!plate.visible) continue
    for (const poly of plate.polygons) {
      if (inside(point, poly)) return plate
    }
  }
  return null
}

const inside = (
  p: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) hit = !hit
  }
  return hit
}
