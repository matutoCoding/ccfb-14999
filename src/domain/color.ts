// 色彩科学：sRGB/线性光转换、Lab 色差 CIEDE2000、Beer-Lambert 透明叠色模型
// 叠色全程在线性光空间做减法混合，禁止用 alpha 直接覆盖

import { clamp, clamp01 } from './math_util.ts'

export interface RGB {
  r: number
  g: number
  b: number
}

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export const rgbToHex = (c: RGB): string => {
  const to = (v: number) =>
    Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`
}

// sRGB 传递函数：编码值 -> 线性光
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

export const srgbToLinearRgb = (c: RGB): RGB => ({
  r: srgbToLinear(c.r),
  g: srgbToLinear(c.g),
  b: srgbToLinear(c.b),
})

export const linearRgbToSrgb = (c: RGB): RGB => ({
  r: clamp01(linearToSrgb(c.r)),
  g: clamp01(linearToSrgb(c.g)),
  b: clamp01(linearToSrgb(c.b)),
})

// 线性 RGB -> CIE XYZ（D65）
const rgbToXyz = (c: RGB): [number, number, number] => {
  const x = 0.4124564 * c.r + 0.3575761 * c.g + 0.1804375 * c.b
  const y = 0.2126729 * c.r + 0.7151522 * c.g + 0.0721750 * c.b
  const z = 0.0193339 * c.r + 0.1191920 * c.g + 0.9503041 * c.b
  return [x, y, z]
}

const D65 = [0.95047, 1, 1.08883]

export interface Lab {
  l: number
  a: number
  b: number
}

export const linearRgbToLab = (c: RGB): Lab => {
  const [x0, y0, z0] = rgbToXyz(c)
  const f = (v: number) =>
    v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116
  const x = f(x0 / D65[0])
  const y = f(y0 / D65[1])
  const z = f(z0 / D65[2])
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) }
}

export const srgbToLab = (c: RGB): Lab => linearRgbToLab(srgbToLinearRgb(c))

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

// CIEDE2000 色差（Sharma 2005 修正），输入两个 Lab
export const deltaE00 = (c1: Lab, c2: Lab, kL = 1, kC = 1, kH = 1): number => {
  const { l: L1, a: a1, b: b1 } = c1
  const { l: L2, a: a2, b: b2 } = c2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G =
    0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p !== 0 && C2p !== 0) {
    const raw = h2p - h1p
    dhp = raw > 180 ? raw - 360 : raw < -180 ? raw + 360 : raw
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2))

  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp: number
  if (C1p === 0 && C2p === 0) hbp = 0
  else if (Math.abs(h1p - h2p) > 180) hbp = (h1p + h2p + 360) / 2
  else hbp = (h1p + h2p) / 2

  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63))
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const SL =
    1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin(rad(2 * dTheta)) * RC
  return Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH)),
  )
}

// 两个 sRGB 字节颜色（0..255）之间的 dE00
export const srgbBytesDeltaE = (
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number =>
  deltaE00(
    srgbToLab({ r: r1 / 255, g: g1 / 255, b: b1 / 255 }),
    srgbToLab({ r: r2 / 255, g: g2 / 255, b: b2 / 255 }),
  )

// 水色 -> 线性光吸收系数 A（每通道 0..~2.3）
// 浓度越高、越不透明，吸收越强；白纸处不施色时 A=0
export const pigmentAbsorbance = (
  colorHex: string,
  concentration: number,
  transparency: number,
): RGB => {
  const lin = srgbToLinearRgb(hexToRgb(colorHex))
  // 水色打在白纸上的单次呈色即 T，反推 A = -ln(T)，钳位防零
  const k = concentration * (1 - 0.8 * clamp01(transparency))
  return {
    r: clamp(-Math.log(Math.max(lin.r, 0.02)), 0, 4) * k,
    g: clamp(-Math.log(Math.max(lin.g, 0.02)), 0, 4) * k,
    b: clamp(-Math.log(Math.max(lin.b, 0.02)), 0, 4) * k,
  }
}

// 吸收系数与覆盖率 -> 透射率（线性光）
export const absorbanceToTransmittance = (a: RGB, coverage: number): RGB => ({
  r: Math.exp(-a.r * coverage),
  g: Math.exp(-a.g * coverage),
  b: Math.exp(-a.b * coverage),
})
