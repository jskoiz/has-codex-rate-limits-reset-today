import OpenAI from "openai";
import { Resend } from "resend";

import { buildNextState, getEnvValue, readSiteState, updateSiteState } from "./site-state.mjs";

const TARGET_USERNAME = "thsottiaux";
const DEFAULT_MODEL = "gpt-5.4";
const RECENT_TWEET_LOOKBACK_DAYS = 1;
const SEARCH_BATCH_SIZE = 20;
const MAX_AUTOMATION_EVENT_ENTRIES = 40;
const MAX_PUBLIC_RATIONALE_LENGTH = 120;

let openaiClient = null;
let resendClient = null;
let rettiwtModulePromise = null;

const classificationSchema = {
  additionalProperties: false,
  properties: {
    confidence: {
      maximum: 1,
      minimum: 0,
      type: "number",
    },
    rationale: {
      type: "string",
    },
    verdict: {
      enum: ["reset_confirmed", "not_reset", "uncertain"],
      type: "string",
    },
  },
  required: ["verdict", "rationale", "confidence"],
  type: "object",
};

const classificationInstructions = `
You classify tweets from @thsottiaux about whether Codex or ChatGPT rate limits have reset.

Return "reset_confirmed" only when the tweet or its quoted post clearly says or directly implies that user limits, caps, or rate limits have reset, been lifted, or usage is available again now.
Return "not_reset" when the tweet is unrelated, promotional, conversational, or does not mean limits were reset.
Return "uncertain" when the tweet could plausibly be about a reset but is not explicit enough to safely auto-switch the public site.

Prefer caution over guessing. Replies and quote tweets may provide context, but if the reset meaning is not clear from this post and its quoted text, use "uncertain".
If the main post talks about a future or next reset, that alone is not a current reset.
If a quoted post is the evidence for "reset_confirmed", say that explicitly in the rationale.
Keep the rationale to one short sentence suitable for a compact public UI.
`.trim();

const getBaseUrl = () => getEnvValue("SITE_BASE_URL", "").replace(/\/+$/, "");

const getReviewEmail = () => getEnvValue("AI_REVIEW_EMAIL", "").trim();
const getRettiwtApiKey = () => getEnvValue("RETTIWT_API_KEY", "").trim();

const getRequiredConfigError = () => {
  const missing = [
    ["RETTIWT_API_KEY", getRettiwtApiKey()],
    ["OPENAI_API_KEY", getEnvValue("OPENAI_API_KEY", "")],
    ["RESEND_API_KEY", getEnvValue("RESEND_API_KEY", "")],
    ["RESEND_FROM_EMAIL", getEnvValue("RESEND_FROM_EMAIL", "")],
    ["AI_REVIEW_EMAIL", getReviewEmail()],
    ["SITE_BASE_URL", getBaseUrl()],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length === 0) {
    return null;
  }

  return `Missing automation configuration: ${missing.join(", ")}`;
};

const getOpenAIClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: getEnvValue("OPENAI_API_KEY", ""),
    });
  }

  return openaiClient;
};

const getResendClient = () => {
  if (!resendClient) {
    resendClient = new Resend(getEnvValue("RESEND_API_KEY", ""));
  }

  return resendClient;
};

const getRettiwt = async () => {
  if (!rettiwtModulePromise) {
    rettiwtModulePromise = import("rettiwt-api");
  }

  const module = await rettiwtModulePromise;
  return module.Rettiwt;
};

const getErrorMessage = (error) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return "";
};

const describeAutomationError = (error, fallback = "Unknown reset monitor error") => {
  const message = getErrorMessage(error);
  const causeMessage =
    typeof error?.cause === "object" && error?.cause
      ? getErrorMessage(error.cause)
      : "";

  if (causeMessage && message && message !== causeMessage) {
    return `${message} (${causeMessage})`;
  }

  return message || causeMessage || fallback;
};

