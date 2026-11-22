// 原画查看器：滚轮以指针为锚点缩放，拖拽平移，双击复位，支持覆盖层
import { h } from './dom.ts'
import { iconSvg } from './icons.ts'

export interface ImageViewer {
  root: HTMLElement
  canvas: HTMLCanvasElement
  bitmap: ImageBitmap
  // 归一化坐标 -> 画布 CSS 坐标
  toCanvasPos: (nx: number, ny: number) => { x: number; y: number }
  // 画布 CSS 坐标 -> 归一化
  toNormalized: (clientX: number, clientY: number) => { x: number; y: number }
  setZoom: (z: number) => void
  getZoom: () => number
  reset: () => void
  overlay: HTMLCanvasElement
  redraw: () => void
  // 为 false 时禁用内置平移与双击复位，交由外部页面接管指针
  setPanEnabled: (enabled: boolean) => void
  // 解绑 ResizeObserver；位图生命周期由调用方管理
  destroy: () => void
}

interface ViewerOptions {
  bitmap: ImageBitmap
  onRedraw?: (v: ImageViewer) => void
}

export const createImageViewer = (opts: ViewerOptions): ImageViewer => {
  const { bitmap } = opts
  const stage = h('div', { class: 'canvas-stage' }) as HTMLElement
  stage.style.height = '560px'
  const canvas = document.createElement('canvas')
  const overlay = document.createElement('canvas')
  overlay.style.position = 'absolute'
  overlay.style.inset = '0'
  overlay.style.pointerEvents = 'none'
  stage.append(canvas, overlay)

  let scale = 1
  let offsetX = 0
  let offsetY = 0
  let drag: { x: number; y: number; ox: number; oy: number } | null = null
  let panEnabled = true

  const fit = (): void => {
    const rect = stage.getBoundingClientRect()
    scale = Math.min(rect.width / bitmap.width, rect.height / bitmap.height)
    offsetX = (rect.width - bitmap.width * scale) / 2
    offsetY = (rect.height - bitmap.height * scale) / 2
    resizeCanvases(rect)
  }

  const resizeCanvases = (rect: DOMRect): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    for (const c of [canvas, overlay]) {
      c.width = Math.round(rect.width * dpr)
      c.height = Math.round(rect.height * dpr)
      c.style.width = `${rect.width}px`
      c.style.height = `${rect.height}px`
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  const drawImage = (): void => {
    const ctx = canvas.getContext('2d')!
    const rect = stage.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(bitmap, offsetX, offsetY, bitmap.width * scale, bitmap.height * scale)
  }

  const redraw = (): void => {
    drawImage()
    opts.onRedraw?.(viewer)
  }

  const viewer: ImageViewer = {
    root: stage,
    canvas,
    overlay,
    bitmap,
    toCanvasPos: (nx, ny) => ({
      x: offsetX + nx * bitmap.width * scale,
      y: offsetY + ny * bitmap.height * scale,
    }),
    toNormalized: (clientX, clientY) => {
      const rect = stage.getBoundingClientRect()
      const x = (clientX - rect.left - offsetX) / (bitmap.width * scale)
      const y = (clientY - rect.top - offsetY) / (bitmap.height * scale)
      return { x, y }
    },
    setZoom: (z) => {
      scale = Math.max(0.1, Math.min(12, z))
      redraw()
    },
    getZoom: () => scale,
    reset: () => {
      fit()
      redraw()
    },
    overlay,
    redraw,
    setPanEnabled: (enabled: boolean) => {
      panEnabled = enabled
      stage.style.cursor = enabled ? 'grab' : 'crosshair'
      if (!enabled) drag = null
    },
    destroy: () => ro.disconnect(),
  }

  stage.addEventListener('wheel', (e) => {
    if (!panEnabled) return
    e.preventDefault()
    const rect = stage.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const next = Math.max(0.1, Math.min(12, scale * (e.deltaY < 0 ? 1.12 : 0.89)))
    // 以指针为锚点
    offsetX = mx - ((mx - offsetX) / scale) * next
    offsetY = my - ((my - offsetY) / scale) * next
    scale = next
    redraw()
  }, { passive: false })

  stage.addEventListener('pointerdown', (e) => {
    if (!panEnabled) return
    stage.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY }
    stage.style.cursor = 'grabbing'
  })
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return
    offsetX = drag.ox + (e.clientX - drag.x)
    offsetY = drag.oy + (e.clientY - drag.y)
    redraw()
  })
  const endDrag = (): void => {
    drag = null
    stage.style.cursor = 'grab'
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('dblclick', () => {
    if (panEnabled) viewer.reset()
  })
  stage.style.cursor = 'grab'

  // 缩放工具条
  const bar = h('div', {
    class: 'toolbar',
    style: 'position:absolute;right:12px;bottom:12px;background:var(--surface);padding:4px;border-radius:8px;box-shadow:var(--shadow);border:1px solid var(--border)',
  }, [
    zoomBtn('zoom-out', () => viewer.setZoom(scale / 1.25)),
    zoomBtn('zoom-in', () => viewer.setZoom(scale * 1.25)),
    zoomBtn('target', () => viewer.reset()),
  ])
  stage.append(bar)

  const ro = new ResizeObserver(() => {
    fit()
    redraw()
  })
  ro.observe(stage)
  queueMicrotask(() => {
    fit()
    redraw()
  })

  return viewer
}

const zoomBtn = (icon: string, onClick: () => void): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'btn btn-ghost btn-sm'
  btn.innerHTML = iconSvg(icon, 16)
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return btn
}
