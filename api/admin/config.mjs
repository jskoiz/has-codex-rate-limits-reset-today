import {
  buildNextState,
  getDefaultAutoResetHours,
  isAuthorizedRequest,
  jsonResponse,
  readJsonBody,
  readSiteState,
  writeSiteState,
} from "../_lib/site-state.mjs";

const unauthorized = () => jsonResponse({ error: "Unauthorized" }, 401);

export async function GET(request) {
  if (!isAuthorizedRequest(request)) {
    return unauthorized();
  }

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
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown config error" }, 500);
  }
}

export async function POST(request) {
  if (!isAuthorizedRequest(request)) {
    return unauthorized();
  }

  try {
    const body = await readJsonBody(request);
    const nextState = await buildNextState({
      applyTimerToCurrentState: Boolean(body?.applyTimerToCurrentState),
      autoResetHours: body?.autoResetHours,
      state: body?.state,
    });

    await writeSiteState(nextState);

    return jsonResponse({
      autoResetHours: nextState.autoResetHours,
      ok: true,
      resetAt: nextState.resetAt,
      state: nextState.currentState,
      updatedAt: nextState.updatedAt,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown write error" }, 500);
  }
}
