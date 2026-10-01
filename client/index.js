'use strict'
/**
 * dsh-thinktank — Client 半体
 *
 * 侧边栏/设置页面板：输入问题 → 从 161 个思维模型中选择（支持搜索、分类筛选、
 * 本地启发式推荐）→ 两种执行模式：
 *   1) 自动分析：host 起分批 agent 会话并行分析 + 综合会话，面板轮询进度；
 *   2) 提示词往返：生成整段提示词复制到任意会话执行，粘回 JSON 导入。
 * 报告页：综合结论（共识/分歧/盲区/行动清单）+ 信号总览 + 按模型卡片网格，
 * 可导出 Markdown；历史报告持久化在宿主 storageDomain。
 *
 * 模型库与校验逻辑直接 require ../src/*.js，构建期 esbuild 内联，前后端同源。
 */

const React = require('react')
const models = require('../src/models')

const API = '/dsh-thinktank/api'
const PLUGIN_ID = '@weibaohui/dsh-thinktank'
const SLOT_ID = 'dsh-thinktank'
const SLOT_ORDER = 37
const h = React.createElement

// ── 样式 ────────────────────────────────────────────────────────────────────
const CSS = `
.dshmm-wrap {
  --mm-text: #1f2328;
  --mm-sub: rgba(31,35,40,0.55);
  --mm-card: #ffffff;
  --mm-solid: #ffffff;
  --mm-card2: rgba(127,127,127,0.05);
  --mm-border: #d0d7de;
  --mm-border2: rgba(90,110,130,0.45);
  --mm-accent: #2563eb;
  --mm-ok: #1a7f37;
  --mm-danger: #cf222e;
  --mm-warn: #b45309;
  --mm-shadow: 0 1px 2px rgba(0,0,0,0.08);
  --mm-pop-shadow: 0 8px 30px rgba(0,0,0,0.2);
}
.dshmm-wrap.dshmm-dark {
  --mm-text: #e6edf3;
  --mm-sub: rgba(230,237,243,0.62);
  --mm-card: rgba(255,255,255,0.045);
  --mm-solid: #161b22;
  --mm-card2: rgba(255,255,255,0.07);
  --mm-border: rgba(255,255,255,0.14);
  --mm-border2: rgba(240,246,252,0.18);
  --mm-accent: #4493f8;
  --mm-ok: #3fb950;
  --mm-danger: #f85149;
  --mm-warn: #d29922;
  --mm-shadow: 0 1px 2px rgba(0,0,0,0.35);
  --mm-pop-shadow: 0 8px 30px rgba(0,0,0,0.6);
}
.dshmm-wrap, .dshmm-wrap * { box-sizing: border-box; }
.dshmm-wrap { font: 13px/1.6 -apple-system, "PingFang SC", "Segoe UI", sans-serif; color: var(--mm-text); padding: 12px 16px 16px; position: relative; overflow-y: auto; }
.dshmm-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
.dshmm-tab { padding:4px 12px; border:1px solid var(--mm-border); border-radius:6px; cursor:pointer; background:var(--mm-card); color:var(--mm-text); user-select:none; font-size:13px; }
.dshmm-tab.active { background:var(--mm-accent); border-color:var(--mm-accent); color:#fff; }
.dshmm-btn { padding:4px 10px; border:1px solid var(--mm-border); border-radius:6px; cursor:pointer; background:var(--mm-card); color:var(--mm-text); font-size:12px; }
.dshmm-btn:hover { filter:brightness(0.95); }
.dshmm-dark .dshmm-btn:hover { filter:brightness(1.3); }
.dshmm-btn.primary { background:var(--mm-accent); border-color:var(--mm-accent); color:#fff; }
.dshmm-btn.danger { color:var(--mm-danger); border-color:var(--mm-danger); }
.dshmm-btn:disabled { opacity:0.5; cursor:not-allowed; }
.dshmm-input, .dshmm-ta, .dshmm-select { width:100%; border:1px solid var(--mm-border); border-radius:8px; padding:8px 10px; background:var(--mm-solid); color:var(--mm-text); font:inherit; }
.dshmm-ta { resize:vertical; min-height:64px; line-height:1.6; }
.dshmm-label { font-size:12px; color:var(--mm-sub); margin:10px 2px 4px; display:flex; justify-content:space-between; align-items:center; }
.dshmm-card { background:var(--mm-card); border:1px solid var(--mm-border2); border-radius:10px; box-shadow:var(--mm-shadow); }
.dshmm-cats { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.dshmm-chip { padding:3px 10px; border:1px solid var(--mm-border); border-radius:999px; cursor:pointer; background:var(--mm-card); color:var(--mm-text); font-size:12px; user-select:none; }
.dshmm-chip.active { background:var(--mm-accent); border-color:var(--mm-accent); color:#fff; }
.dshmm-models { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:8px; margin-top:8px; }
.dshmm-model { position:relative; overflow:hidden; border:1px solid var(--mm-border); border-radius:8px; padding:8px 10px; cursor:pointer; background:var(--mm-card); transition:border-color .15s, background .15s; }
.dshmm-model:hover { border-color:var(--mm-accent); }
.dshmm-model.sel { border-color:var(--mm-ok); background:color-mix(in srgb, var(--mm-ok) 9%, var(--mm-card)); }
.dshmm-model-t { display:flex; align-items:center; gap:6px; font-weight:600; font-size:13px; }
.dshmm-model-en { font-size:11px; color:var(--mm-sub); font-weight:400; }
.dshmm-model-d { font-size:12px; color:var(--mm-sub); margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dshmm-rec { font-size:10px; color:#fff; background:var(--mm-ok); border-radius:4px; padding:0 5px; flex:none; }
.dshmm-notice { margin:8px 0 0; padding:7px 12px; border:1px solid var(--mm-ok); border-radius:8px; background:color-mix(in srgb, var(--mm-ok) 8%, var(--mm-card)); font-size:12px; display:flex; gap:8px; align-items:flex-start; }
.dshmm-notice .x { cursor:pointer; opacity:0.6; margin-left:auto; flex:none; padding:0 2px; }
.dshmm-notice .x:hover { opacity:1; }
/* 选中对勾圆点：未选=空心圈，已选=绿底白勾 */
.dshmm-check { width:18px; height:18px; border-radius:50%; border:1.5px solid var(--mm-border2); display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:transparent; flex:none; transition:all .15s; }
.dshmm-check.on { background:var(--mm-ok); border-color:var(--mm-ok); color:#fff; }
/* 右上角斜角绶带（仅选中态渲染） */
.dshmm-ribbon { position:absolute; top:9px; right:-24px; transform:rotate(45deg); background:var(--mm-ok); color:#fff; font-size:10px; line-height:1.5; padding:0 24px; box-shadow:var(--mm-shadow); pointer-events:none; }
/* 向导步骤条 */
.dshmm-steps { display:flex; align-items:center; gap:6px; margin:2px 0 16px; }
.dshmm-step { display:flex; align-items:center; gap:7px; color:var(--mm-sub); font-size:12px; white-space:nowrap; }
.dshmm-step .n { width:22px; height:22px; border-radius:50%; border:1.5px solid var(--mm-border2); display:inline-flex; align-items:center; justify-content:center; font-size:12px; background:var(--mm-card); flex:none; }
.dshmm-step.active { color:var(--mm-text); font-weight:700; }
.dshmm-step.active .n { background:var(--mm-accent); border-color:var(--mm-accent); color:#fff; }
.dshmm-step.done { color:var(--mm-ok); }
.dshmm-step.done .n { background:var(--mm-ok); border-color:var(--mm-ok); color:#fff; }
.dshmm-step-line { flex:1; height:1.5px; background:var(--mm-border); min-width:16px; }
/* 确认页摘要 */
.dshmm-sum { padding:12px 14px; margin-bottom:10px; }
.dshmm-sum-t { font-size:12px; color:var(--mm-sub); margin-bottom:4px; }
.dshmm-sum-models { display:flex; flex-wrap:wrap; gap:6px; }
.dshmm-sum-m { font-size:12px; border:1px solid var(--mm-ok); color:var(--mm-ok); border-radius:999px; padding:2px 6px 2px 10px; background:color-mix(in srgb, var(--mm-ok) 7%, var(--mm-card)); display:inline-flex; align-items:center; gap:5px; }
.dshmm-sum-m .x { cursor:pointer; opacity:0.5; font-weight:700; width:15px; height:15px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-size:11px; }
.dshmm-sum-m .x:hover { opacity:1; color:#fff; background:var(--mm-danger); }
.dshmm-progress { margin:16px 0; }
.dshmm-batch { display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--mm-border); border-radius:8px; margin-top:6px; background:var(--mm-card); font-size:12px; }
.dshmm-dot { width:8px; height:8px; border-radius:50%; flex:none; }
.dshmm-spin { display:inline-block; width:12px; height:12px; border:2px solid var(--mm-border2); border-top-color:var(--mm-accent); border-radius:50%; animation:dshmm-rot 0.8s linear infinite; }
@keyframes dshmm-rot { to { transform:rotate(360deg); } }
.dshmm-syn { padding:14px 16px; margin-bottom:12px; }
.dshmm-syn-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; margin-top:10px; }
.dshmm-syn-box { border:1px solid var(--mm-border); border-radius:8px; padding:10px 12px; background:var(--mm-card2); }
.dshmm-syn-box h4 { margin:0 0 6px; font-size:12px; }
.dshmm-syn-box ul { margin:0; padding-left:16px; font-size:12px; }
.dshmm-syn-box li { margin-bottom:4px; }
.dshmm-rcards { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:10px; margin-top:10px; }
.dshmm-rcard { padding:12px 14px; display:flex; flex-direction:column; }
.dshmm-rcard-t { display:flex; align-items:center; gap:8px; font-weight:700; }
.dshmm-signal { font-size:10px; border-radius:4px; padding:1px 6px; flex:none; }
.dshmm-verdict { margin:8px 0 6px; font-weight:600; font-size:13px; }
.dshmm-analysis { font-size:12px; color:var(--mm-text); white-space:pre-wrap; word-break:break-word; border-top:1px dashed var(--mm-border); padding-top:8px; margin-top:8px; }
.dshmm-list { margin:6px 0 0; padding-left:18px; font-size:12px; }
.dshmm-list li { margin-bottom:3px; }
.dshmm-lib-cat { margin:14px 0 6px; font-weight:700; display:flex; align-items:center; gap:6px; }
.dshmm-lib-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:8px; }
.dshmm-lib-card { padding:10px 12px; }
.dshmm-lib-qs { font-size:12px; color:var(--mm-sub); margin-top:6px; border-top:1px dashed var(--mm-border); padding-top:6px; }
.dshmm-hist { display:flex; flex-direction:column; gap:8px; margin-top:8px; }
/* 进行中任务实时卡片 */
.dshmm-live { padding:12px 14px; margin-bottom:10px; }
.dshmm-live-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshmm-live-q { font-weight:700; }
.dshmm-live-badge { font-size:10px; border-radius:4px; padding:1px 7px; color:#fff; flex:none; }
.dshmm-live-batches { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.dshmm-live-batch { display:inline-flex; align-items:center; gap:5px; font-size:11px; border:1px solid var(--mm-border); border-radius:999px; padding:2px 9px; color:var(--mm-sub); }
.dshmm-live-results { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:8px; margin-top:10px; }
.dshmm-live-v { border:1px solid var(--mm-border); border-radius:8px; padding:8px 10px; background:var(--mm-card2); animation:dshmm-in .3s ease; }
@keyframes dshmm-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
.dshmm-live-vt { display:flex; align-items:center; gap:6px; font-weight:600; font-size:12px; }
.dshmm-live-vd { font-size:12px; color:var(--mm-sub); margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.dshmm-live-syn { margin-top:10px; border-top:1px dashed var(--mm-border); padding-top:8px; font-size:12px; }
.dshmm-hist-item { display:flex; align-items:center; gap:10px; padding:10px 12px; cursor:pointer; }
.dshmm-hist-item:hover { border-color:var(--mm-accent); }
.dshmm-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:9990; display:flex; align-items:center; justify-content:center; padding:24px; }
.dshmm-modal { background:var(--mm-solid); color:var(--mm-text); border:1px solid var(--mm-border2); border-radius:12px; box-shadow:var(--mm-pop-shadow); padding:16px; width:min(860px,96vw); max-height:88vh; overflow-y:auto; }
.dshmm-err { background:color-mix(in srgb, var(--mm-danger) 10%, var(--mm-card)); border:1px solid var(--mm-danger); color:var(--mm-danger); border-radius:8px; padding:8px 12px; margin:8px 0; font-size:12px; white-space:pre-wrap; }
.dshmm-ai-live { font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; background: var(--mm-card2); border: 1px solid var(--mm-border); border-radius: 8px; padding: 8px 10px; height: 200px; overflow-y: auto; color: var(--mm-text); }
.dshmm-sub { color:var(--mm-sub); font-size:12px; }
.dshmm-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.dshmm-signal-strip { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
`

