// 站点访问口令：单人自部署时挡外人的那一层薄门禁。
//
// 为什么需要它：单机模式（NEXT_PUBLIC_SELF_HOSTED_MODE=true）下
// getCurrentAccount() 直接返回固定的 local_user（见 lib/server/account-auth.ts），
// 任何知道网址的人打开站点就等于你的账号；而账号门禁（ACCOUNT_GATE_*）在单机
// 模式下被 middleware 顶部整体跳过。所以「单机 + 想挡外人」只能另加一层。
//
// 设计取舍：
// - 只认一个环境变量 SITE_ACCESS_PASSWORD，留空即完全关闭，未配置的部署行为与
//   改动前一致（向后兼容）。
// - cookie 走 HttpOnly：安卓壳的 PushService 用 CookieManager.getCookie() 取
//   cookie 再转发给站点接口，读的是 WebView 原生 cookie 仓，HttpOnly 同样读得到。
//   因此壳的后台请求不需要额外开白名单；反过来做成非 HttpOnly 只会让壳内 JS
//   也能读到口令凭证，白增暴露面。
// - 无状态 HMAC 签名，不落库、不依赖 Supabase：代价是改口令后所有设备要重进一次。

const encoder = new TextEncoder();

export const SITE_ACCESS_COOKIE = "ai_phone_site_access";
export const SITE_ACCESS_PAGE_PATH = "/access";
/** 一年。单人自用，没必要反复输。 */
export const SITE_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * 口令放行路径（不校验 cookie）。
 *
 * - 口令页与口令接口本身必须放行，否则会自己锁死自己；
 * - robots.txt 放行：让爬虫能读到「全面禁止收录」的声明。没这道声明的话，
 *   爬虫撞到登录页反而可能把它当成普通页面处理；
 * - 静态资源放行：口令页是自包含 HTML（无外链资源），这些前缀主要是给
 *   PWA manifest / 图标 / 字体留的，避免将来改口令页时被自己拦住。
 */
const GATE_EXEMPT_PREFIXES = [
  SITE_ACCESS_PAGE_PATH,
  "/robots.txt",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
];

const GATE_EXEMPT_ASSET_PREFIXES = [
  "/_next/",
  "/fonts/",
  "/images/",
  "/birds/",
  "/diary/",
  "/game-builtins/",
  "/game-covers/",
  "/hdri/",
  "/models/",
  "/widgets/",
  "/xiaohongshu/",
];

export function getSiteAccessPassword(): string {
  return (process.env.SITE_ACCESS_PASSWORD || "").trim();
}

/** 留空 = 关闭门禁。这是唯一的开关，避免多一个开关变量与口令状态打架。 */
export function isSiteAccessGateEnabled(): boolean {
  return getSiteAccessPassword().length > 0;
}

/** 只认站内相对路径，挡住 `//evil.com` 这类协议相对跳转。 */
export function safeNextPath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // 回到口令页本身没有意义
  if (raw === SITE_ACCESS_PAGE_PATH || raw.startsWith(`${SITE_ACCESS_PAGE_PATH}?`)) return "/";
  return raw;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return bytesToBase64Url(signature);
}

/** 两串等长时做异或比较，不按首个不同字节提前返回，避免时间旁路。 */
function constantTimeEquals(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * 校验用户输入的口令。
 *
 * 两边都先过一次 HMAC 再比较：摘要定长，比较过程不泄露口令长度。
 */
export async function verifySiteAccessPassword(input: string): Promise<boolean> {
  const password = getSiteAccessPassword();
  if (!password) return false;
  const [expected, actual] = await Promise.all([
    hmacSha256("site-access-password", password),
    hmacSha256("site-access-password", input),
  ]);
  return constantTimeEquals(expected, actual);
}

/** 生成口令 cookie 值：v1.<过期秒>.<签名>。改口令后旧 cookie 自动失效。 */
export async function createSiteAccessCookieValue(maxAgeSeconds = SITE_ACCESS_MAX_AGE_SECONDS): Promise<string> {
  const password = getSiteAccessPassword();
  if (!password) return "";
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(maxAgeSeconds));
  const signature = await hmacSha256(`site-access:v1:${expiresAt}`, password);
  return `v1.${expiresAt}.${signature}`;
}

/** 校验口令 cookie：格式、过期时间、签名三关都过才算放行。 */
export async function verifySiteAccessCookieValue(value: string): Promise<boolean> {
  const password = getSiteAccessPassword();
  if (!password || !value) return false;
  const [version, expiresAtRaw, signature, ...rest] = value.split(".");
  if (rest.length > 0 || version !== "v1" || !expiresAtRaw || !signature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSha256(`site-access:v1:${expiresAtRaw}`, password);
  return constantTimeEquals(signature, expected);
}

/** 该路径是否不需要口令。 */
export function isSiteAccessExempt(pathname: string): boolean {
  if (GATE_EXEMPT_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return GATE_EXEMPT_ASSET_PREFIXES.some(prefix => pathname.startsWith(prefix));
}
