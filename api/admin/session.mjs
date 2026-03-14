import {
  clearAdminSessionCookie,
  getAdminPassword,
  getLoginThrottle,
  issueAdminSession,
  jsonResponse,
  recordFailedLogin,
  readJsonBody,
  revokeAdminSession,
} from "../_lib/site-state.mjs";

export async function POST(request) {
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    return jsonResponse({ error: "Missing SITE_ADMIN_PASSWORD configuration" }, 503);
  }

  const throttle = await getLoginThrottle(request);

  if (throttle.isLocked) {
    return jsonResponse(
      { error: "Too many login attempts. Try again later." },
      429,
      {
        "retry-after": String(throttle.retryAfterSeconds || 0),
      },
    );
  }

  const body = await readJsonBody(request);

  if (body?.password !== adminPassword) {
    const failedAttempt = await recordFailedLogin(request);

    if (failedAttempt.isLocked) {
      return jsonResponse(
        { error: "Too many login attempts. Try again later." },
        429,
        {
          "retry-after": String(failedAttempt.retryAfterSeconds || 0),
        },
      );
    }

    return jsonResponse({ error: "Invalid password" }, 401);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "set-cookie": await issueAdminSession(request),
    },
  );
}

export async function DELETE(request) {
  await revokeAdminSession(request);

  return jsonResponse(
    { ok: true },
    200,
    {
      "set-cookie": clearAdminSessionCookie(request),
    },
  );
}
