// 推演侧栏：全局参数、印制顺序（上移/下移）、版块浓度与色料快调
import type { Artwork, Paper, Pigment, Plate, SimSettings } from '../domain/types.ts'
import { h, swatch } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { plateColor } from '../app/plate_draw.ts'

export interface SidebarOptions {
  artwork: Artwork
  plates: Plate[]
  pigments: Pigment[]
  papers: Paper[]
  settings: SimSettings
  callbacks: SidebarCallbacks
}

export interface SidebarCallbacks {
  onSettingsChange: (next: SimSettings) => void
  onReorder: (order: string[]) => Promise<void> | void
  onPlateChange: (plates: Plate[]) => Promise<void> | void
}

export const buildSimSidebar = (opts: SidebarOptions): HTMLElement => {
  const { plates, pigments, papers, settings, callbacks } = opts
  const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-5)' })

  // 全局参数
  const globalCard = h('div', { class: 'card' })
  globalCard.append(h('strong', { style: 'font-size:var(--fs-sm)' }, ['全局印制参数']))
  const paperSelect = document.createElement('select')
  paperSelect.className = 'select'
  paperSelect.innerHTML = papers
    .map((p) => `<option value="${p.id}" ${p.id === settings.paperId ? 'selected' : ''}>${p.name}</option>`)
    .join('')
  paperSelect.addEventListener('change', () =>
    callbacks.onSettingsChange({ ...settings, paperId: paperSelect.value }))
  globalCard.append(field('纸张', paperSelect))

  globalCard.append(
    slider('受潮横向伸缩 %', settings.expansionPctX, -2, 2, 0.05, (v) =>
      callbacks.onSettingsChange({ ...settings, expansionPctX: v })),
    slider('受潮纵向伸缩 %', settings.expansionPctY, -2, 2, 0.05, (v) =>
      callbacks.onSettingsChange({ ...settings, expansionPctY: v })),
    slider('晕化倍率', settings.bleedScale, 0.2, 2.5, 0.05, (v) =>
      callbacks.onSettingsChange({ ...settings, bleedScale: v })),
    slider('推演分辨率长边 px', settings.simMaxSize, 320, 1400, 20, (v) =>
      callbacks.onSettingsChange({ ...settings, simMaxSize: Math.round(v) })),
  )

  // 拱花侧光
  const lightCard = h('div', { class: 'card' })
  lightCard.append(h('strong', { style: 'font-size:var(--fs-sm);display:flex;gap:6px;align-items:center' }, [
    iconSvg('light', 16), '拱花侧光',
  ]))
  lightCard.append(
    slider('光源方位角 °', settings.lightAngleDeg, 0, 360, 5, (v) =>
      callbacks.onSettingsChange({ ...settings, lightAngleDeg: v })),
    slider('光源仰角 °（90 为正面光）', settings.lightElevationDeg, 5, 90, 1, (v) =>
      callbacks.onSettingsChange({ ...settings, lightElevationDeg: v })),
    slider('侧光强度', settings.lightIntensity, 0, 2, 0.05, (v) =>
      callbacks.onSettingsChange({ ...settings, lightIntensity: v })),
    slider('环境光', settings.ambient, 0.3, 1, 0.05, (v) =>
      callbacks.onSettingsChange({ ...settings, ambient: v })),
    slider('拱花凹凸强度', settings.embossStrength, 0.02, 0.3, 0.01, (v) =>
      callbacks.onSettingsChange({ ...settings, embossStrength: v })),
  )
  wrap.append(globalCard, lightCard)

  // 印制顺序与版块快调
  const orderCard = h('div', { class: 'card' })
  orderCard.append(h('strong', { style: 'font-size:var(--fs-sm)' }, [
    `印制顺序（${settings.order.length} 版，先印在上）`,
  ]))
  const orderList = h('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-2);margin-top:var(--sp-3)' })

  const plateById = new Map(plates.map((p) => [p.id, p]))
  settings.order.forEach((id, index) => {
    const plate = plateById.get(id)
    if (!plate) return
    const pigment = pigments.find((p) => p.id === plate.pigmentId)
    const row = h('div', {
      style: 'border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-2);display:flex;flex-direction:column;gap:var(--sp-2)',
    })
    const head = h('div', { class: 'row-between' }, [
      h('span', { style: 'display:flex;gap:var(--sp-2);align-items:center;font-weight:500' }, [
        h('span', { class: 'color-swatch', style: `background:${plateColor(plate.id)}` }),
        `${index + 1}. ${plate.name}`,
        plate.type === 'emboss' ? h('span', { class: 'badge badge-primary' }, ['拱花']) : h('span'),
      ]),
      h('span', { class: 'toolbar' }, [
        orderBtn('↑', index === 0, () => move(index, -1)),
        orderBtn('↓', index === settings.order.length - 1, () => move(index, 1)),
      ]),
    ])
    row.append(head)

    if (plate.type === 'color') {
      const pigmentSelect = document.createElement('select')
      pigmentSelect.className = 'select'
      pigmentSelect.innerHTML = pigments
        .map((p) => `<option value="${p.id}" ${p.id === plate.pigmentId ? 'selected' : ''}>${p.name}</option>`)
        .join('')
      pigmentSelect.addEventListener('change', () => {
        plate.pigmentId = pigmentSelect.value
        void callbacks.onPlateChange(plates)
      })
      const conc = inlineRange('浓度', plate.concentration, 0.1, 2, 0.05, (v) => {
        plate.concentration = v
        void callbacks.onPlateChange(plates)
      })
      const passes = inlineRange('遍数', plate.passes, 1, 4, 1, (v) => {
        plate.passes = Math.round(v)
        void callbacks.onPlateChange(plates)
      })
      row.append(field('色料', pigmentSelect), conc, passes)
      if (pigment) row.prepend(swatch(pigment.colorHex))
    }
    const offset = inlineRange('横向偏差 mm', plate.offsetXMm, -3, 3, 0.1, (v) => {
      plate.offsetXMm = v
      void callbacks.onPlateChange(plates)
    })
    row.append(offset)
    orderList.append(row)
  })
  orderCard.append(orderList)
  wrap.append(orderCard)

  const move = (index: number, delta: number): void => {
    const order = settings.order.slice()
    const target = index + delta
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    void callbacks.onReorder(order)
  }

  return wrap
}

