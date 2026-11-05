const MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-latest',
]

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-anthropic-key, x-gemini-key')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function clip(value, max) {
  const text = String(value || '').trim()
  return text.length > max ? `${text.slice(0, max)}\n…` : text
}

function systemPrompt() {
  return `Bạn là trợ lý AI trong ứng dụng Studyflow, trợ lý học tập cho sinh viên Việt Nam. Trả lời tiếng Việt, cụ thể, giống khi sinh viên hỏi trên ChatGPT, Gemini hay Claude. Nếu câu hỏi không liên quan bài học, cứ trả lời tự nhiên như một trợ lý trò chuyện bình thường.

Cách làm:
- Đọc kỹ câu hỏi, đề bài, ảnh/PDF đính kèm, và tài liệu môn nếu có.
- Ưu tiên tài liệu môn khi nó đủ để trả lời đúng.
- Nếu tài liệu thiếu, không có, hoặc không khớp đề: hãy tìm trên web để tìm giáo trình, ví dụ, công thức, bài giải mẫu, rồi trả lời đầy đủ từ kiến thức của bạn và nguồn vừa tìm. Không dừng lại chỉ vì “không có trong tài liệu”.
- Khi giải bài: nêu hiểu đề, kiến thức cần dùng, các bước, bài làm/đáp án, giải thích vì sao đúng. Có thể viết đoạn mẫu để sinh viên viết lại.
- Khi đọc ảnh đề: đọc chữ trong ảnh rồi giải.
- Dẫn nguồn (tên tài liệu môn hoặc URL) khi dùng. Không bịa nguồn.
- Giọng văn rõ, thân thiện, đi thẳng vào cách làm.`
}

function userText(body) {
  const parts = []
  if (body.task) {
    parts.push(`Nhiệm vụ: ${body.task.name || ''}`)
    if (body.task.description) parts.push(`Yêu cầu đầu mục: ${body.task.description}`)
    if (body.task.hours) parts.push(`Thời lượng phiên: ${body.task.hours} giờ`)
  }
  if (body.course) {
    parts.push(`Môn: ${body.course.name || ''}`)
    if (body.course.output) parts.push(`Yêu cầu đầu ra môn: ${body.course.output}`)
    if (body.course.notes) parts.push(`Ghi chú môn: ${clip(body.course.notes, 1200)}`)
  }
  if (body.plan) parts.push(`Kế hoạch: ${body.plan}`)
  if (body.context) parts.push(clip(body.context, 4000))
  const docs = Array.isArray(body.docs) ? body.docs : []
  if (docs.length) {
    parts.push('Tài liệu môn đã đọc:')
    docs.forEach((doc) => {
      parts.push(`--- ${doc.name || 'tài liệu'} ---\n${clip(doc.text, 8000) || '(không trích được chữ)'}`)
    })
  } else {
    parts.push('Chưa có chữ từ tài liệu môn (tệp chưa tải hoặc chưa trích được).')
  }
  const files = Array.isArray(body.files) ? body.files : []
  if (files.length) {
    parts.push('Đề / bài sinh viên đẩy lên:')
    files.forEach((file) => {
      parts.push(`--- ${file.name || 'tệp'} ---\n${clip(file.text, 8000) || '(ảnh hoặc chưa trích được chữ — xem khối ảnh/PDF nếu có)'}`)
    })
  }
  parts.push(`Câu hỏi của sinh viên:\n${clip(body.question, 8000)}`)
  parts.push('Hãy trả lời đầy đủ. Tìm web nếu cần thông tin mới hoặc tài liệu môn chưa đủ.')
  return parts.filter(Boolean).join('\n\n')
}

function attachments(body) {
  const out = []
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : []
  for (const image of images) {
    if (!image?.data) continue
    out.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.media_type || 'image/jpeg',
        data: image.data,
      },
    })
  }
  const pdfs = Array.isArray(body.pdfs) ? body.pdfs.slice(0, 1) : []
  for (const pdf of pdfs) {
    if (!pdf?.data) continue
    out.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf.data,
      },
    })
  }
  return out
}

