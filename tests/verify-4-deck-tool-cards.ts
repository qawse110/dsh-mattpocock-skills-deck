/**
 * tests/verify-4-deck-tool-cards.ts —— 九个 deck_* 工具的原生工具卡门禁（地图 #3 · 票 #4）。
 *
 * 守什么：卡片走的是桥接那条「静默失败」的路——视图里写了个不认识的组件、列表行多带一个键、
 * 体积超过 8 KiB、层级超过 6 层，App 都不会报错，只会少画几块、画成空白，或者干脆不显示；
 * 而这些错误类型检查一个都看不见（节点树是 any）。所以这里跑两条真数据：
 *
 *   A 三态假回执：九张卡各一份成功、大部分再各一份「没做全」与「什么都没做」，逐张画一遍，
 *     检查标题、首块、行数、每一块的组件形状；
 *   B 仓库里的金标准回执：tests/tracker-contract/fixtures/golden-receipts 那十一份是今天真实
 *     回包的逐字存档，卡片对它们要画得出来——这一条是「假回执跟真回包长得一样」的唯一保险。
 *
 * 另外三条与「卡片画得对不对」同等要紧、但更靠上游：
 *
 *   C 注册链：presentationMeta 必须真的挂到输出形状上（两个工厂 + 由它们拼出来的注册选项），
 *     否则卡再漂亮也送不到 App；
 *   D 出口安全：presentationMeta 抛错或不回对象，框架会把整次工具调用判成失败（见
 *     dsh-tools 的 snapshotProjection），所以 deckToolCard 对任何输入都只能回对象；
 *   E 不越界：工具卡第 0 期不能点，卡里不许出现 action；节点里不许写 {$:…} 绑定，工具卡没有数据模型。
 *
 * 为什么自带一份视图校验、不引 dsh-go 的 kit：它住在用户主目录的技能包下（~/.dsh/skills/…），
 * 门禁不能依赖仓库以外的路径（同 tests/verify-5-dshgo-panels.ts 的口径）。这里只抄九个工具卡
 * 真用到的那几种组件与配额，够拦住「写了个不存在的组件」这类静默失败，不追求做整套校验器。
 *
 * 运行：node --import ./scripts/ts-hook.mts tests/verify-4-deck-tool-cards.ts
 */
// 门禁归属: src/deck/registration/tool-cards.ts
// 门禁归属: src/deck/registration/tool-cards-words.ts
// 门禁归属: src/deck/registration/tool-cards-blocks.ts
// 门禁归属: src/deck/registration/register-options.ts
// 门禁归属: src/deck/registration/detail-render.ts

import { readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { printGateResult } from './lib/gate-result.ts'
import { deckToolCard } from '../src/deck/registration/tool-cards.ts'
import {
  buildAgentToolOptions,
  deckAgentOutputSchemaRaw,
  deckAgentOutputSpec,
} from '../src/deck/registration/register-options.ts'
import { BAD_CASES, OK_CASES, PARTIAL_CASES } from './fixtures/4-tool-cards/receipts.ts'

const GATE = 'verify-4-deck-tool-cards'
const ROOT = path.resolve(import.meta.dirname, '..')
const GOLDEN_DIR = path.join(ROOT, 'tests/tracker-contract/fixtures/golden-receipts')
const CARD_KEY = 'dsh-go/view'

/** 一张工具卡的上限，与 src/deck/registration/tool-cards.ts 里的常量同口径。 */
const MAX_BYTES = 8192
const MAX_COMPONENTS = 40
const MAX_DEPTH = 6
/** #11 裁决 5②：标题不超过 40 字，窄屏也要放得下。 */
const MAX_TITLE = 40

let total = 0
let failed = 0
function check(ok: unknown, message: string, detail?: unknown): void {
  total += 1
  if (ok) {
    console.log('  PASS ' + message)
    return
  }
  failed += 1
  const tail = detail === undefined ? '' : '（实得 ' + JSON.stringify(detail) + '）'
  console.log('  FAIL ' + message + tail)
}

/* ── 视图校验：只抄九个工具卡真用到的那几种组件 ───────────────────────────── */

const NODE_TYPES = ['stack', 'text', 'list', 'keyValue', 'progress', 'callout']
/** list 行允许的键（桥接 schema 的 listItem 是 additionalProperties:false）。 */
const ROW_KEYS = ['title', 'subtitle', 'trailing', 'icon', 'tone', 'action']
const TONES = ['good', 'warn', 'bad', 'info', 'muted']
/** callout 的 tone 窄一档：没有 muted。 */
const CALLOUT_TONES = ['info', 'good', 'warn', 'bad']

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 一张卡的问题清单：组件名、每块的必填格、行键白名单、深度与体积。
 * 空数组就是这张卡没问题。
 */
function issuesOf(view: unknown): string[] {
  const issues: string[] = []
  let components = 0
  let depth = 0

  const walk = (node: unknown, at: string, level: number): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, at + '[' + i + ']', level))
      return
    }
    if (!isRecord(node)) {
      issues.push(at + ' 不是对象')
      return
    }
    for (const key of Object.keys(node)) {
      if (key === '$') issues.push(at + ' 里写了 {$:…} 绑定（工具卡没有数据模型）')
    }
    const type = node.type
    if (typeof type !== 'string') {
      issues.push(at + ' 缺 type')
      return
    }
    if (NODE_TYPES.indexOf(type) < 0) {
      issues.push(at + ' 的组件 ' + type + ' 不在白名单里')
      return
    }
    components += 1
    depth = Math.max(depth, level)
    const here = at + '(' + type + ')'

    if (type === 'stack') {
      const children = node.children
      if (!Array.isArray(children) || !children.length) {
        issues.push(here + ' 的 children 必须是非空数组（空视图在桥接那侧整卡打不开）')
      } else {
        children.forEach((child, i) => walk(child, here + '.children[' + i + ']', level + 1))
      }
      if (node.title !== undefined && typeof node.title !== 'string') issues.push(here + ' 的 title 不是字符串')
      return
    }
    if (type === 'text') {
      if (typeof node.text !== 'string' || !node.text) issues.push(here + ' 缺 text')
      if (node.tone !== undefined && node.tone !== 'muted') issues.push(here + ' 的 tone 只认 muted，实得 ' + JSON.stringify(node.tone))
      if (node.style !== undefined) issues.push(here + ' 不需要 style')
      return
    }
    if (type === 'list') {
      const items = node.items
      if (!Array.isArray(items) || !items.length) {
        issues.push(here + ' 的 items 必须是非空数组')
        return
      }
      items.forEach((item, i) => {
        const row = here + '.items[' + i + ']'
        if (!isRecord(item)) {
          issues.push(row + ' 不是对象')
          return
        }
        for (const key of Object.keys(item)) {
          if (ROW_KEYS.indexOf(key) < 0) issues.push(row + ' 多带了键 ' + key + '（这一行是 additionalProperties:false）')
        }
        if (typeof item.title !== 'string' || !item.title) issues.push(row + ' 缺 title')
        if (item.tone !== undefined && TONES.indexOf(String(item.tone)) < 0) issues.push(row + ' 的 tone 不合法：' + JSON.stringify(item.tone))
        if (item.action !== undefined) issues.push(row + ' 写了 action（工具卡第 0 期不能点）')
      })
      return
    }
    if (type === 'keyValue') {
      const items = node.items
      if (!Array.isArray(items) || !items.length) {
        issues.push(here + ' 的 items 必须是非空数组')
        return
      }
      items.forEach((item, i) => {
        const row = here + '.items[' + i + ']'
        if (!Array.isArray(item) || item.length !== 2) {
          issues.push(row + ' 必须是 [名称, 值] 两格')
          return
        }
        if (typeof item[0] !== 'string' || !item[0]) issues.push(row + ' 的名称不是字符串')
        if (typeof item[1] !== 'string' || !item[1]) issues.push(row + ' 的值不是字符串')
      })
      return
    }
    if (type === 'progress') {
      if (typeof node.value !== 'number' || !isFinite(node.value)) issues.push(here + ' 的 value 必须是数字')
      if (node.max !== undefined && (typeof node.max !== 'number' || !isFinite(node.max))) issues.push(here + ' 的 max 必须是数字')
      if (typeof node.max === 'number' && typeof node.value === 'number' && node.max < node.value) {
        issues.push(here + ' 的 max 小于 value（进度条会画反）')
      }
      if (node.label !== undefined && typeof node.label !== 'string') issues.push(here + ' 的 label 不是字符串')
      return
    }
    // callout
    if (typeof node.text !== 'string' || !node.text) issues.push(here + ' 缺 text')
    if (CALLOUT_TONES.indexOf(String(node.tone)) < 0) issues.push(here + ' 的 tone 不合法：' + JSON.stringify(node.tone))
  }

  walk(view, 'view', 1)
  const bytes = Buffer.byteLength(JSON.stringify(view), 'utf8')
  if (bytes > MAX_BYTES) issues.push('整张卡 ' + bytes + ' 字节，超过 ' + MAX_BYTES)
  if (components > MAX_COMPONENTS) issues.push('整张卡 ' + components + ' 个组件，超过 ' + MAX_COMPONENTS)
  if (depth > MAX_DEPTH) issues.push('整张卡 ' + depth + ' 层，超过 ' + MAX_DEPTH)
  return issues
}

