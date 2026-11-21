/**
 * tests/fixtures/4-tool-cards/receipts.ts —— 九张工具卡的三态假回执（地图 #3 · 票 #4）
 *
 * 为什么手写、而不是直接用 tests/tracker-contract/fixtures/golden-receipts 里的金标准回执：
 * 金标准那十一份全是成功态（唯一一份 unsupported 是「progress 参数已退役」的参数报错），
 * 而卡片最要紧的两个分支恰恰是「没做全」（partial）与「什么都没做」（unsupported）——
 * 这两种回执今天没有任何真实样本，只能照着 src/deck/tools/*.ts 里构造它们的那几行手写。
 * 字段名与层级（壳的 status/reason/text/items + data 里的正事）与金标准回执逐格一致，
 * 对不齐的风险由 tests/verify-golden-receipts.ts 那侧兜。
 *
 * 三组各九个工具：OK_CASES 成功、PARTIAL_CASES 只做了一部分、BAD_CASES 什么都没做成。
 * 有两个工具没有 partial 分支（建票与上报今天只有成功和失败两种结果），它们的 partial 案例
 * 故意留空，门禁会断言「这两个工具不出 partial 卡」，而不是硬造一个不存在的中间态。
 */

/** 一份假回执：外层与真实回执同形，data 里放各工具自己的正事。 */
export interface CardCase {
  /** 断言失败时打印的名字，写清是哪个工具的哪一态。 */
  name: string
  /** 回执自己的 tool 字段，卡片靠它认身份。 */
  tool: string
  /** 调用参数：只有 deck_issue_list 的卡会读（括号里写「列的是哪一批」）。 */
  args?: Record<string, unknown>
  /** 整份回执。 */
  value: Record<string, unknown>
}

