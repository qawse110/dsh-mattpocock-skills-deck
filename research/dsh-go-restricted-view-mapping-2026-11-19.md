# 网页界面四块面板改画成 dsh-go 受限视图：哪些能原样画、哪些要变形、哪些只能丢

> 调研日期 2026-11-19 · 基线 `d22e0b67`
> 问题：把「地图列表 / 本会话的活 / 票详情 / 设置只读」四块按 dsh-go 的受限 JSON 组件树重画，逐块说清原样表达、变形表达、只能丢三类，并交代现有视图模型里哪些字段能直接复用、哪些必须在宿主侧重算。
> 全程只读：没有改动任何源码、测试或配置，没有提交，没有联网，没有运行 `gh`，没有改动任何票。dsh-go 的协议事实来自已经取回本机的 `/tmp/dshgo-*.md`（文末列出用了哪几份）；仓库事实来自 `src/client/kernel/`、`src/client/views/`、`src/deck/` 与 `src/host/` 的源码；数据规模来自本机快照缓存 `/root/.dsh-mattskillsdeck-cache/FeatherHunter__dsh-mattpocock-skills-deck.json`。

## 一句话结论

**四块都能画，而且四块的组件数、层数与字节数都远在配额之内（最坏的一块 15 个组件、3 层、9.4 KiB，配额是 120 个组件、8 层、32 KiB）；真正卡人的不是总量，而是几条单项上限——list 最多 50 行、table 最多 50 行、keyValue 最多 24 项、一段文字最多 2000 字、`panels` 插槽每插件只有 4 个名额（这四块刚好把名额用满）。现有视图模型里，行的分组与筛选、整仓计数、容器三态、动作归类、在办表视图状态这几样都已经算好了，可以直接复用；必须在宿主侧重算的是分页与截断、排序、Markdown 降级成纯文字、以及依赖「谁在请求」的本会话归属。**

## 一、先把协议的硬约束说清

这五条决定了后面每一块的取舍，先单独列出来，因为后面会反复引用：

1. **没有自定义绘制、没有任意样式、没有自定义字体与尺寸。** 设计规则原文把「作者透明度与渐变」「字体文件、任意字号、行高」「任意尺寸、圆角、定位、层叠」「动画」都列进「不开放」；v2 才补上强调色、六档字号、四档字重、卡片变体与 S/M/L 间距。
2. **文字里的链接与 HTML 不开放。** 替代做法是「按钮 + `link` 效果」。`text` 只认段落、换行、加粗、行内代码四种排版。
3. **图集只有 162 个具名图标，没有安全语义那一类。** 逐个核过：没有 `lock`、`key`、`shield`，也没有 `map`、`target`、`compass`、`person`、`gear`。现成能用的是 `flag`、`bookmark`、`list`、`table`、`play`、`bug`、`wrench`、`fork`、`check`、`warning`、`user`、`clock`、`copy`、`external`、`refresh`、`settings` 这些。
4. **上限分三类，超了怎么处理也不一样。** 视图大小（工具卡 8 KiB / 面板 32 KiB / 状态条 2 KiB）、组件与层数（40/6、**120/8**、8/3）、每个 stack 或 row 的子组件（16、**32**、4）、文字与标签字数（2000/200、**2000/200**、200/200）。超大小或嵌套超 64 层是**整块降级**；其余超限是**截断并在被截组件下标一行小字**。
5. **写操作与输入是两回事。** v1 面板里只有 `actions` 按钮、`list` 行的 `action`、`options`、`confirm` 四种点按入口；v2 才允许受限输入与表单，而且**审批卡、授权按钮、密码框永久不开放**。点按之后落到宿主的 handler，一次最多 4 个效果，3 秒内到达才执行；效果白名单只有 insert、command、open、link、toast、copy、refresh、patch 八种。

关于名额还有一条要单独记住：`panels` 插槽**每插件上限 4 个**、`title` 不超过 16 字。这四块正好用满，再想加第五块（比如拉取请求页或技能页）就没有名额了，只能挤进已有四块之一，或者换成 `session.actions` 之类的别的插槽。

## 二、现有视图模型里已经算好的东西

先交代可复用的底座，后面每块只写「用哪几个」与「缺什么」。

