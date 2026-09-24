import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { gmailConfig } from "@/lib/gmail-config";
import { finishGmailConnect } from "@/lib/gmail-oauth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const config = gmailConfig();
  if (!config.enabled)
    return new Response("Gmail integration is disabled.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    const url = new URL(request.url),
      state = url.searchParams.get("state") ?? "",
      code = url.searchParams.get("code") ?? "";
    const nonce =
      request.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)cargo_gmail_oauth=([a-zA-Z0-9_-]+)(?:;|$)/)?.[1] ??
      "";
    if (!state || !nonce || !code || url.searchParams.has("error"))
      throw new Error("Invalid callback");
    const workspace = await finishGmailConnect(
      storage().DB,
      state,
      nonce,
      code,
    );
    const response = NextResponse.redirect(`${config.origin}/?gmail=connected`);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set("cargo_workspace", workspace, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });
    response.cookies.set("cargo_gmail_oauth", "", {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/api/gmail/callback",
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.redirect(`${config.origin}/?gmail=connection_failed`);
  }
}
