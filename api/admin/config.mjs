import {
  buildNextState,
  getDefaultAutoResetHours,
  getDefaultAutomationState,
  getDefaultAutomationEvents,
  getDefaultNoSubtitles,
  getDefaultYesSubtitles,
  getEnvValue,
  isAuthorizedRequest,
  jsonResponse,
  readJsonBody,
  readSiteState,
  updateSiteState,
} from "../_lib/site-state.mjs";

const unauthorized = () => jsonResponse({ error: "Unauthorized" }, 401);

const createManualClassification = (verdict) => ({
  confidence: 1,
  rationale: "Manually reviewed in admin config.",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  },
  verdict,
});

const createDecisionRecord = (pendingReview, classification) => ({
  confidence: classification.confidence,
  decidedAt: Date.now(),
  rationale: classification.rationale,
  tweetId: pendingReview.tweetId,
  tweetUrl: pendingReview.tweetUrl,
  verdict: classification.verdict,
});

const createAutomationLogEntry = (pendingReview, classification) => ({
  confidence: classification.confidence,
  evaluatedAt: Date.now(),
  inputTokens: 0,
  outputTokens: 0,
  rationale: classification.rationale,
  reasoningTokens: 0,
  totalTokens: 0,
  tweetId: pendingReview.tweetId,
  tweetText: pendingReview.tweetText,
  tweetUrl: pendingReview.tweetUrl,
  verdict: classification.verdict,
});

const createClassificationEvent = (pendingReview, classification) => ({
  confidence: classification.confidence,
  createdAt: Date.now(),
  inputTokens: 0,
  outputTokens: 0,
  rationale: classification.rationale,
  reasoningTokens: 0,
  totalTokens: 0,
  tweetId: pendingReview.tweetId,
  tweetText: pendingReview.tweetText,
  tweetUrl: pendingReview.tweetUrl,
  type: classification.verdict === "reset_confirmed" ? "reset_confirmed" : "not_reset",
  verdict: classification.verdict,
});

const getAutomationEventKey = (event) =>
  [event?.type || "", event?.tweetId || "", event?.verdict || "", event?.message || ""].join(":");

const upsertAutomationEvent = (events, nextEvent) => {
  const nextKey = getAutomationEventKey(nextEvent);
  const previousEvents = Array.isArray(events) ? events : [];
  return [nextEvent, ...previousEvents.filter((entry) => getAutomationEventKey(entry) !== nextKey)].slice(0, 40);
};

const resolvePendingReview = async (verdict) => {
  if (!["reset_confirmed", "not_reset"].includes(verdict)) {
    throw new Error("Invalid manual review verdict");
  }

  const classification = createManualClassification(verdict);

  return updateSiteState(async (current) => {
    const pendingReview = current.automation?.pendingReview;

    if (!pendingReview?.tweetId) {
      throw new Error("No pending review to resolve");
    }

    const nextState =
      verdict === "reset_confirmed"
        ? await buildNextState({ state: "yes" }, current)
        : current;
    const recentEvaluations = Array.isArray(current.automation?.recentEvaluations)
      ? current.automation.recentEvaluations
      : [];

    return {
      ...nextState,
      auth: current.auth,
      automation: {
        ...current.automation,
        lastDecision: createDecisionRecord(pendingReview, classification),
        lastError: null,
        lastSeenTweetId: pendingReview.tweetId,
        lastSeenTweetUrl: pendingReview.tweetUrl,
        pendingReview: null,
        recentEvaluations: [
          createAutomationLogEntry(pendingReview, classification),
          ...recentEvaluations.filter((entry) => entry?.tweetId !== pendingReview.tweetId),
        ].slice(0, 20),
        tokenUsage: current.automation?.tokenUsage || getDefaultAutomationState().tokenUsage,
      },
      automationEvents: upsertAutomationEvent(current.automationEvents, createClassificationEvent(pendingReview, classification)),
    };
  });
};

const getReasoningModel = () =>
  getEnvValue("OPENAI_REASONING_MODEL", "") || "gpt-5.4";

const getAnalyticsUrl = () => {
  const value =
    getEnvValue("SITE_ANALYTICS_URL", "") ||
    getEnvValue("VERCEL_ANALYTICS_DASHBOARD_URL", "") ||
    getEnvValue("VERCEL_ANALYTICS_URL", "");
  const trimmed = value.trim();
  return trimmed || null;
};

export async function GET(request) {
  if (!(await isAuthorizedRequest(request))) {
    return unauthorized();
  }

  try {
    const state = await readSiteState();

    return jsonResponse({
      autoResetHours: state.autoResetHours || getDefaultAutoResetHours(),
      automation: state.automation || getDefaultAutomationState(),
      automationEvents: state.automationEvents || getDefaultAutomationEvents(),
      configured: state.configured,
      noSubtitles: state.noSubtitles || getDefaultNoSubtitles(),
      yesSubtitles: state.yesSubtitles || getDefaultYesSubtitles(),
      resetAt: state.resetAt,
      state: state.currentState,
      updatedAt: state.updatedAt,
      analyticsUrl: getAnalyticsUrl(),
      vercelAnalyticsUrl: getAnalyticsUrl(),
      reasoningModel: getReasoningModel(),
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
    const nextState = body?.manualReviewVerdict
      ? await resolvePendingReview(body.manualReviewVerdict)
      : await updateSiteState((current) =>
          buildNextState({
            applyTimerToCurrentState: Boolean(body?.applyTimerToCurrentState),
            autoResetHours: body?.autoResetHours,
            noSubtitles: body?.noSubtitles,
            yesSubtitles: body?.yesSubtitles,
            state: body?.state,
          }, current),
        );

    return jsonResponse({
      autoResetHours: nextState.autoResetHours,
      automation: nextState.automation || getDefaultAutomationState(),
      automationEvents: nextState.automationEvents || getDefaultAutomationEvents(),
      noSubtitles: nextState.noSubtitles,
      yesSubtitles: nextState.yesSubtitles,
      ok: true,
      resetAt: nextState.resetAt,
      state: nextState.currentState,
      updatedAt: nextState.updatedAt,
      analyticsUrl: getAnalyticsUrl(),
      vercelAnalyticsUrl: getAnalyticsUrl(),
      reasoningModel: getReasoningModel(),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown write error" }, 500);
  }
}
