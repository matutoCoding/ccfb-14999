// CPU 色差热图：半分辨率计算 Lab 距离染色，再平滑放大到显示画布，控制大画幅耗时
import { srgbToLab } from '../domain/color.ts'

const heatColor = (t: number): [number, number, number] => {
  const x = Math.max(0, Math.min(1, t))
  // 绿 -> 琥珀 -> 红
  const green: [number, number, number] = [51, 179, 102]
  const amber: [number, number, number] = [242, 166, 51]
  const red: [number, number, number] = [217, 51, 38]
  const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] =>
    [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
  return x < 0.5 ? mix(green, amber, x * 2) : mix(amber, red, (x - 0.5) * 2)
}

const HEAT_SCALE = 2 // 计算分辨率为显示的 1/2

export const renderHeatmapToCanvas = (
  displayCanvas: HTMLCanvasElement,
  simImage: ImageData,
  refBitmap: ImageBitmap,
): void => {
  const fullW = simImage.width
  const fullH = simImage.height
  const hw = Math.max(32, Math.round(fullW / HEAT_SCALE))
  const hh = Math.max(32, Math.round(fullH / HEAT_SCALE))

  const refCanvas = document.createElement('canvas')
  refCanvas.width = hw
  refCanvas.height = hh
  const refCtx = refCanvas.getContext('2d')!
  refCtx.imageSmoothingEnabled = true
  refCtx.drawImage(refBitmap, 0, 0, hw, hh)
  const ref = refCtx.getImageData(0, 0, hw, hh).data

  // 推演结果同样降采样
  const simCanvas = document.createElement('canvas')
  simCanvas.width = hw
  simCanvas.height = hh
  const simCtx = simCanvas.getContext('2d')!
  simCtx.putImageData(simImage, 0, 0)
  const simSmall = simCtx.getImageData(0, 0, hw, hh).data

  const heat = new ImageData(hw, hh)
  for (let i = 0; i < hw * hh; i++) {
    const o = i * 4
    const lab1 = srgbToLab({ r: simSmall[o] / 255, g: simSmall[o + 1] / 255, b: simSmall[o + 2] / 255 })
    const lab2 = srgbToLab({ r: ref[o] / 255, g: ref[o + 1] / 255, b: ref[o + 2] / 255 })
    const de = Math.hypot(lab1.l - lab2.l, lab1.a - lab2.a, lab1.b - lab2.b)
    const [r, g, b] = heatColor(de / 20)
    heat.data[o] = r
    heat.data[o + 1] = g
    heat.data[o + 2] = b
    heat.data[o + 3] = 255
  }

  const out = document.createElement('canvas')
  out.width = hw
  out.height = hh
  out.getContext('2d')!.putImageData(heat, 0, 0)
  const ctx = displayCanvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.clearRect(0, 0, fullW, fullH)
  ctx.drawImage(out, 0, 0, fullW, fullH)
}