const field = (label: string, control: HTMLElement): HTMLElement => {
  const wrap = h('div', { class: 'field', style: 'margin-bottom:var(--sp-3);margin-top:var(--sp-2)' })
  wrap.append(h('label', {}, [label]), control)
  return wrap
}

const slider = (
  label: string, value: number, min: number, max: number, step: number,
  onInput: (v: number) => void,
): HTMLElement => {
  const wrap = h('div', { class: 'field' })
  const valueEl = h('span', { class: 'mono muted' }, [String(value)])
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    valueEl.textContent = String(v)
    onInput(v)
  })
  wrap.append(h('label', { style: 'display:flex;justify-content:space-between' }, [label, valueEl]), input)
  return wrap
}

const inlineRange = (
  label: string, value: number, min: number, max: number, step: number,
  onInput: (v: number) => void,
): HTMLElement => {
  const wrap = h('div')
  const valueEl = h('span', { class: 'mono muted' }, [String(value)])
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    valueEl.textContent = String(v)
    onInput(v)
  })
  wrap.append(h('label', { style: 'display:flex;justify-content:space-between;font-size:var(--fs-xs);color:var(--text-muted)' }, [label, valueEl]), input)
  return wrap
}

const orderBtn = (text: string, disabled: boolean, onClick: () => void): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.className = 'btn btn-sm'
  btn.textContent = text
  btn.disabled = disabled
  btn.addEventListener('click', onClick)
  return btn
}