function historyOf(body) {
  const rows = Array.isArray(body.history) ? body.history.slice(-8) : []
  const messages = []
  for (const row of rows) {
    const text = clip(row.text || row.suggestion || '', 2500)
    if (!text) continue
    const role = row.role === 'ai' || row.role === 'assistant' ? 'assistant' : 'user'
    messages.push({ role, content: text })
  }
  return messages
}

function extractReply(content) {
  const parts = []
  const sources = []
  for (const block of content || []) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text)
      for (const cite of block.citations || []) {
        const url = cite.url || cite.source?.url
        const title = cite.title || cite.cited_text || url
        if (url && !sources.some((item) => item.url === url)) sources.push({ title, url })
      }
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.url && !sources.some((row) => row.url === item.url)) {
          sources.push({ title: item.title || item.url, url: item.url })
        }
      }
    }
  }
  let text = parts.join('\n\n').trim()
  if (sources.length && !/https?:\/\//.test(text.slice(-800))) {
    text += `\n\n**Nguồn**\n${sources.slice(0, 6).map((item) => `- ${item.title}: ${item.url}`).join('\n')}`
  }
  return { text, sources, searched: sources.length > 0 }
}

async function callClaude(apiKey, model, payload, useSearch) {
  const messages = historyOf(payload)
  messages.push({
    role: 'user',
    content: [...attachments(payload), { type: 'text', text: userText(payload) }],
  })
  const body = {
    model,
    max_tokens: 4096,
    system: systemPrompt(),
    messages,
  }
  if (useSearch) {
    body.tools = [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 4,
      user_location: { type: 'approximate', country: 'VN', timezone: 'Asia/Ho_Chi_Minh' },
    }]
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

function errorOf(status, json) {
  const msg = String(json?.error?.message || json?.error || '')
  if (status === 401) return 'Khóa Claude không hợp lệ. Hãy dán lại khóa sk-ant từ console.anthropic.com.'
  if (status === 429) return 'Claude đang bận, thử lại sau một lát.'
  if (/web search/i.test(msg) && /not enabled|disabled/i.test(msg)) return 'search_disabled'
  if (/not_found|model/i.test(msg)) return 'model'
  return msg || `Claude trả lỗi ${status}.`
}

const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]

function geminiContents(payload) {
  const contents = []
  const push = (role, part) => {
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts.push(part)
    else contents.push({ role, parts: [part] })
  }
  for (const row of historyOf(payload)) {
    push(row.role === 'assistant' ? 'model' : 'user', { text: row.content })
  }
  for (const block of attachments(payload)) {
    push('user', { inline_data: { mime_type: block.source.media_type, data: block.source.data } })
  }
  push('user', { text: userText(payload) })
  while (contents.length && contents[0].role === 'model') contents.shift()
  return contents
}

function geminiReply(json) {
  const candidate = json?.candidates?.[0]
  const parts = candidate?.content?.parts || []
  let text = parts.filter((part) => part.text && !part.thought).map((part) => part.text).join('').trim()
  const sources = []
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const url = chunk.web?.uri
    if (url && !sources.some((item) => item.url === url)) sources.push({ title: chunk.web.title || url, url })
  }
  if (text && sources.length && !/https?:\/\//.test(text.slice(-800))) {
    text += `\n\n**Nguồn**\n${sources.slice(0, 6).map((item) => `- ${item.title}: ${item.url}`).join('\n')}`
  }
  return { text, sources, searched: sources.length > 0 }
}

async function callGemini(apiKey, model, payload, useSearch) {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: geminiContents(payload),
    generationConfig: { maxOutputTokens: 8192 },
  }
  if (useSearch) body.tools = [{ google_search: {} }]
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

function geminiError(status, json) {
  const msg = String(json?.error?.message || '')
  const reason = JSON.stringify(json?.error?.details || '')
  if (/API_KEY_INVALID|API key not valid/i.test(msg + reason)) return 'Khóa Gemini không hợp lệ. Lấy lại khóa tại aistudio.google.com/apikey rồi dán vào Cài đặt.'
  if (status === 429) return 'Gemini đã chạm giới hạn miễn phí (số lượt mỗi phút hoặc mỗi ngày). Đợi khoảng 1 phút rồi hỏi lại.'
  if (status === 403) return 'Khóa Gemini chưa được phép gọi API. Kiểm tra lại khóa trên aistudio.google.com.'
  return msg || `Gemini trả lỗi ${status}.`
}

