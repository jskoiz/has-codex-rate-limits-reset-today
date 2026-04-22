import {
  getDefaultAutoResetHours,
  getDefaultNoSubtitles,
  getDefaultYesSubtitles,
  getEnvValue,
  jsonResponse,
  readSiteState,
} from "./_lib/site-state.mjs";

const createPublicSummaryEntry = (entry = null, fallback = {}) => {
  if (!entry && !fallback.tweetId && !fallback.tweetUrl) {
    return null;
  }

  return {
    checkedAt: entry?.evaluatedAt || entry?.createdAt || entry?.decidedAt || null,
    confidence: Number.isFinite(entry?.confidence) ? entry.confidence : null,
    rationale: typeof entry?.rationale === "string" ? entry.rationale : "",
    tweetCreatedAt: typeof entry?.tweetCreatedAt === "string" ? entry.tweetCreatedAt : null,
    tweetId: entry?.tweetId || fallback.tweetId || null,
    tweetText: typeof entry?.tweetText === "string" ? entry.tweetText : "",
    tweetUrl: entry?.tweetUrl || fallback.tweetUrl || null,
    usage: {
      inputTokens: Number.isFinite(entry?.inputTokens) ? entry.inputTokens : 0,
      outputTokens: Number.isFinite(entry?.outputTokens) ? entry.outputTokens : 0,
      reasoningTokens: Number.isFinite(entry?.reasoningTokens) ? entry.reasoningTokens : 0,
      totalTokens: Number.isFinite(entry?.totalTokens) ? entry.totalTokens : 0,
    },
    verdict: entry?.verdict || null,
  };
};

const getLatestAutomationEntry = (automation = {}) => {
  const latestEvaluation = Array.isArray(automation.recentEvaluations) ? automation.recentEvaluations[0] : null;

  return latestEvaluation || automation.pendingReview || automation.lastDecision || null;
};

const getLatestResetEntry = (automation = {}) => {
  const recentReset = Array.isArray(automation.recentEvaluations)
    ? automation.recentEvaluations.find((entry) => entry?.verdict === "reset_confirmed") || null
    : null;

  if (recentReset) {
    return recentReset;
  }

  return automation.lastDecision?.verdict === "reset_confirmed" ? automation.lastDecision : null;
};

export const createPublicAutomationSummary = (automation = {}, currentState = "no") => {
  const latestEntry = getLatestAutomationEntry(automation);
  const lastResetEntry = getLatestResetEntry(automation);
  const displayEntry = lastResetEntry || latestEntry;

  if (!displayEntry && !automation.lastSeenTweetId && !automation.lastError) {
    return null;
  }

  const fallbackTweet = {
    tweetId: automation.lastSeenTweetId || null,
    tweetUrl: automation.lastSeenTweetUrl || null,
  };
  const displaySummary = createPublicSummaryEntry(displayEntry, fallbackTweet);
  const latestSummary = createPublicSummaryEntry(latestEntry, fallbackTweet);
  const lastResetSummary = createPublicSummaryEntry(lastResetEntry, fallbackTweet);

  return {
    ...displaySummary,
    mode: currentState === "no" ? "inactive" : "active",
    lastError: automation.lastError || null,
    latest: latestSummary,
    lastReset: lastResetSummary,
    totals: {
      inputTokens: Number.isFinite(automation.tokenUsage?.totalInputTokens) ? automation.tokenUsage.totalInputTokens : 0,
      outputTokens: Number.isFinite(automation.tokenUsage?.totalOutputTokens) ? automation.tokenUsage.totalOutputTokens : 0,
      reasoningTokens: Number.isFinite(automation.tokenUsage?.totalReasoningTokens)
        ? automation.tokenUsage.totalReasoningTokens
        : 0,
      totalTokens: Number.isFinite(automation.tokenUsage?.totalTokens) ? automation.tokenUsage.totalTokens : 0,
    },
    model: getEnvValue("OPENAI_REASONING_MODEL", "") || "chatgpt-5.4",
  };
};

export async function GET() {
  try {
    const state = await readSiteState();

    return jsonResponse({
      autoResetHours: state.autoResetHours || getDefaultAutoResetHours(),
      automationSummary: createPublicAutomationSummary(state.automation, state.currentState),
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
