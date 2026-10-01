'use strict'
/**
 * dsh-thinktank — 提示词构建与分析结果提取/校验
 *
 * host 与 client 共用（client 经 esbuild 内联，用于手动往返模式的本地校验）。
 * AI 输出协议：回复末尾输出一行标记 `===MIND-JSON===`，其后跟一个 JSON 对象。
 * 提取时从最后一个标记截断、容忍前后散文与代码围栏，解析失败返回 {ok:false}。
 */

const models = require('./models')

const JSON_MARKER = '===MIND-JSON==='

const RESULT_SIGNALS = ['positive', 'negative', 'neutral', 'risk']

// ── 提示词构建 ──────────────────────────────────────────────────────────────

function fmtModelForPrompt(m) {
  const lines = []
  lines.push(`#### ${m.id}｜${m.name}（${m.en}）`)
  lines.push(`定义：${m.def}`)
  lines.push(`要点：${m.points.join('；')}`)
  lines.push(`引导问题：${m.qs.join(' / ')}`)
  return lines.join('\n')
}

function problemBlock(question, context) {
  const lines = []
  lines.push('## 待分析问题')
  lines.push(String(question || '').trim())
  if (context && String(context).trim()) {
    lines.push('')
    lines.push('### 背景信息')
    lines.push(String(context).trim())
  }
  return lines.join('\n')
}

/**
 * 单批次分析提示词：用给定的若干模型逐一分析问题。
 * 输出契约：results[]，每项 {id, verdict, analysis, insights[], actions[], signal}。
 */
function buildBatchPrompt(question, context, modelList) {
  const lines = []
  lines.push('你是一位精通多元思维模型的分析专家。请用下列指定的思维模型，逐一分析同一个问题。')
  lines.push('')
  lines.push(problemBlock(question, context))
  lines.push('')
  lines.push('## 本次使用的思维模型')
  lines.push('')
  for (const m of modelList) lines.push(fmtModelForPrompt(m))
  lines.push('')
  lines.push('## 分析要求')
  lines.push('1. 每个模型独立成节：先给出该模型视角下的一句话结论（verdict），再展开分析（analysis，用该模型的框架结构，150-300字），然后列出 2-4 条关键洞察（insights）与 1-3 条可执行建议（actions）。')
  lines.push('2. 严格站在该模型的框架内思考，不要泛泛而谈；引导问题是锚点但不必逐条回答。')
  lines.push('3. 给出信号判断（signal）：positive=该模型视角下形势有利；negative=形势不利；risk=存在显著风险或陷阱；neutral=中性/信息不足。')
  lines.push('4. 使用中文，具体、直白，结合问题实际，避免正确的废话。')
  lines.push('')
  lines.push('## 输出格式（严格遵守）')
  lines.push('先输出各模型的分析正文（markdown，以「### 模型名」分节）。然后在回复的最后一行单独输出标记 ' + JSON_MARKER + '，再紧随其后输出一个 JSON 对象（不要用代码围栏包裹），结构如下：')
  lines.push(JSON.stringify({
    results: [{
      id: '模型id（必须与上方列出的 id 一致）',
      verdict: '一句话结论',
      analysis: '完整分析（可含 markdown，与正文一致）',
      insights: ['关键洞察1', '关键洞察2'],
      actions: ['可执行建议1'],
      signal: 'positive|negative|neutral|risk',
    }],
  }, null, 2))
  lines.push('')
  lines.push('只允许输出一个 ' + JSON_MARKER + ' 标记，JSON 必须是其后的唯一内容。')
  return lines.join('\n')
}

/**
 * 综合分析提示词：汇总各模型结果，产出跨模型综合结论。
 * compactResults: [{id, name, verdict, signal, insights[]}]
 */
