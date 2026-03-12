import { isAuthorizedAutomationRequest, runResetMonitor } from "../_lib/reset-monitor.mjs";
import { jsonResponse } from "../_lib/site-state.mjs";

export async function GET(request) {
  if (!isAuthorizedAutomationRequest(request)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await runResetMonitor();

    return jsonResponse({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Reset monitor failed", error);

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown reset monitor error",
      },
      500,
    );
  }
}