async function askGemini(apiKey, payload) {
  let lastError = ''
  let lastStatus = 502
  for (const model of GEMINI_MODELS) {
    for (const useSearch of [true, false]) {
      try {
        const result = await callGemini(apiKey, model, payload, useSearch)
        if (result.ok) {
          const reply = geminiReply(result.json)
          if (reply.text) return { ok: true, ...reply, model, provider: 'gemini' }
          const blocked = result.json?.promptFeedback?.blockReason || result.json?.candidates?.[0]?.finishReason
          lastError = blocked ? `Gemini không trả lời câu này (${blocked}).` : 'Gemini chưa trả lời được.'
          continue
        }
        lastError = geminiError(result.status, result.json)
        lastStatus = result.status
        if (result.status === 401 || result.status === 403 || /không hợp lệ/.test(lastError)) {
          return { ok: false, status: result.status, text: lastError }
        }
        if (result.status === 404) break
      } catch (error) {
        lastError = error.message || 'network'
      }
    }
  }
  return { ok: false, status: lastStatus, text: lastError || 'Không gọi được Gemini.' }
}

async function askAnthropic(apiKey, payload) {
  let lastError = ''
  let lastStatus = 502
  for (const model of MODELS) {
    let useSearch = true
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await callClaude(apiKey, model, payload, useSearch)
        if (result.ok && result.json?.content) {
          const reply = extractReply(result.json.content)
          if (reply.text) return { ok: true, ...reply, model, provider: 'claude' }
        }
        const code = errorOf(result.status, result.json)
        if ((code === 'search_disabled' || (result.status === 400 && /tool|web_search/i.test(code))) && useSearch) {
          useSearch = false
          continue
        }
        if (code === 'model') break
        lastError = code
        lastStatus = result.status
        if (result.status === 401) return { ok: false, status: 401, text: lastError }
        if (result.status === 400 && useSearch) {
          useSearch = false
          continue
        }
        if (result.status === 400) return { ok: false, status: 400, text: lastError }
      } catch (error) {
        lastError = error.message || 'network'
      }
    }
  }
  return { ok: false, status: lastStatus, text: lastError || 'Không gọi được Claude. Thử lại hoặc kiểm tra khóa API.' }
}

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const envKey = process.env.ANTHROPIC_API_KEY || ''
  const envGemini = process.env.GEMINI_API_KEY || ''
  if (req.method === 'GET') return res.status(200).json({ live: Boolean(envKey || envGemini) })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })

  const claudeKey = envKey || String(req.headers['x-anthropic-key'] || '').trim()
  const geminiKey = envGemini || String(req.headers['x-gemini-key'] || '').trim()
  if (!claudeKey && !geminiKey) {
    return res.status(501).json({
      error: 'no_key',
      text: 'Chưa có khóa AI. Dán khóa Gemini miễn phí (aistudio.google.com/apikey) hoặc khóa Anthropic trong Cài đặt.',
    })
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  if (!String(payload.question || '').trim()) {
    return res.status(400).json({ error: 'missing', text: 'Thiếu câu hỏi.' })
  }

  const send = (reply) => res.status(200).json({
    text: reply.text,
    sources: reply.sources,
    searched: reply.searched,
    model: reply.model,
    provider: reply.provider,
  })
  const fail = (reply, error) => res.status(reply.status >= 400 ? reply.status : 502).json({ error, text: reply.text })

  // Gemini first when the user has a free key; Claude stays as backup.
  let geminiFail = null
  if (geminiKey) {
    const reply = await askGemini(geminiKey, payload)
    if (reply.ok) return send(reply)
    geminiFail = reply
  }
  if (claudeKey) {
    const reply = await askAnthropic(claudeKey, payload)
    if (reply.ok) return send(reply)
    if (geminiFail) return fail({ ...geminiFail, text: `${geminiFail.text}\n\n(Claude dự phòng cũng chưa dùng được.)` }, 'gemini')
    return fail(reply, 'claude')
  }
  return fail(geminiFail, 'gemini')
}

module.exports.config = { maxDuration: 60 }
