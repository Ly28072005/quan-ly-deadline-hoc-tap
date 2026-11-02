const MAX_TEXT = 20000

export function cleanText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function limitText(text) {
  const clean = cleanText(text)
  return clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT) : clean
}

function extOf(name) {
  return String(name || '').split('.').pop().toLowerCase()
}

function looksLikeText(text) {
  if (!text || text.length < 20) return false
  const sample = text.slice(0, 800)
  let good = 0
  for (const ch of sample) {
    const code = ch.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127) || code >= 160) good += 1
  }
  return good / sample.length > 0.85
}

async function inflate(bytes) {
  const blob = new Blob([bytes])
  for (const codec of ['deflate', 'deflate-raw']) {
    try {
      return await new Response(blob.stream().pipeThrough(new DecompressionStream(codec))).arrayBuffer()
    } catch { /* try next */ }
  }
  throw new Error('inflate')
}

async function readZip(buf) {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const files = {}
  let offset = 0
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break
    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    let compSize = view.getUint32(offset + 18, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen))
    const dataStart = offset + 30 + nameLen + extraLen
    if (flags & 8) {
      let scan = dataStart
      let next = -1
      while (scan + 4 <= bytes.length) {
        if (bytes[scan] === 0x50 && bytes[scan + 1] === 0x4b) {
          const sig = view.getUint32(scan, true)
          if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x08074b50) { next = scan; break }
        }
        scan += 1
      }
      if (next < 0) break
      compSize = next - dataStart
    }
    const compressed = bytes.subarray(dataStart, dataStart + compSize)
    try {
      const raw = method === 0 ? compressed : method === 8 ? new Uint8Array(await inflate(compressed)) : null
      if (raw) files[name] = new TextDecoder('utf-8').decode(raw)
    } catch { /* skip this entry */ }
    offset = dataStart + compSize
    if (flags & 8) {
      if (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x08074b50) offset += 16
      else offset += 12
    }
  }
  return files
}

function xmlToText(xml) {
  return cleanText(String(xml || '')
    .replace(/<a:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))))
}

async function extractDocx(buf) {
  const files = await readZip(buf)
  const body = files['word/document.xml'] || ''
  return xmlToText(body)
}

async function extractPptx(buf) {
  const files = await readZip(buf)
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return cleanText(slides.map((name, index) => {
    const text = xmlToText(files[name])
    return text ? `Slide ${index + 1}\n${text}` : ''
  }).join('\n\n'))
}

function unescapePdf(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
}

function decodePdfString(value) {
  const raw = unescapePdf(value)
  if (raw.charCodeAt(0) === 0xfe && raw.charCodeAt(1) === 0xff) {
    const bytes = Uint8Array.from(raw.slice(2), (ch) => ch.charCodeAt(0) & 0xff)
    return new TextDecoder('utf-16be').decode(bytes)
  }
  return raw
}

function pdfStrings(src) {
  const parts = []
  const literal = /\(((?:\\.|[^()\\])*)\)\s*Tj/g
  let match
  while ((match = literal.exec(src))) parts.push(decodePdfString(match[1]))
  const arrays = /\[(.*?)\]\s*TJ/gs
  while ((match = arrays.exec(src))) {
    const inner = match[1]
    const bits = inner.match(/\(((?:\\.|[^()\\])*)\)/g) || []
    parts.push(bits.map((bit) => decodePdfString(bit.slice(1, -1))).join(''))
  }
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g
  while ((match = hex.exec(src))) {
    const hexes = match[1].replace(/\s+/g, '')
    let out = ''
    for (let i = 0; i + 1 < hexes.length; i += 2) out += String.fromCharCode(parseInt(hexes.slice(i, i + 2), 16))
    parts.push(out)
  }
  return cleanText(parts.join(' '))
}

async function extractPdfLocal(buf) {
  const bytes = new Uint8Array(buf)
  const raw = new TextDecoder('latin1').decode(bytes)
  const chunks = []
  const streamRe = /stream\r?\n/g
  let match
  while ((match = streamRe.exec(raw))) {
    const headStart = raw.lastIndexOf('<<', match.index)
    const dict = headStart >= 0 ? raw.slice(headStart, match.index) : ''
    const start = match.index + match[0].length
    const endMark = raw.indexOf('endstream', start)
    if (endMark < 0) continue
    let payload = bytes.subarray(start, endMark)
    if (payload[payload.length - 1] === 10) payload = payload.subarray(0, payload.length - 1)
    if (payload[payload.length - 1] === 13) payload = payload.subarray(0, payload.length - 1)
    let content = payload
    if (/\/FlateDecode|\/Fl\b/.test(dict)) {
      try { content = new Uint8Array(await inflate(payload)) } catch { continue }
    }
    chunks.push(pdfStrings(new TextDecoder('latin1').decode(content)))
  }
  chunks.push(pdfStrings(raw))
  return cleanText(chunks.filter(Boolean).join('\n'))
}

let pdfjsLoader = null
async function extractPdfJs(blob) {
  if (!pdfjsLoader) {
    pdfjsLoader = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
      return mod
    }).catch((error) => {
      pdfjsLoader = null
      throw error
    })
  }
  const pdfjs = await pdfjsLoader
  const data = new Uint8Array(await blob.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, disableWorker: false }).promise
  const pages = []
  const last = Math.min(doc.numPages, 25)
  for (let i = 1; i <= last; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(' '))
  }
  return cleanText(pages.join('\n'))
}

async function extractPdf(blob, buf) {
  try {
    const text = await extractPdfJs(blob)
    if (text.length >= 40) return text
  } catch { /* local fallback */ }
  return extractPdfLocal(buf)
}

function extractBinaryRuns(buf) {
  const bytes = new Uint8Array(buf)
  const utf16 = new TextDecoder('utf-16le').decode(bytes)
  const latin = new TextDecoder('windows-1258').decode(bytes)
  const pattern = /[\u00C0-\u024F\u1EA0-\u1EFFa-zA-Z0-9][\u00C0-\u024F\u1EA0-\u1EFFa-zA-Z0-9 ,.;:?!\-()/]{18,}/g
  const runs = [...(utf16.match(pattern) || []), ...(latin.match(pattern) || [])]
  return cleanText([...new Set(runs)].join('\n'))
}

export async function extractFileText(blob, name = '', mime = '') {
  const ext = extOf(name)
  const type = String(mime || blob.type || '').toLowerCase()
  if (type.startsWith('text/') || ['txt', 'md', 'csv', 'json'].includes(ext)) {
    return { kind: 'text', text: limitText(await blob.text()) }
  }
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return { kind: 'image', text: '', note: 'image' }
  }
  const buf = await blob.arrayBuffer()
  if (type === 'application/pdf' || ext === 'pdf') {
    return { kind: 'pdf', text: limitText(await extractPdf(blob, buf)) }
  }
  if (ext === 'docx') return { kind: 'docx', text: limitText(await extractDocx(buf)) }
  if (ext === 'pptx') return { kind: 'pptx', text: limitText(await extractPptx(buf)) }
  if (ext === 'doc' || ext === 'ppt') return { kind: 'binary', text: limitText(extractBinaryRuns(buf)) }
  try {
    const text = new TextDecoder('utf-8').decode(buf)
    if (looksLikeText(text)) return { kind: 'text', text: limitText(text) }
  } catch { /* ignore */ }
  return { kind: 'other', text: '' }
}
