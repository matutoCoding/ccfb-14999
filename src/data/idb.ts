// IndexedDB 极简封装：全部数据本地化，无后端
// 版本 1：artworks / plates / pigments / papers / sim_settings / sim_runs / images

const DB_NAME = 'muban-shuiyin'
const DB_VERSION = 1

export const STORES = {
  artworks: 'artworks',
  plates: 'plates',
  pigments: 'pigments',
  papers: 'papers',
  simSettings: 'sim_settings',
  simRuns: 'sim_runs',
  images: 'images',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.artworks)) {
        db.createObjectStore(STORES.artworks, { keyPath: 'id' })
        const plateStore = db.createObjectStore(STORES.plates, { keyPath: 'id' })
        plateStore.createIndex('artworkId', 'artworkId', { unique: false })
        db.createObjectStore(STORES.pigments, { keyPath: 'id' })
        db.createObjectStore(STORES.papers, { keyPath: 'id' })
        db.createObjectStore(STORES.simSettings, { keyPath: 'artworkId' })
        const runStore = db.createObjectStore(STORES.simRuns, { keyPath: 'id' })
        runStore.createIndex('artworkId', 'artworkId', { unique: false })
        db.createObjectStore(STORES.images)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = async <T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    t.onabort = () => reject(t.error)
    t.onerror = () => reject(t.error)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const idbPut = async <T>(store: string, value: T, key?: IDBValidKey): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.put(value as object, key))
}

export const idbGet = async <T>(store: string, key: IDBValidKey): Promise<T | undefined> =>
  tx(store, 'readonly', (s) => s.get(key)) as Promise<T | undefined>

export const idbGetAll = async <T>(store: string): Promise<T[]> =>
  tx(store, 'readonly', (s) => s.getAll()) as Promise<T[]>

export const idbDelete = async (store: string, key: IDBValidKey): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.delete(key))
}

export const idbGetAllByIndex = async <T>(
  store: string,
  indexName: string,
  value: IDBValidKey,
): Promise<T[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly')
    const req = t.objectStore(store).index(indexName).getAll(value)
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export const idbClear = async (store: string): Promise<void> => {
  await tx(store, 'readwrite', (s) => s.clear())
}
