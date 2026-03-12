import { getDefaultAutoResetHours, getDefaultNoSubtitles, jsonResponse, readSiteState } from "./_lib/site-state.mjs";

export async function GET() {
  try {
    const state = await readSiteState();

    return jsonResponse({
      autoResetHours: state.autoResetHours || getDefaultAutoResetHours(),
      configured: state.configured,
      noSubtitles: state.noSubtitles || getDefaultNoSubtitles(),
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
        noSubtitles: getDefaultNoSubtitles(),
        resetAt: null,
        state: "no",
        updatedAt: null,
      },
      500,
    );
  }
}
