/**
 * dsh-thinktank 宿主路由离线冒烟：mock ctx 直调 handler——
 * 信任栅栏拦截、目录/推荐/提示词/导入往返/报告增删查/config 读写、
 * 无 agents 服务时 /analyze 优雅 503、持久化重启读回。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Host = require('../src/index.js')

const { normalizeAnalysisInput } = Host.__internals

function mockRes() {
  return {
    status: 0,
    body: '',
    writeHead(s) { this.status = s; return this },
    write(d) { this.body += String(d); return true },
    end(d) { if (d) this.body += String(d) },
  }
}

function mockReq(method, url, body) {
  const handlers = {}
  const req = {
    method, url,
    on(ev, fn) { handlers[ev] = fn; return this },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined && handlers.data) handlers.data(Buffer.from(body))
    if (handlers.end) handlers.end()
  })
  return req
}

/** 起一个 mock ctx：storageDomain 用共享 Map 模拟持久化介质（重启=新 ctx 同介质）。 */
function mockCtx(medium) {
  const routes = []
  const cleanups = []
  const listeners = {}
  const ctx = {
    storageDomain: {
      open: async ({ name }) => ({
        table: (t) => {
          const key = `${name}/${t}`
          if (!medium.has(key)) medium.set(key, new Map())
          const table = medium.get(key)
          return {
            get: (k) => table.get(k),
            put: async (k, v) => { table.set(k, v) },
            delete: async (k) => { table.delete(k) },
          }
        },
        close: async () => {},
      }),
    },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    connection: { requestRejection: () => undefined },
    on: (name, fn) => { listeners[name] = fn; return () => {} },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    get: () => undefined, // 无 agents/agentPresets：测降级路径
  }
  return { ctx, routes, cleanups, listeners }
}

test('normalizeAnalysisInput 校验', () => {
  assert.equal(normalizeAnalysisInput(null).ok, false)
  assert.equal(normalizeAnalysisInput({ question: '', modelIds: ['swot'] }).ok, false)
  assert.equal(normalizeAnalysisInput({ question: 'q', modelIds: [] }).ok, false)
  assert.equal(normalizeAnalysisInput({ question: 'q', modelIds: ['nope'] }).ok, false)
  const ok = normalizeAnalysisInput({ question: 'q', modelIds: ['swot', 'swot', 'pdca'] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.input.modelIds, ['swot', 'pdca'], '去重')
  const tooMany = normalizeAnalysisInput({ question: 'q', modelIds: Array.from({ length: 40 }, (_, i) => require('../src/models.js').MODELS[i].id) })
  assert.equal(tooMany.ok, false, '超过 36 个被拒')
})

test('路由：目录/推荐/提示词/导入/报告/配置全旅程 + 重启读回', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtx(medium)
  try {
    Host.apply(ctx)
    assert.equal(routes.length, 1)
    const route = routes[0]

    // /status：agents 缺席如实标注
    const st = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/status'), st)
    const status = JSON.parse(st.body)
    assert.equal(status.agentsAvailable, false)
    assert.ok(status.modelCount >= 100)

    // /models 目录
    const cat = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/models'), cat)
    assert.equal(JSON.parse(cat.body).models.length, status.modelCount)

    // /recommend
    const rec = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/recommend', JSON.stringify({ question: '要不要辞职创业做产品' })), rec)
    assert.ok(JSON.parse(rec.body).items.length > 0)

    // /analyze 在无 agents 时 503
    const an = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/analyze', JSON.stringify({ question: 'q', modelIds: ['swot'] })), an)
    assert.equal(an.status, 503)

    // /analyze 校验失败 400
    const an2 = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/analyze', JSON.stringify({ question: '', modelIds: ['swot'] })), an2)
    assert.equal(an2.status, 400)

    // /prompt 生成手动提示词
    const pr = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/prompt', JSON.stringify({ question: '扩张还是收缩？', modelIds: ['swot', 'porter-five'] })), pr)
    assert.equal(pr.status, 200)
    const promptText = JSON.parse(pr.body).prompt
    assert.match(promptText, /===MIND-JSON===/)
    assert.match(promptText, /porter-five/)

    // /import：粘回模拟 AI 输出 → 报告落库
    const fakeAiReply = [
      '### SWOT 分析',
      '优势在于……',
      '===MIND-JSON===',
      JSON.stringify({
        results: [
          { id: 'swot', verdict: '机会大于威胁', analysis: 'S 显著…', insights: ['品牌强'], actions: ['先做渗透'], signal: 'positive' },
          { id: 'porter-five', verdict: '竞争激烈', analysis: '五力…', insights: ['替代品多'], actions: [], signal: 'risk' },
          { id: 'not-in-library', verdict: '丢弃我' },
        ],
        synthesis: {
          summary: '综合来看应谨慎扩张',
          consensus: ['聚焦优势（swot）'],
          conflicts: [],
          blindspots: ['未验证需求'],
          priorities: [{ action: '先小步试点', why: 'porter-five 显示竞争激烈' }],
        },
      }),
    ].join('\n')
    const imp = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/import', JSON.stringify({
      question: '扩张还是收缩？', raw: fakeAiReply,
    })), imp)
    assert.equal(imp.status, 201, imp.body)
    const { reportId, dropped } = JSON.parse(imp.body)
    assert.deepEqual(dropped, ['not-in-library'])

    // /reports 列表包含新报告
    const lst = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/reports'), lst)
    const reports = JSON.parse(lst.body).reports
    assert.equal(reports.length, 1)
    assert.equal(reports[0].id, reportId)
    assert.equal(reports[0].modelCount, 2)
    assert.equal(reports[0].hasSynthesis, true)

    // /report 详情
    const det = mockRes()
    await route.handler(mockReq('GET', `/dsh-thinktank/api/report?id=${reportId}`), det)
    const report = JSON.parse(det.body)
    assert.equal(report.results.length, 2)
    assert.equal(report.synthesis.summary, '综合来看应谨慎扩张')

    // config 读写
    const c1 = mockRes()
    await route.handler(mockReq('PUT', '/dsh-thinktank/api/config', JSON.stringify({ entry: 'both', junk: 1 })), c1)
    assert.equal(JSON.parse(c1.body).entry, 'both')
    assert.equal(JSON.parse(c1.body).junk, undefined, '未知字段不落库')

    // 信任栅栏：403 时所有路由被拒
    ctx.connection.requestRejection = () => 403
    for (const [method, url] of [
      ['GET', '/dsh-thinktank/api/status'],
      ['GET', '/dsh-thinktank/api/reports'],
      ['POST', '/dsh-thinktank/api/analyze'],
      ['POST', '/dsh-thinktank/api/import'],
    ]) {
      const blocked = mockRes()
      await route.handler(mockReq(method, url, method === 'POST' ? '{}' : undefined), blocked)
      assert.equal(blocked.status, 403, `${method} ${url} 应被栅栏拦截`)
    }
    ctx.connection.requestRejection = () => undefined
  } finally {
    for (const cleanup of cleanups) cleanup()
  }

  // 「重启」：新 ctx 同一介质，报告与配置读回
  const second = mockCtx(medium)
  try {
    Host.apply(second.ctx)
    const route = second.routes[0]
    const lst = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/reports'), lst)
    assert.equal(JSON.parse(lst.body).reports.length, 1, '重启后报告仍在')
    const cfg = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/config'), cfg)
    assert.equal(JSON.parse(cfg.body).entry, 'both', '重启后配置仍在')
  } finally {
    for (const cleanup of second.cleanups) cleanup()
  }
})

