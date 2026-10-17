# 单页桌面 + 应用目录 · 开发与排障笔记

> 归属：本 fork（`QINQJnina/doremy.float.phone`）自加功能，**不在官方主线内**
> 用途：记录这套功能的结构、踩过的坑、以及排查方法。给未来的自己（和接手的人）
> 一条不用重新推理的线索——尤其是"为什么这么改""当时是怎么想的"。
> 生成方式：逐文件读源码 + 真机实测。**没验证的明确标「待验证」，不把推断写成结论。**

为什么需要这份文档：单页首页是集中两天加完的，改动横跨 React / CSS / 键盘交互三处，
出问题时如果只靠口述复述，很容易"一点一点重讲一遍还讲乱"。文档的作用是让下次排查
从"我昨天到底改了什么"直接跳到"这两个症状分别对应哪一层"。

---

## 零、实证等级约定

沿用 `docs/fork-changes-overview.md` 的规矩：

- **【实证】**——读过源码 / 真机实测过，文件名、行号、机制都核对过，可照着改。
- **【半实证】**——读了主文件，调用链没走完，方向可信、细节可能有偏。
- **【推断】**——只依据提交信息或工具摘要，**按它动手前必须先读文件**。
- **【待验证】**——已修或已改，但还没有真机确认过的。

⚠️ **本仓库有一条铁律：不信任"对比摘要"数字，只信任直接读到的文件内容。**
理由见 K4。

---

## 一、时间线（15 个提交）

相对上游 `doremy1203/doremy.float.phone:main` 领先 15 个提交，全部集中在 2026-10-16 → 10-17。

| # | 提交 | 标题 | 要点 |
|---|---|---|---|
| 1 | `6f36b26c2a` | feat: 新增「单页桌面」形态 | 与多页桌面一键切换，只改"怎么摆" |
| 2 | `6b41e9a60d` | feat: 应用目录收进按钮 | 点开为一整页全屏清单 |
| 3 | `85ef0ef371` | feat: 切换收进主题 App | 目录按钮移到右下角悬浮 |
| 4 | `71720cd52f` | fix: 「桌面形态」入口未显示 | 菜单渲染白名单漏加 `desktop` 分区 |
| 5 | `22c33035c4` | style: 仪表盘式卡片分组 | 目录加分组 + 搜索 |
| 6 | `c8a3dc544e` | fix: 目录分组无法滚动 | 见 K5；去掉重复的"全部 ›"入口 |
| 7 | `705d273e0c` | perf: 修复滚动掉帧 | 收敛嵌套毛玻璃，见 K6 |
| 8 | `3d2a2269b3` | Merge PR #1 | feature/single-page-desktop |
| 9 | `f3e6979aa5` | feat: 内容解耦 | 「常用」独立清单 + 组件区上移 |
| 10 | `072e019cc0` | feat: 常用改用卡片网格 | 复用设置/外观 App 的 `CardGrid` |
| 11 | `34c0730fc8` | style: 单页微调 | 居中大图标、胶囊条更透、底部留白 96→56px |
| 12 | `ecc6467cc8` | fix: 单页日历 3x2 | 日期行不再挤在一起 |
| 13 | `62bba951ce` | feat: 组件开放完整目录 | 不再限定手挑的 7 个（含 DIY） |
| 14 | `c047a78adf` | feat: 组件单独调尺寸 + 隐藏名称 | `singleWidgetSizes` / `singleWidgetLabels` |
| 15 | `f741b40290` | fix: 目录标题/搜索框被滚出视野 | 本次主线，见 K1 【待验证】 |

---

## 二、功能结构

### 2.1 涉及文件 【实证】

| 文件 | 职责 |
|---|---|
| `components/desktop-shell.tsx` | 桌面壳主体；单页/目录的渲染、状态、键盘 hook 都在这里 |
| `lib/desktop-layout-storage.ts` | 形态持久化（键 `ai_phone_desktop_view_mode_v1`）、dock/单页清单存取 |
| `styles/desktop-single.css` | 单页形态专属样式，选择器全部限定在 `.desktop-single` / `.ds-*` |
| `styles/phone-shell.css` | 手机外壳、移动端媒体查询、`.app-root` |
| `lib/theme-types.ts` | `ThemeProfile.statusBarDropPx`（「状态栏占位上移」） |
| `lib/kv-db.ts` | 主题配置实际存在 IndexedDB 的 `AiPhoneKvDB`，键 `ai_phone_theme_profile_v1` |

