// 种子色料与纸张：参照木版水印常用水色与宣纸参数
import type { Paper, Pigment } from './types.ts'

export const SEED_PIGMENTS: Omit<Pigment, 'id'>[] = [
  { name: '花青', colorHex: '#2f5d8a', concentration: 0.55, transparency: 0.55, note: '植物蓝，山水主色' },
  { name: '赭石', colorHex: '#a06a3c', concentration: 0.5, transparency: 0.5, note: '矿物土色，山石枝干' },
  { name: '朱砂', colorHex: '#c2453d', concentration: 0.6, transparency: 0.35, note: '矿物红，花鸟点睛' },
  { name: '藤黄', colorHex: '#e3b94d', concentration: 0.45, transparency: 0.6, note: '植物黄，花蕊嫩叶' },
  { name: '胭脂', colorHex: '#9e3a4b', concentration: 0.55, transparency: 0.4, note: '深红透明色' },
  { name: '墨色', colorHex: '#33302c', concentration: 0.7, transparency: 0.3, note: '松烟墨，浓淡可调' },
  { name: '汁绿', colorHex: '#5d7a4a', concentration: 0.45, transparency: 0.6, note: '花青调藤黄，叶片色' },
  { name: '蛤粉', colorHex: '#efe9dc', concentration: 0.3, transparency: 0.75, note: '白粉提染' },
]

export const SEED_PAPERS: Omit<Paper, 'id'>[] = [
  {
    name: '净皮宣（二层）',
    thicknessMm: 0.12,
    absorbency: 0.62,
    fiberDirection: 'none',
    baseHex: '#f5efe2',
    roughness: 0.45,
    note: '木版水印常用，吃水适中',
  },
  {
    name: '棉料夹宣',
    thicknessMm: 0.16,
    absorbency: 0.72,
    fiberDirection: 'vertical',
    baseHex: '#f7f2e7',
    roughness: 0.55,
    note: '厚纸，适合多版叠印与拱花',
  },
  {
    name: '云母笺',
    thicknessMm: 0.14,
    absorbency: 0.35,
    fiberDirection: 'horizontal',
    baseHex: '#f6f1e4',
    roughness: 0.3,
    note: '加工笺纸，吸水慢、晕化小',
  },
  {
    name: '仿古连史纸',
    thicknessMm: 0.09,
    absorbency: 0.55,
    fiberDirection: 'none',
    baseHex: '#efe6d2',
    roughness: 0.5,
    note: '薄而韧，画谱复刻常用',
  },
]

// 从名称取稳定 id
export const pigmentIdByName = (name: string): string =>
  `pig_${name}`

export const paperIdByName = (name: string): string =>
  `paper_${name}`