let cssInjected = false
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const el = document.createElement('style')
  el.id = 'dsh-thinktank-css'
  el.textContent = CSS
  document.head.appendChild(el)
}

// ── 主题跟随（属性事件驱动，与 dsh-dashboard 同款）───────────────────────────
function detectDark() {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  const body = document.body
  const source = (root.getAttribute('data-ds-theme-source') || '').toLowerCase()
  if (source === 'dark') return true
  if (source === 'light') return false
  if (body && body.hasAttribute('data-ds-dark-theme')) return true
  const attr = (root.getAttribute('data-theme') || '').toLowerCase()
  if (attr === 'dark') return true
  if (attr === 'light') return false
  if (root.classList.contains('dark')) return true
  if (root.classList.contains('light')) return false
  if (body && body.classList.contains('dark')) return true
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch { return false }
}
const themeBus = { started: false, listeners: new Set(), timer: 0, last: null }
function watchTheme(cb) {
  themeBus.listeners.add(cb)
  if (!themeBus.started) {
    themeBus.started = true
    themeBus.last = detectDark()
    const schedule = () => {
      clearTimeout(themeBus.timer)
      themeBus.timer = setTimeout(() => {
        const dark = detectDark()
        if (dark === themeBus.last) return
        themeBus.last = dark
        for (const fn of [...themeBus.listeners]) { try { fn(dark) } catch { /* 单个订阅者异常不影响其他 */ } }
      }, 100)
    }
    try {
      const mo = new MutationObserver(schedule)
      mo.observe(document.documentElement, { attributes: true })
      if (document.body) mo.observe(document.body, { attributes: true })
    } catch { /* 无 MutationObserver 时仍有挂载探测 + matchMedia */ }
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
      if (mq && mq.addEventListener) mq.addEventListener('change', schedule)
    } catch { /* ignore */ }
  }
  cb(detectDark())
  return () => { themeBus.listeners.delete(cb) }
}
function useDark() {
  const [dark, setDark] = React.useState(detectDark)
  React.useEffect(() => watchTheme(setDark), [])
  return dark
}

