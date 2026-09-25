import { z } from "zod";
import { readJson } from "@/lib/http";
import { mailError } from "@/lib/mail-request";
import { finishGoogleConnect, mailRequest } from "@/lib/mail-storage";
import { respond } from "@/lib/storage";

/** Google redirects here. A same-origin POST from this page completes sign-in
 * with the SameSite=Strict session cookie and the single-use state. */
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code"),
    state = url.searchParams.get("state"),
    nonce = crypto.randomUUID().replace(/-/g, "");
  const valid =
    !!code &&
    code.length <= 4000 &&
    !!state &&
    /^[A-Za-z0-9_-]{43}$/.test(state) &&
    !url.searchParams.has("error");
  const payload = JSON.stringify({
    code: valid ? code : "",
    state: valid ? state : "",
  }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Gmail · CargoGuard</title><style>body{font-family:system-ui,sans-serif;background:#f3f6f8;color:#14283a;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #d7e0e7;border-radius:14px;padding:32px;max-width:460px;font-size:17px;line-height:1.5}a{display:inline-block;margin-top:16px;background:#0f5c55;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}</style></head><body><main><h1 style="font-size:24px;margin:0 0 12px">Connect Gmail</h1><p id="status">${valid ? "Finishing sign-in…" : "Gmail sign-in was cancelled. Go back to CargoGuard and try again."}</p><a href="/mail">Back to CargoGuard</a></main>${valid ? `<script nonce="${nonce}">history.replaceState(null,'','/api/mail/callback');fetch('/api/mail/callback',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(${payload})}).then(async r=>{const v=await r.json().catch(()=>({}));document.getElementById('status').textContent=r.ok?'Gmail connected ('+(v.account||'')+'). New email will be imported automatically.':(v.error||'Connection failed. Try again.');if(r.ok)setTimeout(()=>location.href='/mail',1500);}).catch(()=>{document.getElementById('status').textContent='Could not confirm the connection. Go back and refresh.';});</script>` : ""}</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

export async function POST(request: Request) {
  try {
    const context = await mailRequest(request, "operate", true);
    const input = z
      .object({
        code: z.string().min(1).max(4000),
        state: z.string().length(43),
      })
      .strict()
      .parse(await readJson(request));
    return respond(
      await finishGoogleConnect(context, input.state, input.code),
      {
        id: context.workspace,
        fresh: false,
      },
    );
  } catch (error) {
    return mailError(request, error);
  }
}