### 2.2 形态切换 【实证】

```ts
const [desktopViewMode, setDesktopViewMode] = useState<DesktopViewMode>("paged");
// paged  = 原多页翻页桌面（官方行为，一行没动）
// single = 单页桌面（组件 + 常用 + 右下角目录悬浮钮）
```

- 存储键：`ai_phone_desktop_view_mode_v1`
- 入口：**主题 App → 桌面形态**（注意：早期因菜单白名单漏了 `desktop` 分区导致入口不显示，见提交 4）
- 设计原则：**只改变"怎么摆"，图标布局 / 组件位置 / 主题都不动**，两种形态随时互切

### 2.3 目录页 DOM 结构 【实证】

```
<div class="ds-directory">            ← 整屏覆盖层，position:absolute; inset:0; z-index:700
  <div class="ds-dir-head">           ← 标题「应用目录」+ 关闭钮（flex:none，固定）
  <div class="ds-dir-search">         ← 搜索框（flex:none，固定）
  <div class="ds-dir-scroll">         ← 唯一滚动区（flex:1 1 auto; overflow-y:auto）
    <section class="ds-card ds-dir-group">  ← 每个分组一张卡
      <div class="ds-dir-group-head">       ← 分组名 + 数量
      <div class="ds-grid">                 ← 四列网格
        <div class="ds-dir-cell"> … <button class="ds-pin">  ← 图标 + 钉进常用
```

**关键层级约定：外层不滚、内层滚。** 这个约定是 K1 的成因，也是修复的依据。

### 2.4 目录入口按钮 【实证】

```css
.ds-dir-fab {
  position: absolute;
  right: 18px;
  bottom: calc(var(--dock-height, 92px) + var(--home-dock-lift, 0px) + 22px);
  z-index: 60;
}
```

判定「你手机上跑的是不是最新代码」有个零成本方法：**看单页桌面右下角有没有这个 ✦ 悬浮钮。**
有 = 新代码已生效；没有 = 不是这份代码。

---

## 三、踩坑台账

### K1. 点搜索框后「应用目录」标题/搜索框消失 【实证成因 / 修复待验证】

**症状**
- 打开应用目录，标题和搜索框正常显示
- 点一下搜索框（键盘弹起）→ 标题和搜索框**消失**
- 收起键盘 → 它们**自己回来**
- 全程 DOM 和 CSS 一个字都没变

**机制（这是最反直觉的一点）**

`overflow: hidden` **不是"不能滚动"，而是"不显示滚动条"**——它的 `scrollTop` 依然可以被改。
输入框聚焦时，浏览器为了把输入框滚进视野（focus scroll），会去滚动某个祖先容器的 `scrollTop`；
键盘收起后浏览器又把它滚回 0。于是看起来像"元素时有时无"，实际是**容器的滚动位置变了**。

项目里三个容器都用了 `overflow: hidden`：`.app-root`、`.phone-shell`、`.ds-directory`。
`.ds-directory` 顶部内边距只有 `calc(var(--status-bar-height,36px) + 12px)`，
本身就是「刚好够」的量，**一旦整页被滚，最先出界的就是标题和搜索框**。

**修复**

三处 `overflow: hidden` → `overflow: clip`：

| 文件 | 选择器 |
|---|---|
| `styles/phone-shell.css` | `.phone-shell` |
| `styles/phone-shell.css` | 移动端媒体查询内 `.app-root` |
| `styles/desktop-single.css` | `.ds-directory` |

`clip` 与 `hidden` 视觉完全一致（都裁掉溢出），但 **`clip` 不生成滚动容器**，
focus scroll 动不了它。

**⚠️ 绝对不要给这两个加 `clip`**——它们是真正需要滚动的区域，加了就滚不动了：

- `.desktop-single`（首页常用/组件的滚动列表，`overflow-y: auto`）
- `.ds-dir-scroll`（目录内部分组滚动区，`overflow-y: auto`）

**⚠️ `clip` 不创建滚动容器，会影响 `position: sticky` 的参照系。**
项目里有 sticky 的地方（如聊天联系人页字母索引）。若哪处 sticky 表现异常，
先只撤 `.phone-shell` 那条、保留另外两处——症状在目录页，`.ds-directory` 才是主药。

