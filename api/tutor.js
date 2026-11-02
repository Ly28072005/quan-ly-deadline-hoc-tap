const MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-latest',
]

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-anthropic-key')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function clip(value, max) {
  const text = String(value || '').trim()
  return text.length > max ? `${text.slice(0, max)}\n…` : text
}

function systemPrompt() {
  return `Bạn là Claude trong ứng dụng Studyflow, trợ lý học tập cho sinh viên Việt Nam. Trả lời tiếng Việt, cụ thể, giống khi sinh viên gửi đề hoặc hỏi trên claude.ai.

Cách làm:
- Đọc kỹ câu hỏi, đề bài, ảnh/PDF đính kèm, và tài liệu môn nếu có.
- Ưu tiên tài liệu môn khi nó đủ để trả lời đúng.
- Nếu tài liệu thiếu, không có, hoặc không khớp đề: hãy dùng web_search để tìm giáo trình, ví dụ, công thức, bài giải mẫu, rồi trả lời đầy đủ từ kiến thức của bạn và nguồn vừa tìm. Không dừng lại chỉ vì “không có trong tài liệu”.
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
  parts.push('Hãy giải hoặc trả lời đầy đủ. Tìm web nếu tài liệu môn chưa đủ.')
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

module.exports = async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  const envKey = process.env.ANTHROPIC_API_KEY || ''
  if (req.method === 'GET') return res.status(200).json({ live: Boolean(envKey) })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })

  const headerKey = String(req.headers['x-anthropic-key'] || '').trim()
  const apiKey = envKey || headerKey
  if (!apiKey) {
    return res.status(501).json({
      error: 'no_key',
      text: 'Chưa có khóa Claude. Dán khóa Anthropic (sk-ant-…) trong Cài đặt, hoặc thêm ANTHROPIC_API_KEY trên Vercel.',
    })
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {}
  if (!String(payload.question || '').trim()) {
    return res.status(400).json({ error: 'missing', text: 'Thiếu câu hỏi.' })
  }

  let lastError = ''
  for (const model of MODELS) {
    let useSearch = true
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await callClaude(apiKey, model, payload, useSearch)
        if (result.ok && result.json?.content) {
          const reply = extractReply(result.json.content)
          if (reply.text) {
            return res.status(200).json({
              text: reply.text,
              sources: reply.sources,
              searched: reply.searched,
              model,
            })
          }
        }
        const code = errorOf(result.status, result.json)
        if ((code === 'search_disabled' || (result.status === 400 && /tool|web_search/i.test(code))) && useSearch) {
          useSearch = false
          continue
        }
        if (code === 'model') break
        lastError = code
        if (result.status === 401) {
          return res.status(401).json({ error: 'claude', text: lastError })
        }
        if (result.status === 400 && useSearch) {
          useSearch = false
          continue
        }
        if (result.status === 400) {
          return res.status(400).json({ error: 'claude', text: lastError })
        }
      } catch (error) {
        lastError = error.message || 'network'
      }
    }
  }
  return res.status(502).json({
    error: 'claude',
    text: lastError || 'Không gọi được Claude. Thử lại hoặc kiểm tra khóa API.',
  })
}

module.exports.config = { maxDuration: 60 }
