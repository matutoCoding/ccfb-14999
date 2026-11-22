// 视图资源清理注册表：路由切换前释放 WebGL 上下文、ImageBitmap、Observer
const disposers: (() => void)[] = []

export const registerDisposer = (fn: () => void): void => {
  disposers.push(fn)
}

export const disposeView = (): void => {
  while (disposers.length) {
    const fn = disposers.pop()
    try {
      fn?.()
    } catch (err) {
      console.warn('视图资源清理失败', err)
    }
  }
}
