/**
 * dsh-thinktank 分析流水线端到端（mock agents 服务）：
 * POST /analyze → 分批会话 → turn/end 回收 → 综合会话 → 报告落库可读回。
 * 同时覆盖：批次失败不影响其他批次、综合失败仍产出报告。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Host = require('../src/index.js')
const P = require('../src/prompt.js')

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

function batchReply(modelIds) {
  return '分析正文\n' + P.JSON_MARKER + '\n' + JSON.stringify({
    results: modelIds.map((id) => ({
      id, verdict: `${id} 的结论`, analysis: `${id} 的分析`, insights: [`${id} 洞察`], actions: [`${id} 建议`], signal: 'positive',
    })),
  })
}

/**
 * mock agents：followup 后立即经捕获的 session/event 监听器回灌 turn/end。
 * replyFor(sessionId, promptText) 决定每个会话的输出；failFor 里的会话以 error 收尾。
 */
function mockCtxWithAgents(medium, { replyFor, failFor = () => false }) {
  const routes = []
  const cleanups = []
  const listeners = {}
  const titles = []
  const ctx = {
    storageDomain: {
      open: async ({ name }) => ({
        table: (t) => {
          const key = `${name}/${t}`
          if (!medium.has(key)) medium.set(key, new Map())
          const table = medium.get(key)
          return { get: (k) => table.get(k), put: async (k, v) => { table.set(k, v) }, delete: async (k) => { table.delete(k) } }
        },
        close: async () => {},
      }),
    },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    connection: { requestRejection: () => undefined },
    on: (name, fn) => { listeners[name] = fn; return () => {} },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    get(name) {
      if (name === 'agents') {
        return {
          create: async ({ sessionId, setup }) => {
            if (setup) await setup({})
            return {
              agent: {
                session: {
                  append: (type, payload) => {
                    if (type === 'session/title' && payload && payload.title) titles.push(payload.title)
                  },
                },
                followup: (message) => {
                  const text = message.content[0].text
                  queueMicrotask(() => {
                    const session = {
                      id: sessionId,
                      snapshotEvents: () => [{
                        type: 'assistant/message',
                        data: { message: { content: [{ type: 'text', text: replyFor(sessionId, text) }] } },
                      }],
                    }
                    if (failFor(sessionId, text)) {
                      listeners['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'error', error: 'boom' } } })
                    } else {
                      listeners['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
                    }
                  })
                },
              },
            }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, routes, cleanups, titles }
}

async function waitForJob(route, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = mockRes()
    await route.handler(mockReq('GET', `/dsh-thinktank/api/job?id=${jobId}`), res)
    const job = JSON.parse(res.body)
    if (job.status !== 'running') return job
    if (Date.now() > deadline) throw new Error('job 未在时限内完成')
    await new Promise((r) => setTimeout(r, 20))
  }
}

test('分析流水线：分批 → 综合 → 报告落库', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups, titles } = mockCtxWithAgents(medium, {
    replyFor: (sessionId, text) => {
      if (sessionId.includes('synth')) {
        return P.JSON_MARKER + '\n' + JSON.stringify({
          synthesis: { summary: '综合：大胆假设小心求证', consensus: ['c1'], conflicts: [], blindspots: ['b1'], priorities: [{ action: '试点', why: '风险可控' }] },
        })
      }
      // 从提示词里抠出本批模型 id（提示词含 `#### id｜` 行）
      const ids = [...text.matchAll(/#### ([a-z0-9-]+)｜/g)].map((m) => m[1])
      return batchReply(ids)
    },
  })
  try {
    Host.apply(ctx)
    const route = routes[0]
    const modelIds = ['swot', 'inversion', 'first-principles', 'pdca', 'porter-five', 'pestel', 'hook', 'fogg']
    const an = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/analyze', JSON.stringify({ question: '该不该扩张？', modelIds })), an)
    assert.equal(an.status, 202)
    const { jobId } = JSON.parse(an.body)

    const job = await waitForJob(route, jobId)
    assert.equal(job.status, 'done', JSON.stringify(job))
    assert.equal(job.resultsCount, 8)
    assert.equal(job.synthesisStatus, 'done')
    assert.ok(job.reportId)

    const rep = mockRes()
    await route.handler(mockReq('GET', `/dsh-thinktank/api/report?id=${job.reportId}`), rep)
    const report = JSON.parse(rep.body)
    assert.equal(report.results.length, 8)
    assert.equal(report.synthesis.summary, '综合：大胆假设小心求证')
    assert.deepEqual(report.results.map((r) => r.id).sort(), modelIds.slice().sort())

    // 会话标题：批次 + 综合各钉一个，含问题摘要
    assert.ok(titles.some((t) => t.includes('该不该扩张？') && t.includes('批次 1/2')), `缺批次标题：${JSON.stringify(titles)}`)
    assert.ok(titles.some((t) => t.includes('该不该扩张？') && t.includes('跨模型综合')), `缺综合标题：${JSON.stringify(titles)}`)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('单批失败不影响其他批次；综合失败报告仍可用', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtxWithAgents(medium, {
    replyFor: (sessionId, text) => {
      if (sessionId.includes('synth')) return '综合会话输出坏掉了，没有标记'
      const ids = [...text.matchAll(/#### ([a-z0-9-]+)｜/g)].map((m) => m[1])
      return batchReply(ids)
    },
    failFor: (sessionId) => sessionId.includes('-b1-'), // 第二批次失败
  })
  try {
    Host.apply(ctx)
    const route = routes[0]
    const modelIds = ['swot', 'inversion', 'first-principles', 'pdca', 'porter-five', 'pestel', 'hook', 'fogg']
    const an = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/analyze', JSON.stringify({ question: 'q', modelIds })), an)
    const { jobId } = JSON.parse(an.body)

    const job = await waitForJob(route, jobId)
    assert.equal(job.status, 'done', '部分批次成功即 done')
    assert.equal(job.batches.length, 2)
    assert.equal(job.batches[0].status, 'done')
    assert.equal(job.batches[1].status, 'error')
    assert.equal(job.synthesisStatus, 'error', '综合失败如实标注')

    const rep = mockRes()
    await route.handler(mockReq('GET', `/dsh-thinktank/api/report?id=${job.reportId}`), rep)
    const report = JSON.parse(rep.body)
    assert.equal(report.results.length, 6, '成功批次的 6 个模型结果保留')
    assert.equal(report.synthesis, null)
    assert.equal(report.batchErrors.length, 1)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('AI 推荐流水线：会话输出解析 → picks 校验 → 状态可读（含流式文本尾）', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups, titles } = mockCtxWithAgents(medium, {
    replyFor: (sessionId) => {
      if (sessionId.includes('rec')) {
        return '选型思路：先宏观后微观。\n' + P.JSON_MARKER + '\n' + JSON.stringify({
          rationale: '先宏观后微观',
          picks: [
            { id: 'pestel', reason: '宏观环境扫描' },
            { id: 'swot', reason: '盘点内外部' },
            { id: 'not-real', reason: '应被丢弃' },
          ],
        })
      }
      return 'junk'
    },
  })
  try {
    Host.apply(ctx)
    const route = routes[0]
    const start = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/ai-recommend', JSON.stringify({ question: '出海还是深耕国内？' })), start)
    assert.equal(start.status, 202)
    const { id } = JSON.parse(start.body)

    // 轮询直到 done
    let rec = null
    for (let i = 0; i < 100; i++) {
      const res = mockRes()
      await route.handler(mockReq('GET', `/dsh-thinktank/api/ai-recommend?id=${id}`), res)
      rec = JSON.parse(res.body)
      if (rec.status !== 'running') break
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.equal(rec.status, 'done')
    assert.deepEqual(rec.picks.map((p) => p.id), ['pestel', 'swot'], '未知 id 被丢弃')
    assert.equal(rec.dropped[0], 'not-real')
    assert.equal(rec.rationale, '先宏观后微观')
    assert.ok(typeof rec.elapsedMs === 'number')
    assert.ok(titles.some((t) => t.includes('出海还是深耕国内？') && t.includes('AI 选型')), `缺推荐标题：${JSON.stringify(titles)}`)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('任务落定后立即从 /jobs 任务区消失', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups } = mockCtxWithAgents(medium, {
    replyFor: (sessionId, text) => {
      if (sessionId.includes('synth')) {
        return P.JSON_MARKER + '\n' + JSON.stringify({ synthesis: { summary: 's', consensus: [], conflicts: [], blindspots: [], priorities: [] } })
      }
      const ids = [...text.matchAll(/#### ([a-z0-9-]+)｜/g)].map((m) => m[1])
      return batchReply(ids)
    },
  })
  try {
    Host.apply(ctx)
    const route = routes[0]
    const an = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/analyze', JSON.stringify({ question: 'q', modelIds: ['swot', 'pdca'] })), an)
    const { jobId } = JSON.parse(an.body)

    // 运行中：/jobs 可见
    const mid = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/jobs'), mid)
    // （会话是微任务级完成，可能已落定；两种状态都接受，只验证一致性语义）
    const midJobs = JSON.parse(mid.body).jobs
    assert.ok(midJobs.every((j) => j.status === 'running'), '任务区只含进行中任务')

    const job = await waitForJob(route, jobId)
    assert.equal(job.status, 'done')

    // 落定后：/jobs 不再出现
    const after = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/jobs'), after)
    assert.equal(JSON.parse(after.body).jobs.length, 0, '完成后任务区为空')

    // 报告仍在历史列表
    const lst = mockRes()
    await route.handler(mockReq('GET', '/dsh-thinktank/api/reports'), lst)
    assert.equal(JSON.parse(lst.body).reports.length, 1)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('拷问澄清流水线：AI 出要害追问 → 校验 → 状态可读', async () => {
  const medium = new Map()
  const { ctx, routes, cleanups, titles } = mockCtxWithAgents(medium, {
    replyFor: (sessionId) => {
      if (sessionId.includes('grill')) {
        return '最含糊的是「改造」的边界。\n' + P.JSON_MARKER + '\n' + JSON.stringify({
          questions: [
            { q: '8 万是硬上限还是意愿值？', why: '逼出真实约束' },
            { q: '做半年做不起来怎么办？', why: '最坏承受力' },
            { id: 'x', q: '' },
          ],
        })
      }
      return 'junk'
    },
  })
  try {
    Host.apply(ctx)
    const route = routes[0]
    const start = mockRes()
    await route.handler(mockReq('POST', '/dsh-thinktank/api/grill', JSON.stringify({ question: '要不要做民宿短租？' })), start)
    assert.equal(start.status, 202)
    const { id } = JSON.parse(start.body)

    let job = null
    for (let i = 0; i < 100; i++) {
      const res = mockRes()
      await route.handler(mockReq('GET', `/dsh-thinktank/api/grill?id=${id}`), res)
      job = JSON.parse(res.body)
      if (job.status !== 'running') break
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.equal(job.status, 'done')
    assert.equal(job.questions.length, 2, '空问题被过滤')
    assert.equal(job.questions[0].q, '8 万是硬上限还是意愿值？')
    assert.ok(titles.some((t) => t.includes('拷问澄清')), `缺拷问标题：${JSON.stringify(titles)}`)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})
