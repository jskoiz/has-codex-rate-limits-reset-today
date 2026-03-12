import {
  buildNextState,
  getDefaultAutoResetHours,
  getDefaultNoSubtitles,
  isAuthorizedRequest,
  jsonResponse,
  readJsonBody,
  readSiteState,
  updateSiteState,
} from "../_lib/site-state.mjs";

const unauthorized = () => jsonResponse({ error: "Unauthorized" }, 401);

export async function GET(request) {
  if (!(await isAuthorizedRequest(request))) {
    return unauthorized();
  }

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
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown config error" }, 500);
  }
}

export async function POST(request) {
  if (!(await isAuthorizedRequest(request))) {
    return unauthorized();
  }

  try {
    const body = await readJsonBody(request);
    const nextState = await updateSiteState((current) =>
      buildNextState({
        applyTimerToCurrentState: Boolean(body?.applyTimerToCurrentState),
        autoResetHours: body?.autoResetHours,
        noSubtitles: body?.noSubtitles,
        state: body?.state,
      }, current),
    );

    return jsonResponse({
      autoResetHours: nextState.autoResetHours,
      noSubtitles: nextState.noSubtitles,
      ok: true,
      resetAt: nextState.resetAt,
      state: nextState.currentState,
      updatedAt: nextState.updatedAt,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown write error" }, 500);
  }
}
