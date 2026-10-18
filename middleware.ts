import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ACCOUNT_GATE_COOKIE, ACCOUNT_SESSION_COOKIE } from "./lib/account-cookie-constants";
import { verifyAccountGateCookieValue } from "./lib/account-gate-cookie";
import { isSelfHostedModeEnabled } from "./lib/self-hosting";
import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_PAGE_PATH,
  isSiteAccessExempt,
  isSiteAccessGateEnabled,
  verifySiteAccessCookieValue,
} from "./lib/site-access-gate";

const PUBLIC_ROUTE_PREFIXES = [
  "/verify",
  "/api/auth/",
  "/api/verify/",
  // iPhone Shortcuts does not share the PWA's login cookies. These handlers
  // validate either the bridge token or a short-lived per-command ticket.
  "/shortcut-run/",
  "/api/push/bridge-wake/",
  "/api/push/shortcut-commands/result/",
  "/api/push/shortcut-commands/media/",
  // 个人云的离线生成把「代发触发邮件」外包给站点，同样没有登录 cookie，
  // 凭 bridge_token 认账号（见该路由内的说明）。
  "/api/push/shortcut-commands/deliver-email/",
];

const STATIC_ROUTE_PREFIXES = [
  "/_next/",
  "/birds/",
  "/diary/",
  "/fonts/",
  "/game-builtins/",
  "/game-covers/",
  "/hdri/",
  "/images/",
  "/models/",
  "/widgets/",
  "/xiaohongshu/",
];

const STATIC_FILE_RE = /\.(?:avif|bin|css|gif|glb|gltf|hdr|ico|jpeg|jpg|js|json|map|mjs|mp3|ogg|otf|png|svg|ttf|txt|wasm|wav|webmanifest|webp|woff|woff2)$/i;

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

function isStaticRoute(pathname: string): boolean {
  return STATIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || STATIC_FILE_RE.test(pathname);
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function rewriteToHome(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.rewrite(url);
}

// 私人部署不该被搜索引擎收录：所有经过本中间件的响应都带 noindex。
// 注意它只防「被收录」，不防「被访问」——挡人靠的是下面的访问口令。
const NO_INDEX_HEADER = { "X-Robots-Tag": "noindex, nofollow, noarchive" } as const;

function withNoIndex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", NO_INDEX_HEADER["X-Robots-Tag"]);
  return response;
}

function redirectToAccessPage(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = SITE_ACCESS_PAGE_PATH;
  url.search = `?next=${encodeURIComponent(`${request.nextUrl.pathname}${request.nextUrl.search}`)}`;
  return withNoIndex(NextResponse.rewrite(url));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 站点访问口令（单人自部署用）：必须排在单机模式判定之前。
  //
  // 单机模式下 getCurrentAccount() 直接返回 local_user，下面那套账号门禁整体被
  // 跳过，等于「知道网址就等于拿到账号」。这个门禁是独立的、与账号体系无关的一层，
  // 只有配置了 SITE_ACCESS_PASSWORD 才生效，未配置的部署行为保持不变。
  //
  // 壳（FloatShell）的后台请求不用单独开白：PushService 用 CookieManager 取
  // WebView 原生 cookie 仓再转发，HttpOnly 的口令 cookie 同样会被带上。
  if (isSiteAccessGateEnabled() && !isSiteAccessExempt(pathname)) {
    const accessCookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value ?? "";
    if (!(await verifySiteAccessCookieValue(accessCookie))) {
      if (isApiRoute(pathname)) {
        return NextResponse.json(
          { ok: false, error: "需要站点访问口令。", code: "site_access_required" },
          { status: 401, headers: { "Cache-Control": "no-store", ...NO_INDEX_HEADER } },
        );
      }
      return redirectToAccessPage(request);
    }
  }

  if (isSelfHostedModeEnabled()) {
    return withNoIndex(NextResponse.next());
  }

  if (isStaticRoute(pathname) || isPublicRoute(pathname)) {
    return withNoIndex(NextResponse.next());
  }

  const sessionToken = request.cookies.get(ACCOUNT_SESSION_COOKIE)?.value ?? "";
  const gateCookie = request.cookies.get(ACCOUNT_GATE_COOKIE)?.value ?? "";
  const hasValidGate = await verifyAccountGateCookieValue(gateCookie, sessionToken);

  if (hasValidGate) return withNoIndex(NextResponse.next());

  if (isApiRoute(pathname)) {
    return NextResponse.json(
      { ok: false, error: "请先登录账号。" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Existing logged-in browsers may only have the original account session
  // cookie until /api/auth/me refreshes the signed gate cookie.
  if (sessionToken || pathname === "/") return withNoIndex(NextResponse.next());

  return withNoIndex(rewriteToHome(request));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:avif|bin|css|gif|glb|gltf|hdr|ico|jpeg|jpg|js|json|map|mjs|mp3|ogg|otf|png|svg|ttf|txt|wasm|wav|webmanifest|webp|woff|woff2)$).*)",
  ],
};
