// Node 可跑的核心算法测试：node test/run.ts（Node 24 原生剥离 TS 类型）
// 覆盖：确定性、Beer-Lambert 叠色、dE00、几何切割、形态学、种子噪声
import { mulberry32, fnv1aBytes, polygonArea, pointInPolygon } from '../src/domain/math_util.ts'
import { fbm2, hash2i } from '../src/domain/noise.ts'
import {
  hexToRgb, pigmentAbsorbance, absorbanceToTransmittance,
  srgbToLinearRgb, linearRgbToSrgb, deltaE00, srgbToLab,
} from '../src/domain/color.ts'
import { splitPolygonsByRect, clipPolygon, rasterizePolygons, traceContours } from '../src/domain/geometry.ts'
import { gaussianBlur, connectedComponents } from '../src/domain/morphology.ts'
import { bakePlateMask } from '../src/gl/mask_baker.ts'
import { SEED_PIGMENTS, SEED_PAPERS } from '../src/domain/seed_materials.ts'
import type { Paper, Plate, Vec2 } from '../src/domain/types.ts'

let passed = 0
let failed = 0

const assert = (cond: boolean, name: string): void => {
  if (cond) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}`)
  }
}

const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

// 1. 确定性
const testDeterminism = (): void => {
  console.log('确定性')
  const a = mulberry32(42)
  const b = mulberry32(42)
  const seqA = Array.from({ length: 1000 }, a)
  const seqB = Array.from({ length: 1000 }, b)
  assert(seqA.every((v, i) => v === seqB[i]), '同种子 mulberry32 序列一致')
  assert(hash2i(123, 456, 7) === hash2i(123, 456, 7), '格点哈希稳定')
  const n1 = fbm2(3.7, 9.2, 11, 4)
  const n2 = fbm2(3.7, 9.2, 11, 4)
  assert(n1 === n2, 'fbm 噪声同参数同结果')
  const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) % 256)
  assert(fnv1aBytes(bytes) === fnv1aBytes(bytes), 'FNV 校验和稳定')
  assert(fnv1aBytes(bytes) !== fnv1aBytes(new Uint8Array([1, 2, 3])), '不同数据校验和不同')
}

// 2. Beer-Lambert 叠色
const testBeerLambert = (): void => {
  console.log('Beer-Lambert 透明叠色')
  const cyan = pigmentAbsorbance('#2f5d8a', 0.5, 0.5)
  const yellow = pigmentAbsorbance('#e3b94d', 0.5, 0.6)
  // 白纸上单色：透射率与浓度单调，覆盖率为 0 时完全不吸光
  const t0 = absorbanceToTransmittance(cyan, 0)
  assert(approx(t0.r, 1) && approx(t0.g, 1) && approx(t0.b, 1), '覆盖率 0 不改变纸色')
  const t1 = absorbanceToTransmittance(cyan, 1)
  assert(t1.r < 1 && t1.g < 1 && t1.b < 1, '施色后各通道透射率下降')
  // 叠印可交换：先黄后青与先青后黄，乘法交换律 => 同结果
  const paper = srgbToLinearRgb(hexToRgb('#f5efe2'))
  const print = (first: typeof cyan, second: typeof yellow) => {
    const ta = absorbanceToTransmittance(first, 1)
    const tb = absorbanceToTransmittance(second, 1)
    return {
      r: paper.r * ta.r * tb.r,
      g: paper.g * ta.g * tb.g,
      b: paper.b * ta.b * tb.b,
    }
  }
  const ab = print(cyan, yellow)
  const ba = print(yellow, cyan)
  assert(approx(ab.r, ba.r, 1e-12) && approx(ab.g, ba.g, 1e-12) && approx(ab.b, ba.b, 1e-12),
    '透明叠印满足乘法交换（顺序无关的物理层）')
  // 两遍比一遍深
  const onePass = absorbanceToTransmittance(cyan, 1)
  const twoPass = absorbanceToTransmittance(cyan, 2)
  assert(twoPass.r < onePass.r && twoPass.g < onePass.g && twoPass.b < onePass.b,
    '重复刷色只会更深不会变浅')
  // 线性光往返
  const lin = srgbToLinearRgb({ r: 0.5, g: 0.3, b: 0.8 })
  const back = linearRgbToSrgb(lin)
  const again = srgbToLinearRgb(back)
  assert(approx(again.r, lin.r, 1e-5) && approx(again.g, lin.g, 1e-5) && approx(again.b, lin.b, 1e-5),
    'sRGB 线性光往返一致')
}

// 3. CIEDE2000
const testDeltaE = (): void => {
  console.log('CIEDE2000 色差')
  const lab = srgbToLab(hexToRgb('#888888'))
  assert(approx(deltaE00(lab, lab), 0), '同色 ΔE00 = 0')
  const red = srgbToLab(hexToRgb('#c2453d'))
  const blue = srgbToLab(hexToRgb('#2f5d8a'))
  assert(deltaE00(red, blue) > 30, '朱红与花青色差显著')
  const near1 = srgbToLab(hexToRgb('#f5efe2'))
  const near2 = srgbToLab(hexToRgb('#f2ecdf'))
  assert(deltaE00(near1, near2) < 3, '相近纸色 ΔE00 很小')
  // Sharma 数据集中经典用例（Lab 直接给值）
  const classic = deltaE00(
    { l: 50, a: 2.6772, b: -79.7751 },
    { l: 50, a: 0, b: -82.7485 },
  )
  assert(approx(classic, 2.0425, 0.01), 'Sharma 用例 1 ≈ 2.04')
}

// 4. 几何
const testGeometry = (): void => {
  console.log('几何切割与栅格化')
  const square: Vec2[] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]
  const clipped = clipPolygon(square, [
    { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 },
  ])
  assert(approx(polygonArea(clipped), 0.25, 1e-9), '矩形裁剪面积正确')
  const { inside, outside } = splitPolygonsByRect([square], {
    minX: 0.4, minY: 0, maxX: 0.6, maxY: 1,
  })
  const inArea = inside.reduce((s, p) => s + polygonArea(p), 0)
  const outArea = outside.reduce((s, p) => s + polygonArea(p), 0)
  assert(approx(inArea, 0.2, 1e-9), '切版内部面积 0.2')
  assert(approx(outArea, 0.8, 1e-9), '切版外部面积 0.8，无丢失')
  const mask = rasterizePolygons([square], 100, 100)
  assert(mask.every((v) => v === 1), '满幅多边形栅格化全覆盖')
  assert(pointInPolygon({ x: 0.5, y: 0.5 }, square), '点在多边形内')
  assert(!pointInPolygon({ x: 1.5, y: 0.5 }, square), '点在多边形外')

  // 轮廓追踪：中心矩形掩膜应回到一个闭合多边形，面积接近原始矩形
  const rectMask = new Float32Array(60 * 40)
  for (let y = 10; y < 30; y++) {
    for (let x = 15; x < 45; x++) rectMask[y * 60 + x] = 1
  }
  const contours = traceContours(rectMask, 60, 40)
  assert(contours.length === 1, '单连通块追踪出一条轮廓')
  const tracedArea = contours[0] ? polygonArea(contours[0]) : 0
  // 30x20 像素块按像素中心追踪，外轮廓为 29x19（半像素缩进是该算法的正确行为）
  const expectArea = (29 * 19) / (60 * 40)
  assert(Math.abs(tracedArea - expectArea) / expectArea < 0.05, '追踪轮廓面积符合半像素缩进模型')
  assert((contours[0]?.length ?? 0) >= 4, '轮廓至少 4 个顶点')

  // 两个分离方块应得到两条独立轮廓
  const twoMask = new Float32Array(100)
  for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) twoMask[y * 10 + x] = 1
  for (let y = 7; y < 9; y++) for (let x = 7; x < 9; x++) twoMask[y * 10 + x] = 1
  const twoContours = traceContours(twoMask, 10, 10)
  assert(twoContours.length === 2, '两个分离连通块追踪出两条轮廓')
  assert(twoContours.every((p) => p.length >= 3), '每条轮廓至少 3 个顶点')
}

// 5. 形态学与连通域
const testMorphology = (): void => {
  console.log('形态学')
  const src = new Float32Array(100)
  src[55] = 1 // (x=5,y=5) 远离边界，避免钳边效应
  const blurred = gaussianBlur(src, 10, 10, 2, 1)
  assert(blurred[55] > 0 && blurred[55] < 1, '模糊后峰值下降')
  assert(blurred[54] > 0 && blurred[56] > 0, '能量扩散到邻域')
  const sum = blurred.reduce((a, b) => a + b, 0)
  assert(approx(sum, 1, 1e-5), '高斯核能量守恒')
  const labels = new Int32Array(36)
  // 两块不相邻区域
  labels.set([1, 1, 0, 0, 2, 2], 0)
  labels.set([1, 1, 0, 0, 2, 2], 6)
  labels.set([0, 0, 0, 0, 0, 0], 12)
  labels.set([0, 0, 1, 1, 0, 0], 18)
  const { components } = connectedComponents(labels, 6, 6, 1)
  assert(components.length === 2, '标签 1 被识别为两个连通域')
}

// 6. 掩码烘焙确定性与晕化
const testMaskBaking = (): void => {
  console.log('版块掩码烘焙')
  const plate: Plate = {
    id: 'plate_test', artworkId: 'a', name: 't', type: 'color',
    polygons: [[
      { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 },
    ]],
    regMarks: [], pigmentId: 'p', concentration: 1, passes: 1, overprintGroup: 'g1',
    offsetXMm: 0, offsetYMm: 0, visible: true, locked: false, source: 'manual', clusterId: 0,
  }
  const paper: Paper = {
    id: 'paper_test', name: 't', thicknessMm: 0.12, absorbency: 0.6,
    fiberDirection: 'none', baseHex: '#f5efe2', roughness: 0.4, note: '',
  }
  const opts = { width: 80, height: 80, paper, bleedScale: 1, seedBase: 99 }
  const a = bakePlateMask(plate, opts)
  const b = bakePlateMask(plate, opts)
  assert(a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]),
    '同参数两次烘焙掩码逐元素一致')
  assert(a.cacheKey === b.cacheKey, '缓存键稳定')
  // 中心区域有覆盖率，角落（版块外）经晕化后也应接近 0
  assert(a.data[40 * 80 + 40] > 0.5, '版块中心覆盖率高')
  assert(a.data[2 * 80 + 2] < 0.05, '远离版块的角落几乎无覆盖')
  // 几何变化必然改变缓存键
  const moved: Plate = {
    ...plate,
    polygons: [[
      { x: 0.2, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.7 },
    ]],
  }
  const c = bakePlateMask(moved, opts)
  assert(c.cacheKey !== a.cacheKey, '多边形变化使缓存键失效')
  // 拱花版不做颗粒调制，边缘仅轻微柔化
  const emboss: Plate = { ...plate, type: 'emboss' }
  const e = bakePlateMask(emboss, opts)
  assert(e.data[40 * 80 + 40] > 0.9, '拱花版中心接近满覆盖')
}

// 7. 种子材料库参数合法性
const testSeedMaterials = (): void => {
  console.log('种子材料库')
  const hexRe = /^#[0-9a-f]{6}$/
  assert(SEED_PIGMENTS.length >= 6, '水色至少 6 种')
  for (const p of SEED_PIGMENTS) {
    assert(hexRe.test(p.colorHex), `色料 ${p.name} 颜色为合法 hex`)
    assert(p.concentration > 0 && p.concentration <= 1, `色料 ${p.name} 浓度在 (0,1]`)
    assert(p.transparency >= 0 && p.transparency <= 1, `色料 ${p.name} 透明度在 [0,1]`)
  }
  assert(SEED_PAPERS.length >= 3, '宣纸至少 3 种')
  for (const p of SEED_PAPERS) {
    assert(hexRe.test(p.baseHex), `纸张 ${p.name} 纸基色为合法 hex`)
    assert(p.thicknessMm > 0 && p.thicknessMm < 1, `纸张 ${p.name} 厚度合理`)
    assert(p.absorbency >= 0 && p.absorbency <= 1, `纸张 ${p.name} 吸水性在 [0,1]`)
    assert(['none', 'horizontal', 'vertical'].includes(p.fiberDirection),
      `纸张 ${p.name} 纤维方向合法`)
  }
}

const run = (): void => {
  testDeterminism()
  testBeerLambert()
  testDeltaE()
  testGeometry()
  testMorphology()
  testMaskBaking()
  testSeedMaterials()
  console.log(`\n${passed} 通过, ${failed} 失败`)
  if (failed > 0) process.exit(1)
}

run()