export const compareTweetIds = (left, right) => {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);

    if (leftId === rightId) {
      return 0;
    }

    return leftId > rightId ? 1 : -1;
  } catch (_error) {
    if (left === right) {
      return 0;
    }

    return left > right ? 1 : -1;
  }
};

const sortTweetsAscending = (tweets) => [...tweets].sort((left, right) => compareTweetIds(left.id, right.id));

const normalizeTweetBatch = (result) => (Array.isArray(result?.list) ? result.list : []);

const dedupeTweetsById = (tweets) =>
  Array.from(
    (Array.isArray(tweets) ? tweets : []).reduce((entries, tweet) => {
      if (tweet?.id && !entries.has(tweet.id)) {
        entries.set(tweet.id, tweet);
      }

      return entries;
    }, new Map()).values(),
  );

const filterTweetsByStartDate = (tweets, startDate) => {
  const minimumTimestamp = startDate instanceof Date ? startDate.valueOf() : Number.NaN;

  if (!Number.isFinite(minimumTimestamp)) {
    return dedupeTweetsById(tweets);
  }

  return dedupeTweetsById(tweets).filter((tweet) => {
    const createdAt = new Date(tweet?.createdAt || "").valueOf();
    return Number.isFinite(createdAt) && createdAt >= minimumTimestamp;
  });
};

const getNewestTweet = (tweets) =>
  tweets.reduce((newest, tweet) => {
    if (!newest) {
      return tweet;
    }

    return compareTweetIds(tweet.id, newest.id) > 0 ? tweet : newest;
  }, null);

export const isAuthoredTimelineTweet = (tweet) =>
  Boolean(tweet?.id) &&
  tweet?.tweetBy?.userName?.toLowerCase() === TARGET_USERNAME &&
  !tweet?.retweetedTweet;

export const getUnseenTweets = (tweets, lastSeenTweetId) => {
  const uniqueTweets = Array.from(
    tweets
      .filter(isAuthoredTimelineTweet)
      .reduce((entries, tweet) => {
        if (!entries.has(tweet.id)) {
          entries.set(tweet.id, tweet);
        }

        return entries;
      }, new Map())
      .values(),
  );

  return sortTweetsAscending(
    uniqueTweets.filter((tweet) => !lastSeenTweetId || compareTweetIds(tweet.id, lastSeenTweetId) > 0),
  );
};

const normalizeWhitespace = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

const truncateRationale = (value, maxLength = MAX_PUBLIC_RATIONALE_LENGTH) => {
  if (value.length <= maxLength) {
    return value;
  }

  const clipped = value.slice(0, maxLength - 1).trimEnd();
  const boundary = clipped.lastIndexOf(" ");
  const shortened = boundary > 48 ? clipped.slice(0, boundary) : clipped;

  return `${shortened.trimEnd()}…`;
};

const hasExplicitResetLanguage = (value) => {
  const text = normalizeWhitespace(value).toLowerCase();

  if (!text) {
    return false;
  }

  return (
    /\b(limit|limits|rate limit|rate limits|cap|caps)\b/.test(text) &&
    (/\breset\b/.test(text) ||
      /\bresetting\b/.test(text) ||
      /\bresets\b/.test(text) ||
      /\bbeen reset\b/.test(text) ||
      /\bare reset\b/.test(text))
  );
};

const isFutureResetDiscussion = (value) => {
  const text = normalizeWhitespace(value).toLowerCase();

  if (!text) {
    return false;
  }

  return [
    /\bnext reset\b/,
    /\banother reset\b/,
    /\bwhen\b[^.]{0,48}\breset\b/,
    /\bwill\b[^.]{0,48}\breset\b/,
    /\bin less than\b[^.]{0,48}\breset\b/,
  ].some((pattern) => pattern.test(text));
};

const getFallbackRationale = (verdict) => {
  if (verdict === "reset_confirmed") {
    return "Post clearly confirms limits are reset now.";
  }

  if (verdict === "uncertain") {
    return "Possible reset signal, but not explicit enough to auto-switch.";
  }

  return "Post does not confirm a reset.";
};

