'use strict'
/**
 * dsh-thinktank — Host 半体
 *
 * 思维模型全方位分析：内置 161 个经典思维模型（九大分类），输入一个问题后
 * 把选中模型分批丢给 agent 会话并行分析（每批一个会话，末尾 JSON 标记协议回收
 * 结果），全部批次完成后起一个综合会话产出跨模型结论（共识/分歧/盲区/行动清单），
 * 最终报告持久化到 storageDomain（域 dsh_thinktank）。无 agents 服务时降级为
 * 「提示词往返」模式：生成整段提示词 → 用户在任何会话执行 → 粘回 JSON 导入。
 *
 * 运行时零 npm 依赖；agents/agentDefaultModel 走软依赖（ctx.get），缺席不阻塞激活。
 */

const { randomUUID } = require('node:crypto')

const models = require('./models')
const prompt = require('./prompt')

const PLUGIN_ID = 'dsh-thinktank'
const API_PREFIX = '/dsh-thinktank/api'
const MAX_BODY_BYTES = 1024 * 1024
const BATCH_SIZE = 6
const BATCH_CONCURRENCY = 3
const BATCH_TIMEOUT_MS = 12 * 60 * 1000
const MAX_MODELS_PER_JOB = 36
const MAX_REPORTS = 50

// ── 输入校验 ────────────────────────────────────────────────────────────────

function normalizeAnalysisInput(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['请求体必须是对象'] }
  const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, 2000) : ''
  if (!question) errors.push('question 不能为空')
  const context = typeof raw.context === 'string' ? raw.context.trim().slice(0, 4000) : ''
  const ids = Array.isArray(raw.modelIds) ? raw.modelIds : []
  const modelIds = []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue
    if (!models.MODEL_BY_ID[id]) { errors.push(`未知模型：${id}`); continue }
    seen.add(id)
    modelIds.push(id)
  }
  if (!modelIds.length) errors.push('至少选择一个思维模型')
  if (modelIds.length > MAX_MODELS_PER_JOB) errors.push(`单次最多选择 ${MAX_MODELS_PER_JOB} 个模型`)
  return { ok: errors.length === 0, errors, input: { question, context, modelIds } }
}

// ── 会话结果读取（与 dsh-tasks 同款防御性读法）───────────────────────────────

function messageText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

function lastAssistantText(events) {
  if (!Array.isArray(events)) return ''
  for (let i = events.length - 1; i >= 0; i--) {
    const entry = events[i]
    if (entry && entry.type === 'assistant/message') {
      const message = entry.data && entry.data.message
      const text = messageText(message && message.content)
      if (text) return text
    }
  }
  return ''
}

function sessionEventsOf(session) {
  if (!session) return undefined
  try {
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
    if (Array.isArray(events)) return events
  } catch {}
  return undefined
}

function turnEndKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason && typeof reason === 'object' && typeof reason.kind === 'string') return reason.kind
  return undefined
}

function errorSummaryFrom(reason) {
  const failure = reason && typeof reason === 'object' ? (reason.error || reason.failure) : undefined
  if (failure === undefined || failure === null) return undefined
  const text = typeof failure === 'string' ? failure : (typeof failure.message === 'string' ? failure.message : String(failure))
  return text.slice(0, 200)
}

/** 任务区只展示进行中的任务：落定（完成/失败/取消）即移出，由「历史报告」列表承载。 */
function jobVisible(job) {
  return !!job && job.status === 'running'
}

// ── 插件 ────────────────────────────────────────────────────────────────────

