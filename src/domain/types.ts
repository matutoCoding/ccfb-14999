// 领域模型：所有持久化对象的类型定义

export interface Vec2 {
  x: number
  y: number
}

export type ArtworkKind = 'album' | 'single'

export interface Artwork {
  id: string
  kind: ArtworkKind
  albumName: string
  name: string
  width: number
  height: number
  physicalWidthMm: number
  physicalHeightMm: number
  imageId: string
  createdAt: number
  note: string
}

export type PlateType = 'color' | 'emboss'

export interface Plate {
  id: string
  artworkId: string
  name: string
  type: PlateType
  // 归一化多边形坐标，每块版可由多个封闭区域组成
  polygons: Vec2[][]
  // 套准规矩标记，归一化坐标
  regMarks: Vec2[]
  // 色版用料
  pigmentId: string
  // 浓度倍率，0.1 ~ 2
  concentration: number
  // 刷色遍数
  passes: number
  // 叠印组标记，同组版块在工艺单上标注套叠关系
  overprintGroup: string
  // 套准偏差（毫米），相对规矩线
  offsetXMm: number
  offsetYMm: number
  visible: boolean
  locked: boolean
  source: 'analysis' | 'manual' | 'seed'
  clusterId: number
}

export interface Pigment {
  id: string
  name: string
  // sRGB 十六进制，水色本色
  colorHex: string
  // 标准浓度 0.05 ~ 1
  concentration: number
  // 透明度 0(不透) ~ 1(极透明)
  transparency: number
  note: string
}

export type FiberDirection = 'none' | 'horizontal' | 'vertical'

export interface Paper {
  id: string
  name: string
  // 厚度 mm
  thicknessMm: number
  // 吸水性 0 ~ 1
  absorbency: number
  fiberDirection: FiberDirection
  // 纸基色
  baseHex: string
  // 纸面粗糙度 0 ~ 1，影响晕化边缘
  roughness: number
  note: string
}

export interface SimSettings {
  artworkId: string
  paperId: string
  // 印制顺序：版块 id 列表
  order: string[]
  // 纸张受潮伸缩百分比
  expansionPctX: number
  expansionPctY: number
  // 晕化全局倍率
  bleedScale: number
  // 拱花凹凸强度（纹理像素高度）
  embossStrength: number
  // 侧光方位角（度）
  lightAngleDeg: number
  // 光源仰角（度），90 为正面光
  lightElevationDeg: number
  lightIntensity: number
  ambient: number
  // 推演纹理最长边像素
  simMaxSize: number
}

export interface SimRun {
  id: string
  artworkId: string
  createdAt: number
  // 推演结果像素校验和，用于一致性自检
  checksum: string
  meanDE: number
  p95DE: number
  maxDE: number
  timingMs: number
  plateCount: number
}

export interface AnalysisParams {
  // 期望聚类数（候选色数）
  clusterCount: number
  // 最小版块面积占比，小于则并入邻块
  minAreaRatio: number
  // 浓淡分层数，1 表示只按色相不分浓淡
  toneLevels: number
  // 空间平滑半径（归一化）
  smoothRadius: number
}

export interface CandidatePlate {
  clusterId: number
  colorHex: string
  areaRatio: number
  polygons: Vec2[][]
  pixels: number
}
