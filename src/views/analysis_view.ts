// 原画分析页：Lab 聚类自动拆版，参数可调，候选版块可采纳为正式版块
import type { Artwork, CandidatePlate, Plate, AnalysisParams } from '../domain/types.ts'
import { analyzeArtwork } from '../domain/segmentation.ts'
import { artworkRepo, plateRepo, pigmentRepo, paperRepo, settingsRepo } from '../data/repo.ts'
import { loadImageBitmap } from '../data/image_store.ts'
import { createImageViewer, type ImageViewer } from '../app/image_viewer.ts'
import { h, emptyState } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'
import { navigate } from '../app/router.ts'
import { hashString } from '../gl/mask_baker.ts'
import { registerDisposer } from '../app/lifecycle.ts'

const ANALYSIS_SIZE = 520

const DEFAULT_PARAMS: AnalysisParams = {
  clusterCount: 6,
  minAreaRatio: 0.008,
  toneLevels: 2,
  smoothRadius: 0.006,
}

export const renderAnalysis = async (root: HTMLElement, artworkId?: string): Promise<void> => {
  const artworks = await artworkRepo.list()
  if (artworks.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('empty', 44), '没有可分析的原画', '先在作品列表导入或载入示例'))
    return
  }
  const selected = artworks.find((a) => a.id === artworkId) ?? artworks[0]
  let params: AnalysisParams = { ...DEFAULT_PARAMS }
  let candidates: CandidatePlate[] = []
  let viewer: ImageViewer | null = null
  let highlighted = -1

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">原画分析</h1>
        <p class="page-sub">按颜色与浓淡自动拆分候选版块，种子化算法保证同参数结果恒定</p>
      </div>
      <select class="select" id="art-select" style="max-width:280px">
        ${artworks.map((a) => `<option value="${a.id}" ${a.id === selected.id ? 'selected' : ''}>${a.name}</option>`).join('')}
      </select>
    </div>
    <div class="split-view" style="grid-template-columns:1fr 340px">
      <div class="panel" style="min-height:560px"><div id="stage-host"></div></div>
      <div class="panel">
        <div class="panel-head">拆版参数</div>
        <div class="panel-body" id="param-panel"></div>
      </div>
    </div>
  `

  const stageHost = document.getElementById('stage-host')!
  const bitmap = await loadImageBitmap(selected.imageId)
  viewer = createImageViewer({
    bitmap,
    onRedraw: (v) => drawCandidates(v, candidates, highlighted),
  })
  registerDisposer(() => {
    viewer?.destroy()
    bitmap.close()
  })
  stageHost.replaceChildren(viewer.root)

  const runAnalysis = (): CandidatePlate[] => {
    const { data, width, height } = downscaleForAnalysis(bitmap)
    const seed = hashString(selected.id)
    candidates = analyzeArtwork({
      rgba: data,
      width,
      height,
      params,
      seed,
    })
    highlighted = -1
    drawCandidates(viewer!, candidates, highlighted)
    renderCandidateList()
    return candidates
  }

  const paramPanel = document.getElementById('param-panel')!
  paramPanel.append(buildParamControls(params, (next) => {
    params = next
  }, runAnalysis))

  const listHost = h('div', { style: 'margin-top:var(--sp-4)' })
  paramPanel.append(listHost)

  const renderCandidateList = (): void => {
    listHost.innerHTML = ''
    listHost.append(
      h('div', { class: 'row-between', style: 'margin-bottom:var(--sp-3)' }, [
        h('strong', { style: 'font-size:var(--fs-sm)' }, [`候选版块（${candidates.length}）`]),
        h('span', { class: 'muted' }, ['面积占比']),
      ]),
    )
    candidates.forEach((c, i) => {
      const row = h('div', {
        class: 'row-between',
        style: 'padding:var(--sp-2);border-radius:var(--radius);cursor:pointer',
      }, [
        h('span', { style: 'display:flex;gap:var(--sp-2);align-items:center' }, [
          h('span', { class: 'color-swatch', style: `background:${c.colorHex}` }),
          `版块 ${i + 1}`,
        ]),
        h('span', { class: 'muted' }, [`${(c.areaRatio * 100).toFixed(1)}%`]),
      ])
      row.addEventListener('mouseenter', () => {
        highlighted = i
        drawCandidates(viewer!, candidates, highlighted)
      })
      row.addEventListener('mouseleave', () => {
        highlighted = -1
        drawCandidates(viewer!, candidates, highlighted)
      })
      listHost.append(row)
    })

    const adoptBtn = document.createElement('button')
    adoptBtn.className = 'btn btn-primary btn-block'
    adoptBtn.style.marginTop = 'var(--sp-4)'
    adoptBtn.innerHTML = `${iconSvg('check')} 采纳为正式版块`
    adoptBtn.addEventListener('click', () => void adopt(selected, candidates))
    listHost.append(adoptBtn)
  }

  document.getElementById('art-select')?.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value
    navigate('analysis', id)
  })

  runAnalysis()
}

const buildParamControls = (
  params: AnalysisParams,
  onChange: (next: AnalysisParams) => void,
  onRun: () => void,
): HTMLElement => {
  const panel = h('div')
  const slider = (
    label: string, key: keyof AnalysisParams, min: number, max: number, step: number,
    percent = false,
  ): HTMLElement => {
    const wrap = h('div', { class: 'field' })
    wrap.innerHTML = `
      <label>${label} <span class="mono muted" id="val-${key}"></span></label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}" id="in-${key}" />
    `
    const input = wrap.querySelector<HTMLInputElement>(`#in-${key}`)!
    const val = wrap.querySelector<HTMLElement>(`#val-${key}`)!
    const sync = (): void => {
      const v = Number(input.value)
      val.textContent = percent ? `${(v * 100).toFixed(1)}%` : String(v)
      onChange({ ...params, [key]: v })
    }
    input.addEventListener('input', sync)
    sync()
    return wrap
  }
  panel.append(
    slider('候选色数（拆得粗 ↔ 碎）', 'clusterCount', 2, 14, 1),
    slider('最小版块面积占比', 'minAreaRatio', 0.002, 0.06, 0.002, true),
    slider('浓淡分层数', 'toneLevels', 1, 4, 1),
    slider('空间平滑半径', 'smoothRadius', 0.001, 0.02, 0.001),
  )
  const runBtn = document.createElement('button')
  runBtn.className = 'btn btn-block'
  runBtn.innerHTML = `${iconSvg('analysis')} 重新拆版`
  runBtn.addEventListener('click', onRun)
  panel.append(runBtn)
  return panel
}

