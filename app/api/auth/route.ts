import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authDatabase,
  requireCapability,
  requireAuthOrigin,
  SESSION_COOKIE,
  SESSION_SECONDS,
  teamMode,
  tokenFromRequest,
} from "@/lib/auth";
import {
  bootstrapTeam,
  changePassword,
  loginTeam,
  logoutTeam,
  memberFields,
} from "@/lib/team-storage";
import { HttpError, readJson } from "@/lib/http";

const actions = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("login"),
      email: memberFields.email,
      password: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("bootstrap"),
      ...memberFields,
      secret: z.string().min(1).max(512),
    })
    .strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z
    .object({
      action: z.literal("change_password"),
      current_password: z.string().min(1).max(128),
      password: memberFields.password,
    })
    .strict(),
]);
function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function secureCookie(request: Request) {
  const origin = new URL(
    process.env.CARGO_PUBLIC_ORIGIN ??
      process.env.RENDER_EXTERNAL_URL ??
      request.url,
  );
  if (origin.protocol === "https:") return true;
  if (
    origin.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    return false;
  throw new HttpError(
    "Team sign-in requires HTTPS and a configured public origin.",
    503,
  );
}
function setSession(
  response: NextResponse,
  token: string,
  secure: boolean,
  clear = false,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: clear ? 0 : SESSION_SECONDS,
  });
  return response;
}
export async function GET(request: Request) {
  try {
    if (!teamMode())
      return response({
        mode: "demo",
        user: null,
        label: "Isolated synthetic demo — names are not verified identities.",
      });
    let user = null;
    try {
      user = (await requireCapability(request, "read")).user ?? null;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
    }
    const initialized = await authDatabase()
      .prepare("SELECT singleton FROM team_installation WHERE singleton=1")
      .first();
    return response({
      mode: "team",
      user,
      setup_available:
        !initialized && (process.env.CARGO_BOOTSTRAP_SECRET?.length ?? 0) >= 32,
    });
  } catch (error) {
    return response(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Authentication is temporarily unavailable.",
      },
      error instanceof HttpError ? error.status : 503,
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!teamMode())
      throw new HttpError(
        "Team sign-in is not enabled for this isolated demo.",
        404,
      );
    requireAuthOrigin(request);
    const secure = secureCookie(request),
      input = actions.parse(await readJson(request, 5000));
    if (input.action === "logout") {
      await logoutTeam(tokenFromRequest(request));
      return setSession(response({ signed_out: true }), "", secure, true);
    }
    if (input.action === "bootstrap") {
      await bootstrapTeam(input);
      return response(
        {
          created: true,
          note: "Team created. Sign in with your administrator account.",
        },
        201,
      );
    }
    if (input.action === "change_password") {
      const session = await requireCapability(request, "read");
      await changePassword(
        session.user!,
        input.current_password,
        input.password,
      );
      return setSession(
        response({ changed: true, signed_out: true }),
        "",
        secure,
        true,
      );
    }
    const login = await loginTeam(input.email, input.password);
    return setSession(
      response({ signed_in: true, expires_at: login.expires }),
      login.token,
      secure,
    );
  } catch (error) {
    return response(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the required account fields. Use a 15–128 character password for new accounts."
              : "Authentication is temporarily unavailable.",
      },
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
