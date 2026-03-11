import { getDefaultAutoResetHours, jsonResponse, readSiteState } from "./_lib/site-state.mjs";

export async function GET() {
  try {
    const state = await readSiteState();

    return jsonResponse({
      autoResetHours: state.autoResetHours || getDefaultAutoResetHours(),
      configured: state.configured,
      resetAt: state.resetAt,
      state: state.currentState,
      updatedAt: state.updatedAt,
    });
  } catch (error) {
    return jsonResponse(
      {
        autoResetHours: getDefaultAutoResetHours(),
        configured: false,
        error: error instanceof Error ? error.message : "Unknown status error",
        resetAt: null,
        state: "no",
        updatedAt: null,
      },
      500,
    );
  }
}
