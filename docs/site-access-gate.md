# 站点访问口令（单人自部署的私有门禁）

一个可选层：给站点加一道口令，只有输过口令的浏览器/壳才看得到页面和接口。
面向「自己一个人用、但网址必须公开（例如要打包成 APK / PWA 安装）」的部署。

## 它解决什么，以及为什么不复用账号门禁

单机模式（`NEXT_PUBLIC_SELF_HOSTED_MODE=true`）下，`getCurrentAccount()` 直接返回
固定的 `local_user`（见 `lib/server/account-auth.ts`）。这意味着**任何知道网址的人打开
站点，就等于拿到你的账号**。

而仓库原有的账号门禁（`ACCOUNT_GATE_*`、`ACCOUNT_SESSION_COOKIE`）在单机模式下
被 `middleware.ts` 顶部整体跳过；换成 `false` 启用它，又必须搭 Supabase 账号表、
走完登录流程——为了挡外人反而给自己加一道登录。

所以这里加的是**独立于账号体系**的一层口令门禁：不依赖 Supabase、不落库、
只认一个环境变量。

## 开启方式

在部署平台（Netlify / Vercel）环境变量里加一条，然后**重新部署**：

| 变量名 | 值 |
| --- | --- |
| `SITE_ACCESS_PASSWORD` | 自己定的口令，建议 16 位以上随机串 |

- **不要**写成 `NEXT_PUBLIC_` 开头：那类变量会被打包进浏览器代码、完全公开。
- **留空 = 完全关闭**。不配这个变量时，行为与改动前完全一致，等于没打这个补丁。
- 改口令后旧 cookie 自动失效（签名用口令本身做 HMAC key），所有设备需重进一次。

## 行为

| 请求 | 没口令时 | 有有效 cookie 时 |
| --- | --- | --- |
| 页面（`/`、各 APP 路由等） | rewrite 到 `/access` 口令页 | 正常渲染 |
| `/api/*` | 401 `{"code":"site_access_required"}` | 正常 |
| `/access`、`/robots.txt`、PWA manifest、图标、`/_next/` 等静态资源 | 放行 | 放行 |

放行 `/robots.txt` 是必要的：它输出 `Disallow: /`，让搜索引擎不去索引这个域名。
此外所有经过中间件的响应都带 `X-Robots-Tag: noindex, nofollow, noarchive`。
这两件事只防「被收录」，不防「被访问」——挡人靠的是口令本身。

口令页（`app/access/route.ts`）是**自包含 HTML**：无外链资源、无客户端 JS、原生
form POST 提交。老 WebView、JS 报错的场景也能用。口令错误时有 400ms 固定延迟，
压低爆破速率。

cookie：`ai_phone_site_access`，`HttpOnly` + `SameSite=Lax` + `Secure`（生产），
有效期一年。

## 对安卓壳（FloatShell）的影响

**不需要改壳、不需要重打 APK。** 原因：

`PushService.kt` 取 cookie 用的是 `CookieManager.getInstance().getCookie(SITE_URL)`，
读的是 WebView 原生 cookie 仓——`HttpOnly` 的 cookie 同样读得到（HttpOnly 只限制
页面 JS 的 `document.cookie`）。它把这些 cookie 原样放进后台请求的 `Cookie` 头里。

所以壳的推送链路（`/api/auth/me` → `/api/online/config` → `/api/push/subscribe` →
`/api/push/jobs` → `/api/push/outbox`）会自动带上口令 cookie。

**唯一要求：在壳里输过一次口令。** 全新安装后 WebView 没有 cookie，壳的后台请求
会拿到 401，常驻通知停在「未登录或站点不可达」——那是「还没过口令」，不是推送坏了。
在 App 里看到口令页、输一次即可，之后一年内不用再输。

> 注意：**不要**用「UA 里带 `FloatShell/` 就放行」的思路。壳的 WebView 页面请求确实
> 带这个 UA，但 `PushService` 的后台请求是 OkHttp 直发、不带该 UA（OkHttp 自己
> 加的 `User-Agent: okhttp/x.y.z` 会顶掉），按 UA 开白会让推送整条链路静默失效。

## 验证

1. 隐身窗口打开站点 → 应该看到口令页，看不到手机界面。
2. 随便打开一个接口，例如 `/api/push/selfcheck` → 应返回 401 且带
   `site_access_required`。
3. 输对口令 → 进入站点；刷新、关掉浏览器重开都不用再输。
4. 壳里：杀掉后台，在「设置 → 离线推送」点「测试」，约 6 秒后应收到系统通知。
5. `/api/push/selfcheck` 里每一段都应是 `ok`；重点看「推送订阅」里壳通道条数 ≥ 1、
   「服务端 → 壳长连接广播」为 `ok`。

## 限制（如实说明）

- 这是一层**共享口令**，不是多用户鉴权：拿到口令的人在站点里仍等于你的账号
  （单机模式的固有性质）。
- 口令是唯一秘密。APK 反编译能看到站点网址（`SHELL_SITE_URL` 是构建期常量），
  所以**网址不是秘密，口令才是**——请当成真正的密码保管。
- 没有做失败次数上限/账号锁定：延迟 + 长随机口令即主要防线。要更硬的方案，
  请用 Cloudflare Access（Zero Trust）之类的托管访问控制，那需要绑定自定义域名。
- 口令页与静态资源放行：理论上不带 cookie 也能拿到前端 JS/CSS 文件（这些本就是
  公开的前端代码），但拿不到任何页面、接口与数据。
