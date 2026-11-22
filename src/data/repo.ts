// 仓储：页面通过这里读写 IndexedDB，不直接碰底层 API
import type {
  Artwork, Paper, Pigment, Plate, SimRun, SimSettings,
} from '../domain/types.ts'
import {
  idbDelete, idbGet, idbGetAll, idbGetAllByIndex, idbPut, STORES,
} from '../data/idb.ts'

export const artworkRepo = {
  list: (): Promise<Artwork[]> => idbGetAll<Artwork>(STORES.artworks),
  get: (id: string): Promise<Artwork | undefined> => idbGet<Artwork>(STORES.artworks, id),
  save: (a: Artwork): Promise<void> => idbPut(STORES.artworks, a),
  remove: async (id: string): Promise<void> => {
    const plates = await idbGetAllByIndex<Plate>(STORES.plates, 'artworkId', id)
    for (const p of plates) await idbDelete(STORES.plates, p.id)
    await idbDelete(STORES.simSettings, id)
    await idbDelete(STORES.artworks, id)
  },
}

export const plateRepo = {
  listByArtwork: (artworkId: string): Promise<Plate[]> =>
    idbGetAllByIndex<Plate>(STORES.plates, 'artworkId', artworkId),
  save: (p: Plate): Promise<void> => idbPut(STORES.plates, p),
  saveMany: (plates: Plate[]): Promise<void> =>
    plates.reduce<Promise<void>>(
      (chain, p) => chain.then(() => idbPut(STORES.plates, p)),
      Promise.resolve(),
    ),
  remove: (id: string): Promise<void> => idbDelete(STORES.plates, id),
}

export const pigmentRepo = {
  list: (): Promise<Pigment[]> => idbGetAll<Pigment>(STORES.pigments),
  get: (id: string): Promise<Pigment | undefined> => idbGet<Pigment>(STORES.pigments, id),
  save: (p: Pigment): Promise<void> => idbPut(STORES.pigments, p),
  remove: (id: string): Promise<void> => idbDelete(STORES.pigments, id),
}

export const paperRepo = {
  list: (): Promise<Paper[]> => idbGetAll<Paper>(STORES.papers),
  get: (id: string): Promise<Paper | undefined> => idbGet<Paper>(STORES.papers, id),
  save: (p: Paper): Promise<void> => idbPut(STORES.papers, p),
  remove: (id: string): Promise<void> => idbDelete(STORES.papers, id),
}

export const settingsRepo = {
  get: (artworkId: string): Promise<SimSettings | undefined> =>
    idbGet<SimSettings>(STORES.simSettings, artworkId),
  save: (s: SimSettings): Promise<void> => idbPut(STORES.simSettings, s),
}

export const runRepo = {
  listByArtwork: (artworkId: string): Promise<SimRun[]> =>
    idbGetAllByIndex<SimRun>(STORES.simRuns, 'artworkId', artworkId),
  save: (r: SimRun): Promise<void> => idbPut(STORES.simRuns, r),
}
