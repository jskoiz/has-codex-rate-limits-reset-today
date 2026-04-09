import {
  getDefaultAutoResetHours,
  getDefaultNoSubtitles,
  getDefaultYesSubtitles,
  getEnvValue,
  jsonResponse,
  readSiteState,
} from "./_lib/site-state.mjs";

export const createPublicAutomationSummary = (automation = {}) => {
  const latestEvaluation = Array.isArray(automation.recentEvaluations) ? automation.recentEvaluations[0] : null;
  const latestEntry = latestEvaluation || automation.pendingReview || automation.lastDecision;

  if (!latestEntry && !automation.lastSeenTweetId && !automation.lastError) {
    return null;
  }

  return {
    checkedAt: latestEntry?.evaluatedAt || latestEntry?.createdAt || latestEntry?.decidedAt || null,
    confidence: Number.isFinite(latestEntry?.confidence) ? latestEntry.confidence : null,
    lastError: automation.lastError || null,
    rationale: typeof latestEntry?.rationale === "string" ? latestEntry.rationale : "",
    totals: {
      inputTokens: Number.isFinite(automation.tokenUsage?.totalInputTokens) ? automation.tokenUsage.totalInputTokens : 0,
      outputTokens: Number.isFinite(automation.tokenUsage?.totalOutputTokens) ? automation.tokenUsage.totalOutputTokens : 0,
      reasoningTokens: Number.isFinite(automation.tokenUsage?.totalReasoningTokens)
        ? automation.tokenUsage.totalReasoningTokens
        : 0,
      totalTokens: Number.isFinite(automation.tokenUsage?.totalTokens) ? automation.tokenUsage.totalTokens : 0,
    },
    model: getEnvValue("OPENAI_REASONING_MODEL", "") || "chatgpt-5.4",
    tweetId: latestEntry?.tweetId || automation.lastSeenTweetId || null,
    tweetText: typeof latestEntry?.tweetText === "string" ? latestEntry.tweetText : "",
    tweetUrl: latestEntry?.tweetUrl || automation.lastSeenTweetUrl || null,
    usage: {
      inputTokens: Number.isFinite(latestEntry?.inputTokens) ? latestEntry.inputTokens : 0,
      outputTokens: Number.isFinite(latestEntry?.outputTokens) ? latestEntry.outputTokens : 0,
      reasoningTokens: Number.isFinite(latestEntry?.reasoningTokens) ? latestEntry.reasoningTokens : 0,
      totalTokens: Number.isFinite(latestEntry?.totalTokens) ? latestEntry.totalTokens : 0,
    },
    verdict: latestEntry?.verdict || null,
  };
};

export async function GET() {
  try {
    const state = await readSiteState();

    return jsonResponse({
      autoResetHours: state.autoResetHours || getDefaultAutoResetHours(),
      automationSummary: createPublicAutomationSummary(state.automation),
      configured: state.configured,
      noSubtitles: state.noSubtitles || getDefaultNoSubtitles(),
      yesSubtitles: state.yesSubtitles || getDefaultYesSubtitles(),
      resetAt: state.resetAt,
      state: state.currentState,
      updatedAt: state.updatedAt,
    });
  } catch (error) {
    console.error("Unable to load public status", error);

    return jsonResponse(
      {
        autoResetHours: getDefaultAutoResetHours(),
        automationSummary: null,
        configured: false,
        error: "Status is temporarily unavailable",
        noSubtitles: getDefaultNoSubtitles(),
        yesSubtitles: getDefaultYesSubtitles(),
        resetAt: null,
        state: "no",
        updatedAt: null,
      },
      500,
    );
  }
}
