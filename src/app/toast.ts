// Toast 轻提示
const ROOT_ID = 'toast-root'

export const toast = (message: string, type: 'info' | 'error' = 'info', duration = 2600): void => {
  const root = document.getElementById(ROOT_ID)
  if (!root) return
  const el = document.createElement('div')
  el.className = `toast${type === 'error' ? ' error' : ''}`
  el.textContent = message
  root.appendChild(el)
  window.setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.2s ease'
    window.setTimeout(() => el.remove(), 220)
  }, duration)
}
