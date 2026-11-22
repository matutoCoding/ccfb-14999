// 应用入口：挂载导航、分发路由
import { parseHash, type RouteName } from './app/router.ts'
import { iconSvg } from './app/icons.ts'
import { toast } from './app/toast.ts'
import { hasSeeded, seedAll } from './domain/seed_loader.ts'
import { disposeView } from './app/lifecycle.ts'
import { renderGallery } from './views/gallery_view.ts'
import { renderAnalysis } from './views/analysis_view.ts'
import { renderEditor } from './views/editor_view.ts'
import { renderMaterials } from './views/materials_view.ts'
import { renderSimulation } from './views/simulation_view.ts'
import { renderCarving } from './views/carving_view.ts'

const NAV_ITEMS: { name: RouteName; label: string; icon: Parameters<typeof iconSvg>[0] }[] = [
  { name: 'gallery', label: '作品列表', icon: 'gallery' },
  { name: 'analysis', label: '原画分析', icon: 'analysis' },
  { name: 'editor', label: '分版编辑', icon: 'layers' },
  { name: 'materials', label: '色料与纸张', icon: 'pigment' },
  { name: 'simulation', label: '印制推演', icon: 'print' },
  { name: 'carving', label: '刻版图与工艺单', icon: 'carving' },
]

const mountNav = (active: RouteName): void => {
  const nav = document.getElementById('nav')
  if (!nav) return
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `
      <a class="nav-item${item.name === active ? ' active' : ''}"
         href="#/${item.name}">
        ${iconSvg(item.icon)}
        <span>${item.label}</span>
      </a>`,
  ).join('')
}

const routeView = async (): Promise<void> => {
  const route = parseHash()
  mountNav(route.name)
  const view = document.getElementById('view')
  if (!view) return
  disposeView()
  view.innerHTML = ''
  try {
    switch (route.name) {
      case 'gallery':
        await renderGallery(view)
        break
      case 'analysis':
        await renderAnalysis(view, route.artworkId)
        break
      case 'editor':
        await renderEditor(view, route.artworkId)
        break
      case 'materials':
        await renderMaterials(view)
        break
      case 'simulation':
        await renderSimulation(view, route.artworkId)
        break
      case 'carving':
        await renderCarving(view, route.artworkId)
        break
    }
  } catch (err) {
    view.innerHTML = ''
    const msg = err instanceof Error ? err.message : String(err)
    toast(`页面渲染失败: ${msg}`, 'error', 5000)
    console.error(err)
  }
}

window.addEventListener('hashchange', () => void routeView())

const init = async (): Promise<void> => {
  const seedBtn = document.getElementById('seed-btn')
  seedBtn?.addEventListener('click', async () => {
    seedBtn.setAttribute('disabled', 'true')
    try {
      const result = await seedAll()
      toast(`已载入 ${result.artworkCount} 幅画稿、${result.plateCount} 块版、${result.pigmentCount} 种色料`)
      await routeView()
    } catch (err) {
      toast(err instanceof Error ? err.message : '示例数据装载失败', 'error')
    } finally {
      seedBtn.removeAttribute('disabled')
    }
  })
  if (!(await hasSeeded())) {
    // 首次进入自动装载示例，保证打开即有内容可看
    try {
      await seedAll()
    } catch (err) {
      console.warn('自动种子装载失败', err)
    }
  }
  await routeView()
}

void init()
