import { isAuthorizedRequest, jsonResponse } from "../_lib/site-state.mjs";
import { runResetMonitor } from "../_lib/reset-monitor.mjs";

const unauthorized = () => jsonResponse({ error: "Unauthorized" }, 401);

export async function POST(request) {
  if (!(await isAuthorizedRequest(request))) {
    return unauthorized();
  }

  try {
    const result = await runResetMonitor();

    return jsonResponse({
      ok: true,
      ...result,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown automation error" }, 500);
  }
}
