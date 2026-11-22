// 色料与纸张页：水色（颜色/浓度/透明度）与宣纸（厚度/吸水性/纤维方向）建库
import type { FiberDirection, Paper, Pigment } from '../domain/types.ts'
import { pigmentRepo, paperRepo } from '../data/repo.ts'
import { h } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'

const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.floor(performance.now() * 1000).toString(36)}`

export const renderMaterials = async (root: HTMLElement): Promise<void> => {
  const [pigments, papers] = await Promise.all([pigmentRepo.list(), paperRepo.list()])
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">色料与纸张</h1>
        <p class="page-sub">水色按颜色、浓度、透明度建库；宣纸按厚度、吸水性与纤维方向建库</p>
      </div>
    </div>
    <div class="split-view" style="grid-template-columns:1fr 1fr;min-height:auto">
      <div class="panel"><div class="panel-head row-between"><span>水色颜料（${pigments.length}）</span>
        <button class="btn btn-sm btn-primary" id="add-pigment">${iconSvg('plus', 15)} 新建色料</button></div>
        <div class="panel-body" id="pigment-host"></div></div>
      <div class="panel"><div class="panel-head row-between"><span>宣纸（${papers.length}）</span>
        <button class="btn btn-sm btn-primary" id="add-paper">${iconSvg('plus', 15)} 新建纸张</button></div>
        <div class="panel-body" id="paper-host"></div></div>
    </div>
  `

  const pigmentHost = document.getElementById('pigment-host')!
  const paperHost = document.getElementById('paper-host')!

  const renderPigments = async (): Promise<void> => {
    const list = await pigmentRepo.list()
    pigmentHost.innerHTML = ''
    if (list.length === 0) {
      pigmentHost.append(h('div', { class: 'empty-state' }, [h('strong', {}, ['暂无色料'])]))
      return
    }
    const table = h('table', { class: 'table' })
    table.innerHTML = `
      <thead><tr><th>颜色</th><th>名称</th><th>浓度</th><th>透明度</th><th></th></tr></thead>
    `
    const tbody = document.createElement('tbody')
    for (const p of list) {
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td><span class="color-swatch" style="background:${p.colorHex}"></span></td>
        <td>${p.name}<div class="muted mono" style="font-size:12px">${p.colorHex}</div></td>
        <td class="mono">${p.concentration.toFixed(2)}</td>
        <td class="mono">${p.transparency.toFixed(2)}</td>
        <td style="text-align:right"><button class="btn btn-sm" data-edit>${iconSvg('edit', 14)}</button>
        <button class="btn btn-sm" data-del>${iconSvg('trash', 14)}</button></td>
      `
      tr.querySelector('[data-edit]')?.addEventListener('click', () => void editPigment(p))
      tr.querySelector('[data-del]')?.addEventListener('click', () => void removePigment(p))
      tbody.append(tr)
    }
    table.append(tbody)
    pigmentHost.append(table)
  }

  const renderPapers = async (): Promise<void> => {
    const list = await paperRepo.list()
    paperHost.innerHTML = ''
    if (list.length === 0) {
      paperHost.append(h('div', { class: 'empty-state' }, [h('strong', {}, ['暂无纸张'])]))
      return
    }
    const table = h('table', { class: 'table' })
    table.innerHTML = `
      <thead><tr><th>纸基</th><th>名称</th><th>厚度 mm</th><th>吸水性</th><th>纤维</th><th></th></tr></thead>
    `
    const tbody = document.createElement('tbody')
    const fiberLabel: Record<FiberDirection, string> = {
      none: '无定向', horizontal: '横向', vertical: '纵向',
    }
    for (const p of list) {
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td><span class="color-swatch" style="background:${p.baseHex}"></span></td>
        <td>${p.name}<div class="muted" style="font-size:12px">${p.note}</div></td>
        <td class="mono">${p.thicknessMm.toFixed(2)}</td>
        <td class="mono">${p.absorbency.toFixed(2)}</td>
        <td>${fiberLabel[p.fiberDirection]}</td>
        <td style="text-align:right"><button class="btn btn-sm" data-edit>${iconSvg('edit', 14)}</button>
        <button class="btn btn-sm" data-del>${iconSvg('trash', 14)}</button></td>
      `
      tr.querySelector('[data-edit]')?.addEventListener('click', () => void editPaper(p))
      tr.querySelector('[data-del]')?.addEventListener('click', () => void removePaper(p))
      tbody.append(tr)
    }
    table.append(tbody)
    paperHost.append(table)
  }

  const editPigment = async (origin?: Pigment): Promise<void> => {
    const draft: Pigment = origin
      ? { ...origin }
      : { id: uid('pig'), name: '新水色', colorHex: '#5d7a4a', concentration: 0.5, transparency: 0.5, note: '' }
    const dialog = openDialog(origin ? '编辑色料' : '新建色料')
    dialog.body.innerHTML = `
      <div class="field"><label>名称</label><input class="input" id="d-name" value="${draft.name}" /></div>
      <div class="field"><label>水色颜色</label><input type="color" id="d-color" value="${draft.colorHex}" style="height:40px;padding:2px" /></div>
      <div class="field"><label>标准浓度 <span class="mono muted" id="d-conc-v">${draft.concentration}</span></label>
        <input type="range" id="d-conc" min="0.05" max="1" step="0.05" value="${draft.concentration}" /></div>
      <div class="field"><label>透明度（0 不透 ~ 1 极透明）<span class="mono muted" id="d-trans-v">${draft.transparency}</span></label>
        <input type="range" id="d-trans" min="0" max="1" step="0.05" value="${draft.transparency}" /></div>
      <div class="field"><label>备注</label><input class="input" id="d-note" value="${draft.note}" /></div>
    `
    dialog.body.querySelector<HTMLInputElement>('#d-conc')?.addEventListener('input', (e) => {
      dialog.body.querySelector('#d-conc-v')!.textContent = (e.target as HTMLInputElement).value
    })
    dialog.body.querySelector<HTMLInputElement>('#d-trans')?.addEventListener('input', (e) => {
      dialog.body.querySelector('#d-trans-v')!.textContent = (e.target as HTMLInputElement).value
    })
    dialog.onConfirm(async () => {
      draft.name = dialog.body.querySelector<HTMLInputElement>('#d-name')!.value
      draft.colorHex = dialog.body.querySelector<HTMLInputElement>('#d-color')!.value
      draft.concentration = Number(dialog.body.querySelector<HTMLInputElement>('#d-conc')!.value)
      draft.transparency = Number(dialog.body.querySelector<HTMLInputElement>('#d-trans')!.value)
      draft.note = dialog.body.querySelector<HTMLInputElement>('#d-note')!.value
      await pigmentRepo.save(draft)
      toast(`已保存色料 ${draft.name}`)
      await renderPigments()
    })
  }

  const editPaper = async (origin?: Paper): Promise<void> => {
    const draft: Paper = origin
      ? { ...origin }
      : {
          id: uid('paper'), name: '新宣纸', thicknessMm: 0.12, absorbency: 0.6,
          fiberDirection: 'none', baseHex: '#f5efe2', roughness: 0.45, note: '',
        }
    const dialog = openDialog(origin ? '编辑纸张' : '新建纸张')
    dialog.body.innerHTML = `
      <div class="field"><label>名称</label><input class="input" id="d-name" value="${draft.name}" /></div>
      <div class="field"><label>纸基色</label><input type="color" id="d-base" value="${draft.baseHex}" style="height:40px;padding:2px" /></div>
      <div class="field"><label>厚度 mm <span class="mono muted" id="d-thick-v">${draft.thicknessMm}</span></label>
        <input type="range" id="d-thick" min="0.05" max="0.3" step="0.01" value="${draft.thicknessMm}" /></div>
      <div class="field"><label>吸水性 <span class="mono muted" id="d-abs-v">${draft.absorbency}</span></label>
        <input type="range" id="d-abs" min="0.1" max="0.95" step="0.05" value="${draft.absorbency}" /></div>
      <div class="field"><label>纸面粗糙度 <span class="mono muted" id="d-rough-v">${draft.roughness}</span></label>
        <input type="range" id="d-rough" min="0.1" max="0.9" step="0.05" value="${draft.roughness}" /></div>
      <div class="field"><label>纤维方向</label>
        <select class="select" id="d-fiber">
          <option value="none" ${draft.fiberDirection === 'none' ? 'selected' : ''}>无定向</option>
          <option value="horizontal" ${draft.fiberDirection === 'horizontal' ? 'selected' : ''}>横向（顺横丝晕化更远）</option>
          <option value="vertical" ${draft.fiberDirection === 'vertical' ? 'selected' : ''}>纵向</option>
        </select></div>
      <div class="field"><label>备注</label><input class="input" id="d-note" value="${draft.note}" /></div>
    `
    const bindLabel = (id: string, labelId: string): void =>
      dialog.body.querySelector<HTMLInputElement>(id)?.addEventListener('input', (e) => {
        dialog.body.querySelector(labelId)!.textContent = (e.target as HTMLInputElement).value
      })
    bindLabel('#d-thick', '#d-thick-v')
    bindLabel('#d-abs', '#d-abs-v')
    bindLabel('#d-rough', '#d-rough-v')
    dialog.onConfirm(async () => {
      draft.name = dialog.body.querySelector<HTMLInputElement>('#d-name')!.value
      draft.baseHex = dialog.body.querySelector<HTMLInputElement>('#d-base')!.value
      draft.thicknessMm = Number(dialog.body.querySelector<HTMLInputElement>('#d-thick')!.value)
      draft.absorbency = Number(dialog.body.querySelector<HTMLInputElement>('#d-abs')!.value)
      draft.roughness = Number(dialog.body.querySelector<HTMLInputElement>('#d-rough')!.value)
      draft.fiberDirection = dialog.body.querySelector<HTMLSelectElement>('#d-fiber')!.value as FiberDirection
      draft.note = dialog.body.querySelector<HTMLInputElement>('#d-note')!.value
      await paperRepo.save(draft)
      toast(`已保存纸张 ${draft.name}`)
      await renderPapers()
    })
  }

  const removePigment = async (p: Pigment): Promise<void> => {
    if (!window.confirm(`删除色料「${p.name}」？引用它的版块需要重新指定色料。`)) return
    await pigmentRepo.remove(p.id)
    await renderPigments()
  }
  const removePaper = async (p: Paper): Promise<void> => {
    if (!window.confirm(`删除纸张「${p.name}」？`)) return
    await paperRepo.remove(p.id)
    await renderPapers()
  }

  document.getElementById('add-pigment')?.addEventListener('click', () => void editPigment())
  document.getElementById('add-paper')?.addEventListener('click', () => void editPaper())
  void renderPigments()
  void renderPapers()
}