// ── 工具 ────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* 空 body */ }
  if (!res.ok) {
    const msg = (json && (json.error || (Array.isArray(json.errors) && json.errors.join('\n')))) || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json
}

const SIGNAL_META = {
  positive: { label: '有利', color: 'var(--mm-ok)' },
  negative: { label: '不利', color: 'var(--mm-danger)' },
  risk: { label: '风险', color: 'var(--mm-warn)' },
  neutral: { label: '中性', color: 'var(--mm-sub)' },
}

function catName(catId) {
  const c = models.CATEGORY_BY_ID[catId]
  return c ? c.name : catId
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return String(iso) }
}

function fmtDur(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`
}

// ── AI 推荐弹窗（进度 + 流式过程 + 结果勾选）─────────────────────────────────
function AiRecommendModal({ question, context, onClose, onApply }) {
  const [recId, setRecId] = React.useState(null)
  const [status, setStatus] = React.useState('starting') // starting | running | done | error
  const [textTail, setTextTail] = React.useState('')
  const [picks, setPicks] = React.useState([])
  const [rationale, setRationale] = React.useState('')
  const [err, setErr] = React.useState('')
  const [checked, setChecked] = React.useState(new Set())
  const [elapsed, setElapsed] = React.useState(0)
  const liveRef = React.useRef(null)
  const startRef = React.useRef(Date.now())

  // 启动推荐任务
  React.useEffect(() => {
    let stop = false
    api('POST', '/ai-recommend', { question, context })
      .then((r) => { if (!stop) { setRecId(r.id); setStatus('running') } })
      .catch((e) => { if (!stop) { setStatus('error'); setErr(String(e.message || e)) } })
    return () => { stop = true }
  }, [])

  // 轮询状态（1s），同时刷新流式文本尾与耗时
  React.useEffect(() => {
    if (!recId || status !== 'running') return undefined
    const t = setInterval(async () => {
      setElapsed(Date.now() - startRef.current)
      try {
        const j = await api('GET', `/ai-recommend?id=${encodeURIComponent(recId)}`)
        setTextTail(j.textTail || '')
        if (j.status === 'done') {
          setPicks(j.picks || [])
          setRationale(j.rationale || '')
          setChecked(new Set((j.picks || []).map((p) => p.id)))
          setStatus('done')
        } else if (j.status === 'error') {
          setErr(j.error || '推荐失败')
          setStatus('error')
        }
      } catch (e) {
        setErr(String(e.message || e))
        setStatus('error')
      }
    }, 1000)
    return () => clearInterval(t)
  }, [recId, status])

  // 流式文本自动滚到底
  React.useEffect(() => {
    const el = liveRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [textTail])

  const toggle = (id) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  return h('div', { className: 'dshmm-modal-bg', onMouseDown: onClose },
    h('div', { className: 'dshmm-modal', style: { width: 'min(680px,96vw)' }, onMouseDown: (e) => e.stopPropagation() },
      h('div', { className: 'dshmm-row', style: { marginBottom: 8 } },
        h('strong', { style: { fontSize: 14 } }, '✨ AI 智能推荐'),
        h('span', { className: 'dshmm-sub' }, status === 'running' || status === 'starting' ? `AI 正在阅读 ${models.MODELS.length} 个模型… ${fmtDur(elapsed)}` : ''),
        h('span', { style: { flex: 1 } }),
        h('span', { style: { cursor: 'pointer', opacity: 0.6, padding: '0 4px' }, onClick: onClose }, '✕'),
      ),
      h('div', { className: 'dshmm-sub', style: { marginBottom: 8 } }, `问题：${question.slice(0, 120)}`),

      status === 'error' ? h('div', { className: 'dshmm-err' }, `推荐失败：${err}`) : null,

      // 运行中：流式过程视图（AI 回复的实时尾部）
      (status === 'running' || status === 'starting') ? h('div', null,
        h('div', { className: 'dshmm-row', style: { marginBottom: 6 } },
          h('span', { className: 'dshmm-spin' }),
          h('span', { className: 'dshmm-sub' }, '下方为 AI 回复的实时输出过程'),
        ),
        h('div', { ref: liveRef, className: 'dshmm-ai-live' }, textTail || '（等待 AI 开始输出…）'),
      ) : null,

      // 完成：选型思路 + 推荐清单（可勾选）
      status === 'done' ? h('div', null,
        rationale ? h('div', { className: 'dshmm-card', style: { padding: '10px 12px', marginBottom: 8, fontSize: 12 } },
          h('strong', null, '选型思路：'), rationale) : null,
        h('div', { style: { maxHeight: '40vh', overflowY: 'auto' } },
          picks.map((p) => {
            const m = models.getModel(p.id)
            const on = checked.has(p.id)
            return h('div', {
              key: p.id, className: 'dshmm-model' + (on ? ' sel' : ''),
              style: { marginBottom: 6 }, onClick: () => toggle(p.id),
            },
              on ? h('span', { className: 'dshmm-ribbon' }, '✓') : null,
              h('div', { className: 'dshmm-model-t' },
                h('span', { className: 'dshmm-check' + (on ? ' on' : '') }, '✓'),
                h('span', null, m ? m.name : p.id),
                h('span', { className: 'dshmm-model-en' }, m ? `${m.en} · ${catName(m.cat)}` : ''),
              ),
              p.reason ? h('div', { className: 'dshmm-model-d', style: { WebkitLineClamp: 3 } }, p.reason) : null,
            )
          }),
        ),
        h('div', { className: 'dshmm-row', style: { marginTop: 10, justifyContent: 'flex-end' } },
          h('button', { className: 'dshmm-btn', onClick: onClose }, '取消'),
          h('button', {
            className: 'dshmm-btn primary', disabled: checked.size === 0,
            onClick: () => onApply(picks.filter((p) => checked.has(p.id))),
          }, `采用所选 (${checked.size})`),
        ),
      ) : null,
    ),
  )
}

// ── 模型选择器 ──────────────────────────────────────────────────────────────
function ModelPicker({ selected, onToggle, onBatch, question, context, agentsOk }) {
  const [search, setSearch] = React.useState('')
  const [cat, setCat] = React.useState('')
  const [recs, setRecs] = React.useState([])
  const [onlyRec, setOnlyRec] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [aiOpen, setAiOpen] = React.useState(false)
  const recIds = React.useMemo(() => new Set(recs.map((r) => r.id)), [recs])

  // 提示条 10 秒自动消失
  React.useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(''), 10000)
    return () => clearTimeout(t)
  }, [notice])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return models.MODELS.filter((m) => {
      if (onlyRec && recIds.size && !recIds.has(m.id)) return false
      if (cat && m.cat !== cat) return false
      if (!q) return true
      return m.name.toLowerCase().includes(q)
        || (m.en || '').toLowerCase().includes(q)
        || m.def.toLowerCase().includes(q)
        || m.scenes.join(' ').toLowerCase().includes(q)
    })
  }, [search, cat, onlyRec, recIds])

  const doRecommend = () => {
    const items = models.recommend(question, 10)
    setRecs(items)
    if (!items.length) {
      setOnlyRec(false)
      setNotice('没有匹配到明显相关的模型。可以在问题里补充行业、目标、约束等关键词再试，或手动勾选。')
      return
    }
    const ids = items.map((r) => r.id)
    const added = ids.filter((id) => !selected.has(id)).length
    onBatch(ids, true)
    setOnlyRec(true) // 直接切到「只看推荐」，让结果被看见
    const names = items.slice(0, 5).map((r) => (models.getModel(r.id) || {}).name || r.id).join('、')
    setNotice(`已推荐 ${items.length} 个模型（新勾选 ${added} 个）：${names}${items.length > 5 ? ' 等' : ''}。已切换到「只看推荐」，点分类标签可回到全量列表。`)
  }

  return h('div', null,
    h('div', { className: 'dshmm-row', style: { marginBottom: 4 } },
      h('input', {
        className: 'dshmm-input', style: { flex: 1, minWidth: 180 },
        placeholder: '搜索模型（名称/定义/场景）…',
        value: search, onChange: (e) => setSearch(e.target.value),
      }),
      h('button', { className: 'dshmm-btn', onClick: () => onBatch(models.MODELS.map((m) => m.id), true) }, '全选'),
      h('button', { className: 'dshmm-btn', onClick: () => onBatch([...selected], false) }, '清空'),
      h('button', {
        className: 'dshmm-btn', onClick: doRecommend, disabled: !question.trim(),
        title: question.trim() ? '本地关键词匹配，毫秒出结果（不经 AI）' : '先在第 1 步填写问题，匹配才有的放矢',
      }, '🔍 关键词匹配'),
      h('button', {
        className: 'dshmm-btn', onClick: () => setAiOpen(true), disabled: !question.trim() || agentsOk === false,
        title: agentsOk === false
          ? 'agents 服务不可用，只能用关键词匹配'
          : (question.trim() ? '起一个 AI 会话通读模型库后选型，带推荐理由，需等待约半分钟' : '先在第 1 步填写问题'),
      }, '✨ AI 智能推荐'),
    ),
    notice ? h('div', { className: 'dshmm-notice' },
      h('span', null, '✨'),
      h('span', null, notice),
      h('span', { className: 'x', onClick: () => setNotice('') }, '✕'),
    ) : null,
    h('div', { className: 'dshmm-cats' },
      recs.length ? h('span', {
        className: 'dshmm-chip' + (onlyRec ? ' active' : ''),
        style: onlyRec ? {} : { borderColor: 'var(--mm-ok)', color: 'var(--mm-ok)' },
        onClick: () => setOnlyRec(!onlyRec),
      }, `✨ 只看推荐 (${recs.length})`) : null,
      h('span', {
        className: 'dshmm-chip' + (cat === '' && !onlyRec ? ' active' : ''),
        onClick: () => { setCat(''); setOnlyRec(false) },
      }, `全部 (${models.MODELS.length})`),
      models.CATEGORIES.map((c) => h('span', {
        key: c.id, className: 'dshmm-chip' + (cat === c.id && !onlyRec ? ' active' : ''),
        onClick: () => { setCat(cat === c.id ? '' : c.id); setOnlyRec(false) },
      }, `${c.icon} ${c.name} (${models.MODELS.filter((m) => m.cat === c.id).length})`)),
    ),
    h('div', { className: 'dshmm-models' },
      filtered.map((m) => {
        const sel = selected.has(m.id)
        return h('div', {
          key: m.id,
          className: 'dshmm-model' + (sel ? ' sel' : ''),
          onClick: () => onToggle(m.id),
          title: m.def,
        },
          sel ? h('span', { className: 'dshmm-ribbon' }, '✓ 已选') : null,
          h('div', { className: 'dshmm-model-t' },
            h('span', { className: 'dshmm-check' + (sel ? ' on' : '') }, '✓'),
            h('span', null, m.name),
            recIds.has(m.id) ? h('span', { className: 'dshmm-rec' }, '推荐') : null,
          ),
          h('div', { className: 'dshmm-model-en' }, `${m.en} · ${catName(m.cat)}`),
          h('div', { className: 'dshmm-model-d' }, m.def),
        )
      }),
      !filtered.length ? h('div', { className: 'dshmm-sub' }, '没有匹配的模型') : null,
    ),
    aiOpen ? h(AiRecommendModal, {
      question: question.trim(), context: (context || '').trim(),
      onClose: () => setAiOpen(false),
      onApply: (picksUsed) => {
        const ids = picksUsed.map((p) => p.id)
        const added = ids.filter((id) => !selected.has(id)).length
        onBatch(ids, true)
        setRecs(picksUsed.map((p) => ({ id: p.id, score: 1, hits: [] })))
        setOnlyRec(true)
        const names = picksUsed.slice(0, 5).map((p) => (models.getModel(p.id) || {}).name || p.id).join('、')
        setNotice(`AI 推荐了 ${ids.length} 个模型（新勾选 ${added} 个）：${names}${ids.length > 5 ? ' 等' : ''}。已切换到「只看推荐」。`)
        setAiOpen(false)
      },
    }) : null,
  )
}

// ── 报告视图 ────────────────────────────────────────────────────────────────
function ReportView({ report, onBack, onDelete }) {
  const [catFilter, setCatFilter] = React.useState('')
  const [expand, setExpand] = React.useState({})
  const results = Array.isArray(report.results) ? report.results : []
  const syn = report.synthesis || null

  const signalCounts = React.useMemo(() => {
    const c = { positive: 0, negative: 0, risk: 0, neutral: 0 }
    for (const r of results) c[r.signal || 'neutral'] = (c[r.signal || 'neutral'] || 0) + 1
    return c
  }, [results])

  const catsUsed = React.useMemo(() => {
    const ids = []
    for (const r of results) {
      const m = models.getModel(r.id)
      const cid = m ? m.cat : ''
      if (!ids.includes(cid)) ids.push(cid)
    }
    return ids
  }, [results])

  const shown = results.filter((r) => {
    if (!catFilter) return true
    const m = models.getModel(r.id)
    return (m ? m.cat : '') === catFilter
  })

  const exportMd = () => {
    const md = models.reportMarkdown(report)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `智囊团分析-${(report.question || '报告').slice(0, 30)}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const synBox = (title, icon, arr) => (Array.isArray(arr) && arr.length)
    ? h('div', { className: 'dshmm-syn-box' },
        h('h4', null, `${icon} ${title}`),
        h('ul', null, arr.map((s, i) => h('li', { key: i }, typeof s === 'string' ? s : String((s && (s.action || s.text)) || '')))),
      )
    : null

  return h('div', null,
    h('div', { className: 'dshmm-row', style: { marginBottom: 10 } },
      h('button', { className: 'dshmm-btn', onClick: onBack }, '← 返回'),
      h('strong', { style: { fontSize: 15 } }, report.question || '分析报告'),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'dshmm-btn', onClick: exportMd }, '导出 Markdown'),
      onDelete ? h('button', { className: 'dshmm-btn danger', onClick: onDelete }, '删除') : null,
    ),
    h('div', { className: 'dshmm-sub', style: { marginBottom: 10 } },
      `${fmtTime(report.createdAt)} · ${results.length} 个模型${report.durationMs ? ` · 耗时 ${fmtDur(report.durationMs)}` : ''}${report.imported ? ' · 手动导入' : ''}`,
      report.context ? h('div', { style: { marginTop: 4 } }, `背景：${report.context.slice(0, 200)}`) : null,
    ),

    h('div', { className: 'dshmm-signal-strip' },
      Object.keys(SIGNAL_META).map((k) => signalCounts[k]
        ? h('span', { key: k, className: 'dshmm-chip', style: { borderColor: SIGNAL_META[k].color, cursor: 'default' } }, `${SIGNAL_META[k].label} × ${signalCounts[k]}`)
        : null),
    ),

    syn ? h('div', { className: 'dshmm-card dshmm-syn' },
      h('h3', { style: { margin: '0 0 8px', fontSize: 15 } }, '🧭 综合结论'),
      syn.summary ? h('div', { style: { whiteSpace: 'pre-wrap' } }, syn.summary) : null,
      h('div', { className: 'dshmm-syn-grid' },
        synBox('模型共识', '🤝', syn.consensus),
        synBox('观点分歧', '⚡', syn.conflicts),
        synBox('盲区提醒', '🕳️', syn.blindspots),
        (Array.isArray(syn.priorities) && syn.priorities.length) ? h('div', { className: 'dshmm-syn-box' },
          h('h4', null, '✅ 行动清单'),
          h('ul', null, syn.priorities.map((p, i) => h('li', { key: i },
            h('strong', null, typeof p === 'string' ? p : p.action),
            typeof p === 'object' && p && p.why ? h('span', { className: 'dshmm-sub' }, ` —— ${p.why}`) : null,
          ))),
        ) : null,
      ),
    ) : h('div', { className: 'dshmm-card dshmm-syn' },
      h('h3', { style: { margin: '0 0 8px', fontSize: 15 } }, '🧭 综合结论'),
      h('div', { className: 'dshmm-sub' }, report.synthesisError ? `综合阶段未完成：${report.synthesisError}` : '无综合数据（各模型分析仍然有效）'),
    ),

    Array.isArray(report.batchErrors) && report.batchErrors.length ? h('div', { className: 'dshmm-err' },
      report.batchErrors.map((b, i) => h('div', { key: i }, `批次失败：${(b.models || []).map((id) => { const m = models.getModel(id); return m ? m.name : id }).join('、')} —— ${b.error || ''}`)),
    ) : null,

    h('div', { className: 'dshmm-cats' },
      h('span', { className: 'dshmm-chip' + (catFilter === '' ? ' active' : ''), onClick: () => setCatFilter('') }, `全部 (${results.length})`),
      catsUsed.map((cid) => {
        const c = models.CATEGORY_BY_ID[cid]
        const n = results.filter((r) => { const m = models.getModel(r.id); return (m ? m.cat : '') === cid }).length
        return h('span', { key: cid || 'none', className: 'dshmm-chip' + (catFilter === cid ? ' active' : ''), onClick: () => setCatFilter(catFilter === cid ? '' : cid) },
          `${c ? c.icon + ' ' + c.name : '其他'} (${n})`)
      }),
    ),

    h('div', { className: 'dshmm-rcards' },
      shown.map((r) => {
        const m = models.getModel(r.id)
        const sig = SIGNAL_META[r.signal] || SIGNAL_META.neutral
        const open = !!expand[r.id]
        return h('div', { key: r.id, className: 'dshmm-card dshmm-rcard' },
          h('div', { className: 'dshmm-rcard-t' },
            h('span', { className: 'dshmm-signal', style: { background: sig.color, color: '#fff' } }, sig.label),
            h('span', null, m ? m.name : r.id),
            h('span', { className: 'dshmm-sub', style: { fontWeight: 400, fontSize: 11 } }, m ? `${m.en} · ${catName(m.cat)}` : ''),
          ),
          r.verdict ? h('div', { className: 'dshmm-verdict' }, r.verdict) : null,
          Array.isArray(r.insights) && r.insights.length ? h('ul', { className: 'dshmm-list' },
            r.insights.map((s, i) => h('li', { key: i }, s)),
          ) : null,
          Array.isArray(r.actions) && r.actions.length ? h('div', { style: { marginTop: 6, fontSize: 12 } },
            h('span', { className: 'dshmm-sub' }, '建议：'),
            h('ul', { className: 'dshmm-list' }, r.actions.map((s, i) => h('li', { key: i }, s))),
          ) : null,
          r.analysis ? h('div', null,
            open ? h('div', { className: 'dshmm-analysis' }, r.analysis) : null,
            h('button', { className: 'dshmm-btn', style: { marginTop: 8 }, onClick: () => setExpand({ ...expand, [r.id]: !open }) },
              open ? '收起完整分析' : '展开完整分析'),
          ) : null,
        )
      }),
    ),
  )
}