/** 拿到一张卡（不是「这次不出卡」）。 */
function cardOf(value: unknown, args?: unknown): Record<string, unknown> | null {
  const meta = deckToolCard(args === undefined ? {} : args, value)
  if (!isRecord(meta)) return null
  const view = meta[CARD_KEY]
  return isRecord(view) ? view : null
}

/** 一趟校验：出卡、没问题、根是 stack、标题不超过 40 字。 */
function checkCard(label: string, view: Record<string, unknown> | null): boolean {
  if (!view) {
    check(false, label + '：应当出卡，这次没出')
    return false
  }
  const issues = issuesOf(view)
  check(issues.length === 0, label + '：视图在配额与白名单内', issues)
  check(view.type === 'stack', label + '：根节点是 stack', view.type)
  const title = typeof view.title === 'string' ? view.title : ''
  check(title.length > 0 && title.length <= MAX_TITLE, label + '：标题有且不超过 ' + MAX_TITLE + ' 字', title)
  return issues.length === 0
}

function childrenOf(view: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!view || !Array.isArray(view.children)) return []
  return view.children.filter(isRecord)
}

function firstOf(view: Record<string, unknown> | null): Record<string, unknown> | null {
  const children = childrenOf(view)
  return children.length ? children[0] : null
}

/** 一张卡里所有「名称 · 值」块的名称（只读第一格，用来查某一行在不在）。 */
function keyValueLabels(view: Record<string, unknown> | null): string[] {
  const labels: string[] = []
  for (const node of childrenOf(view)) {
    if (node.type !== 'keyValue' || !Array.isArray(node.items)) continue
    for (const item of node.items) {
      if (Array.isArray(item) && typeof item[0] === 'string') labels.push(item[0])
    }
  }
  return labels
}