视图模型的内核分四层，从下往上：`src/client/kernel/store-derived.ts` 从快照派生行与计数；`src/client/kernel/deck-view-model.ts` 把「一帧」（工作区 + 库版本）切成九个公开切片；`src/client/kernel/deck-view-binding.ts` 负责建帧、按版本共享、只通知相关切片；各个 `deck-*-detail.ts` 负责容器与票的详情切片。九个切片名是公开契约，写在 `deck-view-model.ts:36`：projection、filters、rows、counts、readout、reading、mapDetail、issueDetail、prList。

| 已经算好的东西 | 位置 | 四块里怎么用 |
| --- | --- | --- |
| 行按状态与占用分三组 | `deck-view-model.ts:205` `deckRowsOf` | 地图列表直接取 `visible` |
| 整仓六个计数 | `deck-view-binding.ts:137` `deckCountsFor` | 列表页三枚 KPI 直接用 |
| 容器三态与配色 | `src/client/kernel/container-view.ts:71` `containerTriState` | 容器行角标与主按钮措辞 |
| 行级动作九选一 | `src/client/kernel/row-actions.ts:49` `rowActionKind` | 列表行与详情页主按钮 |
| 票号徽标的写法 | `src/client/kernel/ticket-label.ts:35` `ticketLabelOf` | 四块里凡是要显示票号的地方 |
| 在办表视图状态机 | `src/client/views/shared/workRouteTable.ts:163` `workRouteTableViewOf` | 「本会话的活」整块 |
| 票详情切片 | `src/client/kernel/deck-issue-detail.ts:104` `deckIssueDetailOf` | 票详情整块 |
| 地图详情切片 | `src/client/kernel/deck-map-detail.ts:80` `deckMapDetailOf` | 地图列表的容器计数 |
| 工作区总览行 | `src/client/views/SettingsWorkspaces.ts:160` `computeWsOverviewRows` | 设置只读整块 |
| 三个开关的当前值 | `src/client/kernel/settings-view.ts:476` `viewFlagOf` | 设置只读的开关格 |

## 三、面板一：地图列表

对应当前界面 `src/client/views/ListTab.ts:120` 的 `ListTab` 与行渲染 `src/client/views/ListTabRow.ts:138` 的 `listIssueRow`。

### 原样表达

- **票号徽标**：`ticketLabelOf` 已经算成 `#目录/编号` 一个字符串，直接当 `list` 行的 `trailing` 或标题前缀。
- **标题**：一行文字，原样。
- **状态**：开放 / 已合并 / 已关闭三态，`IssueDetail.ts:421` 与列表共用同一份判定，画成 `trailing` 里的两个字或 `tone`。
- **标签名**：`x.labels` 里的 name，拼成一行副标题。
- **容器身份**：地图还是规格，`containerKindOf`（`container-view.ts:47`）已经算好，画成 `subtitle` 开头的一个词加图标（地图用 `flag`，规格用 `fork`）。
- **被阻塞**：`blockedBy` 已经是编号数组（`src/host/tracker/snapshotAssemble.ts:258` 的 `normalizeTicket` 压好的），`trailing` 写「被 N 张挡着」。
- **更新时间**：`updatedAt` 截成 `YYYY-MM-DD`。
- **三枚 KPI**：可接 / 阻塞 / 已关闭，`deckCountsFor` 直接给三个数，画成一行三个 `metric`（这是设计规则推荐的用法）。
- **计数未取全的提示**：`kpiState.complete === false` 时界面写「已知 N 张（未取全）」（`ListTab.ts:347`），这段可以放进 `caption` 或一句 `text`。

### 变形表达

- **容器迷你圆环**（`ListTabRow.ts:359` 的 `ringOf`，画「已关闭 / 总数」的小环）：圆环要靠 `progress` 组件，但它是整块一个进度条，塞不进 list 的一行。变成 `trailing` 里的 `3/7` 两个数字。
- **行内主按钮三态**（拆票 / 执行 / 完成，措辞与颜色来自 `containerTriState`）：list 的一行只能带一个 `action` 且只显示箭头，不能显示按钮文字。变成「点这一行进入票详情」或「点这一行直接执行」的二选一，按钮文字挪到详情页的 `actions`。
- **标签 chip 的颜色**：标签颜色是数据里带的十六进制色（`label.color`），受限视图里没法给单个标签上底色。变成纯文字，最多用一个 `tone` 表达「有标签」。
- **作者头像**：现在按作者算 12 种颜色（`ListTabRow.ts:358`）。变成 `user` 图标加 `@login`。
- **已选标签过滤条与筛选行**（`ListTab.ts:353-357` 的吸顶块）：`row` 里放一组 `actions`，最多 4 个；状态筛选五档（all/open/closed/blocked/frontier）放不下，得变成 `options`（最多 8 个选项，够用）。
- **「+N 更多」**（`ListTabRow.ts:368`，现在固定写 `+0`）：变成副标题末尾的 `+N` 文字，不能再点开。