const drawCandidates = (
  viewer: ImageViewer, candidates: CandidatePlate[], highlighted: number,
): void => {
  const ctx = viewer.overlay.getContext('2d')!
  const rect = viewer.overlay.getBoundingClientRect()
  ctx.clearRect(0, 0, rect.width, rect.height)
  candidates.forEach((c, i) => {
    const active = highlighted === -1 || highlighted === i
    ctx.lineWidth = highlighted === i ? 2.4 : 1.2
    ctx.strokeStyle = highlighted === i ? '#b23a33' : 'rgba(44,38,32,0.75)'
    ctx.fillStyle = hexWithAlpha(c.colorHex, highlighted === i ? 0.4 : 0.16)
    ctx.globalAlpha = active ? 1 : 0.25
    for (const poly of c.polygons) {
      ctx.beginPath()
      poly.forEach((p, idx) => {
        const pos = viewer.toCanvasPos(p.x, p.y)
        if (idx === 0) ctx.moveTo(pos.x, pos.y)
        else ctx.lineTo(pos.x, pos.y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}

const hexWithAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// 等比缩放到分析分辨率，返回 RGBA 与实际宽高
const downscaleForAnalysis = (
  bitmap: ImageBitmap,
): { data: Uint8ClampedArray; width: number; height: number } => {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(64, Math.round(bitmap.width * scale))
  const height = Math.max(64, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

const adopt = async (artwork: Artwork, candidates: CandidatePlate[]): Promise<void> => {
  const pigments = await pigmentRepo.list()
  const existing = await plateRepo.listByArtwork(artwork.id)
  if (existing.length > 0 && !window.confirm('已有版块将被本次采纳结果整体替换，确认继续？')) return
  for (const old of existing) await plateRepo.remove(old.id)
  const baseIdx = existing.length
  const plates: Plate[] = candidates.map((c, i): Plate => ({
    id: `plate_${artwork.id}_${Date.now().toString(36)}_${i}`,
    artworkId: artwork.id,
    name: `分析版块 ${baseIdx + i + 1}`,
    type: 'color',
    polygons: c.polygons,
    regMarks: [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }],
    pigmentId: pigments[0]?.id ?? '',
    concentration: 0.9,
    passes: 1,
    overprintGroup: `g${(i % 3) + 1}`,
    offsetXMm: 0,
    offsetYMm: 0,
    visible: true,
    locked: false,
    source: 'analysis',
    clusterId: c.clusterId,
  }))
  await plateRepo.saveMany(plates)
  const settings = await settingsRepo.get(artwork.id)
  const papers = await paperRepo.list()
  if (!settings) {
    await settingsRepo.save({
      artworkId: artwork.id,
      paperId: papers[0]?.id ?? '',
      order: plates.map((p) => p.id),
      expansionPctX: 0,
      expansionPctY: 0,
      bleedScale: 1,
      embossStrength: 0.09,
      lightAngleDeg: 315,
      lightElevationDeg: 35,
      lightIntensity: 0.9,
      ambient: 0.65,
      simMaxSize: 900,
    })
  } else {
    settings.order = plates.map((p) => p.id)
    await settingsRepo.save(settings)
  }
  toast(`已采纳 ${plates.length} 块版`)
  navigate('editor', artwork.id)
}
