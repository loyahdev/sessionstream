const markup = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expired | SessionStream</title>
<style>
:root{color-scheme:dark;--bg:#121614;--panel:#1b211d;--text:#f3f2e9;--muted:#a4afa7;--line:#344238;--accent:#baf77a}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f6ef;--panel:#fff;--text:#18221b;--muted:#526255;--line:#d1ddd1;--accent:#326c26}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px system-ui,sans-serif;min-height:100svh;display:grid;place-items:center;padding:24px}
main{max-width:460px;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:clamp(24px,7vw,44px)}
.brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:750;letter-spacing:-.04em}.brand svg{color:var(--accent)}
h1{margin:32px 0 8px;font-size:clamp(30px,7vw,42px);letter-spacing:-.04em}p{color:var(--muted);line-height:1.6;margin:0 0 28px}a{color:var(--accent);text-underline-offset:4px}
</style>
</head>
<body><main>
<div class="brand"><svg aria-hidden="true" width="25" height="29" viewBox="-3 -1 40 46" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M0 17C9 2 24 19 34 3M0 29C9 14 24 31 34 15M0 41C9 26 24 43 34 27"/></svg>sessionstream</div>
<h1>Link expired</h1><p>This listening session is no longer available. Ask your host to share a new link.</p>
<a href="https://sessionstream.app/">Back to SessionStream</a>
</main></body></html>`;

export const expiredPage = () => new Response(markup, {status:410, headers:{
  'Content-Type':'text/html; charset=utf-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
}});