function buildSynthesisPrompt(question, context, compactResults) {
  const lines = []
  lines.push('你是一位精通多元思维模型的分析专家。同一个问题已用多个思维模型分别完成分析，现在需要你跨模型综合，形成最终结论。')
  lines.push('')
  lines.push(problemBlock(question, context))
  lines.push('')
  lines.push('## 各模型分析摘要')
  lines.push('')
  for (const r of compactResults) {
    const insights = Array.isArray(r.insights) ? r.insights.slice(0, 3).join('；') : ''
    lines.push(`- 【${r.name}】信号=${r.signal || 'neutral'}｜结论：${r.verdict || ''}${insights ? `｜洞察：${insights}` : ''}`)
  }
  lines.push('')
  lines.push('## 综合要求')
  lines.push('1. summary：200-400字的综合结论——这个问题综合来看该怎么看、怎么办。')
  lines.push('2. consensus：多个模型指向一致的结论（2-5条，每条说明哪些模型支持）。')
  lines.push('3. conflicts：模型之间相互冲突或张力明显的观点（0-4条，说明冲突双方与权衡点）。没有就输出空数组。')
  lines.push('4. blindspots：所有模型都没能覆盖的盲区与未验证假设（2-4条）。')
  lines.push('5. priorities：综合各模型的行动清单，按优先级排序（3-7条），每条含 action（具体行动）、why（依据，注明来自哪些模型）。')
  lines.push('6. 使用中文，具体直白，严禁空泛。')
  lines.push('')
  lines.push('## 输出格式（严格遵守）')
  lines.push('在回复最后一行单独输出标记 ' + JSON_MARKER + '，紧随其后输出一个 JSON 对象（不要用代码围栏包裹）：')
  lines.push(JSON.stringify({
    synthesis: {
      summary: '综合结论',
      consensus: ['共识1（支持模型：A、B）'],
      conflicts: ['分歧1：X模型认为…而Y模型认为…，权衡点在于…'],
      blindspots: ['盲区1'],
      priorities: [{ action: '具体行动', why: '依据（来自哪些模型）' }],
    },
  }, null, 2))
  lines.push('')
  lines.push('只允许输出一个 ' + JSON_MARKER + ' 标记，JSON 必须是其后的唯一内容。')
  return lines.join('\n')
}

/**
 * 手动往返模式的单发提示词：全部分析 + 综合在一条提示词内完成，
 * 用户粘贴到任意会话执行后把 JSON 粘回导入。
 */
function buildManualPrompt(question, context, modelList) {
  const batch = buildBatchPrompt(question, context, modelList)
  const lines = []
  lines.push(batch)
  lines.push('')
  lines.push('## 追加：跨模型综合')
  lines.push('在完成上述全部模型分析后，再做一轮跨模型综合，产出 summary（200-400字综合结论）、consensus（模型共识，2-5条）、conflicts（观点分歧，0-4条）、blindspots（盲区，2-4条）、priorities（行动清单3-7条，含 action 与 why）。')
  lines.push('')
  lines.push('## 最终输出格式（以本段为准）')
  lines.push('先输出全部分析正文（markdown），最后输出一行 ' + JSON_MARKER + ' 标记，紧随其后一个 JSON 对象（不要代码围栏），结构：')
  lines.push(JSON.stringify({
    results: [{ id: '模型id', verdict: '一句话结论', analysis: '完整分析', insights: ['洞察'], actions: ['建议'], signal: 'positive|negative|neutral|risk' }],
    synthesis: {
      summary: '综合结论',
      consensus: ['共识'],
      conflicts: ['分歧'],
      blindspots: ['盲区'],
      priorities: [{ action: '行动', why: '依据' }],
    },
  }, null, 2))
  return lines.join('\n')
}

/**
 * AI 智能推荐提示词：把整个模型库的紧凑清单交给 AI，让它针对问题选型。
 * 输出契约：picks[]，每项 {id, reason}；可选 rationale（选型思路）。
 */
function buildRecommendPrompt(question, context, allModels) {
  const lines = []
  lines.push('你是思维模型选型顾问。用户想用「多元思维模型」全方位分析一个问题，模型库如下。请仔细阅读问题，从库中挑选 6-12 个最合适的模型。')
  lines.push('')
  lines.push(problemBlock(question, context))
  lines.push('')
  lines.push('## 选型要求')
  lines.push('1. 跨分类组合：决策/战略/认知/心理/沟通/学习/系统/产品/执行，尽量覆盖 3 个以上不同视角，不要集中在一个分类。')
  lines.push('2. 每个模型给出一句具体推荐理由（为什么它适合这个问题，禁止泛泛的「有助于分析」）。')
  lines.push('3. 宁缺毋滥：不相关的不要凑数。')
  lines.push('')
  lines.push('## 模型库（id｜名称｜分类｜定义｜适用场景）')
  for (const m of allModels) {
    const cat = models.CATEGORY_BY_ID[m.cat]
    lines.push(`${m.id}｜${m.name}｜${cat ? cat.name : m.cat}｜${m.def}｜${m.scenes.join('/')}`)
  }
  lines.push('')
  lines.push('## 输出格式（严格遵守）')
  lines.push('先用一段话说明你的选型思路，然后在回复最后一行单独输出标记 ' + JSON_MARKER + '，紧随其后输出一个 JSON 对象（不要用代码围栏包裹）：')
  lines.push(JSON.stringify({
    rationale: '选型思路（一段话）',
    picks: [{ id: '模型id（必须与库中 id 完全一致）', reason: '一句推荐理由' }],
  }, null, 2))
  lines.push('')
  lines.push('只允许输出一个 ' + JSON_MARKER + ' 标记，JSON 必须是其后的唯一内容。')
  return lines.join('\n')
}