test('DELETE /report 删除后列表为空', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtx(medium)
  try {
    Host.apply(ctx)
    const route = routes[0]
    const imp = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/import', JSON.stringify({
      question: 'q',
      raw: JSON.stringify({ results: [{ id: 'swot', verdict: 'v' }] }),
    })), imp)
    const { reportId } = JSON.parse(imp.body)
    const del = mockRes()
    await route.handler(mockReq('DELETE', `/dsh-thinktank/api/report?id=${reportId}`), del)
    assert.equal(del.status, 200)
    const lst = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/reports'), lst)
    assert.equal(JSON.parse(lst.body).reports.length, 0)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('AI 推荐：无 agents 服务时 503 降级', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtx(medium)
  try {
    Host.apply(ctx)
    const res = mockRes()
    await routes[0].handler(mockReq('POST', '/dsh-thinktank/api/ai-recommend', JSON.stringify({ question: 'q' })), res)
    assert.equal(res.status, 503)
    const bad = mockRes()
    await routes[0].handler(mockReq('GET', '/dsh-thinktank/api/ai-recommend?id=nope'), bad)
    assert.equal(bad.status, 404)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('jobVisible：仅进行中可见，落定（完成/失败/取消）即移出任务区', () => {
  const { jobVisible } = Host.__internals
  const now = 1_000_000_000
  assert.equal(jobVisible({ status: 'running', settledAt: 0 }), true)
  assert.equal(jobVisible({ status: 'done', settledAt: now - 1 }), false, '刚完成也不再停留')
  assert.equal(jobVisible({ status: 'error', settledAt: now - 1 }), false)
  assert.equal(jobVisible({ status: 'aborted', settledAt: 0 }), false)
  assert.equal(jobVisible(null), false)
})

test('AI 拷问：无 agents 服务时 503（可跳过继续）；未知 id 404', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtx(medium)
  try {
    Host.apply(ctx)
    const res = mockRes()
    await routes[0].handler(mockReq('POST', '/dsh-thinktank/api/grill', JSON.stringify({ question: 'q' })), res)
    assert.equal(res.status, 503)
    const bad = mockRes()
    await routes[0].handler(mockReq('GET', '/dsh-thinktank/api/grill?id=nope'), bad)
    assert.equal(bad.status, 404)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})