// 极简模态框
const openDialog = (title: string): {
  body: HTMLElement
  onConfirm: (fn: () => Promise<void> | void) => void
} => {
  const mask = h('div', {
    style: 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:grid;place-items:center;z-index:900',
  })
  const card = h('div', {
    class: 'card',
    style: 'width:440px;max-width:92vw;max-height:88vh;overflow:auto',
  })
  const body = h('div')
  card.append(
    h('strong', { style: 'font-size:var(--fs-base);display:block;margin-bottom:var(--sp-4)' }, [title]),
    body,
  )
  const actions = h('div', { class: 'toolbar', style: 'justify-content:flex-end;margin-top:var(--sp-4)' })
  const cancel = document.createElement('button')
  cancel.className = 'btn'
  cancel.textContent = '取消'
  const ok = document.createElement('button')
  ok.className = 'btn btn-primary'
  ok.textContent = '保存'
  actions.append(cancel, ok)
  card.append(actions)
  mask.append(card)
  document.body.append(mask)
  const close = (): void => mask.remove()
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close()
  })
  cancel.addEventListener('click', close)
  return {
    body,
    onConfirm: (fn) =>
      ok.addEventListener('click', () => {
        Promise.resolve(fn()).then(close).catch((err) => toast(String(err), 'error'))
      }),
  }
}