// ── 提示词往返弹窗 ──────────────────────────────────────────────────────────
function ManualModal({ question, context, modelIds, onClose, onImported }) {
  const [promptText, setPromptText] = React.useState('')
  const [raw, setRaw] = React.useState('')
  const [err, setErr] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    api('POST', '/prompt', { question, context, modelIds })
      .then((r) => setPromptText(r.prompt || ''))
      .catch((e) => setErr('生成提示词失败：' + String(e.message || e)))
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板 API 不可用：选中文本让用户手动复制
      try {
        const ta = document.getElementById('dshmm-manual-prompt')
        if (ta) { ta.focus(); ta.select() }
      } catch { /* ignore */ }
    }
  }

  const doImport = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api('POST', '/import', { question, context, raw })
      onImported(r.reportId)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { className: 'dshmm-modal-bg', onMouseDown: onClose },
    h('div', { className: 'dshmm-modal', onMouseDown: (e) => e.stopPropagation() },
      h('div', { className: 'dshmm-row', style: { marginBottom: 8 } },
        h('strong', { style: { fontSize: 14 } }, '提示词往返模式'),
        h('span', { style: { flex: 1 } }),
        h('span', { style: { cursor: 'pointer', opacity: 0.6, padding: '0 4px' }, onClick: onClose }, '✕'),
      ),
      h('div', { className: 'dshmm-sub', style: { marginBottom: 8 } },
        '第一步：复制下面的提示词，粘贴到任意 AI 会话中执行；第二步：把回复末尾的结构化结果（含 ===MIND-JSON=== 标记）整体粘回，点击导入。'),
      err ? h('div', { className: 'dshmm-err' }, err) : null,
      h('textarea', {
        id: 'dshmm-manual-prompt', className: 'dshmm-ta', readOnly: true,
        style: { minHeight: 180, fontFamily: 'ui-monospace, monospace', fontSize: 12 },
        value: promptText || '生成中…',
      }),
      h('div', { className: 'dshmm-row', style: { margin: '8px 0' } },
        h('button', { className: 'dshmm-btn primary', onClick: copy, disabled: !promptText }, copied ? '已复制 ✓' : '复制提示词'),
      ),
      h('textarea', {
        className: 'dshmm-ta', style: { minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12 },
        placeholder: '把 AI 回复（至少包含 ===MIND-JSON=== 标记及其后的 JSON）粘贴到这里…',
        value: raw, onChange: (e) => setRaw(e.target.value),
      }),
      h('div', { className: 'dshmm-row', style: { marginTop: 8 } },
        h('button', { className: 'dshmm-btn primary', onClick: doImport, disabled: busy || !raw.trim() }, busy ? '导入中…' : '导入并生成报告'),
        h('span', { className: 'dshmm-sub' }, '只校验结构，结果存为一份新报告'),
      ),
    ),
  )
}