**已排除的错误方向（别再走一遍）**
- ❌ 不是底部被系统导航栏压住。实测：目录能完整滚到底，且是手势导航。
- ❌ 不是「状态栏占位上移 / `--status-bar-drop` 时有时无」。实测该项一直是 0。
- ❌ 不是第三方美化 CSS 修好了。那份 CSS 里没有任何 `.ds-directory` / `--status-bar-drop` 规则（见 K7）。

**对照实验记录**

在真机上用 3 行 CSS 临时验证过（加在全局自定义 CSS 末尾）：

```css
.app-root, .phone-shell, .ds-directory { overflow: clip !important; }
```

结果：点搜索框键盘弹起，**标题稳稳在**，目录滚动依然顺滑。→ 机制成立。
源码修复即基于此实验，**真机复验结果见第六节**。

---

### K2. 「Chrome 里好看，App 里不对」的两个层次 【实证】

**第一层：跑的不是同一套媒体查询**

实测环境视口 **360 × 805 @2x**，而 Chrome 桌面预览是固定的 **390 × 844 机模**。

| 媒体查询 | 360 真机 | 390 机模 |
|---|---|---|
| `@media (max-width: 373px) and (hover:none) and (pointer:coarse)`（`--slot-size: 16.92vw` 等） | ✅ 命中 | ❌ 不命中 |
| `@media (max-width: 360px)`（第三方 CSS 里多处，带 `!important`） | ✅ 命中 | ❌ 不命中 |

即：**真机走的是等比缩放分支，桌面上看到的是默认 clamp 分支。** 两边像素级对不上是必然的。

**第二层：部分键盘 hook 在桌面根本不执行**

`useAndroidCaretKeyboardLift()` / `useAndroidNativeKeyboardViewport()` 都有这道门：

```js
window.matchMedia("(max-width: 500px) and (hover: none) and (pointer: coarse)").matches
```

桌面机模不满足 → 整段逻辑一次都不跑。所以**跟键盘相关的 bug，桌面 Chrome 永远复现不出来。**

**推论（重要）**：`max-width: 360px` 是**包含** 360 的。真机正好落在边界值上，
意味着在 360 上调出来的效果，到 361px 的设备就切回另一套规则。
**判断标准：在真机 360 环境里看，不要在桌面机模里看。**

自测当前命中哪一支（零成本）：

```css
@media (max-width: 360px) {
  .phone-shell::after {
    content: "≤360px 分支"; position: absolute; top: 40px; left: 8px;
    font-size: 10px; color: blue; z-index: 9999; pointer-events: none;
  }
}
@media (min-width: 361px) {
  .phone-shell::after {
    content: ">360px 分支"; position: absolute; top: 40px; left: 8px;
    font-size: 10px; color: red; z-index: 9999; pointer-events: none;
  }
}
```

实测结果：**≤360px 分支**（蓝字）。

---

### K3. 安卓壳不打包网页 —— 改网页不需要重打包 【实证】

`android-shell/.../MainActivity.kt` 开头注释即写明：

> 全屏 WebView 直接加载线上站点。**网页每次部署即时生效**，本壳只负责原生能力。

三处硬限制：

- `val SITE_URL: String = BuildConfig.SITE_URL` —— 站点地址是**编译期常量**
- `webView.loadUrl(consumeOpenUrl(intent) ?: SITE_URL)` —— 冷启动只加载它，**壳没有地址栏**
- `shouldOverrideUrlLoading`：只有同 host 留在壳内，其它一律 `startActivity` 甩给系统浏览器

**结论**：改网页（`components/` `styles/` `lib/`）→ 部署即生效，**不用重新打包 APK**。
改壳（`android-shell/`）→ **必须重打包重装**，网页怎么部署都没用。

**要用壳验证分支部署怎么办**：workflow 支持 `workflow_dispatch` 的 `site_url` 输入，
重新打包指向预览地址即可。**代价：换 host = 换 origin = 空环境**，
本地 IndexedDB / localStorage 按 origin 隔离，数据一个都看不到。换前务必导出备份。

---

### K4. 对比工具报「零差异」不可信 【实证】

曾经出现：工具对比报「领先 0 / 落后 0，零差异」，而 GitHub 页面明确写
「15 commits ahead」。**两者矛盾时，以 GitHub 与你实际读到的文件为准。**

