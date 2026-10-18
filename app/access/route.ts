import { NextResponse } from "next/server";

import {
  SITE_ACCESS_COOKIE,
  SITE_ACCESS_MAX_AGE_SECONDS,
  SITE_ACCESS_PAGE_PATH,
  createSiteAccessCookieValue,
  isSiteAccessGateEnabled,
  safeNextPath,
  verifySiteAccessPassword,
} from "@/lib/site-access-gate";

/**
 * 站点访问口令页（自包含 HTML，不依赖任何外链资源与客户端 JS）。
 *
 * 为什么用 Route Handler 而不是 page.tsx：这个页面要在「什么都还没放行」的状态下
 * 渲染，走 App Router 的页面就会连带加载全局样式、PWA 注册器、插件引导等一堆
 * 与门禁无关的东西；而且口令页必须能不靠 JS 提交（老 WebView、JS 报错都能用），
 * 原生 form POST 最稳。
 *
 * 提交后由本文件直接写 cookie 并 303 跳回原路径，不额外开接口目录。
 */

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(options: { next: string; error?: string }): string {
  const next = escapeHtml(options.next);
  const error = options.error
    ? `<p class="err">${escapeHtml(options.error)}</p>`
    : "";
  // 口令页刻意做得极简：不透露这是什么项目、不加载任何外部资源。
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<meta name="theme-color" content="#f8f7f2" />
<title>需要访问口令</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: #f8f7f2;
    color: #2b2b28;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: 100%; max-width: 340px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 18px;
    padding: 26px 22px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.06);
  }
  h1 { margin: 0 0 6px; font-size: 17px; font-weight: 600; letter-spacing: 0.01em; }
  p.hint { margin: 0 0 18px; font-size: 13px; color: #8a8a83; }
  label { display: block; font-size: 12px; color: #8a8a83; margin-bottom: 6px; }
  input[type="password"] {
    width: 100%; padding: 12px 14px;
    font-size: 16px; /* 16px 以下 iOS 会在聚焦时放大页面 */
    color: #2b2b28;
    background: #f8f7f2;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    outline: none;
  }
  input[type="password"]:focus { border-color: rgba(0, 0, 0, 0.28); background: #fff; }
  button {
    width: 100%; margin-top: 14px; padding: 12px 14px;
    font-size: 15px; font-weight: 600; color: #f8f7f2;
    background: #2b2b28; border: 0; border-radius: 12px;
  }
  button:active { opacity: 0.82; }
  p.err {
    margin: 0 0 14px; padding: 9px 12px;
    font-size: 13px; color: #8c2f24;
    background: rgba(140, 47, 36, 0.07);
    border-radius: 10px;
  }
</style>
</head>
<body>
  <form class="card" method="post" action="${SITE_ACCESS_PAGE_PATH}">
    <h1>需要访问口令</h1>
    <p class="hint">这是一个私有部署，输入口令后继续。</p>
    ${error}
    <label for="password">口令</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
    <input type="hidden" name="next" value="${next}" />
    <button type="submit">进入</button>
  </form>
</body>
</html>`;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML_HEADERS });
}

export function GET(request: Request) {
  // 门禁关着的时候不该有人走到这里（middleware 不会 rewrite）；直接回首页更省事。
  if (!isSiteAccessGateEnabled()) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  return htmlResponse(renderPage({ next }));
}

export async function POST(request: Request) {
  if (!isSiteAccessGateEnabled()) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }
  const form = await request.formData().catch(() => null);
  const submitted = String(form?.get("password") ?? "");
  const next = safeNextPath(form?.get("next"));

  if (!(await verifySiteAccessPassword(submitted))) {
    // 慢一点再回：口令页是唯一可爆破的入口，几百毫秒的固定延迟成本很低。
    await new Promise(resolve => setTimeout(resolve, 400));
    return htmlResponse(renderPage({ next, error: "口令不正确。" }), 401);
  }

  const value = await createSiteAccessCookieValue();
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SITE_ACCESS_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SITE_ACCESS_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