/** 成功态：九张卡都要画出来，且画的是「成了什么」。 */
export const OK_CASES: CardCase[] = [
  {
    name: 'deck_context 成功',
    tool: 'deck_context',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_context',
      text: '这里是 /root/workspace/code/matt/dsh-mattpocock-skills-deck，后端 github，地图 1 张。',
      data: {
        backend: { id: 'github', source: 'explicit', label: '' },
        repo: {
          backend: 'github',
          refId: 'qawse110/dsh-mattpocock-skills-deck',
          name: 'dsh-mattpocock-skills-deck',
          url: 'https://github.com/qawse110/dsh-mattpocock-skills-deck',
          permissions: { push: true, triage: true },
        },
        workspace: { root: '/root/workspace/code/matt/dsh-mattpocock-skills-deck', key: 'ws-a1b2c3d4', sessionId: 's-1', source: 'exec.agent.session.cwd' },
        initialized: true,
        preflight: { ok: true, message: '' },
        maps: [{ key: '3', title: '技能票台（手机原生面板）', state: 'open', url: 'https://github.com/qawse110/dsh-mattpocock-skills-deck/issues/3' }],
        quota: { perCallPoints: 600, perCallRequests: 400, perHourPoints: 2000, perHourRequests: 1500, maxChildTicketsPerCall: 60 },
      },
    },
  },
  {
    name: 'deck_issue_list 成功',
    tool: 'deck_issue_list',
    args: { state: 'open' },
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_issue_list',
      text: 'ISSUE 列表：共 2 行符合（state=open），回 2 行。',
      data: {
        total: 2, returned: 2, truncated: false, backendTruncated: false, opId: '1762310000000-1',
        issues: [
          { key: '4', title: '落地：9 个 deck 工具接上原生工具卡', state: 'open', type: 'issue', labels: ['ready-for-agent'], assignees: ['qawse110'], parentKey: '3', effortId: 'dsh-go', status: 'claimed', statusConflict: false, updatedAt: '2026-11-21T12:25:54Z', url: 'https://github.com/x/y/issues/4' },
          { key: '10', title: '验收：九张工具卡在真机上画得对', state: 'open', type: 'issue', labels: [], assignees: [], parentKey: '3', effortId: 'dsh-go', statusConflict: false, updatedAt: '2026-11-20T09:00:00Z', url: 'https://github.com/x/y/issues/10' },
        ],
      },
    },
  },
  {
    name: 'deck_issue_get 成功',
    tool: 'deck_issue_get',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_issue_get',
      text: '票 4 读回来了：状态 open，父票 3，被阻塞 1 条。',
      data: {
        ticket: { key: '4', title: '落地：9 个 deck 工具接上原生工具卡', state: 'open', type: 'issue', labels: ['ready-for-agent'], assignees: ['qawse110'], updatedAt: '2026-11-21T12:25:54Z', closedAt: null, url: 'https://github.com/x/y/issues/4', commentCount: 0 },
        body: {
          mode: 'full', length: 620, digest: 'sha256:0123456789abcdef',
          chunks: ['<!-- DSH-FORMAT v1 -->', '# 落地：九张工具卡', '', '在 src/deck/registration 里补 presentationMeta，统一用 toolCard 包住。'],
        },
        commentCount: 0,
        section: null,
        relations: { parentKey: '3', blockedBy: ['11'], blocking: ['10'] },
        landings: { parent: '正文行', blockedBy: '正文行', caveat: '' },
        comments: [],
        dependenciesRaw: null,
      },
    },
  },
  {
    name: 'deck_issue_create 成功',
    tool: 'deck_issue_create',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_issue_create',
      text: '票 24 建好了：把工具卡接上。落在 demo（编号 24）。',
      data: {
        ticket: { key: '24', title: '把工具卡接上', state: 'open', type: 'issue', labels: ['bug'], assignees: [], parentKey: '3', blockedBy: ['4'], url: 'https://github.com/x/y/issues/24' },
        kind: 'issue',
        idempotencyKey: 'key-1',
        limits: { maxChildTicketsPerCall: 60 },
      },
      items: [
        { key: '24', step: 'text', status: 'ok' },
        { key: '24', step: 'labels', status: 'ok' },
      ],
    },
  },
  {
    name: 'deck_issue_patch 成功',
    tool: 'deck_issue_patch',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_issue_patch',
      text: '票 4：这次点了 2 步，成了 2 步。',
      data: { requested: ['comment', 'assignees'], ticket: { key: '4', state: 'open', updatedAt: '2026-11-21T12:30:00Z' } },
      items: [
        { key: '4', step: 'comment', status: 'ok' },
        { key: '4', step: 'assignees', status: 'ok' },
      ],
    },
  },
  {
    name: 'deck_issue_report 成功',
    tool: 'deck_issue_report',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_issue_report',
      text: '票 4 已上报：落地：9 个 deck 工具接上原生工具卡。',
      data: { key: '4', title: '落地：9 个 deck 工具接上原生工具卡', state: 'open', url: 'https://github.com/x/y/issues/4', backendId: 'github', effortId: 'dsh-go', note: '' },
    },
  },
  {
    name: 'deck_map_snapshot 成功',
    tool: 'deck_map_snapshot',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_map_snapshot',
      text: '地图 3：子票 8 张，未关闭 2 张、已关闭 6 张、可接 1 张。',
      data: {
        map: { key: '3', title: '技能票台（手机原生面板）', state: 'open', labels: ['wayfinder:map'], updatedAt: '2026-11-21T12:25:54Z', url: 'https://github.com/x/y/issues/3' },
        children: [
          { key: '4', title: '落地：9 个 deck 工具接上原生工具卡', state: 'open', labels: ['wayfinder:task'], assignees: ['qawse110'], blockedBy: [], statusConflict: false, updatedAt: '2026-11-21T12:25:54Z' },
          { key: '10', title: '验收：九张工具卡在真机上画得对', state: 'open', labels: [], assignees: [], blockedBy: ['5', '4', '7'], statusConflict: false, updatedAt: '2026-11-20T09:00:00Z' },
          { key: '5', title: '落地：四个面板与状态条', state: 'closed', labels: [], assignees: [], blockedBy: [], statusConflict: false, updatedAt: '2026-11-19T09:00:00Z' },
        ],
        stats: { total: 8, open: 2, closed: 6, frontier: 1, claimed: 1, blocked: 1, indeterminate: 0, levels: [['3']], levelOf: {} },
        truncated: false,
        progressOf: {},
        blockedByKeys: [],
        blocks: { destination: '…', notes: '…', decisions: '…', fog: '…', outOfScope: '…' },
      },
    },
  },
  {
    name: 'deck_map_link 成功',
    tool: 'deck_map_link',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_map_link',
      text: '这次要补 1 条边，建成 1 条。',
      data: { requested: 1, done: 1, jobs: [{ key: '10', blockedBy: ['4'] }] },
      items: [
        { key: '10', target: '4', op: 'block', role: 'edge', status: 'ok', evidence: { kind: 'readback', ok: true, text: '写后读回：#10 的被阻塞里有 #4' }, landing: '正文行', ok: true },
      ],
    },
  },
  {
    name: 'deck_map_plan_create 成功',
    tool: 'deck_map_plan_create',
    value: {
      ok: true, status: 'ok', reason: '', tool: 'deck_map_plan_create',
      text: '计划 dshgo-cards：这一片建了 3 张子票（共计划 3 张），建成 2 条边。',
      data: {
        planId: 'dshgo-cards', mapKey: '3', durable: true,
        builtKeys: ['41', '42', '43'], skippedKeys: [], restKeys: [], edges: 2,
        counts: { planned: 3, actual: 3, ok: true, compared: 3 },
        shards: { suggested: 1, perShard: 3, maxChildTicketsPerCall: 60 },
        nextCall: null,
      },
      items: [
        { key: 'map', role: 'map', status: 'ok', title: '技能票台' },
        { key: '41', role: 'child', status: 'ok', planKey: 'C1', title: '第一片' },
        { key: '42', role: 'child', status: 'ok', planKey: 'C2', title: '第二片' },
        { key: '43', role: 'child', status: 'ok', planKey: 'C3', title: '第三片' },
      ],
    },
  },
]

