// 示例数据装载：生成三幅画稿、版块、色料纸张库与默认推演参数
import type { Artwork, Paper, Pigment, Plate, SimSettings, Vec2 } from './types.ts'
import { SEED_PAPERS, SEED_PIGMENTS, pigmentIdByName, paperIdByName } from './seed_materials.ts'
import { generateFlowerBird, generateLandscape, type GenPolygon } from './art_gen.ts'
import { generateEmbossPaper } from './art_gen_emboss.ts'
import { saveImageBlob } from '../data/image_store.ts'
import { idbGetAll, idbPut, STORES } from '../data/idb.ts'
import { hexToRgb, srgbToLab, deltaE00 } from './color.ts'

export const SEED_ARTWORK_IDS = {
  flowerBird: 'art_flower_bird',
  landscape: 'art_landscape',
  emboss: 'art_emboss_paper',
}

const nearestPigment = (hex: string, pigments: Pigment[]): Pigment => {
  const target = srgbToLab(hexToRgb(hex))
  let best = pigments[0]
  let bestD = Infinity
  for (const p of pigments) {
    const d = deltaE00(target, srgbToLab(hexToRgb(p.colorHex)))
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

const buildPlates = (
  artworkId: string,
  polys: GenPolygon[],
  pigments: Pigment[],
  orderIndex: { n: number },
): Plate[] =>
  polys.map((poly, i): Plate => {
    const pigment = poly.emboss ? pigments[0] : nearestPigment(poly.colorHex, pigments)
    const id = `plate_${artworkId}_${i + 1}`
    const polygons: Vec2[][] = [poly.points]
    return {
      id,
      artworkId,
      name: poly.name,
      type: poly.emboss ? 'emboss' : 'color',
      polygons,
      regMarks: [
        { x: 0.04, y: 0.04 },
        { x: 0.96, y: 0.04 },
      ],
      pigmentId: pigment.id,
      concentration: poly.emboss ? 0.5 : 0.9,
      passes: poly.emboss ? 1 : 1,
      overprintGroup: poly.emboss ? 'emboss' : `g${(orderIndex.n++ % 3) + 1}`,
      offsetXMm: 0,
      offsetYMm: 0,
      visible: true,
      locked: false,
      source: 'seed',
      clusterId: i,
    }
  })

const defaultSettings = (artworkId: string, paperId: string, order: string[]): SimSettings => ({
  artworkId,
  paperId,
  order,
  expansionPctX: 0,
  expansionPctY: 0,
  bleedScale: 1,
  embossStrength: 0.09,
  lightAngleDeg: 315,
  lightElevationDeg: 35,
  lightIntensity: 0.9,
  ambient: 0.65,
  simMaxSize: 900,
})

export interface SeedResult {
  artworkCount: number
  plateCount: number
  pigmentCount: number
  paperCount: number
}

export const seedAll = async (): Promise<SeedResult> => {
  // 色料与纸张
  const pigments: Pigment[] = SEED_PIGMENTS.map((p) => ({ ...p, id: pigmentIdByName(p.name) }))
  for (const p of pigments) await idbPut(STORES.pigments, p)
  const papers: Paper[] = SEED_PAPERS.map((p) => ({ ...p, id: paperIdByName(p.name) }))
  for (const p of papers) await idbPut(STORES.papers, p)

  const counter = { n: 0 }
  let plateCount = 0

  // 花鸟
  const fb = await generateFlowerBird()
  await saveImageBlob(SEED_ARTWORK_IDS.flowerBird, fb.blob)
  const fbArt: Artwork = {
    id: SEED_ARTWORK_IDS.flowerBird,
    kind: 'single',
    albumName: '写意花鸟册',
    name: '折枝花鸟',
    width: fb.width,
    height: fb.height,
    physicalWidthMm: 300,
    physicalHeightMm: 400,
    imageId: SEED_ARTWORK_IDS.flowerBird,
    createdAt: Date.now(),
    note: '程序生成的种子画稿，版块为标准答案',
  }
  const fbPlates = buildPlates(fbArt.id, fb.polygons, pigments, counter)
  await persistArtwork(fbArt, fbPlates, defaultSettings(fbArt.id, papers[0].id, fbPlates.map((p) => p.id)))
  plateCount += fbPlates.length

  // 山水
  const ls = await generateLandscape()
  await saveImageBlob(SEED_ARTWORK_IDS.landscape, ls.blob)
  const lsArt: Artwork = {
    id: SEED_ARTWORK_IDS.landscape,
    kind: 'album',
    albumName: '写意山水册',
    name: '溪山松色',
    width: ls.width,
    height: ls.height,
    physicalWidthMm: 400,
    physicalHeightMm: 300,
    imageId: SEED_ARTWORK_IDS.landscape,
    createdAt: Date.now() + 1,
    note: '程序生成的种子画稿，远山近山分层套印',
  }
  const lsPlates = buildPlates(lsArt.id, ls.polygons, pigments, counter)
  await persistArtwork(lsArt, lsPlates, defaultSettings(lsArt.id, papers[3].id, lsPlates.map((p) => p.id)))
  plateCount += lsPlates.length

  // 拱花笺纸
  const ep = await generateEmbossPaper()
  await saveImageBlob(SEED_ARTWORK_IDS.emboss, ep.blob)
  const epArt: Artwork = {
    id: SEED_ARTWORK_IDS.emboss,
    kind: 'single',
    albumName: '拱花笺谱',
    name: '宝相花拱花笺',
    width: ep.width,
    height: ep.height,
    physicalWidthMm: 240,
    physicalHeightMm: 320,
    imageId: SEED_ARTWORK_IDS.emboss,
    createdAt: Date.now() + 2,
    note: '全部为拱花版，侧光下观察凹凸',
  }
  const epPlates = buildPlates(epArt.id, ep.polygons, pigments, counter)
  await persistArtwork(epArt, epPlates, defaultSettings(epArt.id, papers[2].id, epPlates.map((p) => p.id)))
  plateCount += epPlates.length

  return {
    artworkCount: 3,
    plateCount,
    pigmentCount: pigments.length,
    paperCount: papers.length,
  }
}

const persistArtwork = async (
  artwork: Artwork,
  plates: Plate[],
  settings: SimSettings,
): Promise<void> => {
  await idbPut(STORES.artworks, artwork)
  for (const plate of plates) await idbPut(STORES.plates, plate)
  await idbPut(STORES.simSettings, settings)
}

export const hasSeeded = async (): Promise<boolean> => {
  const list = await idbGetAll<Artwork>(STORES.artworks)
  return list.some((a) => a.id === SEED_ARTWORK_IDS.flowerBird)
}
