/**
 * src/deck/registration/tool-cards-blocks.ts —— 工具卡的几种共用块（地图 #3 · 票 #4）
 *
 * 九张卡都是同一副骨架：标题 → 状态块 → 内容块 → 脚注。这里只摆位置与配色，
 * 「缺什么、怎么续」由各张卡自己给，因为每个工具缺的东西不一样。
 *
 * 一条不能改的约定：一块内容都没有时，骨架必须补一句灰字。桥接那侧把「子节点为空」判成坏视图，
 * 整卡打不开——宁可说一句「这次没有可写进卡片的内容」，也不能交一张空卡。
 */

import {
  rec,
  str,
  listOf,
  isPartial,
  isUnsupported,
  zhReason,
  clip,
  TITLE_MAX,
} from "./tool-cards-words.js"
import type { CardNode, UnknownRecord } from "./tool-cards-words.js"

/* ── 版面小件：九张卡共用的几种块 ─────────────────────────────────────────── */

/** 一行灰字脚注。text 节点的 tone 只认 'muted' 这一个常量。 */
export function footnote(text: string): CardNode {
  return { type: 'text', text: text, tone: 'muted' }
}

/** 一句提醒。callout 的 tone 只有 info / good / warn / bad 四档，没有 muted。 */
export function callout(text: string, tone: string): CardNode {
  return { type: 'callout', text: text, tone: tone }
}

/** 几行「名称 · 值」。用数组形式写，最省体积也不容易多带键。一行都没有时不出这一块。 */
export function keyValue(rows: [string, string][]): CardNode | null {
  const items: unknown[] = []
  for (const row of rows) {
    if (!row[1]) continue
    items.push([row[0], row[1]])
  }
  return items.length ? { type: 'keyValue', items: items } : null
}

/** 列表行：title 必有，trailing 放右端的一小段（时间、成了/没成）。 */
export function listNode(rows: CardNode[]): CardNode | null {
  return rows.length ? { type: 'list', items: rows } : null
}

/** 一行列表。tone 只做加强，状态本身一定同时写成字（#11 裁决 5④）。 */
export function rowOf(title: string, trailing: string, tone: string): CardNode {
  const row: CardNode = { title: clip(title, 60) }
  if (trailing) row.trailing = clip(trailing, 12)
  if (tone) row.tone = tone
  return row
}

/** 进度条：value 是已完成的数，max 是总数。 */
export function progressBar(value: number, max: number, label: string): CardNode {
  return { type: 'progress', value: value, max: max, label: label }
}

/**
 * 状态块：#11 裁决 3。只有 status 不是 ok 时才有，而且必须是标题下第一块。
 * partial 说两句——一句缺什么、一句怎么续；unsupported 说一句为什么没做，再补一句「什么都没动」。
 * 这两句由各张卡自己给，因为「缺什么」各工具不同，这里只负责摆位置与配色。
 */
export function statusBlock(value: UnknownRecord, missing: string, resume: string): CardNode | null {
  if (isUnsupported(value)) {
    return callout(zhReason(value.reason) + '。这次什么都没做，没花点数、没写盘。', 'bad')
  }
  if (isPartial(value)) {
    return callout(missing + (resume ? ' ' + resume : ''), 'warn')
  }
  return null
}

/**
 * 九张卡共用的骨架：标题 → 状态块 → 内容块 → 脚注。空的块自动跳过。
 * 一块都不剩时补一句灰字：桥接那侧把「子节点为空」判成坏视图，整卡打不开（见文件头第 4 条）。
 */
export function skeleton(title: string, blocks: (CardNode | null | undefined)[]): CardNode {
  const children: unknown[] = []
  for (const block of blocks) {
    if (block) children.push(block)
  }
  if (!children.length) children.push(footnote('这次没有可写进卡片的内容。'))
  return { type: 'stack', title: clip(title, TITLE_MAX), children: children }
}

/* ── 权限与正文两个小判定 ─────────────────────────────────────────────── */

/**
 * 仓库能不能写。回执里 permissions 有三种形态：{push,triage}、{unknown:true}、以及缺这一格。
 * 只读与未知要分开说——「不知道」不能写成「不能」。
 */
export function permissionLabel(permissions: unknown): string {
  const p = rec(permissions)
  if (!Object.keys(p).length) return '未知'
  if (p.unknown === true) return '未知'
  const push = p.push === true
  const triage = p.triage === true
  if (push && triage) return '可写'
  if (push || triage) return '部分可写'
  return '只读'
}

/**
 * 票的正文。只读取回来的那一档：excerpt 直接给 text，full 把分块拼起来，
 * section 只读了一段所以没有整段正文可放（返回空串，卡片改放脚注说明）。
 */
export function bodyTextOf(body: UnknownRecord): string {
  const direct = str(body.text)
  if (direct) return direct
  const chunks = listOf(body.chunks)
  if (chunks.length) return chunks.map(function (c) { return str(c) }).join('\n')
  return ''
}