/**
 * 没做全（partial）：标题必须说出「没做全」这件事，标题下第一块必须是 warn 的 callout。
 * 建票与上报没有 partial 这一档（工具实现里只有成功与失败两支），这里不硬造。
 */
export const PARTIAL_CASES: CardCase[] = [
  {
    name: 'deck_context 没读全',
    tool: 'deck_context',
    value: {
      ok: true, status: 'partial', reason: 'backend-timeout', tool: 'deck_context',
      text: '后端 github 认出来了，但地图清单这次没读回来（超时了）。',
      data: { backendId: 'github', partial: true, incomplete: 'timeout', error: { kind: 'timeout', message: 'read timed out after 30000ms' } },
      notes: ['这次是读超时：地图清单没读到，别的照常。'],
    },
  },
  {
    name: 'deck_issue_list 没读全',
    tool: 'deck_issue_list',
    args: { state: 'open' },
    value: {
      ok: true, status: 'partial', reason: 'backend-timeout', tool: 'deck_issue_list',
      text: 'ISSUE 列表这次没读全（超时了）…',
      data: { total: null, returned: 0, truncated: true, backendTruncated: false, issues: [], partial: true, incomplete: 'timeout', opId: '1762310000000-2' },
      notes: ['这次是读超时：名单是空的，不代表一张票都没有。'],
    },
  },
  {
    name: 'deck_issue_get 没读全',
    tool: 'deck_issue_get',
    value: {
      ok: true, status: 'partial', reason: 'backend-timeout', tool: 'deck_issue_get',
      text: '票 4 的外壳读到了，正文这次没读回来。',
      data: { key: '4', backendId: 'github', partial: true, incomplete: 'budget', relations: { parentKey: '3', blockedBy: [], blocking: [] }, error: { kind: 'budget', message: 'budget exhausted' } },
      notes: ['这次是额度不够：票的外壳读到了，正文没读。'],
    },
  },
  {
    name: 'deck_issue_patch 没做全',
    tool: 'deck_issue_patch',
    value: {
      ok: true, status: 'partial', reason: '', tool: 'deck_issue_patch',
      text: '票 4：这次点了 3 步，成了 2 步。',
      data: { requested: ['comment', 'labels', 'assignees'], ticket: { key: '4', state: 'open' } },
      items: [
        { key: '4', step: 'comment', status: 'ok' },
        { key: '4', step: 'labels', status: 'ok' },
        { key: '4', step: 'assignees', status: 'failed', reason: '后端拒绝：认领人 qawse110 不在协作者名单里' },
      ],
      notes: ['有的步骤没成，逐条原因在上面：别把没成的那一步当成已经改好。'],
    },
  },
  {
    name: 'deck_map_snapshot 子票没数出来',
    tool: 'deck_map_snapshot',
    value: {
      ok: true, status: 'partial', reason: 'backend-timeout', tool: 'deck_map_snapshot',
      text: '地图 3 的影子读到了，子票清单这次没读全。',
      data: {
        map: { key: '3', title: '技能票台（手机原生面板）', state: 'open', labels: [], updatedAt: '2026-11-21T12:25:54Z', url: 'https://github.com/x/y/issues/3' },
        children: [], stats: null, truncated: true, progressOf: {}, blockedByKeys: [],
        blocks: { destination: '', notes: '', decisions: '', fog: '', outOfScope: '' },
        kidsError: { kind: 'timeout', message: 'children read timed out' },
      },
    },
  },
  {
    name: 'deck_map_link 没接全',
    tool: 'deck_map_link',
    value: {
      ok: true, status: 'partial', reason: '', tool: 'deck_map_link',
      text: '这次要补 2 条边，建成 1 条。',
      data: { requested: 2, done: 1, jobs: [{ key: '10', blockedBy: ['4'] }] },
      items: [
        { key: '10', target: '4', op: 'block', role: 'edge', status: 'ok', evidence: { kind: 'readback', ok: true, text: '写后读回：#10 的被阻塞里有 #4' } },
        { key: '10', target: '7', op: 'block', role: 'edge', status: 'failed', reason: '后端拒绝：这条边会成环' },
      ],
    },
  },
  {
    name: 'deck_map_plan_create 没建全',
    tool: 'deck_map_plan_create',
    value: {
      ok: true, status: 'partial', reason: '', tool: 'deck_map_plan_create',
      text: '计划 dshgo-cards：这一片建了 2 张子票（共计划 4 张）。',
      data: {
        planId: 'dshgo-cards', mapKey: '3', durable: true,
        builtKeys: ['41', '42'], skippedKeys: [], restKeys: ['C3', 'C4'], edges: 1,
        counts: { planned: 4, actual: 2, ok: false, compared: 2 },
        shards: { suggested: 2, perShard: 2, maxChildTicketsPerCall: 60 },
        nextCall: { tool: 'deck_map_plan_create', planId: 'dshgo-cards', hint: '带同一个 planId、把剩下的子票再传一次' },
      },
      items: [
        { key: '41', role: 'child', status: 'ok', planKey: 'C1' },
        { key: '42', role: 'child', status: 'ok', planKey: 'C2' },
      ],
    },
  },
]

