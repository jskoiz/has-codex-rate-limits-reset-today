import OpenAI from "openai";
import { Resend } from "resend";

import { buildNextState, readSiteState, updateSiteState } from "./site-state.mjs";

const TARGET_USERNAME = "thsottiaux";
const DEFAULT_MODEL = "gpt-5.4";
const RECENT_TWEET_LOOKBACK_DAYS = 1;
const SEARCH_BATCH_SIZE = 20;

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

Return "reset_confirmed" only when the tweet clearly says or directly implies that user limits, caps, or rate limits have reset, been lifted, or usage is available again now.
Return "not_reset" when the tweet is unrelated, promotional, conversational, or does not mean limits were reset.
Return "uncertain" when the tweet could plausibly be about a reset but is not explicit enough to safely auto-switch the public site.

Prefer caution over guessing. Replies and quote tweets may provide context, but if the reset meaning is not clear from this post and its quoted text, use "uncertain".
Keep the rationale brief and concrete.
`.trim();

const getBaseUrl = () => (process.env.SITE_BASE_URL || "").replace(/\/+$/, "");

const getReviewEmail = () => (process.env.AI_REVIEW_EMAIL || "").trim();
const getRettiwtApiKey = () => (process.env.RETTIWT_API_KEY || "").trim();

const getRequiredConfigError = () => {
  const missing = [
    ["RETTIWT_API_KEY", getRettiwtApiKey()],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["RESEND_API_KEY", process.env.RESEND_API_KEY],
    ["RESEND_FROM_EMAIL", process.env.RESEND_FROM_EMAIL],
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
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
};

const getResendClient = () => {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
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
      };
    });
  } catch (error) {
    console.error("Unable to persist automation error", error);
  }
};

const getRecentTweetSearchStartDate = () =>
  new Date(Date.now() - RECENT_TWEET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

const fetchRecentTweets = async () => {
  const Rettiwt = await getRettiwt();
  const rettiwt = new Rettiwt({ apiKey: getRettiwtApiKey() });
  const searchResults = await rettiwt.tweet.search(
    {
      fromUsers: [TARGET_USERNAME],
      startDate: getRecentTweetSearchStartDate(),
    },
    SEARCH_BATCH_SIZE,
  );

  return Array.isArray(searchResults?.list) ? searchResults.list : [];
};

const classifyTweet = async (tweet) => {
  const response = await getOpenAIClient().responses.create({
    model: process.env.OPENAI_REASONING_MODEL || DEFAULT_MODEL,
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
                  quotedText: tweet.quoted?.fullText || null,
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

  return {
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : "",
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
    verdict: parsed.verdict,
  };
};

const sendReviewEmail = async (tweet, classification) => {
  const configUrl = `${getBaseUrl()}/config`;
  const { error } = await getResendClient().emails.send({
    from: process.env.RESEND_FROM_EMAIL,
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
    };
  });

export const isAuthorizedAutomationRequest = (request) => {
  const secret = process.env.CRON_SECRET || "";

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
      const classification = await classify(tweet);
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
    const message = error instanceof Error ? error.message : "Unknown reset monitor error";
    await recordError(message);
    throw error;
  }
};