function textsIn(view: unknown): string {
  return JSON.stringify(view)
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

function main(): void {
  console.log('— A 注册链：卡片真的挂上去了吗 —')

  const spec = deckAgentOutputSpec()
  const raw = deckAgentOutputSchemaRaw()
  check(typeof spec.presentationMeta === 'function', 'deckAgentOutputSpec() 带 presentationMeta')
  check(spec.presentationMeta === deckToolCard, 'deckAgentOutputSpec() 挂的是 tool-cards 里那一个函数')
  check(typeof raw.presentationMeta === 'function', 'deckAgentOutputSchemaRaw() 带 presentationMeta')
  check(raw.presentationMeta === deckToolCard, 'deckAgentOutputSchemaRaw() 挂的是同一个函数（两条注册路共用一个）')
  check(typeof spec.render === 'function' && typeof raw.render === 'function', '两个工厂照旧带 render（旧契约不破）')

  const options = buildAgentToolOptions({
    name: 'deck_context',
    description: '看这个工作区连的是哪个后端',
    parameters: { type: 'object', properties: {} },
  })
  check(options !== null, 'buildAgentToolOptions 能拼出注册选项')
  const opts = isRecord(options) ? options : {}
  const out = isRecord(opts.output) ? opts.output : {}
  check(out.presentationMeta === deckToolCard, '注册选项上的 presentationMeta 也是同一个函数（defineTool 那条路不会漏）')

  console.log('— B 成功态：九张卡都画得出来，画的是「成了什么」 —')
  for (const c of OK_CASES) {
    const view = cardOf(c.value, c.args || {})
    if (!checkCard(c.name, view)) continue
    const first = firstOf(view)
    check(first === null || first.type !== 'callout', c.name + '：成功态的第一块不是提醒块', first && first.type)
  }

  console.log('— C 没做全：标题说得出「没做全」，标题下第一块是黄色提醒 —')
  const PARTIAL_WORDS = /没读全|没做全|没接全|没建成|没建全|没数出来/
  for (const c of PARTIAL_CASES) {
    const view = cardOf(c.value, c.args || {})
    if (!checkCard(c.name, view)) continue
    const title = String(view.title)
    check(PARTIAL_WORDS.test(title), c.name + '：标题说出了「没做全」这件事', title)
    const first = firstOf(view)
    check(!!first && first.type === 'callout' && first.tone === 'warn', c.name + '：第一块是 warn 的提醒块', first)
  }
  // 建票与上报今天没有 partial 这一档（工具实现里只有成功与失败两支），把这件事写成断言，
  // 免得以后有人照着九张卡的平均样子给它们硬造一个中间态。
  const partialTools = PARTIAL_CASES.map((c) => c.tool)
  check(partialTools.indexOf('deck_issue_create') < 0 && partialTools.indexOf('deck_issue_report') < 0,
    '建票与上报没有「没做全」这一档（夹具里不造，门禁里写明）')

  console.log('— D 什么都没做：标题说得出「没做成」，标题下第一块是红色提醒 —')
  const BAD_WORDS = /没读回来|没读到|没报上|没建成|没接成|没改成/
  for (const c of BAD_CASES) {
    const view = cardOf(c.value, c.args || {})
    if (!checkCard(c.name, view)) continue
    const title = String(view.title)
    check(BAD_WORDS.test(title), c.name + '：标题说出了「没做成」这件事', title)
    const first = firstOf(view)
    check(!!first && first.type === 'callout' && first.tone === 'bad', c.name + '：第一块是 bad 的提醒块', first)
    const all = textsIn(view)
    check(all.indexOf('没花点数') >= 0 || all.indexOf('没做成') >= 0 || all.indexOf('没读回来') >= 0,
      c.name + '：卡面写出了这次什么都没动', all.slice(0, 120))
  }

  console.log('— E 不该出卡的三个工具 —')
  const workRoute = readGolden('11-deck_work_route')
  check(Object.keys(deckToolCard({}, workRoute)).length === 0, 'deck_work_route 不出卡（#11 定稿只画九张）')
  check(Object.keys(deckToolCard({}, { status: 'ok', text: '给了两条建议', tool: 'suggest_next_steps' })).length === 0,
    'suggest_next_steps 走同一个输出形状，但不出卡')
  check(Object.keys(deckToolCard({}, { status: 'ok', text: '服务清单', tool: 'deck_probe' })).length === 0, 'deck_probe 不出卡')

  console.log('— F 出口安全：任何输入都只能回对象，绝不抛错 —')
  const weird: unknown[] = [null, undefined, 0, 42, '', 'deck_context', [], [1, 2], {}, { tool: '' }, { tool: 'no_such_tool' }]
  let safe = true
  for (const v of weird) {
    let meta: unknown = null
    try {
      meta = deckToolCard({}, v)
    } catch (e) {
      safe = false
    }
    if (!isRecord(meta)) safe = false
  }
  check(safe, 'null / undefined / 数字 / 字符串 / 数组 / 空对象 / 不认识的工具名，都回一个对象，不抛错')

  const boom = {}
  Object.defineProperty(boom, 'tool', { get() { throw new Error('回执坏了') } })
  let threw = false
  let meta: unknown = null
  try {
    meta = deckToolCard({}, boom)
  } catch (e) {
    threw = true
  }
  check(!threw && isRecord(meta) && Object.keys(meta as object).length === 0, '回执的字段读取抛错时回 {}（不能把整次工具调用拖失败）')

  // 超 8 KiB 时干脆不出卡：桥接那侧看不到体积错误，只会安静地少画几块，比不出卡更难查。
  const hugeRepo = cardOf({ ok: true, status: 'ok', tool: 'deck_context', data: { backend: { id: 'github' }, repo: { name: 'x'.repeat(9000) } } })
  check(hugeRepo === null, '一张卡超过 8 KiB 时不出卡（宁可只有文字，不要让桥接少画几块）')

  console.log('— G 金标准回执：今天真实回包的十一份逐份画一遍 —')
  const goldenFiles = readdirSync(GOLDEN_DIR).filter((f) => /^\d{2}-.*\.golden\.json$/.test(f)).sort()
  check(goldenFiles.length === 11, '金标准回执还是十一份', goldenFiles.length)
  let goldenCards = 0
  for (const file of goldenFiles) {
    const receipt = JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), 'utf8'))
    const view = cardOf(receipt)
    const tool = String(receipt.tool || '')
    if (tool === 'deck_work_route') {
      check(view === null, file + '：deck_work_route 不出卡')
      continue
    }
    goldenCards += 1
    checkCard(file, view)
  }
  check(goldenCards === 10, '十一份里十份出了卡、一份（在办表）不出卡', goldenCards)

  console.log('— H 版面细节：每种状态该有的块与不该有的块 —')
  // 只查「名称 · 值」那一块里有没有「地图」这一行：整张卡的正文里当然会提到地图（状态块要解释
  // 地图清单没读回来），所以不能拿整张卡的文字去搜。
  const ctxPartial = cardOf(PARTIAL_CASES[0].value)
  const ctxRows = keyValueLabels(ctxPartial)
  check(ctxPartial !== null && ctxRows.indexOf('地图') < 0,
    '工作区没读全时不写「地图 N 张」（没读到的东西不能写成没有）', ctxRows)
  const ctxOk = keyValueLabels(cardOf(OK_CASES[0].value))
  check(ctxOk.indexOf('地图') >= 0, '工作区读全时照旧有「地图」这一行', ctxOk)

  const snapOk = cardOf(OK_CASES[6].value)
  const snapProgress = childrenOf(snapOk).filter((n) => n.type === 'progress')
  check(snapProgress.length === 1 && snapProgress[0].value === 6 && snapProgress[0].max === 8,
    '地图成功：进度条是「已关闭 6 / 共 8」', snapProgress[0])

  const goldenSnap = readGolden('05-deck_map_snapshot')
  const goldenSnapView = cardOf(goldenSnap)
  const goldenProgress = childrenOf(goldenSnapView).filter((n) => n.type === 'progress')
  check(goldenProgress.length === 0, '一张子票都没有时不出进度条（0/0 是一根空杠，比不画更像坏了）')
  check(textsIn(goldenSnapView).indexOf('还没有子票') >= 0, '一张子票都没有时用一句灰字说明')

  const snapPartial = cardOf(PARTIAL_CASES[4].value)
  check(childrenOf(snapPartial).filter((n) => n.type === 'progress').length === 0, '子票没数出来时也不出进度条')
  check(textsIn(snapPartial).indexOf('子票没数出来') >= 0, '子票没数出来时标题就这么写')

  const listTruncated = cardOf({ ok: true, status: 'ok', tool: 'deck_issue_list', data: { total: 12, returned: 4, truncated: true, issues: [
    { key: '1', title: '一' }, { key: '2', title: '二' }, { key: '3', title: '三' }, { key: '4', title: '四' },
  ] } }, { state: 'closed' })
  check(textsIn(listTruncated).indexOf('共 12 张') >= 0, '名单被截断时脚注写出「显示 4 / 共 12 张」', textsIn(listTruncated).slice(0, 200))
  check(String(listTruncated && listTruncated.title).indexOf('已关闭') >= 0, '清单标题带上「列的是哪一批」')

  const getLong = cardOf({ ok: true, status: 'ok', tool: 'deck_issue_get',
    data: { ticket: { key: '4', title: '长正文', state: 'open' }, body: { mode: 'full', length: 1200, chunks: ['<!-- 机器注释 -->', '# 标题', 'x'.repeat(600)] } } })
  check(textsIn(getLong).indexOf('正文共 1200 字') >= 0, '正文比卡面长时写出「正文共 N 字」')
  check(textsIn(getLong).indexOf('<!--') < 0, '正文开头的机器注释行不进卡面')
  const getSection = cardOf({ ok: true, status: 'ok', tool: 'deck_issue_get',
    data: { ticket: { key: '4', state: 'open' }, body: { mode: 'section', length: 40 } } })
  check(textsIn(getSection).indexOf('不是全文') >= 0, '只读了一段时脚注说清「这一档不是全文」')

  const patchPartial = cardOf(PARTIAL_CASES[3].value)
  const patchRows = childrenOf(patchPartial).filter((n) => n.type === 'list')[0]
  const rows = Array.isArray(patchRows && patchRows.items) ? (patchRows.items as Record<string, unknown>[]) : []
  check(rows.length === 3, '改票：三步各一行', rows.length)
  check(rows.filter((r) => r.tone === 'bad').length === 1, '改票：只有没成的那一行标红', rows)
  check(rows.some((r) => String(r.trailing) === '没成'), '改票：没成的那一行把「没成」写成字（颜色只做加强）')
  check(rows.every((r) => typeof r.title === 'string' && String(r.title).indexOf('#') < 0), '改票：行标题写的是这一步做了什么，不重复票号')

  const planPartial = cardOf(PARTIAL_CASES[6].value)
  check(textsIn(planPartial).indexOf('planId') >= 0, '子票没建全时写清「带同一个 planId 再调一次」')
  check(textsIn(planPartial).indexOf('没建全') >= 0, '子票没建全时标题就这么写')
  const planRows = childrenOf(planPartial).filter((n) => n.type === 'list')[0]
  const planItems = Array.isArray(planRows && planRows.items) ? (planRows.items as unknown[]) : []
  check(planItems.length <= 3, '建计划：建成的票号最多列三行', planItems.length)

  const listRowsNode = childrenOf(cardOf(OK_CASES[1].value, OK_CASES[1].args || {})).filter((n) => n.type === 'list')[0]
  const listItems = Array.isArray(listRowsNode && listRowsNode.items) ? (listRowsNode.items as unknown[]) : []
  check(listItems.length <= 4, '清单类卡最多四行', listItems.length)

  const linkBad = cardOf(BAD_CASES[7].value)
  check(textsIn(linkBad).indexOf('没成') >= 0, '边没接成时行上写明「没成」')

  console.log('— I 不越界：不写绑定、不放按钮、体积留余量 —')
  let maxBytes = 0
  const allViews: Record<string, unknown>[] = []
  for (const group of [OK_CASES, PARTIAL_CASES, BAD_CASES]) {
    for (const c of group) {
      const view = cardOf(c.value, c.args || {})
      if (!view) continue
      allViews.push(view)
      maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(view), 'utf8'))
    }
  }
  check(allViews.length === OK_CASES.length + PARTIAL_CASES.length + BAD_CASES.length,
    '三态假回执每一份都出了卡', allViews.length)
  check(allViews.every((v) => JSON.stringify(v).indexOf('"$"') < 0), '任何一张卡里都没有 {$:…} 绑定')
  check(allViews.every((v) => JSON.stringify(v).indexOf('"action"') < 0), '任何一张卡里都没有 action（第 0 期不能点）')
  check(maxBytes < MAX_BYTES, '最大的一张卡 ' + maxBytes + ' 字节，在 ' + MAX_BYTES + ' 以内')

  printGateResult(GATE, total, failed)
  if (failed > 0) process.exitCode = 1
}

/** 读一份金标准回执：十一份里按前缀取，读不到就当场停——这条门禁的上游就是它。 */
function readGolden(prefix: string): Record<string, unknown> {
  const file = path.join(GOLDEN_DIR, prefix + '.golden.json')
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

main()