/** 什么都没做（unsupported）：标题必须说「没做成」，标题下第一块必须是 bad 的 callout。 */
export const BAD_CASES: CardCase[] = [
  {
    name: 'deck_context 没读到后端',
    tool: 'deck_context',
    value: {
      ok: false, status: 'unsupported', reason: 'no-backend', tool: 'deck_context',
      text: '这个工作区还没选后端。先选一个，或在锚文件里写清。这次什么都没做。',
      data: {},
    },
  },
  {
    name: 'deck_issue_list 没读回来',
    tool: 'deck_issue_list',
    args: { state: 'closed' },
    value: {
      ok: false, status: 'unsupported', reason: 'backend-threw', tool: 'deck_issue_list',
      text: 'ISSUE 列表没取回来（后端原话：gh: could not resolve repository）。',
      data: { error: { message: 'gh: could not resolve repository' } },
    },
  },
  {
    name: 'deck_issue_get 没读回来',
    tool: 'deck_issue_get',
    value: {
      ok: false, status: 'unsupported', reason: 'backend-threw', tool: 'deck_issue_get',
      text: '票 4 没读回来（后端原话：not found）。',
      data: { key: '4', backendId: 'github', error: { message: 'not found' } },
    },
  },
  {
    name: 'deck_issue_create 没建成票',
    tool: 'deck_issue_create',
    value: {
      ok: false, status: 'unsupported', reason: 'bad-args', tool: 'deck_issue_create',
      text: '父票 3 不存在，这次没建。这次什么都没做：没选后端、没花点数、没写盘。',
      data: { error: { kind: 'parent', message: '父票 3 不存在' } },
    },
  },
  {
    name: 'deck_issue_patch 没改成',
    tool: 'deck_issue_patch',
    value: {
      ok: false, status: 'unsupported', reason: 'backend-threw', tool: 'deck_issue_patch',
      text: '票 4：这次点了 1 步，成了 0 步。',
      data: { requested: ['comment'] },
      items: [{ key: '4', step: 'comment', status: 'failed', reason: '后端拒绝：票已关闭' }],
    },
  },
  {
    name: 'deck_issue_report 没报上',
    tool: 'deck_issue_report',
    value: {
      ok: false, status: 'unsupported', reason: 'no-session-context', tool: 'deck_issue_report',
      text: '这次没有会话上下文，认不出在哪个工作区，没上报。',
      data: { key: '4', backendId: 'github', effortId: 'dsh-go', error: { kind: 'nosession', message: 'no session context' } },
    },
  },
  {
    name: 'deck_map_snapshot 没读回来',
    tool: 'deck_map_snapshot',
    value: {
      ok: false, status: 'unsupported', reason: 'backend-threw', tool: 'deck_map_snapshot',
      text: '地图 3 没读回来（后端原话：not found）。',
      data: {},
    },
  },
  {
    name: 'deck_map_link 没接成边',
    tool: 'deck_map_link',
    value: {
      ok: false, status: 'unsupported', reason: 'bad-args', tool: 'deck_map_link',
      text: '目标票 99 不存在，这次一条边都没接。',
      data: { requested: 1, done: 0, jobs: [] },
      items: [{ key: '10', target: '99', op: 'block', role: 'edge', status: 'failed', reason: '目标票 99 不存在' }],
    },
  },
  {
    name: 'deck_map_plan_create 没建成子票',
    tool: 'deck_map_plan_create',
    value: {
      ok: false, status: 'unsupported', reason: 'bad-args', tool: 'deck_map_plan_create',
      text: '计划 dshgo-cards 的父票 3 不是地图，这次没建。',
      data: { planId: 'dshgo-cards', counts: { planned: 0, actual: 0, ok: false, compared: 0 } },
    },
  },
]