// ── 向导组件 ────────────────────────────────────────────────────────────────
function StepsBar({ step }) {
  const steps = ['输入问题', '选择模型', '确认提交']
  const nodes = []
  steps.forEach((label, i) => {
    const n = i + 1
    const cls = step === n ? ' active' : step > n ? ' done' : ''
    nodes.push(h('div', { key: n, className: 'dshmm-step' + cls },
      h('span', { className: 'n' }, step > n ? '✓' : String(n)),
      h('span', null, label),
    ))
    if (n < steps.length) nodes.push(h('div', { key: 'line' + n, className: 'dshmm-step-line' }))
  })
  return h('div', { className: 'dshmm-steps' }, nodes)
}

function StepQuestion({ question, setQuestion, context, setContext, onNext }) {
  return h('div', null,
    h('div', { className: 'dshmm-label' }, h('span', null, '要分析的问题'), h('span', null, `${question.length}/2000`)),
    h('textarea', {
      className: 'dshmm-ta', style: { minHeight: 110 },
      placeholder: '例如：我要不要从大厂辞职，和朋友创业做一款面向自由职业者的记账工具？',
      value: question, onChange: (e) => setQuestion(e.target.value.slice(0, 2000)), maxLength: 2000,
      autoFocus: true,
    }),
    h('div', { className: 'dshmm-label' }, h('span', null, '背景信息（可选，越具体分析越贴合）'), h('span', null, `${context.length}/4000`)),
    h('textarea', {
      className: 'dshmm-ta', style: { minHeight: 90 },
      placeholder: '补充约束条件、资源、时间线、相关方、已试过的方案等背景。',
      value: context, onChange: (e) => setContext(e.target.value.slice(0, 4000)), maxLength: 4000,
    }),
    h('div', { className: 'dshmm-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
      h('button', { className: 'dshmm-btn primary', style: { padding: '8px 18px' }, onClick: onNext }, '下一步：选择模型 →'),
    ),
  )
}

function StepModels({ selected, onToggle, onBatch, question, context, agentsOk, onBack, onNext }) {
  // 模型列表很长：导航按钮上下各一组，主按钮直接显示已选数量
  const nav = (key) => h('div', {
    key, className: 'dshmm-row',
    style: { justifyContent: 'space-between', margin: key === 'top' ? '4px 0 10px' : '14px 0 0' },
  },
    h('button', { className: 'dshmm-btn', onClick: onBack }, '← 上一步'),
    h('button', {
      className: 'dshmm-btn primary', style: { padding: '8px 18px' },
      onClick: onNext, disabled: selected.size === 0,
    }, `已选 ${selected.size} 个，下一步 →`),
  )
  return h('div', null,
    h('div', { className: 'dshmm-label' },
      h('span', null, '选择要参与分析的思维模型'),
      h('span', { className: 'dshmm-sub' }, '建议 6-24 个，跨分类组合效果最好'),
    ),
    nav('top'),
    h(ModelPicker, { selected, onToggle, onBatch, question, context, agentsOk }),
    nav('bottom'),
  )
}

function StepConfirm({ question, context, selectedIds, agentsOk, onBack, onAuto, onManual, onRemove }) {
  const grouped = []
  for (const c of models.CATEGORIES) {
    const list = selectedIds.map((id) => models.getModel(id)).filter((m) => m && m.cat === c.id)
    if (list.length) grouped.push({ cat: c, list })
  }
  return h('div', null,
    h('div', { className: 'dshmm-card dshmm-sum' },
      h('div', { className: 'dshmm-sum-t' }, '问题'),
      h('div', { style: { fontWeight: 600, whiteSpace: 'pre-wrap' } }, question),
      h('div', { className: 'dshmm-sum-t', style: { marginTop: 10 } }, '背景'),
      h('div', { className: 'dshmm-sub', style: { whiteSpace: 'pre-wrap' } }, context || '（未填写）'),
    ),
    h('div', { className: 'dshmm-card dshmm-sum' },
      h('div', { className: 'dshmm-sum-t' }, `将使用 ${selectedIds.length} 个思维模型（点 × 可移除）`),
      grouped.map((g) => h('div', { key: g.cat.id, style: { marginTop: 8 } },
        h('div', { className: 'dshmm-sub', style: { fontSize: 11, marginBottom: 4 } }, `${g.cat.icon} ${g.cat.name} · ${g.list.length}`),
        h('div', { className: 'dshmm-sum-models' }, g.list.map((m) => h('span', { key: m.id, className: 'dshmm-sum-m' },
          m.name,
          h('span', { className: 'x', title: `移除「${m.name}」`, onClick: () => onRemove(m.id) }, '✕'),
        ))),
      )),
    ),
    h('div', { className: 'dshmm-row', style: { marginTop: 6, justifyContent: 'space-between' } },
      h('button', { className: 'dshmm-btn', onClick: onBack }, '← 上一步'),
      h('div', { className: 'dshmm-row' },
        h('button', { className: 'dshmm-btn', style: { padding: '8px 14px' }, onClick: onManual, disabled: selectedIds.length === 0 }, '📋 提示词往返'),
        h('button', {
          className: 'dshmm-btn primary', style: { padding: '8px 18px', fontSize: 13 },
          onClick: onAuto, disabled: !agentsOk || selectedIds.length === 0,
          title: agentsOk ? '后台起 AI 会话自动完成全部分析' : 'agents 服务不可用，请用提示词往返',
        }, agentsOk ? '🧠 确认，开始自动分析' : '🧠 自动分析（agents 不可用）'),
      ),
    ),
    !agentsOk ? h('div', { className: 'dshmm-sub', style: { marginTop: 8, textAlign: 'right' } }, '当前宿主无 agents 服务，请用「提示词往返」模式') : null,
  )
}

// ── 进行中任务实时卡片（历史页）：批次进度 + 已产出结论逐渐填满 ──────────────
function LiveJobCard({ job, onOpen, onCancel }) {
  const statusMeta = {
    running: { label: '进行中', color: 'var(--mm-accent)' },
    done: { label: '已完成', color: 'var(--mm-ok)' },
    error: { label: '失败', color: 'var(--mm-danger)' },
    aborted: { label: '已取消', color: 'var(--mm-sub)' },
  }
  const meta = statusMeta[job.status] || statusMeta.running
  const results = Array.isArray(job.results) ? job.results : []
  const doneBatches = job.batches.filter((b) => b.status === 'done').length
  return h('div', { className: 'dshmm-card dshmm-live' },
    h('div', { className: 'dshmm-live-head' },
      job.status === 'running' ? h('span', { className: 'dshmm-spin' }) : null,
      h('span', { className: 'dshmm-live-q' }, job.question || '（无标题）'),
      h('span', { className: 'dshmm-live-badge', style: { background: meta.color } }, meta.label),
      h('span', { className: 'dshmm-sub' }, `模型 ${results.length}/${job.modelCount} · 批次 ${doneBatches}/${job.batches.length} · ${fmtDur(job.durationMs)}`),
      h('span', { style: { flex: 1 } }),
      job.status === 'running' && onCancel ? h('button', { className: 'dshmm-btn danger', onClick: () => onCancel(job.id) }, '取消') : null,
      job.reportId ? h('button', { className: 'dshmm-btn primary', onClick: () => onOpen(job.reportId) }, '查看完整报告 →') : null,
    ),
    h('div', { className: 'dshmm-live-batches' },
      job.batches.map((b) => h('span', { key: b.index, className: 'dshmm-live-batch', title: b.error || '' },
        h('span', {
          className: 'dshmm-dot',
          style: { background: b.status === 'done' ? 'var(--mm-ok)' : b.status === 'error' ? 'var(--mm-danger)' : b.status === 'running' ? 'var(--mm-accent)' : 'var(--mm-border2)' },
        }),
        `批次${b.index + 1} ${b.status === 'done' ? `✓${b.count}` : b.status === 'error' ? '✗' : b.status === 'running' ? '分析中' : '排队'}`,
      )),
      job.synthesisStatus === 'running' || job.synthesisStatus === 'done' ? h('span', { className: 'dshmm-live-batch' },
        h('span', { className: 'dshmm-dot', style: { background: job.synthesisStatus === 'done' ? 'var(--mm-ok)' : 'var(--mm-accent)' } }),
        `综合 ${job.synthesisStatus === 'done' ? '✓' : '综合中'}`,
      ) : null,
    ),
    results.length ? h('div', { className: 'dshmm-live-results' },
      results.map((r) => {
        const m = models.getModel(r.id)
        const sig = SIGNAL_META[r.signal] || SIGNAL_META.neutral
        return h('div', { key: r.id, className: 'dshmm-live-v' },
          h('div', { className: 'dshmm-live-vt' },
            h('span', { className: 'dshmm-signal', style: { background: sig.color, color: '#fff' } }, sig.label),
            h('span', null, m ? m.name : r.id),
          ),
          r.verdict ? h('div', { className: 'dshmm-live-vd' }, r.verdict) : null,
        )
      }),
    ) : h('div', { className: 'dshmm-sub', style: { marginTop: 8 } }, '各模型结论出来后会在这里逐渐填满…'),
    job.synthesisData && job.synthesisData.summary ? h('div', { className: 'dshmm-live-syn' },
      h('strong', null, '🧭 综合结论：'), job.synthesisData.summary,
    ) : null,
    job.error ? h('div', { className: 'dshmm-err', style: { marginTop: 8 } }, job.error) : null,
  )
}

// ── 主面板 ──────────────────────────────────────────────────────────────────
// 默认不预选中任何模型：让用户主动挑选或用推荐，提交后也重置为空
const DEFAULT_SELECTED = []


function MindPanel({ variant }) {
  const dark = useDark()
  const [view, setView] = React.useState('analyze') // analyze | library | history | report
  const [step, setStep] = React.useState(1) // 向导：1 输入问题 / 2 选择模型 / 3 确认提交
  const [question, setQuestion] = React.useState('')
  const [context, setContext] = React.useState('')
  const [selected, setSelected] = React.useState(() => new Set(DEFAULT_SELECTED))
  const [err, setErr] = React.useState('')
  const [report, setReport] = React.useState(null)
  const [reports, setReports] = React.useState([])
  const [jobs, setJobs] = React.useState([])
  const [manual, setManual] = React.useState(false)
  const [agentsOk, setAgentsOk] = React.useState(true)
  const [libSearch, setLibSearch] = React.useState('')
  const wrapRef = React.useRef(null)

  // 主面板模式钉高（视口高 − 顶部偏移），自身成为滚动容器
  React.useEffect(() => {
    if (variant !== 'panel') return
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      try {
        const r = el.getBoundingClientRect()
        const hh = window.innerHeight - r.top - 6
        if (hh > 300) el.style.height = Math.round(hh) + 'px'
      } catch { /* ignore */ }
    }
    fit()
    const t1 = setTimeout(fit, 300)
    const t2 = setTimeout(fit, 1500)
    window.addEventListener('resize', fit)
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', fit) }
  }, [variant])

  React.useEffect(() => { injectCss() }, [])
  React.useEffect(() => {
    api('GET', '/status').then((s) => setAgentsOk(!!s.agentsAvailable)).catch(() => {})
  }, [])

  const loadHistory = React.useCallback(() => {
    api('GET', '/reports').then((r) => setReports(r.reports || [])).catch(() => {})
  }, [])

  // 历史页轮询进行中任务：卡片上的批次状态与模型结论随执行逐渐填满；
  // 每轮顺带刷新报告列表（本地存储读取，代价极小），任务落定即从任务区消失、
  // 报告出现在下方列表
  React.useEffect(() => {
    if (view !== 'history') return undefined
    let stop = false
    const poll = async () => {
      try {
        const j = await api('GET', '/jobs')
        if (stop) return
        setJobs(j.jobs || [])
        loadHistory()
      } catch { /* 轮询失败下轮再来 */ }
      if (!stop) setTimeout(poll, 2000)
    }
    poll()
    return () => { stop = true }
  }, [view, loadHistory])

  const toggleModel = (id) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const batchSelect = (ids, add) => {
    if (!add) { setSelected(new Set()); return }
    const next = new Set(selected)
    for (const id of ids) next.add(id)
    setSelected(next)
  }

  const startAnalyze = async () => {
    setErr('')
    if (!question.trim()) { setErr('请先输入要分析的问题'); return }
    if (!selected.size) { setErr('请至少选择一个思维模型'); return }
    if (selected.size > 36) { setErr('单次最多选择 36 个模型，请精简'); return }
    try {
      await api('POST', '/analyze', { question: question.trim(), context: context.trim(), modelIds: [...selected] })
      // 提交成功即打开历史页（任务卡片实时展示进度与结论），同时向导重置等待下一次输入
      setQuestion('')
      setContext('')
      setSelected(new Set(DEFAULT_SELECTED))
      setStep(1)
      setView('history')
    } catch (e) {
      setErr(String(e.message || e))
    }
  }

  const cancelJob = (id) => {
    api('POST', '/cancel', { jobId: id }).catch(() => {})
  }

  const openReport = async (id) => {
    setErr('')
    try {
      const r = await api('GET', `/report?id=${encodeURIComponent(id)}`)
      setReport(r)
      setView('report')
    } catch (e) { setErr(String(e.message || e)) }
  }

  const deleteReport = async (id) => {
    try {
      await api('DELETE', `/report?id=${encodeURIComponent(id)}`)
      setReport(null)
      setView('history')
      loadHistory()
    } catch (e) { setErr(String(e.message || e)) }
  }

  // ── 视图渲染 ──
  const gotoStep = (n) => {
    setErr('')
    if (n >= 2 && !question.trim()) { setErr('请先输入要分析的问题'); return }
    if (n >= 3 && !selected.size) { setErr('请至少选择一个思维模型'); return }
    if (n >= 3 && selected.size > 36) { setErr('单次最多选择 36 个模型，请精简'); return }
    setStep(n)
  }

  const analyzeView = h('div', null,
    h(StepsBar, { step }),
    step === 1 ? h(StepQuestion, { question, setQuestion, context, setContext, onNext: () => gotoStep(2) }) : null,
    step === 2 ? h(StepModels, {
      selected, onToggle: toggleModel, onBatch: batchSelect, question, context, agentsOk,
      onBack: () => setStep(1), onNext: () => gotoStep(3),
    }) : null,
    step === 3 ? h(StepConfirm, {
      question: question.trim(), context: context.trim(), selectedIds: [...selected], agentsOk,
      onBack: () => setStep(2),
      onAuto: startAnalyze,
      onManual: () => { setErr(''); setManual(true) },
      onRemove: toggleModel,
    }) : null,
  )

  const libraryView = h('div', null,
    h('input', {
      className: 'dshmm-input', placeholder: '搜索模型…', value: libSearch,
      onChange: (e) => setLibSearch(e.target.value),
    }),
    h('div', { className: 'dshmm-sub', style: { margin: '6px 2px 0' } }, '模型库仅供浏览学习；选择模型在「分析」页的第 2 步进行。'),
    models.CATEGORIES.map((c) => {
      const q = libSearch.trim().toLowerCase()
      const list = models.MODELS.filter((m) => m.cat === c.id && (!q
        || m.name.toLowerCase().includes(q) || (m.en || '').toLowerCase().includes(q)
        || m.def.toLowerCase().includes(q) || m.scenes.join(' ').includes(q)))
      if (!list.length) return null
      return h('div', { key: c.id },
        h('div', { className: 'dshmm-lib-cat' }, `${c.icon} ${c.name}`, h('span', { className: 'dshmm-sub' }, c.desc)),
        h('div', { className: 'dshmm-lib-grid' },
          list.map((m) => h('div', { key: m.id, className: 'dshmm-card dshmm-lib-card' },
            h('div', { style: { fontWeight: 700 } }, m.name, ' ', h('span', { className: 'dshmm-sub', style: { fontWeight: 400, fontSize: 11 } }, m.en)),
            h('div', { style: { marginTop: 4, fontSize: 12 } }, m.def),
            h('div', { className: 'dshmm-sub', style: { marginTop: 4, fontSize: 11 } }, m.points.join('；')),
            h('div', { className: 'dshmm-lib-qs' }, m.qs.map((s, i) => h('div', { key: i }, `❓ ${s}`))),
          )),
        ),
      )
    }),
  )

  const historyView = h('div', null,
    jobs.length ? h('div', null,
      h('div', { className: 'dshmm-label', style: { marginTop: 0 } }, h('span', null, `任务（${jobs.filter((j) => j.status === 'running').length} 个进行中）`)),
      jobs.map((j) => h(LiveJobCard, { key: j.id, job: j, onOpen: openReport, onCancel: cancelJob })),
    ) : null,
    h('div', { className: 'dshmm-row', style: { marginBottom: 6 } },
      h('strong', null, '历史报告'),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'dshmm-btn', onClick: loadHistory }, '刷新'),
    ),
    h('div', { className: 'dshmm-hist' },
      reports.length ? reports.map((r) => h('div', {
        key: r.id, className: 'dshmm-card dshmm-hist-item', onClick: () => openReport(r.id),
      },
        h('span', null, r.ok === false ? '⚠️' : '📄'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.question || '（无标题）'),
          h('div', { className: 'dshmm-sub' }, `${fmtTime(r.createdAt)} · ${r.modelCount} 个模型${r.hasSynthesis ? ' · 含综合结论' : ''}`),
        ),
        h('button', {
          className: 'dshmm-btn danger', onClick: (e) => { e.stopPropagation(); deleteReport(r.id) },
        }, '删除'),
      )) : h('div', { className: 'dshmm-sub' }, '还没有保存的报告'),
    ),
  )

  return h('div', { ref: wrapRef, className: 'dshmm-wrap' + (dark ? ' dshmm-dark' : '') },
    h('div', { className: 'dshmm-head' },
      h('span', { style: { fontSize: 16 } }, '🦉'),
      h('strong', { style: { fontSize: 15, marginRight: 4 } }, '智囊团'),
      h('span', { className: 'dshmm-sub', style: { marginRight: 8 } }, `${models.MODELS.length} 位思维顾问为你出主意`),
      h('span', { className: 'dshmm-tab' + (view === 'analyze' ? ' active' : ''), onClick: () => setView('analyze') }, '分析'),
      h('span', { className: 'dshmm-tab' + (view === 'library' ? ' active' : ''), onClick: () => setView('library') }, `模型库 (${models.MODELS.length})`),
      h('span', {
        className: 'dshmm-tab' + (view === 'history' ? ' active' : ''),
        onClick: () => { setView('history'); loadHistory() },
      }, '历史'),
      report && view === 'report' ? h('span', { className: 'dshmm-tab active' }, '报告') : null,
    ),
    err ? h('div', { className: 'dshmm-err' }, err) : null,
    view === 'analyze' ? analyzeView : null,
    view === 'library' ? libraryView : null,
    view === 'history' ? historyView : null,
    view === 'report' && report ? h(ReportView, {
      report,
      onBack: () => { setView('analyze') },
      onDelete: () => deleteReport(report.id),
    }) : null,
    manual ? h(ManualModal, {
      question: question.trim(), context: context.trim(), modelIds: [...selected],
      onClose: () => setManual(false),
      onImported: (reportId) => { setManual(false); openReport(reportId) },
    }) : null,
  )
}

