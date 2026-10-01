/**
 * dsh-thinktank 模型库完整性测试：id 唯一、分类合法、字段齐备、推荐与导出可用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const M = require('../src/models.js')

test('模型库规模与分类完整', () => {
  assert.ok(M.MODELS.length >= 100, `模型数量过少：${M.MODELS.length}`)
  assert.equal(M.CATEGORIES.length, 9)
  for (const c of M.CATEGORIES) {
    assert.ok(c.id && c.name && c.icon, `分类缺字段：${c.id}`)
  }
})

test('每个模型字段齐备、id 唯一、分类合法', () => {
  const seen = new Set()
  for (const m of M.MODELS) {
    assert.ok(/^[a-z0-9-]+$/.test(m.id), `id 非法：${m.id}`)
    assert.ok(!seen.has(m.id), `id 重复：${m.id}`)
    seen.add(m.id)
    assert.ok(m.name && m.en && m.def, `${m.id} 缺 name/en/def`)
    assert.ok(M.CATEGORY_BY_ID[m.cat], `${m.id} 分类不存在：${m.cat}`)
    assert.ok(Array.isArray(m.points) && m.points.length >= 2, `${m.id} points 不足`)
    assert.ok(Array.isArray(m.scenes) && m.scenes.length >= 2, `${m.id} scenes 不足`)
    assert.ok(Array.isArray(m.qs) && m.qs.length >= 1, `${m.id} qs 缺失`)
  }
})

test('getModel / getModels 查询', () => {
  assert.equal(M.getModel('swot').name, 'SWOT 分析')
  assert.equal(M.getModel('nope'), null)
  const list = M.getModels(['swot', 'nope', 'pdca', 'swot'])
  assert.deepEqual(list.map((m) => m.id), ['swot', 'pdca'], '过滤未知 id 并去重')
  assert.deepEqual(M.getModels('junk'), [])
})

test('catalog 摘要不含重型字段', () => {
  const c = M.catalog()
  assert.equal(c.models.length, M.MODELS.length)
  assert.equal(c.categories.length, 9)
  assert.equal(c.models[0].points, undefined, 'catalog 不带 points')
  assert.equal(c.models[0].qs, undefined, 'catalog 不带 qs')
})

test('recommend 对中文问题给出相关模型', () => {
  const items = M.recommend('我要不要辞职创业做一款新产品')
  assert.ok(items.length > 0, '应有推荐结果')
  assert.ok(items.length <= 12)
  const ids = items.map((r) => r.id)
  assert.ok(ids.every((id) => M.MODEL_BY_ID[id]), '推荐 id 必须在库内')
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i - 1].score >= items[i].score, '按分数降序')
  }
  assert.deepEqual(M.recommend(''), [])
  assert.deepEqual(M.recommend(null), [])
})

test('reportMarkdown 产出完整结构', () => {
  const md = M.reportMarkdown({
    question: '测试问题',
    context: '测试背景',
    createdAt: '2026-10-01T00:00:00Z',
    results: [
      { id: 'swot', verdict: '结论', analysis: '分析', insights: ['洞察1'], actions: ['行动1'], signal: 'positive' },
    ],
    synthesis: {
      summary: '综合结论',
      consensus: ['共识1'],
      conflicts: [],
      blindspots: ['盲区1'],
      priorities: [{ action: '先做这个', why: '依据' }],
    },
  })
  assert.match(md, /# 智囊团 · 思维模型综合分析报告/)
  assert.match(md, /测试问题/)
  assert.match(md, /综合结论/)
  assert.match(md, /共识1/)
  assert.match(md, /盲区1/)
  assert.match(md, /先做这个/)
  assert.match(md, /SWOT 分析/)
})
