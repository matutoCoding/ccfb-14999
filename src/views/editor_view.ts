// 分版编辑页：圈画新版、框选切版、多块合并、规矩标记与叠印组、套准微调
import type { Artwork, Pigment, Plate, Vec2 } from '../domain/types.ts'
import { artworkRepo, plateRepo, pigmentRepo } from '../data/repo.ts'
import { loadImageBitmap } from '../data/image_store.ts'
import { createImageViewer, type ImageViewer } from '../app/image_viewer.ts'
import { drawPlates, hitTestPlate, plateColor } from '../app/plate_draw.ts'
import { h, emptyState, swatch, badge } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'
import { navigate } from '../app/router.ts'
import { splitPolygonsByRect, type Rect } from '../domain/geometry.ts'
import { polygonArea, pointInPolygon } from '../domain/math_util.ts'
import { registerDisposer } from '../app/lifecycle.ts'

type Mode = 'select' | 'draw' | 'split' | 'mark'

export const renderEditor = async (root: HTMLElement, artworkId?: string): Promise<void> => {
  const artworks = await artworkRepo.list()
  if (artworks.length === 0) {
    root.innerHTML = ''
    root.append(emptyState(iconSvg('empty', 44), '没有可编辑的作品', '先导入原画或载入示例'))
    return
  }
  const artwork = artworks.find((a) => a.id === artworkId) ?? artworks[0]
  const bitmap = await loadImageBitmap(artwork.imageId)
  let plates = await plateRepo.listByArtwork(artwork.id)
  const pigments = await pigmentRepo.list()
  let mode: Mode = 'select'
  let selectedId: string | null = plates[0]?.id ?? null
  let draft: Vec2[] = []
  let rectStart: Vec2 | null = null
  let rectNow: Rect | null = null
  let viewer: ImageViewer

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">分版编辑 · ${artwork.name}</h1>
        <p class="page-sub">圈画版块范围，设定套准规矩与叠印关系；共 ${plates.length} 块版</p>
      </div>
      <div class="toolbar" id="mode-bar"></div>
    </div>
    <div class="split-view" style="grid-template-columns:1fr 360px">
      <div class="panel" style="min-height:580px"><div id="stage-host"></div></div>
      <div class="panel">
        <div class="panel-head row-between">
          <span>版块清单</span>
          ${badge(`${plates.length} 块`)}
        </div>
        <div class="panel-body" id="side-host" style="flex:1"></div>
      </div>
    </div>
  `

  viewer = createImageViewer({
    bitmap,
    onRedraw: (v) => {
      drawPlates(v, plates, { selectedId: selectedId ?? undefined, regMarks: true })
      drawDraft(v)
      drawSplitRect(v)
    },
  })
  const stageHost = document.getElementById('stage-host')!
  stageHost.replaceChildren(viewer.root)
  registerDisposer(() => {
    viewer.destroy()
    bitmap.close()
  })

  const drawDraft = (v: ImageViewer): void => {
    if (draft.length === 0) return
    const ctx = v.overlay.getContext('2d')!
    ctx.strokeStyle = '#b23a33'
    ctx.fillStyle = 'rgba(178,58,51,0.16)'
    ctx.lineWidth = 2
    ctx.beginPath()
    draft.forEach((p, i) => {
      const pos = v.toCanvasPos(p.x, p.y)
      if (i === 0) ctx.moveTo(pos.x, pos.y)
      else ctx.lineTo(pos.x, pos.y)
    })
    ctx.stroke()
  }
  const drawSplitRect = (v: ImageViewer): void => {
    if (!rectNow) return
    const ctx = v.overlay.getContext('2d')!
    const a = v.toCanvasPos(rectNow.minX, rectNow.minY)
    const b = v.toCanvasPos(rectNow.maxX, rectNow.maxY)
    ctx.strokeStyle = '#2f5d8a'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.8
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.setLineDash([])
  }

  const refresh = (): void => {
    drawPlates(viewer, plates, { selectedId: selectedId ?? undefined, regMarks: true })
    renderSide()
    const sub = root.querySelector('.page-sub')
    if (sub) sub.textContent = `圈画版块范围，设定套准规矩与叠印关系；共 ${plates.length} 块版`
  }

  // 工具模式条
  const modeBar = document.getElementById('mode-bar')!
  const modes: { key: Mode; label: string; icon: string }[] = [
    { key: 'select', label: '选择', icon: 'target' },
    { key: 'draw', label: '圈画新版', icon: 'edit' },
    { key: 'split', label: '框选切开', icon: 'split' },
    { key: 'mark', label: '落规矩', icon: 'plus' },
  ]
  modeBar.append(
    ...modes.map((m) => {
      const btn = document.createElement('button')
      btn.className = `btn${mode === m.key ? ' btn-primary' : ''}`
      btn.innerHTML = `${iconSvg(m.icon)} ${m.label}`
      btn.addEventListener('click', () => {
        mode = m.key
        draft = []
        rectNow = null
        modeBar.querySelectorAll('.btn').forEach((b) => b.classList.remove('btn-primary'))
        btn.classList.add('btn-primary')
        viewer.setPanEnabled(m.key === 'select')
      })
      return btn
    }),
  )

  // 画布交互
  viewer.root.addEventListener('pointerdown', (e) => {
    const p = viewer.toNormalized(e.clientX, e.clientY)
    if (mode === 'select') {
      const hit = hitTestPlate(plates, p.x, p.y)
      selectedId = hit?.id ?? null
      refresh()
    } else if (mode === 'draw') {
      draft.push(p)
      drawDraft(viewer)
    } else if (mode === 'split') {
      rectStart = p
      rectNow = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
    } else if (mode === 'mark') {
      const target = plates.find((pl) => pl.id === selectedId)
      if (!target) return toast('先在清单里选中一块版', 'error')
      target.regMarks.push(p)
      void plateRepo.save(target).then(() => {
        toast('规矩标记已添加')
        refresh()
      })
    }
  })
  viewer.root.addEventListener('pointermove', (e) => {
    if (mode === 'split' && rectStart) {
      const p = viewer.toNormalized(e.clientX, e.clientY)
      rectNow = {
        minX: Math.min(rectStart.x, p.x),
        minY: Math.min(rectStart.y, p.y),
        maxX: Math.max(rectStart.x, p.x),
        maxY: Math.max(rectStart.y, p.y),
      }
      drawPlates(viewer, plates, { selectedId: selectedId ?? undefined, regMarks: true })
      drawSplitRect(viewer)
    }
  })
  viewer.root.addEventListener('pointerup', async () => {
    if (mode === 'split' && rectNow && selectedId) {
      await splitSelected(rectNow)
    }
    rectStart = null
    rectNow = null
  })
  viewer.root.addEventListener('dblclick', async () => {
    if (mode === 'draw' && draft.length >= 3) await commitDrawnPlate()
  })

  const splitSelected = async (rect: Rect): Promise<void> => {
    const target = plates.find((p) => p.id === selectedId)
    if (!target) return
    const { inside, outside } = splitPolygonsByRect(target.polygons, rect)
    if (inside.length === 0 || outside.length === 0) {
      return toast('切割框没有把版块分成两部分', 'error')
    }
    target.polygons = outside
    const clone: Plate = {
      ...target,
      id: `plate_${artwork.id}_${Date.now().toString(36)}`,
      name: `${target.name} · 切块`,
      polygons: inside,
      regMarks: target.regMarks.map((m) => ({ ...m })),
      locked: false,
    }
    await plateRepo.save(target)
    await plateRepo.save(clone)
    plates = await plateRepo.listByArtwork(artwork.id)
    selectedId = clone.id
    toast('版块已切开')
    refresh()
  }

  const commitDrawnPlate = async (): Promise<void> => {
    const pts = draft
    draft = []
    if (polygonArea(pts) < 0.0005) return toast('圈画范围太小', 'error')
    const plate: Plate = {
      id: `plate_${artwork.id}_${Date.now().toString(36)}`,
      artworkId: artwork.id,
      name: `手画版块 ${plates.length + 1}`,
      type: 'color',
      polygons: [pts],
      regMarks: [{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }],
      pigmentId: pigments[0]?.id ?? '',
      concentration: 0.9,
      passes: 1,
      overprintGroup: 'g1',
      offsetXMm: 0,
      offsetYMm: 0,
      visible: true,
      locked: false,
      source: 'manual',
      clusterId: -1,
    }
    await plateRepo.save(plate)
    plates = await plateRepo.listByArtwork(artwork.id)
    selectedId = plate.id
    toast('新版块已保存，双击画布可继续圈画')
    refresh()
  }

  const sideHost = document.getElementById('side-host')!
  const renderSide = (): void => {
    sideHost.innerHTML = ''
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-2)' })
    for (const plate of plates) {
      const pigment = pigments.find((p) => p.id === plate.pigmentId)
      const row = h('div', {
        class: 'card',
        style: `padding:var(--sp-3);cursor:pointer;border-color:${
          selectedId === plate.id ? 'var(--primary)' : 'var(--border)'
        }`,
      }, [
        h('div', { class: 'row-between' }, [
          h('span', { style: 'display:flex;gap:var(--sp-2);align-items:center;font-weight:500' }, [
            h('span', { class: 'color-swatch', style: `background:${plateColor(plate.id)}` }),
            plate.name,
          ]),
          plate.type === 'emboss' ? badge('拱花', true) : badge('色版'),
        ]),
        h('div', { class: 'muted', style: 'margin-top:4px;font-size:var(--fs-xs)' }, [
          `${pigment?.name ?? '未指定色料'} · ${plate.passes} 遍 · 叠印组 ${plate.overprintGroup}`,
        ]),
      ])
      row.addEventListener('click', () => {
        selectedId = plate.id
        refresh()
      })
      list.append(row)
    }
    sideHost.append(list)

    const selected = plates.find((p) => p.id === selectedId)
    if (selected) sideHost.append(buildInspector(selected))
    sideHost.append(buildBatchActions())
  }

  const buildInspector = (plate: Plate): HTMLElement => {
    const card = h('div', { class: 'card', style: 'margin-top:var(--sp-4)' })
    const pigment = pigments.find((p) => p.id === plate.pigmentId)
    card.innerHTML = `
      <strong style="font-size:var(--fs-sm)">版块属性</strong>
      <div class="field" style="margin-top:var(--sp-3)">
        <label>名称</label>
        <input class="input" id="pl-name" value="${plate.name}" />
      </div>
      <div class="field">
        <label>色料</label>
        <select class="select" id="pl-pigment">
          ${pigments.map((p) => `<option value="${p.id}" ${p.id === plate.pigmentId ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>浓度倍率 <span class="mono muted" id="v-conc">${plate.concentration.toFixed(2)}</span></label>
        <input type="range" id="pl-conc" min="0.1" max="2" step="0.05" value="${plate.concentration}" /></div>
      <div class="field"><label>刷色遍数 <span class="mono muted" id="v-pass">${plate.passes}</span></label>
        <input type="range" id="pl-pass" min="1" max="4" step="1" value="${plate.passes}" /></div>
      <div class="field"><label>叠印组</label>
        <input class="input" id="pl-group" value="${plate.overprintGroup}" /></div>
      <div class="field"><label>横向套准偏差 mm <span class="mono muted" id="v-ox">${plate.offsetXMm.toFixed(2)}</span></label>
        <input type="range" id="pl-ox" min="-3" max="3" step="0.1" value="${plate.offsetXMm}" /></div>
      <div class="field"><label>纵向套准偏差 mm <span class="mono muted" id="v-oy">${plate.offsetYMm.toFixed(2)}</span></label>
        <input type="range" id="pl-oy" min="-3" max="3" step="0.1" value="${plate.offsetYMm}" /></div>
      <div class="toolbar">
        <button class="btn btn-sm" id="pl-toggle">${plate.visible ? '隐藏版块' : '显示版块'}</button>
        <button class="btn btn-sm" id="pl-del">${iconSvg('trash', 15)} 删除</button>
      </div>
    `
    if (pigment) card.prepend(swatch(pigment.colorHex))
    const bind = (id: string, event: 'input' | 'change', fn: (el: HTMLInputElement) => void): void => {
      card.querySelector<HTMLInputElement>(id)?.addEventListener(event, (e) => fn(e.target as HTMLInputElement))
    }
    const save = async (patch: Partial<Plate>): Promise<void> => {
      Object.assign(plate, patch)
      await plateRepo.save(plate)
    }
    bind('#pl-name', 'change', (el) => void save({ name: el.value }).then(refresh))
    bind('#pl-pigment', 'change', (el) => void save({ pigmentId: el.value }).then(refresh))
    bind('#pl-conc', 'input', (el) => {
      card.querySelector('#v-conc')!.textContent = Number(el.value).toFixed(2)
      void save({ concentration: Number(el.value) })
    })
    bind('#pl-pass', 'input', (el) => {
      card.querySelector('#v-pass')!.textContent = el.value
      void save({ passes: Number(el.value) })
    })
    bind('#pl-group', 'change', (el) => void save({ overprintGroup: el.value }))
    bind('#pl-ox', 'input', (el) => {
      card.querySelector('#v-ox')!.textContent = Number(el.value).toFixed(2)
      void save({ offsetXMm: Number(el.value) })
    })
    bind('#pl-oy', 'input', (el) => {
      card.querySelector('#v-oy')!.textContent = Number(el.value).toFixed(2)
      void save({ offsetYMm: Number(el.value) })
    })
    card.querySelector('#pl-toggle')?.addEventListener('click', async () => {
      await save({ visible: !plate.visible })
      refresh()
    })
    card.querySelector('#pl-del')?.addEventListener('click', async () => {
      if (!window.confirm(`删除版块「${plate.name}」？`)) return
      await plateRepo.remove(plate.id)
      plates = plates.filter((p) => p.id !== plate.id)
      selectedId = plates[0]?.id ?? null
      refresh()
    })
    return card
  }

  const buildBatchActions = (): HTMLElement => {
    const wrap = h('div', { style: 'margin-top:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-2)' })
    const mergeBtn = document.createElement('button')
    mergeBtn.className = 'btn btn-block'
    mergeBtn.innerHTML = `${iconSvg('merge')} 合并重叠版块`
    mergeBtn.addEventListener('click', () => void mergeOverlapping())
    const simBtn = document.createElement('button')
    simBtn.className = 'btn btn-primary btn-block'
    simBtn.innerHTML = `${iconSvg('print')} 去印制推演`
    simBtn.addEventListener('click', () => navigate('simulation', artwork.id))
    wrap.append(mergeBtn, simBtn)
    return wrap
  }

  // 合并：中心点落在另一版块多边形内的两块版并为一块
  const mergeOverlapping = async (): Promise<void> => {
    let merged = 0
    const used = new Set<string>()
    const next: Plate[] = []
    for (const plate of plates) {
      if (used.has(plate.id)) continue
      let target = plate
      for (const other of plates) {
        if (other.id === target.id || used.has(other.id)) continue
        const center = averagePoint(other.polygons[0] ?? [])
        if (center && target.polygons.some((poly) => pointInPolygon(center, poly))) {
          target = {
            ...target,
            polygons: [...target.polygons, ...other.polygons],
            name: `${target.name}+${other.name}`,
          }
          used.add(other.id)
          merged++
        }
      }
      used.add(target.id)
      next.push(target)
    }
    if (merged === 0) return toast('没有检测到重叠版块')
    for (const old of plates) await plateRepo.remove(old.id)
    await plateRepo.saveMany(next)
    plates = next
    refresh()
    toast(`已合并 ${merged} 处重叠`)
  }

  refresh()
}

const averagePoint = (poly: Vec2[]): Vec2 | null => {
  if (!poly || poly.length === 0) return null
  const sum = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / poly.length, y: sum.y / poly.length }
}
