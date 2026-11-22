// 画稿图像存储：Blob 入 IDB，读回为 ImageBitmap
import { idbGet, idbPut, idbDelete, STORES } from './idb.ts'

export const saveImageBlob = async (id: string, blob: Blob): Promise<void> =>
  idbPut(STORES.images, blob, id)

export const loadImageBlob = async (id: string): Promise<Blob | undefined> =>
  idbGet<Blob>(STORES.images, id)

export const deleteImageBlob = async (id: string): Promise<void> =>
  idbDelete(STORES.images, id)

export const loadImageBitmap = async (id: string): Promise<ImageBitmap> => {
  const blob = await loadImageBlob(id)
  if (!blob) throw new Error(`图像不存在: ${id}`)
  return createImageBitmap(blob)
}

// 文件转 Blob，并读出位图尺寸
export const fileToBlobWithSize = async (
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  bitmap.close()
  return { blob: file.slice(0, file.size, file.type), width, height }
}

// canvas -> PNG Blob
export const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas 导出失败'))), 'image/png')
  })
