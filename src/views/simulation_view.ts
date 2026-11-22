// 印制推演页：逐版 Beer-Lambert 叠印、拱花侧光、套准偏差、色差定位、确定性自检
import type { Artwork, Paper, Plate, SimRun, SimSettings } from '../domain/types.ts'
import { artworkRepo, plateRepo, pigmentRepo, paperRepo, settingsRepo, runRepo } from '../data/repo.ts'
import { loadImageBitmap } from '../data/image_store.ts'
import { SimEngine, makeSimRun, type EnginePlate, type RunStats } from '../gl/sim_engine.ts'
import { hashString } from '../gl/mask_baker.ts'
import { emptyState } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'
import { buildSimSidebar, type SidebarCallbacks } from './sim_controls.ts'
import { renderHeatmapToCanvas } from '../gl/heatmap_canvas.ts'
import { registerDisposer } from '../app/lifecycle.ts'

type ViewMode = 'result' | 'reference' | 'heatmap'

export const renderSimulation = async (root: HTMLElement, artworkId?: string): Promise<void> => {
  const artworks = await artworkRepo.list()
  if (artworks.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('empty', 44), '没有可推演的作品', '先导入原画或载入示例'))
    return
  }
  const artwork = artworks.find((a) => a.id === artworkId) ?? artworks[0]
  let plates = await plateRepo.listByArtwork(artwork.id)
  const pigments = await pigmentRepo.list()
  const papers = await paperRepo.list()
  if (plates.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('layers', 44), '这幅作品还没有版块', '先到原画分析或分版编辑里建版'))
    return
  }
  let settings = await ensureSettings(artwork.id, plates, papers)
  const refBitmap = await loadImageBitmap(artwork.imageId)

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">印制推演 · ${artwork.name}</h1>
        <p class="page-sub" id="status-line">${plates.length} 块版 · 等待首次推演</p>
      </div>
      <div class="toolbar" id="view-bar">
        <button class="btn btn-sm" data-view="result">推演成品</button>
        <button class="btn btn-sm" data-view="reference">原画对照</button>
        <button class="btn btn-sm" data-view="heatmap">色差热图</button>
        <button class="btn btn-sm" id="self-check">${iconSvg('check', 15)} 一致性自检</button>
      </div>
    </div>
    <div class="split-view" style="grid-template-columns:1fr 360px">
      <div class="panel" style="min-height:600px">
        <div class="panel-head row-between">
          <span id="canvas-title">推演成品</span>
          <span id="checksum-line" class="mono muted"></span>
        </div>
        <div class="panel-body" id="canvas-host" style="display:grid;place-items:center;background:var(--paper)"></div>
      </div>
      <div class="panel"><div class="panel-head">印制参数与顺序</div>
        <div class="panel-body scroll-y" id="side-host" style="max-height:70vh"></div></div>
    </div>
  `

  // 离屏 WebGL canvas 跑推演，可见 2D canvas 负责呈现三种视图
  const glCanvas = document.createElement('canvas')
  const displayCanvas = document.createElement('canvas')
  displayCanvas.style.maxWidth = '100%'
  displayCanvas.style.maxHeight = '64vh'
  displayCanvas.style.boxShadow = 'var(--shadow)'
  const displayCtx = displayCanvas.getContext('2d')!
  document.getElementById('canvas-host')!.append(displayCanvas)

  const engine = new SimEngine(glCanvas)
  registerDisposer(() => {
    engine.dispose()
    refBitmap.close()
  })
  let viewMode: ViewMode = 'result'
  let lastStats: RunStats | null = null
  let lastSim: Uint8ClampedArray | null = null
  let rerunTimer = 0
  let running = false
  let rerunQueued = false
  let lastReason = ''

  const orderedPlates = (): EnginePlate[] =>
    settings.order
      .map((id) => plates.find((p) => p.id === id))
      .filter((p): p is Plate => Boolean(p))
      .map((plate) => ({
        plate,
        pigment: pigments.find((pg) => pg.id === plate.pigmentId) ?? pigments[0],
      }))

  const present = (): void => {
    if (!lastStats) return
    displayCanvas.width = lastStats.width
    displayCanvas.height = lastStats.height
    if (viewMode === 'result') {
      displayCtx.putImageData(new ImageData(lastSim!, lastStats.width, lastStats.height), 0, 0)
      document.getElementById('canvas-title')!.textContent = '推演成品（线性光 Beer-Lambert 叠印）'
    } else if (viewMode === 'reference') {
      displayCtx.drawImage(refBitmap, 0, 0, lastStats.width, lastStats.height)
      document.getElementById('canvas-title')!.textContent = '原画参考'
    } else {
      renderHeatmapToCanvas(
        displayCanvas,
        new ImageData(lastSim!, lastStats.width, lastStats.height),
        refBitmap,
      )
      document.getElementById('canvas-title')!.textContent = '色差热图（绿→黄→红，ΔE 0~20）'
    }
    document.querySelectorAll<HTMLElement>('#view-bar [data-view]').forEach((b) =>
      b.classList.toggle('btn-primary', b.dataset.view === viewMode))
  }

  const run = async (reason: string): Promise<void> => {
    if (running) {
      // 推演进行中（掩码首次烘焙可能较慢），记下最新请求，结束后补跑
      rerunQueued = true
      lastReason = reason
      return
    }
    running = true
    try {
      const paper = papers.find((p) => p.id === settings.paperId) ?? papers[0]
      const start = performance.now()
      const rawStats = engine.run({
        plates: orderedPlates(),
        paper,
        settings,
        seedBase: hashString(artwork.id),
        physicalWidthMm: artwork.physicalWidthMm,
        physicalHeightMm: artwork.physicalHeightMm,
      }, artwork.width, artwork.height)
      lastSim = engine.readCanvas()
      const refRgba = sampleReference(refBitmap, rawStats.width, rawStats.height)
      const stats = engine.compareReference(refRgba, lastSim, 2, rawStats.plateIndexToId)
      stats.timingMs = performance.now() - start
      lastStats = stats
      await runRepo.save(makeSimRun(artwork.id, stats, plates.length))
      document.getElementById('status-line')!.textContent =
        `${plates.length} 块版 · ${reason} · 耗时 ${stats.timingMs.toFixed(0)} ms · 均值ΔE ${stats.meanDE.toFixed(2)} · P95 ${stats.p95DE.toFixed(2)} · 峰值 ${stats.maxDE.toFixed(2)}`
      document.getElementById('checksum-line')!.textContent = `校验和 ${stats.checksum}`
      present()
    } catch (err) {
      toast(err instanceof Error ? err.message : '推演失败', 'error', 4000)
      rerunQueued = false
    } finally {
      running = false
    }
    if (rerunQueued) {
      rerunQueued = false
      await run(lastReason || '参数变更')
    }
  }

  // 点击画面定位责任版块
  displayCanvas.addEventListener('click', (e) => {
    if (!lastStats) return
    const rect = displayCanvas.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    const index = engine.locatePlateIndex(nx, ny)
    const plateId = lastStats.plateIndexToId[index]
    const plate = plates.find((p) => p.id === plateId)
    if (plate) toast(`该位置最后落色：${plate.name}（第 ${index} 版）`)
    else toast('该位置为纸基，无版块落色')
  })

  document.getElementById('view-bar')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-view]')
    if (!btn) return
    viewMode = btn.dataset.view as ViewMode
    present()
  })

  // 一致性自检：同参数连跑两次，逐像素比对
  document.getElementById('self-check')?.addEventListener('click', async () => {
    const first = engine.readCanvas()
    await run('自检第二次推演')
    const second = engine.readCanvas()
    const same = first.length === second.length && first.every((v, i) => v === second[i])
    if (same) toast(`自检通过：两次推演 ${first.length / 4} 个像素完全一致`)
    else toast('自检失败：两次结果存在差异，请检查随机源', 'error')
  })

  const callbacks: SidebarCallbacks = {
    onSettingsChange: (next: SimSettings) => {
      settings = next
      void settingsRepo.save(settings)
      window.clearTimeout(rerunTimer)
      rerunTimer = window.setTimeout(() => void run('参数变更'), 120)
    },
    onReorder: async (nextOrder: string[]) => {
      settings.order = nextOrder
      await settingsRepo.save(settings)
      await run('印制顺序调整')
    },
    onPlateChange: async (nextPlates: Plate[]) => {
      plates = nextPlates
      await plateRepo.saveMany(plates)
      window.clearTimeout(rerunTimer)
      rerunTimer = window.setTimeout(() => void run('版块颜色调整'), 60)
    },
  }

  document.getElementById('side-host')!.append(buildSimSidebar({
    artwork, plates, pigments, papers, settings, callbacks,
  }))
  await run('首次推演')
}

const ensureSettings = async (
  artworkId: string,
  plates: Plate[],
  papers: Paper[],
): Promise<SimSettings> => {
  const existing = await settingsRepo.get(artworkId)
  if (existing) {
    const known = new Set(existing.order)
    for (const p of plates) if (!known.has(p.id)) existing.order.push(p.id)
    existing.order = existing.order.filter((id) => plates.some((p) => p.id === id))
    return existing
  }
  const created: SimSettings = {
    artworkId,
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
  }
  await settingsRepo.save(created)
  return created
}

const sampleReference = (
  bitmap: ImageBitmap, width: number, height: number,
): Uint8ClampedArray => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

export const recentRuns = async (artworkId: string): Promise<SimRun[]> => {
  const runs = await runRepo.listByArtwork(artworkId)
  return runs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)
}
