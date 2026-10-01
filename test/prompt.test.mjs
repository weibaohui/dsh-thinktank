/**
 * dsh-thinktank 提示词与结果协议测试：
 * 提示词包含模型 id 与标记契约；extractMindJson 容忍围栏/散文/尾随文本；
 * normalizeResults/normalizeSynthesis 的钳制与丢弃规则。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const M = require('../src/models.js')
const P = require('../src/prompt.js')

const two = M.getModels(['swot', 'inversion'])

test('buildBatchPrompt 含模型 id、引导问题与标记契约', () => {
  const text = P.buildBatchPrompt('要不要创业', '手头有 50 万', two)
  assert.match(text, /要不要创业/)
  assert.match(text, /手头有 50 万/)
  assert.match(text, /swot/)
  assert.match(text, /inversion/)
  assert.match(text, /===MIND-JSON===/)
  assert.match(text, /signal/)
})

test('buildSynthesisPrompt 携带各模型摘要', () => {
  const text = P.buildSynthesisPrompt('问题', '', P.compactResults([
    { id: 'swot', verdict: '机会大于风险', signal: 'positive', insights: ['优势显著'] },
  ]))
  assert.match(text, /SWOT 分析/)
  assert.match(text, /机会大于风险/)
  assert.match(text, /===MIND-JSON===/)
})

test('buildManualPrompt 单发协议含 results 与 synthesis', () => {
  const text = P.buildManualPrompt('问题', '', two)
  assert.match(text, /results/)
  assert.match(text, /synthesis/)
  assert.match(text, /以本段为准/)
})

test('extractMindJson：标准标记 + 尾随散文', () => {
  const raw = '分析正文……\n===MIND-JSON===\n{"results":[{"id":"swot","verdict":"v","signal":"positive"}]}\n以上。'
  const parsed = P.extractMindJson(raw)
  assert.ok(parsed)
  assert.equal(parsed.results[0].id, 'swot')
})

test('extractMindJson：代码围栏包裹与无标记纯 JSON', () => {
  const fenced = '```json\n{"results":[]}\n```'
  assert.ok(P.extractMindJson(fenced))
  const bare = '{"synthesis":{"summary":"x"}}'
  assert.ok(P.extractMindJson(bare))
})

test('extractMindJson：坏输入返回 null', () => {
  assert.equal(P.extractMindJson(''), null)
  assert.equal(P.extractMindJson(null), null)
  assert.equal(P.extractMindJson('===MIND-JSON===\nnot json at all'), null)
  assert.equal(P.extractMindJson('没有标记没有JSON'), null)
})

test('normalizeResults：未知 id 丢弃、signal 兜底、长度钳制', () => {
  const known = new Set(['swot'])
  const { results, dropped } = P.normalizeResults({
    results: [
      { id: 'swot', verdict: 'v'.repeat(500), analysis: 'a', insights: ['i'], actions: ['x'], signal: 'bogus' },
      { id: 'unknown-model', verdict: 'v' },
      { id: 'swot', verdict: 'dup' },
      'junk',
    ],
  }, known)
  assert.equal(results.length, 1)
  assert.deepEqual(dropped, ['unknown-model'])
  assert.equal(results[0].signal, 'neutral', '非法 signal 回退 neutral')
  assert.equal(results[0].verdict.length, 300, 'verdict 截断')
})

test('normalizeSynthesis：字符串 priorities 与空壳拒绝', () => {
  const syn = P.normalizeSynthesis({
    synthesis: {
      summary: 's',
      consensus: ['c'],
      priorities: ['直接字符串', { action: 'a', why: 'w' }, { noAction: true }],
    },
  })
  assert.ok(syn)
  assert.equal(syn.priorities.length, 2)
  assert.equal(syn.priorities[0].action, '直接字符串')
  assert.equal(P.normalizeSynthesis(null), null)
  assert.equal(P.normalizeSynthesis({ synthesis: {} }), null, '全空壳不可用')
})

test('buildRecommendPrompt 含紧凑模型库与 picks 契约', () => {
  const text = P.buildRecommendPrompt('要不要出海', 'SaaS 产品', M.MODELS)
  assert.match(text, /要不要出海/)
  assert.match(text, /swot｜SWOT 分析｜/)
  assert.match(text, /===MIND-JSON===/)
  assert.match(text, /picks/)
  // 库行数 = 模型数
  const rows = text.split('\n').filter((l) => /^[a-z0-9-]+｜/.test(l))
  assert.equal(rows.length, M.MODELS.length)
})

test('normalizePicks：未知 id 丢弃、去重、理由截断、上限 15', () => {
  const known = new Set(['swot', 'pdca'])
  const { picks, dropped, rationale } = P.normalizePicks({
    rationale: 'r'.repeat(1000),
    picks: [
      { id: 'swot', reason: '合适' },
      { id: 'nope', reason: 'x' },
      { id: 'pdca' },
      { id: 'swot', reason: 'dup' },
      'junk',
    ],
  }, known)
  assert.deepEqual(picks.map((p) => p.id), ['swot', 'pdca'])
  assert.deepEqual(dropped, ['nope'])
  assert.equal(picks[1].reason, '', '缺 reason 兜底空串')
  assert.equal(rationale.length, 800)
  assert.equal(P.normalizePicks(null, known).picks.length, 0)
  assert.equal(P.normalizePicks({}, known).picks.length, 0)
})

test('buildGrillPrompt：含问题背景与 questions 契约', () => {
  const text = P.buildGrillPrompt('要不要转行', '今年 35 岁')
  assert.match(text, /要不要转行/)
  assert.match(text, /今年 35 岁/)
  assert.match(text, /隐藏假设/)
  assert.match(text, /===MIND-JSON===/)
  assert.match(text, /questions/)
})

test('normalizeQuestions：去重、截断、上限 6', () => {
  const { questions } = P.normalizeQuestions({
    questions: [
      { q: 'q'.repeat(500), why: 'w' },
      { q: 'q1', why: 'w1' },
      { q: 'q1' },
      { q: 'q2' },
      { q: '', why: 'x' },
      'junk',
    ],
  })
  assert.equal(questions.length, 3)
  assert.equal(questions[0].q.length, 200)
  assert.equal(questions[1].q, 'q1')
  assert.equal(questions[1].why, 'w1')
  assert.equal(questions[2].q, 'q2')
  assert.equal(questions[2].why, '', '缺 why 兜底空串')
  assert.equal(P.normalizeQuestions(null).questions.length, 0)
  const many = P.normalizeQuestions({ questions: Array.from({ length: 10 }, (_, i) => ({ q: 'q' + i })) })
  assert.equal(many.questions.length, 6, '上限 6 问')
})
