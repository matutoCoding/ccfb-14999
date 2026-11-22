// 刻版图与工艺单：每块版出反向（镜像）刻版图，标注物理尺寸与规矩位置，支持打印与 PNG 导出
import type { Artwork, Paper, Pigment, Plate, SimSettings } from '../domain/types.ts'
import { artworkRepo, plateRepo, pigmentRepo, paperRepo, settingsRepo } from '../data/repo.ts'
import { loadImageBitmap } from '../data/image_store.ts'
import { h, emptyState, badge } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'
import { plateColor } from '../app/plate_draw.ts'
import { bbox, polygonArea } from '../domain/math_util.ts'
import { canvasToPngBlob } from '../data/image_store.ts'
import { saveImageBlob } from '../data/image_store.ts'

export const renderCarving = async (root: HTMLElement, artworkId?: string): Promise<void> => {
  const artworks = await artworkRepo.list()
  if (artworks.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('empty', 44), '没有可出图的作品', '先建版再来出刻版图'))
    return
  }
  const artwork = artworks.find((a) => a.id === artworkId) ?? artworks[0]
  const plates = await plateRepo.listByArtwork(artwork.id)
  const pigments = await pigmentRepo.list()
  const papers = await paperRepo.list()
  const settings = await settingsRepo.get(artwork.id)
  if (plates.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('carving', 44), '这幅作品还没有版块', '先完成分版编辑'))
    return
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">刻版图与工艺单 · ${artwork.name}</h1>
        <p class="page-sub">刻版需镜像上板，图中已做水平翻转；尺寸按作品物理幅面 ${artwork.physicalWidthMm} × ${artwork.physicalHeightMm} mm 换算</p>
      </div>
      <div class="toolbar">
        <button class="btn" id="export-all">${iconSvg('download')} 导出全部 PNG</button>
        <button class="btn btn-primary" id="print-btn">${iconSvg('print-icon')} 打印工艺单</button>
      </div>
    </div>
    <div id="process-sheet"></div>
    <div class="grid" id="plate-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))"></div>
  `

  const grid = document.getElementById('plate-grid')!
  const sheet = document.getElementById('process-sheet')!
  sheet.append(buildProcessSheet(artwork, plates, pigments, papers, settings))

  const ordered = orderPlates(plates, settings)
  const exports: { name: string; canvas: HTMLCanvasElement }[] = []
  for (const plate of ordered) {
    const { card, canvas } = buildPlateCard(plate, artwork, pigments)
    grid.append(card)
    exports.push({ name: plate.name, canvas })
  }

  document.getElementById('print-btn')?.addEventListener('click', () => {
    window.print()
  })
  document.getElementById('export-all')?.addEventListener('click', async () => {
    for (const item of exports) {
      const blob = await canvasToPngBlob(item.canvas)
      const safe = item.name.replace(/[^\w一-龥]+/g, '_')
      await saveImageBlob(`export_${artwork.id}_${safe}_${Date.now().toString(36)}`, blob)
    }
    toast(`已导出 ${exports.length} 张刻版图 PNG（存于浏览器 IndexedDB 图像库）`)
  })
}

const orderPlates = (plates: Plate[], settings: SimSettings | undefined): Plate[] => {
  if (!settings) return plates
  const map = new Map(plates.map((p) => [p.id, p]))
  return settings.order.map((id) => map.get(id)).filter((p): p is Plate => Boolean(p))
}

const buildPlateCard = (
  plate: Plate, artwork: Artwork, pigments: Pigment[],
): { card: HTMLElement; canvas: HTMLCanvasElement } => {
  const W = 480
  const H = Math.round((W * artwork.physicalHeightMm) / artwork.physicalWidthMm)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  drawCarvingCanvas(ctx, plate, artwork, W, H)

  const pigment = pigments.find((p) => p.id === plate.pigmentId)
  const box = bbox(plate.polygons.flat())
  const widthMm = (box.maxX - box.minX) * artwork.physicalWidthMm
  const heightMm = (box.maxY - box.minY) * artwork.physicalHeightMm

  const card = h('div', { class: 'card' }, [
    h('div', { class: 'row-between', style: 'margin-bottom:var(--sp-3)' }, [
      h('strong', { style: 'display:flex;gap:var(--sp-2);align-items:center;font-size:var(--fs-sm)' }, [
        h('span', { class: 'color-swatch', style: `background:${plateColor(plate.id)}` }),
        plate.name,
      ]),
      plate.type === 'emboss' ? badge('拱花', true) : badge('色版'),
    ]),
  ])
  const stage = h('div', { class: 'canvas-stage', style: 'height:auto;background:#fbf8f0' })
  canvas.style.width = '100%'
  canvas.style.height = 'auto'
  stage.append(canvas)
  card.append(stage)
  card.append(
    h('div', { class: 'muted', style: 'margin-top:var(--sp-3);font-size:var(--fs-xs);line-height:1.8' }, [
      `包络尺寸：${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm`,
      h('br'),
      `规矩点：${plate.regMarks.map((m) => `(${(m.x * artwork.physicalWidthMm).toFixed(1)}, ${(m.y * artwork.physicalHeightMm).toFixed(1)})`).join(' ')}`,
      h('br'),
      plate.type === 'color'
        ? `色料：${pigment?.name ?? '未指定'} · 浓度 ×${plate.concentration.toFixed(2)} · ${plate.passes} 遍 · 叠印组 ${plate.overprintGroup}`
        : `拱花压版 · 凹凸强度随推演参数`,
    ]),
  )
  return { card, canvas }
}

// 镜像刻版图：水平翻转多边形，墨线风格，标注尺寸与规矩十字
const drawCarvingCanvas = (
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  artwork: Artwork,
  W: number,
  H: number,
): void => {
  ctx.fillStyle = '#fbf8f0'
  ctx.fillRect(0, 0, W, H)
  // 纸边外框
  ctx.strokeStyle = '#c9c0ad'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1)

  const toPx = (nx: number, ny: number): [number, number] => [
    (1 - nx) * W, // 镜像翻转
    ny * H,
  ]
  ctx.save()
  ctx.strokeStyle = '#2c2620'
  ctx.fillStyle = plate.type === 'emboss' ? 'rgba(47,93,138,0.12)' : 'rgba(44,38,32,0.1)'
  ctx.lineWidth = 1.8
  ctx.lineJoin = 'round'
  for (const poly of plate.polygons) {
    ctx.beginPath()
    poly.forEach((p, i) => {
      const [x, y] = toPx(p.x, p.y)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // 规矩十字（镜像后仍标注实际坐标）
  ctx.strokeStyle = '#b23a33'
  ctx.lineWidth = 1.4
  ctx.setLineDash([4, 3])
  for (const mark of plate.regMarks) {
    const [x, y] = toPx(mark.x, mark.y)
    ctx.beginPath()
    ctx.moveTo(x - 10, y)
    ctx.lineTo(x + 10, y)
    ctx.moveTo(x, y - 10)
    ctx.lineTo(x, y + 10)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.restore()

  // 标题栏
  ctx.fillStyle = '#2c2620'
  ctx.font = '600 15px "PingFang SC", sans-serif'
  ctx.fillText(`${plate.name}（反向刻版图）`, 16, 28)
  ctx.font = '12px "Cascadia Code", monospace'
  ctx.fillStyle = '#64748b'
  ctx.fillText(
    `${artwork.physicalWidthMm}x${artwork.physicalHeightMm}mm | area ${(polygonArea(plate.polygons[0] ?? []) * 100).toFixed(1)}%`,
    16, H - 16,
  )
}

const buildProcessSheet = (
  artwork: Artwork,
  plates: Plate[],
  pigments: Pigment[],
  papers: Paper[],
  settings: SimSettings | undefined,
): HTMLElement => {
  const paper = papers.find((p) => p.id === settings?.paperId)
  const ordered = orderPlates(plates, settings)
  const card = h('div', { class: 'card', style: 'margin-bottom:var(--sp-5)' })
  card.append(h('strong', { style: 'font-size:var(--fs-base);display:block;margin-bottom:var(--sp-4)' }, [
    '木版水印工艺单',
  ]))
  const meta = h('div', { class: 'muted', style: 'margin-bottom:var(--sp-4);line-height:1.9' }, [
    `作品：${artwork.albumName} / ${artwork.name}`,
    h('br'),
    `幅面：${artwork.physicalWidthMm} × ${artwork.physicalHeightMm} mm · 用纸：${paper?.name ?? '未指定'}（厚 ${paper?.thicknessMm ?? 0}mm，吸水性 ${(paper?.absorbency ?? 0).toFixed(2)}）`,
    h('br'),
    `版数：${plates.length}（色版 ${plates.filter((p) => p.type === 'color').length} / 拱花 ${plates.filter((p) => p.type === 'emboss').length}）`,
  ])
  card.append(meta)
  const table = h('table', { class: 'table' })
  table.innerHTML = `
    <thead><tr><th>序</th><th>版名</th><th>类型</th><th>色料配方</th><th>浓度</th><th>遍数</th><th>叠印组</th><th>套准偏差 mm</th></tr></thead>
  `
  const tbody = document.createElement('tbody')
  ordered.forEach((plate, i) => {
    const pigment = pigments.find((p) => p.id === plate.pigmentId)
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="mono">${i + 1}</td>
      <td>${plate.name}</td>
      <td>${plate.type === 'emboss' ? '拱花' : '色版'}</td>
      <td>${plate.type === 'color' ? `${pigment?.name ?? ''} ${pigment?.colorHex ?? ''} / 透明 ${pigment?.transparency.toFixed(2) ?? ''}` : '—'}</td>
      <td class="mono">×${plate.concentration.toFixed(2)}</td>
      <td class="mono">${plate.passes}</td>
      <td>${plate.overprintGroup}</td>
      <td class="mono">${plate.offsetXMm.toFixed(1)}, ${plate.offsetYMm.toFixed(1)}</td>
    `
    tbody.append(tr)
  })
  table.append(tbody)
  card.append(table)
  return card
}