// 渲染期崩溃兜底：任何 throw 不能白屏宿主页面
function SafePanel(props) {
  const [crash, setCrash] = React.useState(null)
  React.useEffect(() => {
    const handler = (e) => {
      try {
        const list = (globalThis.__dshThinktankErrors = globalThis.__dshThinktankErrors || [])
        list.push(String((e && e.message) || e).slice(0, 300))
      } catch { /* ignore */ }
    }
    window.addEventListener('error', handler)
    return () => window.removeEventListener('error', handler)
  }, [])
  if (crash) return h('div', { style: { padding: 16 } }, `面板渲染出错：${String(crash)}`)
  try {
    return h(MindPanel, props)
  } catch (e) {
    setCrash(String((e && e.message) || e))
    return null
  }
}

// ── 入口注册（侧边栏 / 设置页，配置决定）────────────────────────────────────
const ENTRY_STATE = { entry: 'sidebar', listeners: [] }
function setEntry(entry) {
  ENTRY_STATE.entry = entry
  for (const fn of ENTRY_STATE.listeners.slice()) {
    try { fn(entry) } catch { /* 单个监听失败不影响其他 */ }
  }
}

module.exports = {
  name: PLUGIN_ID,
  inject: ['slots'],

  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    let disposers = []
    function unregisterAll() {
      for (const d of disposers) { try { if (typeof d === 'function') d() } catch { /* ignore */ } }
      disposers = []
    }
    // 每个入口只注册一次：反复 unregister/register 会触发宿主 slot 去重竞态
    const registered = { sidebar: false, settings: false }
    function registerSidebar() {
      if (registered.sidebar) return
      registered.sidebar = true
      disposers.push(slots.inject('sidebar.panellist', () => slots.register(
        { name: 'sidebar.panellist', id: SLOT_ID, label: '智囊团', order: -99 },
        (props) => h('span', {
          'aria-hidden': 'true',
          style: { display: 'inline-flex', width: (props && props.size) || 18, height: (props && props.size) || 18, alignItems: 'center', justifyContent: 'center', fontSize: ((props && props.size) || 18) - 4 },
        }, '🦉'),
      )))
      disposers.push(slots.inject('main', () => slots.register(
        { name: 'main', key: SLOT_ID },
        () => h(SafePanel, { variant: 'panel' }),
      )))
    }
    function registerSettings() {
      if (registered.settings) return
      registered.settings = true
      disposers.push(slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: PLUGIN_ID, order: SLOT_ORDER, label: () => '智囊团' },
        () => h(SafePanel, { variant: 'settings' }),
      )))
    }
    function applyEntries(entry) {
      if (entry === 'sidebar' || entry === 'both') registerSidebar()
      if (entry === 'settings' || entry === 'both') registerSettings()
    }

    applyEntries(ENTRY_STATE.entry)
    ENTRY_STATE.listeners.push((entry) => applyEntries(entry))
    fetch(API + '/config').then((r) => r.json()).then((cfg) => {
      if (cfg && cfg.entry && cfg.entry !== ENTRY_STATE.entry) setEntry(cfg.entry)
    }).catch(() => { /* 配置不可达：保持默认 */ })

    ctx.effect(() => () => unregisterAll(), 'dsh-thinktank: entries')
  },
}