/** 校验 AI 推荐结果：id 白名单过滤、理由截断、去重、上限 15 个。 */
function normalizePicks(parsed, knownIds) {
  const arr = parsed && typeof parsed === 'object' && Array.isArray(parsed.picks) ? parsed.picks : []
  const picks = []
  const dropped = []
  const seen = new Set()
  for (const item of arr.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    if (knownIds && !knownIds.has(id)) { dropped.push(id); continue }
    seen.add(id)
    picks.push({ id, reason: trunc(item.reason, 200) })
    if (picks.length >= 15) break
  }
  const rationale = parsed && typeof parsed === 'object' ? trunc(parsed.rationale, 800) : ''
  return { picks, dropped, rationale }
}



/** 从 AI 回复文本中提取标记后的 JSON 对象。失败返回 null。 */
function extractMindJson(text) {
  if (typeof text !== 'string' || !text) return null
  const idx = text.lastIndexOf(JSON_MARKER)
  let tail = idx >= 0 ? text.slice(idx + JSON_MARKER.length) : text
  // 容忍代码围栏包裹
  tail = tail.trim()
  const fence = /^```(?:json)?\s*/i
  if (fence.test(tail)) tail = tail.replace(fence, '').replace(/```\s*$/, '').trim()
  // 找第一个 { 并做括号配平扫描，容忍 JSON 之后的尾随散文
  const start = tail.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < tail.length; i++) {
    const ch = tail[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(tail.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

const trunc = (v, n) => String(v || '').trim().slice(0, n)

function strList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const it of v.slice(0, maxItems)) {
    const s = typeof it === 'string' ? it.trim() : ''
    if (s) out.push(s.slice(0, maxLen))
  }
  return out
}

/**
 * 校验并规整 results 数组（只保留库内模型 id；未知 id 丢弃）。
 * 返回 { results, dropped } —— dropped 为被丢弃项的 id 列表。
 */
function normalizeResults(raw, knownIds) {
  const results = []
  const dropped = []
  const arr = raw && Array.isArray(raw.results) ? raw.results : Array.isArray(raw) ? raw : []
  const seen = new Set()
  for (const item of arr.slice(0, 80)) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    if (knownIds && !knownIds.has(id)) { dropped.push(id); continue }
    seen.add(id)
    results.push({
      id,
      verdict: trunc(item.verdict, 300),
      analysis: trunc(item.analysis, 4000),
      insights: strList(item.insights, 6, 400),
      actions: strList(item.actions, 4, 300),
      signal: RESULT_SIGNALS.includes(item.signal) ? item.signal : 'neutral',
    })
  }
  return { results, dropped }
}

/** 校验并规整 synthesis 对象；不可用返回 null。 */
function normalizeSynthesis(raw) {
  const syn = raw && typeof raw === 'object' ? (raw.synthesis && typeof raw.synthesis === 'object' ? raw.synthesis : raw) : null
  if (!syn) return null
  const out = {
    summary: trunc(syn.summary, 2000),
    consensus: strList(syn.consensus, 6, 400),
    conflicts: strList(syn.conflicts, 5, 400),
    blindspots: strList(syn.blindspots, 5, 400),
    priorities: [],
  }
  if (Array.isArray(syn.priorities)) {
    for (const p of syn.priorities.slice(0, 8)) {
      if (typeof p === 'string' && p.trim()) out.priorities.push({ action: p.trim().slice(0, 300), why: '' })
      else if (p && typeof p === 'object') {
        const action = trunc(p.action, 300)
        if (action) out.priorities.push({ action, why: trunc(p.why, 300) })
      }
    }
  }
  if (!out.summary && !out.consensus.length && !out.priorities.length) return null
  return out
}

/** 各模型结果的紧凑摘要（综合分析提示词用）。 */
function compactResults(results) {
  return (results || []).map((r) => {
    const m = models.getModel(r.id)
    return {
      id: r.id,
      name: m ? m.name : r.id,
      verdict: r.verdict,
      signal: r.signal,
      insights: (r.insights || []).slice(0, 3),
    }
  })
}

module.exports = {
  JSON_MARKER,
  RESULT_SIGNALS,
  buildBatchPrompt,
  buildSynthesisPrompt,
  buildManualPrompt,
  buildRecommendPrompt,
  extractMindJson,
  normalizeResults,
  normalizeSynthesis,
  normalizePicks,
  compactResults,
}
