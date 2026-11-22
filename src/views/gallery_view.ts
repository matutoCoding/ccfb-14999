// 作品列表页：按画谱分组，支持导入原画与删除
import type { Artwork } from '../domain/types.ts'
import { artworkRepo } from '../data/repo.ts'
import { loadImageBlob, fileToBlobWithSize, saveImageBlob } from '../data/image_store.ts'
import { h, emptyState, objectUrl, badge } from '../app/dom.ts'
import { iconSvg } from '../app/icons.ts'
import { toast } from '../app/toast.ts'
import { navigate } from '../app/router.ts'

const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.floor(performance.now() * 1000).toString(36)}`

export const renderGallery = async (root: HTMLElement): Promise<void> => {
  const artworks = await artworkRepo.list()
  artworks.sort((a, b) => a.createdAt - b.createdAt)

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">作品列表</h1>
        <p class="page-sub">按画谱与单幅管理原画，导入后可在分析页自动拆版</p>
      </div>
      <div class="toolbar">
        <button class="btn" id="import-btn">${iconSvg('upload')} 导入原画</button>
        <input type="file" id="import-file" accept="image/png,image/jpeg" hidden />
      </div>
    </div>
  `

  if (artworks.length === 0) {
    root.append(
      emptyState(
        iconSvg('empty', 44),
        '还没有作品',
        '点击右上角导入原画，或在左下角载入示例画稿',
      ),
    )
  } else {
    const groups = new Map<string, Artwork[]>()
    for (const art of artworks) {
      const key = art.kind === 'album' ? art.albumName : '单幅作品'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(art)
    }
    for (const [groupName, items] of groups) {
      const section = h('div', { style: 'margin-bottom: var(--sp-6)' }, [
        h('div', {
          class: 'row-between',
          style: 'margin-bottom: var(--sp-4)',
        }, [
          h('strong', { style: 'font-size:var(--fs-base)' }, [
            groupName,
            `（${items.length}）`,
          ]),
        ]),
      ])
      const grid = h('div', { class: 'grid grid-cards' })
      for (const art of items) grid.append(await artworkCard(art))
      section.append(grid)
      root.append(section)
    }
  }

  const importBtn = document.getElementById('import-btn')
  const fileInput = document.getElementById('import-file') as HTMLInputElement
  importBtn?.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void importArtwork(file)
    fileInput.value = ''
  })
}

const artworkCard = async (art: Artwork): Promise<HTMLElement> => {
  const blob = await loadImageBlob(art.imageId)
  const thumb = blob ? objectUrl(blob) : ''
  const card = h('div', { class: 'card', style: 'padding:0;overflow:hidden;cursor:pointer' })
  card.innerHTML = `
    <div style="aspect-ratio:4/3;background:var(--paper);overflow:hidden;display:grid;place-items:center">
      <img src="${thumb}" alt="${art.name}" style="width:100%;height:100%;object-fit:cover" />
    </div>
    <div style="padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-2)">
      <div class="row-between">
        <strong style="font-size:var(--fs-sm)">${art.name}</strong>
        ${art.kind === 'album' ? badge('画谱') : badge('单幅', true)}
      </div>
      <span class="muted" style="font-size:var(--fs-xs)">
        ${art.width} × ${art.height} px · ${art.physicalWidthMm} × ${art.physicalHeightMm} mm
      </span>
      <div class="toolbar" style="margin-top:var(--sp-2)">
        <button class="btn btn-sm" data-act="analyze">${iconSvg('analysis', 15)} 拆版</button>
        <button class="btn btn-sm" data-act="sim">${iconSvg('print', 15)} 推演</button>
        <button class="btn btn-sm" data-act="del" title="删除">${iconSvg('trash', 15)}</button>
      </div>
    </div>
  `
  card.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'analyze') return navigate('analysis', art.id)
    if (act === 'sim') return navigate('simulation', art.id)
    if (act === 'del') return void deleteArtwork(art)
    navigate('editor', art.id)
  })
  return card
}

const deleteArtwork = async (art: Artwork): Promise<void> => {
  if (!window.confirm(`确认删除「${art.name}」及其全部版块？此操作不可恢复。`)) return
  await artworkRepo.remove(art)
  toast(`已删除 ${art.name}`)
  const view = document.getElementById('view')
  if (view) void renderGallery(view)
}

const importArtwork = async (file: File): Promise<void> => {
  try {
    const { blob, width, height } = await fileToBlobWithSize(file)
    const id = uid('art')
    await saveImageBlob(id, blob)
    const artwork: Artwork = {
      id,
      kind: 'single',
      albumName: '单幅作品',
      name: file.name.replace(/\.[^.]+$/, ''),
      width,
      height,
      // 未标注物理尺寸时按 96dpi 估算
      physicalWidthMm: Math.round((width / 96) * 25.4),
      physicalHeightMm: Math.round((height / 96) * 25.4),
      imageId: id,
      createdAt: Date.now(),
      note: '用户导入',
    }
    await artworkRepo.save(artwork)
    toast(`已导入 ${artwork.name}`)
    navigate('analysis', id)
  } catch (err) {
    toast(err instanceof Error ? err.message : '导入失败', 'error')
  }
}