module.exports = {
  name: PLUGIN_ID,
  inject: ['webServer', 'connection', 'storageDomain'],

  __internals: { normalizeAnalysisInput, jobVisible },

  apply(ctx) {
    // ── 存储（域打不开退化内存，/status 如实标注）───────────────────────────
    const memTables = { reports: new Map(), config: new Map() }
    const storageMode = { mode: 'memory', error: '' }
    const passthrough = { parse: (v) => v }
    const domainPromise = ctx.storageDomain.open({
      name: 'dsh_thinktank',
      version: 1,
      invalidRecords: 'backup-and-skip',
      tables: {
        reports: { valueSchema: passthrough },
        config: { valueSchema: passthrough },
      },
    }).then((domain) => {
      if (domain) storageMode.mode = 'domain'
      return domain
    }).catch((e) => {
      storageMode.mode = 'memory'
      storageMode.error = String((e && e.message) || e).slice(0, 200)
      return null
    })

    async function storeTable(name) {
      const domain = await domainPromise
      if (domain) return domain.table(name)
      return {
        get: (key) => memTables[name].get(key),
        put: async (key, value) => { memTables[name].set(key, value) },
        delete: async (key) => { memTables[name].delete(key) },
      }
    }
    ctx.effect(() => () => {
      domainPromise.then((d) => d && d.close()).catch(() => {})
    }, 'dsh-thinktank: storage close')

    const DEFAULT_CONFIG = { entry: 'sidebar' }

    async function currentConfig() {
      try {
        const table = await storeTable('config')
        const stored = await table.get('ui')
        if (stored && typeof stored === 'object') return { ...DEFAULT_CONFIG, ...stored }
      } catch { /* ignore */ }
      return { ...DEFAULT_CONFIG }
    }

    // ── 报告存取 ────────────────────────────────────────────────────────────

    async function listReports() {
      try {
        const table = await storeTable('reports')
        const index = (await table.get('index')) || []
        const out = []
        for (const id of index.slice(-200)) {
          try {
            const r = await table.get(id)
            if (r && r.id) {
              out.push({
                id: r.id,
                question: String(r.question || '').slice(0, 120),
                createdAt: r.createdAt,
                modelCount: Array.isArray(r.results) ? r.results.length : 0,
                hasSynthesis: !!(r.synthesis && r.synthesis.summary),
                ok: r.ok !== false,
              })
            }
          } catch { /* 单条坏了跳过 */ }
        }
        return out.reverse()
      } catch { return [] }
    }

    async function saveReport(report) {
      const table = await storeTable('reports')
      await table.put(report.id, report)
      let index = []
      try { index = (await table.get('index')) || [] } catch { /* ignore */ }
      index = index.filter((id) => id !== report.id)
      index.push(report.id)
      // 修剪最旧报告
      while (index.length > MAX_REPORTS) {
        const old = index.shift()
        try { if (table.delete) await table.delete(old) } catch { /* ignore */ }
      }
      await table.put('index', index)
    }

    // ── 分析任务 ────────────────────────────────────────────────────────────

    const jobs = new Map() // jobId -> job（内存态，重启即失；报告落盘兜底）
    // sessionId -> { resolve, reject, timer }：turn/end 事件回收会话输出
    const pendingSessions = new Map()

    const agentsService = () => {
      try { return ctx.get('agents') } catch { return undefined }
    }

    function agentSelection() {
      try {
        const adm = ctx.get('agentDefaultModel')
        if (adm && typeof adm.currentSelection === 'function') return adm.currentSelection()
      } catch { /* ignore */ }
      return {}
    }

    /** 会话标题：插件名前缀 + 问题摘要 + 阶段标记，侧边栏一眼可辨。 */
    function sessionTitleFor(question, stage) {
      const q = String(question || '').trim().replace(/\s+/g, ' ')
      const short = q.length > 16 ? `${q.slice(0, 16)}…` : q
      return `🦉 智囊团 · ${short || '未命名问题'} · ${stage}`
    }

    /**
     * 起一个无人值守会话执行 prompt，返回最终 assistant 文本。
     * 失败/超时/被中止都会 reject。调用方负责并发控制。
     * onSession（可选）：会话创建后回传 session 对象，供调用方轮询流式输出。
     */
    async function runSession(tag, promptText, onSession, timeoutMs, title) {
      const agents = agentsService()
      if (!agents || typeof agents.create !== 'function') {
        throw new Error('agents-service-unavailable')
      }
      const sessionId = `tt-${tag}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
      const selection = agentSelection()
      const handle = await agents.create({
        sessionId,
        meta: { cwd: process.env.DSH_HOME || process.env.HOME || '/' },
        agentOptions: selection && selection.provider ? { provider: selection.provider, model: selection.model } : {},
        // 不 mount 预设会话将零工具——按 dsh-tasks 同款流程解析并挂载默认预设
        setup: async (agentCtx) => {
          try {
            const presets = ctx.get('agentPresets')
            if (!presets || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') return
            const resolved = await presets.resolve(undefined)
            if (resolved && resolved.id) await presets.mount(agentCtx, resolved.id)
          } catch { /* 预设缺席：纯文本分析不依赖工具，继续 */ }
        },
      })
      const text = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingSessions.delete(sessionId)
          reject(new Error('分析超时'))
        }, typeof timeoutMs === 'number' ? timeoutMs : BATCH_TIMEOUT_MS)
        pendingSessions.set(sessionId, { resolve, reject, timer })
        try {
          if (typeof onSession === 'function' && handle.agent && handle.agent.session) {
            try { onSession(handle.agent.session) } catch { /* 忽略回传失败 */ }
          }
          // 无人值守：放宽沙箱与审批，避免写操作被 ask 策略卡死
          const session = handle.agent && handle.agent.session
          if (session && typeof session.append === 'function') {
            try { session.append('sandbox/mode', { mode: 'workspace-write' }) } catch { /* ignore */ }
            try { session.append('approval/policy', { policy: 'never' }) } catch { /* ignore */ }
            // 钉住会话标题（user 来源防止自动标题覆盖）；失败非致命
            if (title) {
              try { session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } }) } catch { /* ignore */ }
            }
          }
          handle.agent.followup({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: promptText }],
            source: { kind: 'dsh-thinktank' },
          })
        } catch (e) {
          clearTimeout(timer)
          pendingSessions.delete(sessionId)
          reject(e)
        }
      })
      return text
    }

    ctx.effect(() => {
      const dispose = ctx.on('session/event', (session, event) => {
        try {
          if (!event || event.type !== 'turn/end') return
          const sessionId = session && session.id
          if (typeof sessionId !== 'string') return
          const pending = pendingSessions.get(sessionId)
          if (!pending) return
          pendingSessions.delete(sessionId)
          clearTimeout(pending.timer)
          const kind = turnEndKind(event.data && event.data.reason)
          if (kind === 'completed' || kind === 'max-tokens') {
            pending.resolve(lastAssistantText(sessionEventsOf(session)))
          } else {
            pending.reject(new Error(errorSummaryFrom(event.data && event.data.reason) || `turn ended: ${kind || 'unknown'}`))
          }
        } catch { /* 事件分发绝不能拖垮宿主 */ }
      })
      return () => { try { dispose() } catch {} }
    }, 'dsh-thinktank: session event tracking')

    function jobSnapshot(job, full) {
      const snap = {
        id: job.id,
        status: job.status,
        question: job.question,
        createdAt: job.createdAt,
        modelCount: job.modelIds.length,
        batches: job.batches.map((b) => ({
          index: b.index, status: b.status, count: b.results.length,
          models: b.modelIds, error: b.error || undefined,
        })),
        resultsCount: job.results.length,
        synthesisStatus: job.synthesisStatus,
        error: job.error || undefined,
        reportId: job.reportId || undefined,
        durationMs: job.settledAt ? job.settledAt - job.startedAt : Date.now() - job.startedAt,
      }
      // full 模式带完整结果与综合结论（历史页实时卡片用：随批次完成逐渐填满）
      if (full) {
        snap.results = job.results
        snap.synthesisData = job.synthesisData || null
      }
      return snap
    }

    async function runBatch(job, batch) {
      batch.status = 'running'
      const modelList = models.getModels(batch.modelIds)
      const knownIds = new Set(batch.modelIds)
      try {
        const text = await runSession(
          `b${batch.index}`,
          prompt.buildBatchPrompt(job.question, job.context, modelList),
          undefined, undefined,
          sessionTitleFor(job.question, `批次 ${batch.index + 1}/${job.batches.length}`),
        )
        if (job.status === 'aborted') return
        const parsed = prompt.extractMindJson(text)
        if (!parsed) throw new Error('未能在回复中找到结构化结果（JSON 标记缺失或损坏）')
        const { results, dropped } = prompt.normalizeResults(parsed, knownIds)
        if (!results.length) throw new Error('结果为空或模型 id 全部不匹配')
        batch.results = results
        if (dropped.length) batch.error = `忽略未知模型：${dropped.join(',')}`
        batch.status = 'done'
        job.results.push(...results)
      } catch (e) {
        batch.status = 'error'
        batch.error = String((e && e.message) || e).slice(0, 300)
      }
    }

    async function runSynthesis(job) {
      job.synthesisStatus = 'running'
      try {
        const text = await runSession(
          'synth',
          prompt.buildSynthesisPrompt(job.question, job.context, prompt.compactResults(job.results)),
          undefined, undefined,
          sessionTitleFor(job.question, '跨模型综合'),
        )
        if (job.status === 'aborted') return
        const parsed = prompt.extractMindJson(text)
        const synthesis = prompt.normalizeSynthesis(parsed)
        if (!synthesis) throw new Error('综合结果解析失败')
        job.synthesisData = synthesis
        job.synthesisStatus = 'done'
      } catch (e) {
        job.synthesisStatus = 'error'
        job.synthesisError = String((e && e.message) || e).slice(0, 300)
      }
    }

    async function runJob(job) {
      job.startedAt = Date.now()
      // 简单并发池：最多 BATCH_CONCURRENCY 个批次并行
      const queue = job.batches.slice()
      const workers = []
      for (let i = 0; i < Math.min(BATCH_CONCURRENCY, queue.length); i++) {
        workers.push((async () => {
          while (queue.length) {
            const batch = queue.shift()
            if (!batch || job.status === 'aborted') return
            await runBatch(job, batch)
          }
        })())
      }
      await Promise.all(workers)
      if (job.status === 'aborted') return
      if (job.results.length > 0) {
        await runSynthesis(job)
      } else {
        job.synthesisStatus = 'skipped'
      }
      if (job.status === 'aborted') return
      job.status = job.results.length > 0 ? 'done' : 'error'
      if (job.status === 'error') job.error = '所有批次均失败：' + job.batches.map((b) => b.error || '?').join('；').slice(0, 400)
      job.settledAt = Date.now()
      // 落成报告（含部分失败的结果）
      const report = {
        id: `r-${job.id}`,
        ok: job.status === 'done',
        question: job.question,
        context: job.context,
        createdAt: job.createdAt,
        modelIds: job.modelIds,
        results: job.results,
        synthesis: job.synthesisData || null,
        synthesisError: job.synthesisError || undefined,
        batchErrors: job.batches.filter((b) => b.status === 'error').map((b) => ({ models: b.modelIds, error: b.error })),
        durationMs: job.settledAt - job.startedAt,
      }
      try {
        await saveReport(report)
        job.reportId = report.id
      } catch { /* 存储不可用：结果仍在内存 job 里 */ }
    }

    function startJob(input) {
      const id = `j-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
      const batches = []
      for (let i = 0; i < input.modelIds.length; i += BATCH_SIZE) {
        batches.push({
          index: batches.length,
          modelIds: input.modelIds.slice(i, i + BATCH_SIZE),
          status: 'queued',
          results: [],
        })
      }
      const job = {
        id,
        question: input.question,
        context: input.context,
        modelIds: input.modelIds,
        createdAt: new Date().toISOString(),
        status: 'running',
        batches,
        results: [],
        synthesisStatus: 'pending',
        startedAt: Date.now(),
        settledAt: 0,
      }
      jobs.set(id, job)
      if (jobs.size > 30) {
        // 防膨胀：丢最旧的已结束 job
        for (const [jid, j] of jobs) {
          if (j.status !== 'running' && jid !== id) { jobs.delete(jid); break }
        }
      }
      runJob(job).catch((e) => {
        job.status = 'error'
        job.error = String((e && e.message) || e).slice(0, 400)
        job.settledAt = Date.now()
      })
      return job
    }

    // ── AI 智能推荐 ──────────────────────────────────────────────────────────
    // 单会话任务：AI 读完整模型库后选型。运行中保留 session 句柄，状态轮询时
    // 聚合 assistant/chunk 流式增量，给客户端一个「实时对话过程」视图。
    const recJobs = new Map() // recId -> { status, session, textTail, picks, rationale, dropped, error, startedAt }

    function liveTextTail(session, max = 3000) {
      const events = sessionEventsOf(session)
      if (!events) return ''
      let text = ''
      for (const e of events) {
        if (!e) continue
        if (e.type === 'assistant/chunk') {
          const c = e.data && e.data.chunk
          if (c && c.type === 'text-delta' && typeof c.text === 'string') text += c.text
          else if (c && c.type === 'text' && typeof c.text === 'string') text += c.text
        } else if (e.type === 'assistant/message') {
          const t = messageText(e.data && e.data.message && e.data.message.content)
          if (t) text = t // 完整消息覆盖增量聚合
        }
      }
      return text.length > max ? `…${text.slice(-max)}` : text
    }

    async function runRecommend(rec) {
      try {
        const text = await runSession(
          'rec',
          prompt.buildRecommendPrompt(rec.question, rec.context, models.MODELS),
          (session) => { rec.session = session },
          6 * 60 * 1000,
          sessionTitleFor(rec.question, 'AI 选型'),
        )
        const parsed = prompt.extractMindJson(text)
        const { picks, dropped, rationale } = prompt.normalizePicks(parsed, new Set(Object.keys(models.MODEL_BY_ID)))
        if (!picks.length) throw new Error('AI 未能给出有效推荐（结构化结果为空或 id 不匹配）')
        rec.picks = picks
        rec.dropped = dropped
        rec.rationale = rationale
        rec.status = 'done'
      } catch (e) {
        rec.status = 'error'
        rec.error = String((e && e.message) || e).slice(0, 300)
      }
    }

    function startRecommend(question, context) {
      const id = `rec-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
      const rec = { id, question, context, status: 'running', picks: [], dropped: [], rationale: '', error: '', startedAt: Date.now(), session: null }
      recJobs.set(id, rec)
      // 30 分钟前的旧推荐惰性清理
      for (const [rid, r] of recJobs) {
        if (Date.now() - r.startedAt > 30 * 60 * 1000) recJobs.delete(rid)
      }
      runRecommend(rec).catch(() => {})
      return rec
    }

    // ── HTTP API ────────────────────────────────────────────────────────────

    function readBody(req, limit) {
      return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
          chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
    }

    ctx.effect(() => {
      const disposeRoute = ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          // 信任栅栏：Host/Origin 检查 + 浏览器认证，缺一不可
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end()
            return
          }
          const url = new URL(req.url || '/', 'http://dsh.local')
          const path = url.pathname.replace(/\/+$/, '')
          const sendJson = (status, payload) => {
            res.writeHead(status, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            res.end(JSON.stringify(payload))
          }

          try {
            if (req.method === 'GET' && path.endsWith('/status')) {
              sendJson(200, {
                storage: storageMode.mode,
                storageError: storageMode.error,
                agentsAvailable: !!agentsService(),
                modelCount: models.MODELS.length,
                categories: models.CATEGORIES.length,
                jobsRunning: [...jobs.values()].filter((j) => j.status === 'running').length,
              })
              return
            }

            if (req.method === 'GET' && path.endsWith('/models')) {
              sendJson(200, models.catalog())
              return
            }

            if (req.method === 'POST' && path.endsWith('/recommend')) {
              let body = {}
              try { body = JSON.parse((await readBody(req, 64 * 1024)) || '{}') } catch { /* 空体 */ }
              sendJson(200, { items: models.recommend(body.question, 12) })
              return
            }

            if (req.method === 'POST' && path.endsWith('/ai-recommend')) {
              let body = {}
              try { body = JSON.parse((await readBody(req, 64 * 1024)) || '{}') } catch { /* 空体 */ }
              const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : ''
              if (!question) { sendJson(400, { errors: ['question 不能为空'] }); return }
              if (!agentsService()) { sendJson(503, { error: 'agents 服务不可用，请用关键词匹配' }); return }
              const context = typeof body.context === 'string' ? body.context.trim().slice(0, 4000) : ''
              const rec = startRecommend(question, context)
              sendJson(202, { id: rec.id })
              return
            }

            if (req.method === 'GET' && path.endsWith('/ai-recommend')) {
              const rec = recJobs.get(url.searchParams.get('id') || '')
              if (!rec) { sendJson(404, { error: '推荐任务不存在（宿主重启后不保留）' }); return }
              // 运行中：刷新流式文本尾，给客户端「对话过程」视图
              if (rec.status === 'running' && rec.session) {
                try { rec.textTail = liveTextTail(rec.session) } catch { /* 保持上次值 */ }
              }
              sendJson(200, {
                id: rec.id,
                status: rec.status,
                textTail: rec.textTail || '',
                picks: rec.picks,
                rationale: rec.rationale,
                dropped: rec.dropped,
                error: rec.error || undefined,
                elapsedMs: Date.now() - rec.startedAt,
              })
              return
            }

            if (req.method === 'POST' && path.endsWith('/analyze')) {
              let body = null
              try { body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch { /* 落到校验报错 */ }
              const { ok, errors, input } = normalizeAnalysisInput(body)
              if (!ok) { sendJson(400, { errors }); return }
              if (!agentsService()) { sendJson(503, { error: 'agents 服务不可用，请改用「提示词往返」模式' }); return }
              const job = startJob(input)
              sendJson(202, { jobId: job.id, batches: job.batches.length })
              return
            }

            if (req.method === 'GET' && path.endsWith('/jobs')) {
              // 任务区只给进行中的（落定即消失，报告进历史列表）；带完整结果供实时卡片渲染
              const all = [...jobs.values()]
                .filter((j) => jobVisible(j))
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, 20)
              sendJson(200, { jobs: all.map((j) => jobSnapshot(j, true)) })
              return
            }

            if (req.method === 'GET' && path.endsWith('/job')) {
              const job = jobs.get(url.searchParams.get('id') || '')
              if (!job) { sendJson(404, { error: 'job 不存在（宿主重启后任务不保留，报告在历史里）' }); return }
              sendJson(200, jobSnapshot(job))
              return
            }

            if (req.method === 'POST' && path.endsWith('/cancel')) {
              let body = {}
              try { body = JSON.parse((await readBody(req, 4096)) || '{}') } catch { /* 空体 */ }
              const job = jobs.get(body.jobId || '')
              if (!job) { sendJson(404, { error: 'job 不存在' }); return }
              if (job.status === 'running') job.status = 'aborted'
              sendJson(200, { ok: true })
              return
            }

            if (req.method === 'POST' && path.endsWith('/prompt')) {
              let body = null
              try { body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch { /* ignore */ }
              const { ok, errors, input } = normalizeAnalysisInput(body)
              if (!ok) { sendJson(400, { errors }); return }
              const modelList = models.getModels(input.modelIds)
              sendJson(200, { prompt: prompt.buildManualPrompt(input.question, input.context, modelList) })
              return
            }

            if (req.method === 'POST' && path.endsWith('/import')) {
              let body = null
              try { body = JSON.parse(await readBody(req, MAX_BODY_BYTES)) } catch { /* ignore */ }
              if (!body || typeof body !== 'object') { sendJson(400, { errors: ['请求体必须是对象'] }); return }
              const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : ''
              if (!question) { sendJson(400, { errors: ['question 不能为空'] }); return }
              const context = typeof body.context === 'string' ? body.context.trim().slice(0, 4000) : ''
              const parsed = prompt.extractMindJson(String(body.raw || ''))
              if (!parsed) { sendJson(400, { errors: ['无法从粘贴内容中解析出结果 JSON（需要 ' + prompt.JSON_MARKER + ' 标记或纯 JSON）'] }); return }
              const { results, dropped } = prompt.normalizeResults(parsed, new Set(Object.keys(models.MODEL_BY_ID)))
              if (!results.length) { sendJson(400, { errors: ['结果中没有有效的模型分析项（id 需与模型库匹配）'] }); return }
              const synthesis = prompt.normalizeSynthesis(parsed)
              const report = {
                id: `r-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
                ok: true,
                imported: true,
                question,
                context,
                createdAt: new Date().toISOString(),
                modelIds: results.map((r) => r.id),
                results,
                synthesis,
                batchErrors: dropped.length ? [{ models: dropped, error: '导入时被忽略的未知模型 id' }] : [],
                durationMs: 0,
              }
              await saveReport(report)
              sendJson(201, { reportId: report.id, resultCount: results.length, dropped })
              return
            }

            if (req.method === 'GET' && path.endsWith('/reports')) {
              sendJson(200, { reports: await listReports() })
              return
            }

            if (req.method === 'GET' && path.endsWith('/report')) {
              const table = await storeTable('reports')
              const report = await table.get(url.searchParams.get('id') || '')
              if (!report || !report.id) { sendJson(404, { error: '报告不存在' }); return }
              sendJson(200, report)
              return
            }

            if (req.method === 'DELETE' && path.endsWith('/report')) {
              const id = url.searchParams.get('id') || ''
              const table = await storeTable('reports')
              try { if (table.delete) await table.delete(id) } catch { /* ignore */ }
              try {
                const index = ((await table.get('index')) || []).filter((x) => x !== id)
                await table.put('index', index)
              } catch { /* ignore */ }
              sendJson(200, { ok: true })
              return
            }

            if (req.method === 'GET' && path.endsWith('/config')) {
              sendJson(200, await currentConfig())
              return
            }

            if (req.method === 'PUT' && path.endsWith('/config')) {
              let body = {}
              try { body = JSON.parse((await readBody(req, 64 * 1024)) || '{}') } catch { /* 空体 */ }
              const cfg = await currentConfig()
              if (['sidebar', 'settings', 'both'].includes(body.entry)) cfg.entry = body.entry
              try {
                const table = await storeTable('config')
                await table.put('ui', cfg)
              } catch { /* 内存模式静默 */ }
              sendJson(200, cfg)
              return
            }

            sendJson(404, { error: 'not found' })
          } catch (e) {
            sendJson(500, { error: String((e && e.message) || e).slice(0, 300) })
          }
        },
      })
      return () => { try { disposeRoute() } catch {} }
    }, 'dsh-thinktank: http api')
  },
}
