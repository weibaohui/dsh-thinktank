'use strict'
/**
 * 轻量 markdown 渲染（基本子集）：标题、段落、有序/无序列表、引用、围栏代码、
 * 行内代码、加粗、斜体、删除线、链接（仅 http/https）、分隔线。
 * 直接输出 React 元素——不经过 innerHTML，AI 文本里的原始 HTML 一律按字面显示。
 * 流式场景友好：无结束围栏的代码块按代码处理到末尾；===MIND-JSON=== 标记及其后
 * 内容不参与渲染。
 */

const React = require('react')
const h = React.createElement

const MARKER = '===MIND-JSON==='

// 加粗/斜体/删除线/行内代码/链接 的行内分词（** 与 __ 先于单字符匹配）
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\))/g

/** 行内格式 → React 节点数组 */
function renderInline(text) {
  const str = String(text || '')
  const nodes = []
  let last = 0
  let m
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(str))) {
    if (m.index > last) nodes.push(str.slice(last, m.index))
    const tok = m[0]
    let el = null
    if (tok.startsWith('**') || tok.startsWith('__')) el = h('strong', null, tok.slice(2, -2))
    else if (tok.startsWith('~~')) el = h('del', null, tok.slice(2, -2))
    else if (tok.startsWith('`')) el = h('code', { className: 'dshmm-md-code' }, tok.slice(1, -1))
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (mm && /^https?:\/\//i.test(mm[2])) el = h('a', { href: mm[2], target: '_blank', rel: 'noreferrer' }, mm[1])
      else nodes.push(tok) // 非http链接按字面显示
    } else el = h('em', null, tok.slice(1, -1))
    if (el) nodes.push(el)
    last = m.index + tok.length
  }
  if (last < str.length) nodes.push(str.slice(last))
  return nodes
}

const BLOCK_START_RE = /^\s*(```|#{1,4}\s|>\s?|[-*+]\s|\d+[.)]\s|---+|\*\*\*+)/

/** markdown 文本 → React 块级元素数组（基本子集） */
function renderMarkdown(text) {
  const src = String(text || '').split(MARKER)[0].replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const out = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    // 围栏代码块（未闭合则吃到末尾——流式输出中途也稳定）
    if (/^\s*```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(h('pre', { key: key++, className: 'dshmm-md-pre' }, h('code', null, buf.join('\n'))))
      continue
    }
    // 标题：# ~ #### 映射为 h3 ~ h6（卡片内不需要真正的大标题）
    const hm = /^(#{1,4})\s+(.*)/.exec(line)
    if (hm) {
      out.push(h(`h${hm[1].length + 2}`, { key: key++ }, renderInline(hm[2])))
      i++
      continue
    }
    // 分隔线
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push(h('hr', { key: key++ }))
      i++
      continue
    }
    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push(h('blockquote', { key: key++, className: 'dshmm-md-quote' }, renderInline(buf.join(' '))))
      continue
    }
    // 无序 / 有序列表
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const itemRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/
      const items = []
      while (i < lines.length && itemRe.test(lines[i])) { items.push(lines[i].replace(itemRe, '')); i++ }
      out.push(h(ordered ? 'ol' : 'ul', { key: key++ },
        items.map((it, j) => h('li', { key: j }, renderInline(it)))),
      )
      continue
    }
    // 空行
    if (!line.trim()) { i++; continue }
    // 段落：聚到下一空行或块级语法处
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !BLOCK_START_RE.test(lines[i])) { buf.push(lines[i]); i++ }
    out.push(h('p', { key: key++, className: 'dshmm-md-p' }, renderInline(buf.join('\n'))))
  }
  return out
}

module.exports = { renderMarkdown, renderInline }