同类现象：`docs/fork-changes-overview.md` 也记过——对比列表里
`lib/shell-call-overlay.ts`、`styles/phone-shell.css` 等条目显示 `+0/-0`，
但实际有实质改动，是对比接口在文件数超限后没附 diff 统计。

**铁律**：凡是"改没改、改了什么"的判断，一律**直接读文件**，
不用工具摘要数字当证据。这条踩过两次，代价是两轮排查方向全跑偏。

---

### K5. 应用目录分组无法滚动 【实证】

`.desktop-single` / `.ds-dir-scroll` 一律用**「块级流 + 外边距」**排布，**不用 flex 列布局**。

原因：卡片自身是 `overflow: hidden`，而 `overflow` 不为 `visible` 时，
flex 子项的 `min-height: auto` 会解析为 0 —— 卡片被压扁到容器高度，
既不溢出也不滚动，内容就"看不见"了。

对应提交 `c8a3dc544e`。

---

### K6. 单页/目录滚动掉帧 【实证】

毛玻璃（`backdrop-filter`）在本文件里被刻意收敛，因为**嵌套模糊**是掉帧主因：

- 整页糊 + 卡糊 + 每个图标糊 → 滚动时每帧重新采样几十层
- 做法：整页底色改为近乎不透明、去掉整页/卡片的模糊，
  图标模糊半径从 22px 压到 5px（背后本来就已经是糊的，观感几乎无差别）

对应提交 `705d273e0c`。**加新样式时注意别把嵌套模糊加回来。**

---

### K7. 第三方美化 CSS 的干扰 【实证】

现用主题 `b.css`（约 300k）有几个必须知道的特点：

- 文件头标注来源是**另一个 fork**（`Repository 1206149951-create/float @ 8ef9e34`），
  DOM 结构可能与当前上游不同
- **几乎每条规则都带 `!important`**，覆盖力极强，出问题极难定位
- 有 `font-size: 0 !important` + `::after { content: "トーク" }` 这类**改文案**的规则，
  不只是换皮
- 大量 `:has()` / `:nth-child(3n+2)` 结构敏感选择器
- 含 `@media (max-width: 360px)` 分支，在本机（360px）会生效

**它没有修 K1**：全文没有 `.ds-directory` / `.ds-dir-*` / `--status-bar-drop` /
`--mobile-keyboard-lift` / `--phone-screen-height` / `phone-shell-wrap` 任何一条。
之前"加了美化就正常"是**视觉掩盖**——`.phone-shell { background: #faf6ec !important }`
把壳底色刷成不透明米色，裁切边不那么扎眼了，实际裁切还在。

**自查命令**（拿到新 CSS 先跑一遍）：

```bash
grep -nE "ds-directory|ds-dir|status-bar-drop|mobile-keyboard-lift|phone-screen-height|phone-shell-wrap" b.css
```

---

## 四、分诊手册

### 症状：「应用目录」顶部（标题/搜索框）看不见

按顺序问两句话，能砍掉大半可能性：

| 问题 | 回答 | 结论 |
|---|---|---|
| ① 完全不碰搜索框，只打开目录、上下滑动，标题在吗？ | 一直在 | 是聚焦触发的 → K1 |
| | 也会消失 | 纯布局/裁切问题，**不是 K1**，重新查 |
| ② 点搜索框让键盘弹起、再收起键盘，标题回来吗？ | 回来 | 浏览器 focus scroll → **就是 K1** |
| | 不回来 | 某个变量被改了没恢复（`--phone-screen-height` 停在小值等），要动 JS |

实测记录：① 一直在、② 会回来 → **判定 K1，已按此修复。**

### 症状：改了代码但 App 里没变化

按顺序排查：

1. **✦ 悬浮钮在不在**（见 2.4）→ 不在 = 跑的是旧版
2. **Service Worker 缓存**（本机环境实测 SW 已激活）→ 部署后旧 HTML 引旧 CSS 是经典坑
3. **部署平台的 commit 是不是最新的**（Netlify/Vercel 面板看 Deploys 列表）
4. 换 origin 测分支 → 记得是空环境，别以为数据丢了

---

## 五、环境实测记录 【实证】

2026-10-17，在**安卓壳内**实测：