### 只能丢

- **悬停看全文**：整行只用一行文字，超出就截断，没有提示可看（`list` 的行没有悬停态）。
- **标签的十六进制颜色与深浅底色**：没有任意样式。
- **骨架屏与首屏加载动画**（`ListTab.ts:439-445`）：动画由 App 统一，插件不能画，只能用一句「正在读取」。
- **行的多工作单元目录签**（`mdEffortRowNode`）：多工作单元时可以降成一句说明，单独的可点目录签放不下。
- **首屏骨架、下拉淡入这类过渡**：同上，属于动画。

### 可复用与要重算

能直接复用：`deckRowsOf`（分组）、`deckCountsFor`（三枚 KPI 与「未取全」标记）、`containerKindOf` 与 `containerTriState`（身份与措辞）、`ticketLabelOf`（票号）、`normalizeTicket` 补好的 `blockedBy` 与 `claimedBy`。

必须重算：**排序**。`ListTab.ts:216-236` 的 `sortIssues` 住在视图层，按编号数值、标题 localeCompare、其它字段字符串比较三档，同键还要先按工作单元再按编号兜底。宿主拿到的行没有按会话的排序偏好排过，得在宿主侧重跑一遍。**分页与截断**同理：`list` 最多 50 行，整仓 1870 张票必须切片（本机快照的 `deck.counts` 就是 open 62 / closed 1808 / total 1870）。

### 配额粗估

| 结构 | 组件数 | 层数 | 字节 |
| --- | --- | --- | --- |
| 20 行 list + 3 枚 metric + 一行说明 | 7 | 3 | 3 788 |
| 推到 list 上限 50 行 | 7 | 3 | 5 742 |

远在 120 个组件、8 层、32 KiB 之内。唯一的风险是有人想一次画完整仓 1870 张票——那会在 `list` 的 50 行上限处被截断，所以必须分页，而不是改结构。

## 四、面板二：本会话的活

对应当前界面的在办表浮层 `src/client/views/shared/workRouteTable.ts:347` 的 `WorkRouteTable` 与行 `:282` 的 `WorkRouteRow`，入口在 `src/client/panel/Dock.ts:381` 的 `WorkRouteTrigger`。

### 原样表达

这张表本来就是六列规整数据，是四块里最贴合 `table` 组件的一块：

- **六格里五格原样直出**：票号（`ticketKey`，可再经 `ticketLabelOf` 拼目录）、标题、会话名、动作词、时间（`workRouteTableClock` 已经处理成「同日只给时分、跨天带月日」）、在办或陈旧。
- **陈旧条数**：`workRouteTableViewOf` 算好的 `staleCount`，画成一枚 `metric`（数字加橙色 `tone: warn`）。
- **表格的更新时间**：`view.at`，一行 `text` 带 `tone: muted`。
- **四种状态**：idle / empty / unreadable / ok 已经在同一个函数里判完，前三种各对一句 `callout` 或 `emptyState`（`emptyState` 是 v2，老 App 不认，要用 `text` 兜底）。
- **点一行进票或进地图**：`workRouteNavOf`（`workRouteTable.ts:215`）已经分好「容器进地图页、其余进票页」，直接当 `action`。

### 变形表达

- **「本会话」小标**（`WorkRouteRow` 里 `currentSession` 为真时加一枚标记）：table 的单元格里放不下徽标，变成会话名后面加「（本会话）」四个字，或者给整行加一行前缀。
- **整行悬停给全标题与全时刻**：丢悬停，改成把标题截到 30 字左右、时刻直接给完整的 `YYYY-MM-DD HH:mm`（table 有 8 列可用，横向能滑动）。
- **在办绿 / 陈旧灰两色**：`table` 单元格只能靠 `tone`，或者把这一格写成文字「在办 · 陈旧」。
- **六列的固定宽度**（`WORK_ROUTE_TABLE_CELLS`，`workRouteTable.ts:244`，56px 加两段 minmax 那串）：宽度写死是网页版的排版，受限视图里定不了像素，只能定列顺序与对齐方式（给时间列 `align: 'end'`）。
- **按会话分组、当前会话排第一**（`src/deck/tools/work-route.ts:170-197`）：`table` 没有分组，变成一张平表，当前会话的行放最前，或者一个会话一张 `list`。

