// 画布转 Blob 的独立入口，避免生成器之间循环依赖
export const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), 'image/png'),
  )