const normalizeClassification = (tweet, classification = {}) => {
  const normalized = {
    ...classification,
    rationale: normalizeWhitespace(classification.rationale),
  };
  const mainText = tweet?.fullText || "";
  const quotedText = tweet?.quoted?.fullText || "";

  if (normalized.verdict === "reset_confirmed" && isFutureResetDiscussion(mainText) && hasExplicitResetLanguage(quotedText)) {
    normalized.rationale = "Quoted post confirms limits already reset; this post discusses the next reset.";
  } else if (!normalized.rationale) {
    normalized.rationale = getFallbackRationale(normalized.verdict);
  }

  normalized.rationale = truncateRationale(normalized.rationale);

  return normalized;
};

const createDecisionRecord = (tweet, classification) => ({
  confidence: classification.confidence,
  decidedAt: Date.now(),
  rationale: classification.rationale,
  tweetId: tweet.id,
  tweetUrl: tweet.url,
  verdict: classification.verdict,
});

const createPendingReview = (tweet, classification) => ({
  confidence: classification.confidence,
  createdAt: Date.now(),
  rationale: classification.rationale,
  tweetId: tweet.id,
  tweetText: tweet.fullText,
  tweetUrl: tweet.url,
});

const createAutomationLogEntry = (tweet, classification) => ({
  confidence: classification.confidence,
  evaluatedAt: Date.now(),
  inputTokens: classification.usage?.inputTokens || 0,
  outputTokens: classification.usage?.outputTokens || 0,
  rationale: classification.rationale,
  reasoningTokens: classification.usage?.reasoningTokens || 0,
  totalTokens: classification.usage?.totalTokens || 0,
  tweetId: tweet.id,
  tweetText: tweet.fullText,
  tweetUrl: tweet.url,
  verdict: classification.verdict,
});

const appendAutomationLog = (automationState, tweet, classification) => {
  const nextEntry = createAutomationLogEntry(tweet, classification);
  const previousEntries = Array.isArray(automationState?.recentEvaluations) ? automationState.recentEvaluations : [];

  return [nextEntry, ...previousEntries.filter((entry) => entry?.tweetId !== tweet.id)].slice(0, 20);
};

const updateTokenUsageTotals = (automationState, classification) => {
  const usage = classification.usage || {};
  const totals = automationState?.tokenUsage || {};

  return {
    totalInputTokens: (totals.totalInputTokens || 0) + (usage.inputTokens || 0),
    totalOutputTokens: (totals.totalOutputTokens || 0) + (usage.outputTokens || 0),
    totalReasoningTokens: (totals.totalReasoningTokens || 0) + (usage.reasoningTokens || 0),
    totalTokens: (totals.totalTokens || 0) + (usage.totalTokens || 0),
  };
};

const getAutomationEvents = (state) => (Array.isArray(state?.automationEvents) ? state.automationEvents : []);

const getAutomationEventKey = (event) =>
  [
    event?.type || "",
    event?.tweetId || "",
    event?.verdict || "",
    event?.message || "",
  ].join(":");

const appendAutomationEvent = (events, nextEvent) => {
  const nextKey = getAutomationEventKey(nextEvent);
  const previousEvents = Array.isArray(events) ? events : [];

  return [nextEvent, ...previousEvents.filter((entry) => getAutomationEventKey(entry) !== nextKey)].slice(
    0,
    MAX_AUTOMATION_EVENT_ENTRIES,
  );
};

const createErrorEvent = (message) => ({
  createdAt: Date.now(),
  message,
  type: "error",
});

const createSeedEvent = (tweet) => ({
  createdAt: Date.now(),
  tweetId: tweet.id,
  tweetText: tweet.fullText,
  tweetUrl: tweet.url,
  type: "seeded",
});

