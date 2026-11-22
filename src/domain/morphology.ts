// 栅格形态学：高斯模糊、连通域，全部确定性算法，供拆版与晕化使用
import { gaussianKernel } from './math_util.ts'

// 可分离高斯模糊，in-place 安全（内部双缓冲）
export const gaussianBlur = (
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  sigma: number,
  channels = 1,
): Float32Array => {
  const r = Math.max(1, Math.round(radius))
  const kernel = gaussianKernel(r, sigma)
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  // 水平
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0
        for (let k = 0; k < kernel.length; k++) {
          const xx = Math.min(width - 1, Math.max(0, x + k - r))
          sum += kernel[k] * src[(y * width + xx) * channels + c]
        }
        tmp[(y * width + x) * channels + c] = sum
      }
    }
  }
  // 垂直
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0
        for (let k = 0; k < kernel.length; k++) {
          const yy = Math.min(height - 1, Math.max(0, y + k - r))
          sum += kernel[k] * tmp[(yy * width + x) * channels + c]
        }
        out[(y * width + x) * channels + c] = sum
      }
    }
  }
  return out
}

// 单通道各向异性高斯，纤维方向用，sx/sy 为两轴半径
export const gaussianBlur2D = (
  src: Float32Array,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): Float32Array => {
  if (Math.abs(radiusX - radiusY) < 0.5) {
    const r = Math.max(1, Math.round(radiusX))
    return gaussianBlur(src, width, height, r, r / 2)
  }
  const kx = gaussianKernel(Math.max(1, Math.round(radiusX)), Math.max(0.6, radiusX / 2))
  const ky = gaussianKernel(Math.max(1, Math.round(radiusY)), Math.max(0.6, radiusY / 2))
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = 0; k < kx.length; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k - Math.round(radiusX)))
        sum += kx[k] * src[y * width + xx]
      }
      tmp[y * width + x] = sum
    }
  }
  const ry = Math.round(radiusY)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = 0; k < ky.length; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k - ry))
        sum += ky[k] * tmp[yy * width + x]
      }
      out[y * width + x] = sum
    }
  }
  return out
}

export interface Component {
  id: number
  pixels: number
  // 边界框（像素）
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// 4-连通域标注，labels 长度 = w*h，背景为 -1；仅对 label == target 的像素生长
export const connectedComponents = (
  labels: Int32Array,
  width: number,
  height: number,
  target: number,
): { compMap: Int32Array; components: Component[] } => {
  const compMap = new Int32Array(width * height).fill(-1)
  const components: Component[] = []
  let compId = 0
  const stack: number[] = []
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== target || compMap[i] !== -1) continue
    let pixels = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    stack.length = 0
    stack.push(i)
    compMap[i] = compId
    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % width
      const y = (idx / width) | 0
      pixels++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ]
      for (const n of neighbors) {
        if (n >= 0 && labels[n] === target && compMap[n] === -1) {
          compMap[n] = compId
          stack.push(n)
        }
      }
    }
    components.push({ id: compId, pixels, minX, minY, maxX, maxY })
    compId++
  }
  return { compMap, components }
}
