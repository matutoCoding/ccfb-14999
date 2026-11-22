// 轻量 DOM 构建辅助
export const h = (
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElement => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else el.setAttribute(k, v)
  }
  for (const child of children) {
    el.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return el
}

export const emptyState = (
  icon: string,
  title: string,
  sub: string,
  action?: HTMLButtonElement,
): HTMLElement => {
  const el = h('div', { class: 'empty-state' }, [
    icon,
    h('strong', {}, [title]),
    h('span', {}, [sub]),
  ])
  if (action) el.append(action)
  return el
}

export const badge = (text: string, primary = false): HTMLElement =>
  h('span', { class: `badge${primary ? ' badge-primary' : ''}` }, [text])

export const swatch = (colorHex: string): HTMLElement =>
  h('span', { class: 'color-swatch', style: `background:${colorHex}` })

export const clear = (el: HTMLElement): void => {
  el.innerHTML = ''
}

// 把 Blob 包装成可持久显示的 objectURL（页面卸载时统一回收）
const urlPool = new Set<string>()
export const objectUrl = (blob: Blob): string => {
  const url = URL.createObjectURL(blob)
  urlPool.add(url)
  return url
}
window.addEventListener('beforeunload', () => {
  for (const url of urlPool) URL.revokeObjectURL(url)
  urlPool.clear()
})
