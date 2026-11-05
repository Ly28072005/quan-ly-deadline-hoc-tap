const DB = 'sf-files'
const STORE = 'blobs'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveBlob(id, file) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ blob: file, type: file.type || '', name: file.name || '' }, id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadBlob(id) {
  const db = await openDb()
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return row
}

export async function removeBlob(id) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export { extractFileText } from './extract.js?v=70'

export function fileKind(name, mime) {
  const ext = String(name || '').split('.').pop().toLowerCase()
  const type = String(mime || '').toLowerCase()
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (type.startsWith('text/') || ['txt', 'md', 'csv', 'json'].includes(ext)) return 'text'
  return 'other'
}