### 只能丢

- **progress 那一格**：`WorkRouteTableRow`（`workRouteTable.ts:130-141`）的类型里还留着 `progress?`，但 #1352 起 `deck_issue_report` 已经不再收进度，在办表条目里也没有这一格（`src/deck/shell/work-path-readout.ts:39` 的 `WorkPathReadoutEntry` 没有 progress）。也就是说这一格是类型上的残留，画的时候直接不要。
- **680 像素的最小宽度与浮层定位**：`WORK_ROUTE_POPOVER_MIN_WIDTH = 680`，受限视图里没有浮层也没有最小宽度，整块变成面板里的一个 stack。
- **整行提示的两段式（完整标题小字 + 全文）**：没有悬停。
- **unreadable 时的 reason 原文**：那是宿主给的机器码（例如 `host.work-route.shape`），面向第一次阅读的人要翻译成一句人话，原始码可以不画。

### 可复用与要重算

能直接复用：`workRouteTableViewOf`（`workRouteTable.ts:163`，四种状态与逐条字段挑选）、`WorkRouteTableRow` 的八个字段、`workRouteTableClock` 与 `workRouteTableStamp`（时间的两种写法）、`workRouteNavOf`（点去哪）。

必须重算：**哪条算「本会话」**。`currentSession` 是宿主按请求方算出来的，不是数据里存着的；所以 `src/client/kernel/work-route-own.ts:27` 专门有一个 `snapshotWithoutWorkRoute`，把这一列剥掉再交给别的会话用。同理 `ownWorkRouteKeyOf`（:39）是「会话号 + 工作目录」两段拼的键，说明这份读数随请求方而变，不能跨会话缓存。**截断条数**也要重算：`projectWorkPathReadout`（`work-path-readout.ts:225`）在 core 档只留最近 20 条（`CORE_CLIP = 20`），其余条数记在 total 里；到了受限视图，table 又是 50 行上限，两处上限要合成一处口径。

### 配额粗估

| 结构 | 组件数 | 层数 | 字节 |
| --- | --- | --- | --- |
| 6 列 20 行 + 2 枚 metric + 一行说明 | 5 | 3 | 3 049 |
| 推到 50 行 | 6 | 4 167 |

远在配额之内。

## 五、面板三：票详情

对应当前界面 `src/client/views/IssueDetail.ts:68` 的 `IssueDetail`，评论段在 `src/client/views/IssueDetailComments.ts:36`。

### 原样表达

- **票号、标题、状态**：`IssueDetail.ts:419-421` 三联里前两件直接画成 `text`，状态画成 `trailing` 或一枚 `metric`。
- **元信息行**（:423-441）：标签名、@ 指派人、更新日期、创建日期、作者、关闭日期，六个都是字符串，`keyValue` 一行放一个正好（上限 24 项，这里用 6 项）。
- **父地图条**（:442-447）：一句「属于 #N 标题」，可点的部分变成 `list` 的一行或 `actions`。
- **子票列表**（:454-467）：每张子票有编号、标题、状态，天然是 `list` 的行。
- **被阻塞列表**（:469-483）：每条有编号与标题，同上。图标从 `lock` 换成 `warning`（图标表里没有锁）。
- **关系未知时的一句说明**（`proj.relationsNotice`）：直接一句 `text` 或 `callout`。
- **「只读」提示**（:490-493）：一句 `callout`（`tone: info`）。
- **评论条目**：作者、时间、正文，每条画成一段 `text`（正文降级见下）。
- **报错与重试**（:400-415）：错误类型（`errView.kind`）、一句人话、重试按钮，`callout` 加 `actions` 一组，正好对上。

### 变形表达

