import { readJson } from "@/lib/http";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import { finishMicrosoftConnect } from "@/lib/microsoft-storage";
import { respond } from "@/lib/storage";
import { z } from "zod";

/** The initial cross-site redirect cannot rely on a SameSite=Strict team cookie.
 * A same-origin POST from this document supplies it and still verifies the
 * single-use state against the initiating user's exact session on the server.
 */
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code"),
    state = url.searchParams.get("state"),
    nonce = crypto.randomUUID().replace(/-/g, "");
  const valid =
    code &&
    code.length <= 10000 &&
    state &&
    /^[A-Za-z0-9_-]{43}$/.test(state) &&
    !url.searchParams.has("error");
  const payload = JSON.stringify({
    code: valid ? code : "",
    state: valid ? state : "",
  }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Microsoft · CargoGuard</title></head><body><main><h1>Connect Microsoft</h1><p id="status">${valid ? "Completing your authenticated connection…" : "Microsoft connection was cancelled or the response was invalid. Return to CargoGuard and try again."}</p><a href="/outlook">Return to CargoGuard</a></main>${valid ? `<script nonce="${nonce}">history.replaceState(null,'','/api/microsoft/callback');fetch('/api/microsoft/callback',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(${payload})}).then(async r=>{const v=await r.json();document.getElementById('status').textContent=r.ok?'Microsoft account connected. Return to CargoGuard.':(v.error||'Connection failed. Start again.');}).catch(()=>{document.getElementById('status').textContent='Connection status is uncertain. Return to CargoGuard and refresh connection status.';});</script>` : ""}</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
export async function POST(request: Request) {
  try {
    const context = await microsoftRequest(request, "operate", true);
    const input = z
      .object({
        code: z.string().min(1).max(10000),
        state: z.string().length(43),
      })
      .strict()
      .parse(await readJson(request));
    return respond(
      await finishMicrosoftConnect(context, input.state, input.code),
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
