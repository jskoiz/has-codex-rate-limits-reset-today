import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  getAdminPassword,
  jsonResponse,
  readJsonBody,
} from "../_lib/site-state.mjs";

export async function POST(request) {
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    return jsonResponse({ error: "Missing SITE_ADMIN_PASSWORD configuration" }, 503);
  }

  const body = await readJsonBody(request);

  if (body?.password !== adminPassword) {
    return jsonResponse({ error: "Invalid password" }, 401);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "set-cookie": createAdminSessionCookie(),
    },
  );
}

export async function DELETE() {
  return jsonResponse(
    { ok: true },
    200,
    {
      "set-cookie": clearAdminSessionCookie(),
    },
  );
}