- **正文 Markdown**：`mdToHtml`（`src/client/views/shared/md.ts:236`）支持的子集是段落、粗斜体、行内代码、删除线、有序无序列表（含任务项）、表格、围栏代码块、标题、水平线、引用块、https 图片。到了 `text` 只剩段落、换行、粗体、行内代码四样：**标题降成加粗的一行、列表降成带短横线的普通行、表格降成逐行的「名称：值」、引用块降成缩进文字、围栏代码块降成行内代码**。
- **正文长度**：`text` 上限 2000 字，而本机样本里正文中位数 1497 字、p90 6949 字、最长 14368 字，**近四成票（22/56）的正文超过 2000 字**。变成「截前 1900 字 + 一句『正文共 N 字，完整内容请到桌面端查看』」，或者拆成多段 `text`（但每段各自 2000 字上限照样生效）。
- **状态 chip 的颜色与图标**：开放时是实心圆点、关闭时是勾，两色由 `stateColor` 给。变成 `tone` 一档加文字，或者用 `check` 图标（图标表里没有实心圆点，得用 `pending` 或 `running` 代替）。
- **顶栏六件**（:370-399：返回、面包屑、工作单元签、快照提示、主按钮、新会话、复制、外链）：`actions` 最多 4 个、至多一个 primary。变成「主按钮 + 新会话 + 复制 + 外链」四颗，返回交给 App 的导航，面包屑降成一行 `text`。
- **评论的分页与「已显示 x / 共 N」**：评论一次最多给 5 条（样本里单票最多 10 条），其余用一行 `text` 报总数，配一个 `actions` 的「加载更多」。
- **可写态与只读态的切换**：现在靠 `readOnlyKnown`（:490，判据是拉取请求一律不可写、快照投影且评论不可用也不可写）在视图里算。到了受限视图，输入框根本没有，这段判定变成「要不要画那一句只读提示」。

### 只能丢

- **评论输入框**（`IssueDetailComments.ts` 里的多行输入框加发送按钮加「Markdown · 回车发送」小字）：v1 完全没有输入；v2 的受限表单也只允许声明式字段，往 GitHub 发评论这种写操作要走宿主的 `command` 效果，等于把「发评论」变成「调一个斜杠命令」。**这块是四块里丢得最狠的**。
- **正文里的图片**：`mdToHtml` 认得 https 地址并让用户点开放大，`text` 里链接只显示文字、图片画不出来；`image` 组件只收 `asset:` 清单内文件或 64 KiB 以内的内嵌数据，而票正文里的图是外链。所以图片一律丢。
- **悬停看全文**（标题、标签、被阻塞票的提示）：没有悬停态。
- **作者头像的 12 色**：没有任意颜色。
- **代码块的等宽排版与横向滚动**：`text` 只有行内代码，围栏代码块降级成普通文字，缩进和换行能留，等宽留不住。
- **点图放大的浮层**（`mdImgOverlay`）：没有浮层。
- **原始错误文本**（:400-415 的 `rawBlock`）：可以留一句短的，整段原始 JSON 应该丢，超了还会触发 2000 字截断。

### 可复用与要重算

能直接复用：`deckIssueDetailOf`（`deck-issue-detail.ts:104`，已经把投影行与详情合成一片）、`knownTotalOf`（:66，评论总数三选一）、`deck-issue-detail.ts:36` 的 `DeckIssueComments`（nodes / known / unknown / hasMore / total 五格正好够画分页）、`tStatus` 与 `tStatusLabel`（`src/client/views/shared/ticket.ts:23`、:30）、`ticketLabelOf`。

必须重算：**Markdown 降级成纯文字**（`mdToHtml` 是造 DOM 的函数，宿主侧没有 DOM，要另写一个「Markdown 转纯文字」的降级器，只保留粗体与行内代码两个标记）。**正文截断到 1900 字**与**评论分页**（协议上限决定的，视图模型不知道这两条上限）。**只读态判定**（`readOnlyKnown` 现在在视图里算，拉取请求标记与「评论是否未知」两边都要搬到宿主）。**主按钮该显示哪几个字**：`containerTriState` 给的 `labelKey` 是翻译键，要在这里翻成中文。

### 配额粗估

| 结构 | 组件数 | 层数 | 字节 |
| --- | --- | --- | --- |
| 正文截 1900 字 + 8 行子票 list + 一段 callout | 11 | 3 | 5 503 |
| 最坏（正文 2000 字 + 8 行子票 + 3 段评论） | 15 | 3 | 9 402 |