const createClassificationEvent = (type, tweet, classification) => ({
  confidence: classification.confidence,
  createdAt: Date.now(),
  inputTokens: classification.usage?.inputTokens || 0,
  outputTokens: classification.usage?.outputTokens || 0,
  rationale: classification.rationale,
  reasoningTokens: classification.usage?.reasoningTokens || 0,
  totalTokens: classification.usage?.totalTokens || 0,
  tweetId: tweet.id,
  tweetText: tweet.fullText,
  tweetUrl: tweet.url,
  type,
  verdict: classification.verdict,
});

const clearAutomationError = async () => {
  const current = await readSiteState();

  if (!current.automation.lastError) {
    return;
  }

  await updateSiteState((state) => ({
    ...state,
    automation: {
      ...state.automation,
      lastError: null,
    },
  }));
};

const recordAutomationError = async (message) => {
  try {
    await updateSiteState((state) => {
      if (state.automation.lastError === message) {
        return null;
      }

      return {
        ...state,
        automation: {
          ...state.automation,
          lastError: message,
        },
        automationEvents: appendAutomationEvent(getAutomationEvents(state), createErrorEvent(message)),
      };
    });
  } catch (error) {
    console.error("Unable to persist automation error", error);
  }
};

const getRecentTweetSearchStartDate = () =>
  new Date(Date.now() - RECENT_TWEET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

const fetchRecentTweetsFromUserFallback = async (rettiwt, startDate) => {
  const user = await rettiwt.user.details(TARGET_USERNAME);
  const userId = typeof user?.id === "string" ? user.id : "";

  if (!userId) {
    throw new Error(`Unable to resolve @${TARGET_USERNAME} for timeline fallback`);
  }

  const timelineResponses = await Promise.allSettled([
    rettiwt.user.timeline(userId, SEARCH_BATCH_SIZE),
    rettiwt.user.replies(userId, SEARCH_BATCH_SIZE),
  ]);
  const tweets = filterTweetsByStartDate(
    timelineResponses.flatMap((response) => (response.status === "fulfilled" ? normalizeTweetBatch(response.value) : [])),
    startDate,
  );

  if (tweets.length > 0) {
    return tweets;
  }

  const firstRejected = timelineResponses.find((response) => response.status === "rejected");
  if (firstRejected?.status === "rejected") {
    throw firstRejected.reason;
  }

  return [];
};

export const fetchRecentTweetsFromRettiwt = async (rettiwt, startDate = getRecentTweetSearchStartDate()) => {
  try {
    const searchResults = await rettiwt.tweet.search(
      {
        fromUsers: [TARGET_USERNAME],
        startDate,
      },
      SEARCH_BATCH_SIZE,
    );
    const tweets = filterTweetsByStartDate(normalizeTweetBatch(searchResults), startDate);

    if (tweets.length > 0) {
      return tweets;
    }
  } catch (error) {
    try {
      return await fetchRecentTweetsFromUserFallback(rettiwt, startDate);
    } catch (fallbackError) {
      throw new Error(
        `Tweet search failed: ${describeAutomationError(error, "Unknown Rettiwt search error")}; timeline fallback failed: ${describeAutomationError(fallbackError, "Unknown Rettiwt timeline error")}`,
        {
          cause: fallbackError,
        },
      );
    }
  }

  return fetchRecentTweetsFromUserFallback(rettiwt, startDate);
};

const fetchRecentTweets = async () => {
  try {
    const Rettiwt = await getRettiwt();
    const rettiwt = new Rettiwt({ apiKey: getRettiwtApiKey() });
    return await fetchRecentTweetsFromRettiwt(rettiwt);
  } catch (error) {
    throw new Error(`Tweet fetch failed: ${describeAutomationError(error, "Unknown Rettiwt error")}`, {
      cause: error,
    });
  }
};

const classifyTweet = async (tweet) => {
  try {
    const response = await getOpenAIClient().responses.create({
      model: getEnvValue("OPENAI_REASONING_MODEL", "") || DEFAULT_MODEL,
      reasoning: {
        effort: "medium",
      },
      input: [
        {
          content: [
            {
              text: classificationInstructions,
              type: "input_text",
            },
          ],
          role: "system",
        },
        {
          content: [
            {
              text: JSON.stringify(
                {
                  tweet: {
                    createdAt: tweet.createdAt,
                    fullText: tweet.fullText,
                    isReply: Boolean(tweet.replyTo),
                    quotedCreatedAt: tweet.quoted?.createdAt || null,
                    quotedText: tweet.quoted?.fullText || null,
                    quotedUrl: tweet.quoted?.url || null,
                    url: tweet.url,
                  },
                },
                null,
                2,
              ),
              type: "input_text",
            },
          ],
          role: "user",
        },
      ],
      text: {
        format: {
          name: "tweet_reset_classification",
          schema: classificationSchema,
          strict: true,
          type: "json_schema",
        },
      },
    });

    const rawOutput = response.output_text?.trim();

    if (!rawOutput) {
      throw new Error("OpenAI returned an empty classification response");
    }

    const parsed = JSON.parse(rawOutput);

    return normalizeClassification(tweet, {
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : "",
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      verdict: parsed.verdict,
    });
  } catch (error) {
    throw new Error(`Tweet classification failed: ${describeAutomationError(error, "Unknown OpenAI error")}`, {
      cause: error,
    });
  }
};

const sendReviewEmail = async (tweet, classification) => {
  const configUrl = `${getBaseUrl()}/config`;
  try {
    const { error } = await getResendClient().emails.send({
      from: getEnvValue("RESEND_FROM_EMAIL", ""),
      subject: "Review possible Codex reset tweet",
      text: [
        "The Codex reset monitor found a tweet that might indicate limits were reset.",
        "",
        `Tweet URL: ${tweet.url}`,
        `Posted: ${tweet.createdAt}`,
        "",
        "Tweet text:",
        tweet.fullText,
        "",
        `AI rationale: ${classification.rationale || "No rationale provided."}`,
        "",
        `Review it in the admin page: ${configUrl}`,
      ].join("\n"),
      to: [getReviewEmail()],
    });

    if (error) {
      throw new Error(error.message || "Unable to send review email");
    }
  } catch (error) {
    throw new Error(`Review email failed: ${describeAutomationError(error, "Unknown Resend error")}`, {
      cause: error,
    });
  }
};

const seedTimelineWatermark = async (tweet) =>
  updateSiteState((state) => ({
    ...state,
    automation: {
      ...state.automation,
      lastError: null,
      lastSeenTweetId: tweet.id,
      lastSeenTweetUrl: tweet.url,
    },
    automationEvents: appendAutomationEvent(getAutomationEvents(state), createSeedEvent(tweet)),
  }));

const markTweetAsNotReset = async (tweet, classification) =>
  updateSiteState((state) => ({
    ...state,
    automation: {
      ...state.automation,
      lastDecision: createDecisionRecord(tweet, classification),
      lastError: null,
      lastSeenTweetId: tweet.id,
      lastSeenTweetUrl: tweet.url,
      recentEvaluations: appendAutomationLog(state.automation, tweet, classification),
      tokenUsage: updateTokenUsageTotals(state.automation, classification),
    },
    automationEvents: appendAutomationEvent(
      getAutomationEvents(state),
      createClassificationEvent("not_reset", tweet, classification),
    ),
  }));

const markTweetForManualReview = async (tweet, classification) =>
  updateSiteState((state) => ({
    ...state,
    automation: {
      ...state.automation,
      lastDecision: createDecisionRecord(tweet, classification),
      lastError: null,
      lastSeenTweetId: tweet.id,
      lastSeenTweetUrl: tweet.url,
      pendingReview: createPendingReview(tweet, classification),
      recentEvaluations: appendAutomationLog(state.automation, tweet, classification),
      tokenUsage: updateTokenUsageTotals(state.automation, classification),
    },
    automationEvents: appendAutomationEvent(
      getAutomationEvents(state),
      createClassificationEvent("review_requested", tweet, classification),
    ),
  }));

const markTweetAsResetConfirmed = async (tweet, classification) =>
  updateSiteState(async (state) => {
    const nextState = await buildNextState({ state: "yes" }, state);

    return {
      ...nextState,
      auth: state.auth,
      automation: {
        ...state.automation,
        lastDecision: createDecisionRecord(tweet, classification),
        lastError: null,
        lastSeenTweetId: tweet.id,
        lastSeenTweetUrl: tweet.url,
        pendingReview: null,
        recentEvaluations: appendAutomationLog(state.automation, tweet, classification),
        tokenUsage: updateTokenUsageTotals(state.automation, classification),
      },
      automationEvents: appendAutomationEvent(
        getAutomationEvents(state),
        createClassificationEvent("reset_confirmed", tweet, classification),
      ),
    };
  });

export const isAuthorizedAutomationRequest = (request) => {
  const secret = getEnvValue("CRON_SECRET", "");

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
};

export const runResetMonitor = async (deps = {}) => {
  const configError = getRequiredConfigError();
  const readState = deps.readSiteState || readSiteState;
  const fetchTweets = deps.fetchRecentTweets || deps.fetchLatestTimelineTweets || fetchRecentTweets;
  const classify = deps.classifyTweet || classifyTweet;
  const sendEmail = deps.sendReviewEmail || sendReviewEmail;
  const clearError = deps.clearAutomationError || clearAutomationError;
  const recordError = deps.recordAutomationError || recordAutomationError;
  const seedWatermark = deps.seedTimelineWatermark || seedTimelineWatermark;
  const markNotReset = deps.markTweetAsNotReset || markTweetAsNotReset;
  const markReview = deps.markTweetForManualReview || markTweetForManualReview;
  const markResetConfirmed = deps.markTweetAsResetConfirmed || markTweetAsResetConfirmed;

  if (configError) {
    throw new Error(configError);
  }

  try {
    const currentState = await readState();
    const timelineTweets = await fetchTweets();
    const authoredTweets = timelineTweets.filter(isAuthoredTimelineTweet);
    const newestTweet = getNewestTweet(authoredTweets);

    if (!newestTweet) {
      await clearError();

      return {
        outcome: "no_tweets",
        processedCount: 0,
      };
    }

    if (!currentState.automation.lastSeenTweetId) {
      await seedWatermark(newestTweet);

      return {
        lastSeenTweetId: newestTweet.id,
        outcome: "seeded",
        processedCount: 0,
      };
    }

    const unseenTweets = getUnseenTweets(authoredTweets, currentState.automation.lastSeenTweetId);

    if (unseenTweets.length === 0) {
      await clearError();

      return {
        outcome: "no_new_tweets",
        processedCount: 0,
      };
    }

    let processedCount = 0;

    for (const tweet of unseenTweets) {
      const classification = normalizeClassification(tweet, await classify(tweet));
      processedCount += 1;

      if (classification.verdict === "not_reset") {
        await markNotReset(tweet, classification);
        continue;
      }

      if (classification.verdict === "reset_confirmed") {
        await markResetConfirmed(tweet, classification);

        return {
          outcome: "reset_confirmed",
          processedCount,
          tweetId: tweet.id,
          tweetUrl: tweet.url,
        };
      }

      await sendEmail(tweet, classification);
      await markReview(tweet, classification);

      return {
        outcome: "review_requested",
        processedCount,
        tweetId: tweet.id,
        tweetUrl: tweet.url,
      };
    }

    return {
      outcome: "no_reset_detected",
      processedCount,
      tweetId: unseenTweets[unseenTweets.length - 1].id,
      tweetUrl: unseenTweets[unseenTweets.length - 1].url,
    };
  } catch (error) {
    const message = describeAutomationError(error);
    await recordError(message);
    throw error;
  }
};