| 项 | 值 |
|---|---|
| UA | Android 14 / ALT-AN00 / `(wv)` / Chrome 116 / `FloatShell` |
| 视口 | **360 × 805**（CSS px） |
| 像素比 | @2x（物理 720 × 1610） |
| PWA 独立窗口 | 否（壳内，非装机 PWA） |
| Service Worker | **已激活**（改动后可能存在缓存滞后） |
| 通知权限 | 不支持（壳走原生推送通道） |
| 存储占用 | 37.9 MB / 配额 132.69 GB（0.0%） |
| IndexedDB | 20 个库（聊天/记忆/设置/主题/音乐/故事/地图/栖所/便签等） |
| 持久化存储 | **未开启**（存储紧张时系统可能清数据 → 定期导出备份） |

**调试通道**：`MainActivity.kt` 第 264 行 `WebView.setWebContentsDebuggingEnabled(true)`。
手机开 USB 调试 + 电脑 Chrome `chrome://inspect` 即可远程调试真机页面。
注意它**只看得到 WebView/Chrome 层**；原生层（状态栏高度注入、键盘 insets）要走 Logcat。

---

## 六、未结案（下次从这里继续）

### U1. K1 的真机复验 【待验证】

- 代码已提交：`f741b40290` → PR #3 合入 main
- **用户反馈：生产构建后在 App 里打开仍然不行**
- 但临时 CSS 对照实验是实测有效的，所以最可能是「新代码没真的跑起来」而非「修复无效」
- **下次优先确认（按顺序）**：
  1. 临时那 3 行 `overflow: clip` CSS 是否还在主题配置里？还在 = 症状已不是 K1；已删 = 大概率缓存
  2. Netlify Deploys 最新 commit 是否为 `3721034145` / `f741b40290`
  3. 硬清缓存 / 换无痕窗口 / 在 `chrome://inspect` 里看 `getComputedStyle(.ds-directory).overflow` 是否为 `clip`
  4. 若 `overflow` 确实是 `clip` 但问题仍在 → **K1 结论需要修正**，重新做 ①② 分诊

### U2. `--status-bar-height` 与「状态栏位置」的关系 【半实证】

曾观察到「顶部偏移 12px 时标题在、4px 时不在」，但按代码：

```css
.ds-directory { padding: calc(var(--status-bar-height, 36px) + 12px) …; }
```

只读 `--status-bar-height`，**不读**「状态栏位置」`--status-bar-top`。
理论上调「状态栏位置」动不到目录顶部。

→ 需确认当时调的到底是「状态栏位置」还是「状态栏占位上移」，或存在第三条链路。
（在 K1 已修的前提下，这个观察现在可能已不成立，需重测。）

### U3. 键盘 hook 与 CSS 的契约 【半实证】

本 fork 的 `phone-shell.css` 现在是：

```css
margin-top: calc(-1 * var(--status-bar-drop, 0px));
transform: translate3d(0, calc(-1 * var(--mobile-keyboard-lift, 0px)), 0);
```

而 `desktop-shell.tsx` 第 1021 行注释写的是「抬升已改用 margin-top（真实布局位移）实现」。
**注释与实现不一致**。

但逻辑推演：键盘触发原生压缩时 `data-native-kb-resize === "1"` 会强制 `applyLift(0)`，
此时 `--mobile-keyboard-lift` 恒为 0，两种写法结果相同 → **在原生压缩路径上无害**。
是否需要统一，等 U1 结论出来再定，别在没定性前乱动。

### U4. 是否把 K1 的通用部分提给上游 【待定】

`.app-root` / `.phone-shell` 的 `overflow: hidden` 在官方主线也存在，
即「focus scroll 能把壳滚走」是**上游也有的问题**。
但 `.ds-directory` 是本 fork 独有。若将来要报，**只报前两处**，且需先验证官方版本可复现。

---

## 七、给未来的自己

1. **别信工具摘要，去读文件。**（K4，已经因此跑偏两轮）
2. **别在桌面 Chrome 验证和键盘/媒体查询相关的改动。**（K2）
3. **改 `overflow` 前先想：这个容器是「要裁」还是「要滚」。**（K1 / K5）
4. **加毛玻璃前先想：它是不是嵌套在另一个模糊里。**（K6）
5. **遇到「时有时无」，先找"什么在变"**——很可能是滚动位置、变量、或缓存，
   而不是布局本身。（K1 就是这样，一开始全班人马都在查布局）
6. **文档比记忆可靠。** 尤其是"为什么这么改"，隔一天就忘。