仍在 120 个组件、8 层、32 KiB 之内。**注意字节数里最大的一块是正文本身**（1900 汉字约 5 725 字节），所以正文截断既是字数上限也是字节预算的主要去处。

## 六、面板四：设置只读

对应当前界面 `src/client/views/SettingsPage.ts:79` 的 `SettingsPage` 与 `src/client/views/SettingsWorkspaces.ts:296` 的 `renderWsOverview`。

### 原样表达

- **版本号**：`__DSW_VERSION__`（`src/client/index.ts:86` 声明，`SettingsPage.ts:117` 去掉前缀 v），一行 `text`。
- **工作区计数**：`computeWsOverviewRows`（`SettingsWorkspaces.ts:160`）返回 `{ rows, total, boundCount }`，两个数字画成 `metric`（工作区 N / 已绑定 M）。
- **每个工作区的三件事**：显示名（`wsDisplayOf`，:133，最短唯一后缀）、后端名、来源（explicit / matches / fallback 三档）。这三件是 `keyValue` 或 `table` 的天然内容。
- **三个开关的当前值**：`viewFlagOf`（`settings-view.ts:476`）给出 statusBar / deckTools / suggest 三档，只读面板只显示「开 / 关」。
- **未绑定工作区的提示**：`wsUnboundHintOf`（:145）给的 wait / check 两档，翻成两句人话。

### 变形表达

- **三个开关**（每行三个可点的开关）：只读面板里不能点。变成 `keyValue` 的一行「状态栏：显示 / 隐藏」。**如果将来要能改**，只能走 `actions` 加 `patch` 效果（16 KiB 以内的 JSON Merge Patch），但那就不再是「只读」了。
- **标题行的图标**：现在用 `compass`，图标表里没有，换成 `settings`。
- **联系 / Star / Issue 三枚外链**（`DeckHeaderActions`，转发到 dsh-featherhunter-plugin-base 包的 `ActionCluster`）：变成三颗 `actions` 配 `link` 效果（只收 https、2048 字符以内、每次点都弹确认）。注意 `actions` 上限 4 颗，三颗外链加一颗刷新正好。
- **工作区列表的分组折叠**（`renderWsOverview` 是 details 加 summary）：受限视图里没有折叠，变成一整段 `list`，或者一个 `actions` 加一个 `refresh` 效果。
- **刷新按钮**：`refresh(id)` 是协议里的现成能力，一颗 `actions` 就够。

### 只能丢

- **调试日志分组的五个交互**（`SettingsPage.ts:136` 的 `DiagnosticLogSection`：导出今天 / 打开目录 / 复制路径 / 清空）：这是 `src/client/views/diagnosticLog/DiagnosticLogSection.ts` 里自带五个局部状态的组件（开关过渡、忙互斥、清空确认、行内闪光、导出回执）。复制路径能走 `copy` 效果，其余的导出与清空都是宿主的文件操作，只能丢，或者降级成「开关的当前值 + 一句说明」。
- **作者插件卡**（`SettingsPage.ts:140` 的 `DeckAuthorPlugins`，转发到第三方包的 `AuthorPlugins`）：第三方渲染，受限视图里没有对应组件，整块丢。
- **更新入口**（`UpdateEntryHost`）：那是另一个插件的组件，丢。
- **提示条的 toast 与状态小字里的圆点**：toast 有 `toast` 效果可替代，圆点没有图标可替。
- **来源 chip 的三色**（explicit 绿 / matches 蓝 / fallback 灰）：变成文字，或用 `tone` 一档。
- **路径的悬停看全文**（用 `HoverTip` 给全部原样路径）：没有悬停，长路径只能截断或换行。

### 可复用与要重算

能直接复用：`computeWsOverviewRows`（合并、排序、boundCount 都算好了）、`wsSuffixKeepOf` 与 `wsDisplayOf`（最短唯一后缀）、`wsUnboundHintOf`、`viewFlagOf`、`settingsViewLoad`（`settings-view.ts:414`，每次打开重读设置文件，见 #1802）、`__DSW_VERSION__`。

