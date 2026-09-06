function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

// Commit a first-party document before the next request. This preserves Strict
// credential cookies across GitHub's cross-site return without weakening them
// to SameSite=Lax or embedding credentials in URLs/JavaScript.
export function githubReturnPage(input: { title: string; description: string; label: string; action: "/api/github/install" | "/api/github/callback"; fields?: Record<string, string>; headers?: HeadersInit }) {
  const button = `<button type="submit">${escapeHtml(input.label)}</button>`;
  const content = input.fields
    ? `<form method="post" action="${input.action}">${Object.entries(input.fields).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("")}${button}</form>`
    : `<a class="button" href="${input.action}">${escapeHtml(input.label)}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.title)}</title><style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f4;color:#202225}main{width:min(440px,calc(100vw - 64px));padding:28px;border:1px solid #d7d7d2;border-radius:18px;background:white}h1{font-size:24px;margin:0 0 8px}p{color:#565656;line-height:1.5}.button,button{display:inline-block;border:0;border-radius:9px;background:#202225;color:white;padding:12px 16px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}:focus-visible{outline:3px solid #315efb;outline-offset:4px}</style></head><body><main><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.description)}</p>${content}</main></body></html>`;
  const headers = new Headers(input.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(html, { headers });
}
