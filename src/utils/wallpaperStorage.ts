/**
 * 壁纸图片本地存储（IndexedDB）+ 按需压缩
 * localStorage 放不下图片，只存设置项，图片本体在这里。
 */

const IDB_NAME = 'opencode-wallpaper'
const IDB_STORE = 'images'
const IDB_VERSION = 1
const IDB_KEY = 'current'
/** 壁纸最长边，超出则压缩 */
const MAX_EDGE = 2560
/** 超过该体积才压缩（即便尺寸未超） */
const COMPRESS_SIZE_THRESHOLD = 2.5 * 1024 * 1024

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode)
    const store = tx.objectStore(IDB_STORE)
    const req = run(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function wallpaperIdbPut(blob: Blob): Promise<void> {
  await withStore('readwrite', store => store.put(blob, IDB_KEY))
}

export async function wallpaperIdbGet(): Promise<Blob | undefined> {
  return withStore('readonly', store => store.get(IDB_KEY))
}

export async function wallpaperIdbDelete(): Promise<void> {
  await withStore('readwrite', store => store.delete(IDB_KEY))
}

/** 只在超尺寸或超体积时才压缩，小图原样存 */
export async function compressWallpaperImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  const { width, height } = bitmap
  const maxEdge = Math.max(width, height)
  const scale = maxEdge > MAX_EDGE ? MAX_EDGE / maxEdge : 1
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  if (scale >= 1 && file.size <= COMPRESS_SIZE_THRESHOLD) {
    bitmap.close()
    return file
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH)
    bitmap.close()

    const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const quality = type === 'image/webp' ? 0.86 : 0.88
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
    return blob ?? file
  } catch {
    bitmap.close()
    return file
  }
}