必须重算：**工作区名单要现读**。`settingsViewLoad` 的约定是「每次打开都重读 `~/.dsh/mattskillsdeck/settings.yaml` 与宿主的工作区清单」，而受限视图的数据函数每次 emit 都要给完整数据、限 4 Hz——所以面板侧要自己决定是「打开时读一次」还是「每次 emit 都读」。**开关的三档值现在住在设置文件里**（`VIEW_FLAG_SEED_NAMES`，`settings-view.ts:111`，缺省 statusBar 隐藏、deckTools 开、suggest 开），宿主侧要先落到数据对象里再绑定，不然视图里写死默认值会跟设置文件不一致。

### 配额粗估

| 结构 | 组件数 | 层数 | 字节 |
| --- | --- | --- | --- |
| 标题 + 2 枚 metric + 一张表 + 一段 callout | 6 | 2 | 622 |
| 最坏（多两行工作区） | 6 | 2 | 776 |

四块里最轻的一块，配额毫无压力。

## 七、四块的配额汇总

| 面板 | 组件数 | 层数 | 字节 | 是否在配额内 |
| --- | --- | --- | --- | --- |
| 地图列表 | 7 | 3 | 3 788（50 行时 5 742） | 是 |
| 本会话的活 | 5 | 3 | 3 049（50 行时 4 167） | 是 |
| 票详情 | 11 | 3 | 5 503（最坏 9 402） | 是 |
| 设置只读 | 6 | 2 | 622（最坏 776） | 是 |

对照配额（面板 32 KiB / 120 个组件 / 8 层，每个 stack 或 row 最多 32 个子组件），四块全都有很大余量。**结论是配额不是这次改造的瓶颈，瓶颈在三处**：一是 `panels` 只有 4 个名额，四块正好占满；二是 list / table 的 50 行与 keyValue 的 24 项，决定必须分页；三是 `text` 的 2000 字，挡掉近四成票的完整正文。

字节数的口径说明：上面每个数字都是把真实结构的 JSON 用 node 序列化之后数的字节，不是估的。单条 list 行（含 title、subtitle、trailing、icon 四个字段）约 157 字节；1900 个汉字的一段 `text` 约 5 725 字节；50 行 3 列的 `table` 约 3 354 字节。汉字在 JSON 里是 UTF-8 三字节，所以文字内容的字节数总是比直觉大。

## 八、必须在宿主侧重算的七件事

这一节把前面四块里散落的「要重算」收成一束，理由都是同一类：**这些逻辑今天住在视图层或浏览器里，而受限视图的数据函数跑在引擎侧**。

1. **分页与截断**。list 50 行、table 50 行、keyValue 24 项、text 2000 字，四条上限视图模型完全不知道。而整仓有 1870 张票、正文 p90 有 6949 字——分页策略必须自己定，不能依赖数据源已经是切片好的。
2. **排序**。`ListTab.ts:216-236` 的 `sortIssues` 在视图里，三档排序键加两级兜底。宿主拿到的行是按快照顺序给的，不是按会话偏好排的。
3. **Markdown 降级**。`mdToHtml`（`shared/md.ts:236`）造 DOM，宿主没有 DOM。要另写一个只保留粗体与行内代码的降级器，并且把表格、列表、围栏代码块都摊平成普通行。
4. **本会话归属与在办表的当前条目排序**。依赖请求方的会话号，见 `work-route-own.ts:27,39` 与 `work-path-readout.ts:225`。
5. **只读态判定**。`IssueDetail.ts:490` 的 `readOnlyKnown` 把拉取请求标记、评论是否可用、评论是否未知三个条件拼在一起，散在视图里。
6. **相对时间的写法**。`workRouteTableClock`（`workRouteTable.ts:90-99`）按「同一天只给时分、跨天带月日」写，判断要用当前时刻。面板每 4 Hz 可以重新 emit，但时间文案要自己算。
7. **翻译键落地**。`containerTriState` 给的 `labelKey` 与 `titleKey`、`rowActionText` 给的文案、`truthNoticeLines` 的状态句，都是 `tr()` 的键，取值要在宿主侧完成（协议要求中文全角标点，而且按钮的文案有字数上限）。

反过来，**不**需要重算的也值得点明，免得重复劳动：行的分组与筛选（`deckRowsOf`）、整仓计数与「未取全」标记（`deckCountsFor`）、容器三态与动作归类（`containerTriState` 与 `rowActionKind`）、票号写法（`ticketLabelOf`）、在办表的四种状态（`workRouteTableViewOf`）、工作区总览的合并排序（`computeWsOverviewRows`），这六样都是纯函数，输入确定输出确定，直接拿结果用。

## 九、建议的下一步

1. **先做「设置只读」这一块**。它最小（6 个组件、622 字节）、数据源最干净（`computeWsOverviewRows` 一个纯函数）、也不需要分页，是验证「宿主侧组装视图 + 绑定数据」这条通路是否跑得通的最短路径。
2. **再做「本会话的活」**。六列正对 `table`，`workRouteTableViewOf` 已经把状态机与字段都挑好了，唯一的坑是本会话归属要现读。这块能顺带把「绑定与 4 Hz 补丁」验证一遍。
3. **「地图列表」与「票详情」放后面**。这两块要先把三件事定下来：分页策略（50 行一页还是无限滚动换页）、正文截断后怎么引导用户去看全文、评论的写入口怎么处理（要不要走 `command` 效果）。
4. **四块占满 `panels` 的 4 个名额**。如果要加第五块（拉取请求页、技能页、版本控制页），得先决定是塞进这四块之一，还是把某一块的入口挪到 `session.actions` 之类的别的插槽。这个决定应该在动手前做，不然写完之后没有名额可用。

## 十、还没查清的部分

1. **`text` 里粗体与行内代码的标记会不会计入 2000 字**：上限表只写「文字 2000 字」，没说标记符号算不算。如果算，正文可用字数要再打折扣。
2. **`table` 的单元格里能不能放 `tone` 或图标**：原文只说「整列是数字时自动右对齐」「放不下时横向滑动」，没说单元格支持富内容。如果不能，在办表的「在办 / 陈旧」只能写成文字。
3. **面板数据函数 4 Hz 与 32 KiB 的实测行为**：协议写了「每次 emit 给完整数据、桥接算差量、限 4 Hz、限 32 KiB」，但没写超了是丢帧、合并还是报错。四块里只有「票详情」的正文接近上限，需要真机试一次才能确认会不会被静默丢弃。
4. **v2 的输入与表单到底能做到什么程度**：能力边界原文只说「v2 允许受限输入与表单，但没有审批卡样式和密码框」，本机取回的原文里没有输入组件的字段清单。这直接决定评论能不能在手机上面板里写。
5. **老 App 不认 `emptyState`、`gallery`、`metric.trend` 时要怎么兜底**：原文说「旧 App 忽略不认识的键」，但这次四块如果想用 `emptyState` 画空态，就得同时准备 `text` 的降级写法，这个双写规则原文没有明说。
6. **面板在 `chat.panel` 与 `session.tab` 两种位置下的可用高度**：`placement` 可以是 session.tab、features、chat.panel、plugin 四个位置，但原文没有说清弹层形态下的可视高度会不会挤压表格的横向滑动。
7. **评论的写入口**是否真的要走 `command` 效果：效果白名单里有九种之一就是斜杠命令（参数 500 字以内），但没有现成的「发一条评论」命令，这条路要不要新开命令没有核实。

## 十一、来源

- 协议：`/tmp/dshgo-components.md`（组件字段与上限表）、`/tmp/dshgo-slots.md`（插槽与面板名额）、`/tmp/dshgo-README.md`（协议总览）、`/tmp/dshgo-actions.md`（动作与效果白名单）、`/tmp/dshgo-quickstart.md`（工具卡）、`/tmp/dshgo-checklist.md`（发布前自查）、`/tmp/dshgo-design-rules.md`（不开放清单与组件选择建议）、`/tmp/dshgo-capabilities.md`（能力边界）。这八份都是已经取回本机的原文，本次直接读文件，没有联网。
- 仓库：`src/client/kernel/`（视图模型、绑定、各详情切片）、`src/client/views/`（列表、详情、设置、在办表的渲染）、`src/client/panel/`（页签分发）、`src/deck/`（工具回执与在办表读数）、`src/host/`（快照装配与分页）。行号以基线 `d22e0b67` 为准。
- 数据：`/root/.dsh-mattskillsdeck-cache/FeatherHunter__dsh-mattpocock-skills-deck.json`（抽样快照）与 `~/.dsh/mattskillsdeck/settings.yaml`（本机设置）。规模口径提醒：这份缓存里只有 70 行 issue，而整仓计数记的是 1870 张，估算分页时要用后者。
