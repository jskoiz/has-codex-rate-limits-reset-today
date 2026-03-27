import test from "node:test";
import assert from "node:assert/strict";

import {
  compareTweetIds,
  getUnseenTweets,
  isAuthoredTimelineTweet,
  runResetMonitor,
} from "../api/_lib/reset-monitor.mjs";

const createTweet = (id, overrides = {}) => ({
  createdAt: "2026-03-12T00:00:00.000Z",
  fullText: `tweet ${id}`,
  id,
  quoted: null,
  replyTo: null,
  retweetedTweet: null,
  tweetBy: {
    userName: "thsottiaux",
  },
  url: `https://x.com/thsottiaux/status/${id}`,
  ...overrides,
});

const withAutomationEnv = async (fn) => {
  const previous = {
    AI_REVIEW_EMAIL: process.env.AI_REVIEW_EMAIL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RETTIWT_API_KEY: process.env.RETTIWT_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SITE_BASE_URL: process.env.SITE_BASE_URL,
  };

  process.env.OPENAI_API_KEY = "test-openai";
  process.env.RESEND_API_KEY = "test-resend";
  process.env.RESEND_FROM_EMAIL = "sender@example.com";
  process.env.AI_REVIEW_EMAIL = "reviewer@example.com";
  process.env.SITE_BASE_URL = "https://example.com";
  process.env.RETTIWT_API_KEY = "test-rettiwt";

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test("compareTweetIds sorts tweet snowflakes numerically", () => {
  assert.equal(compareTweetIds("200", "100"), 1);
  assert.equal(compareTweetIds("100", "200"), -1);
  assert.equal(compareTweetIds("100", "100"), 0);
});

test("isAuthoredTimelineTweet excludes retweets and other authors", () => {
  assert.equal(isAuthoredTimelineTweet(createTweet("101")), true);
  assert.equal(isAuthoredTimelineTweet(createTweet("102", { retweetedTweet: createTweet("88") })), false);
  assert.equal(
    isAuthoredTimelineTweet(createTweet("103", { tweetBy: { userName: "someoneelse" } })),
    false,
  );
});

test("getUnseenTweets filters old tweets, de-duplicates IDs, and sorts ascending", () => {
  const tweets = [
    createTweet("105"),
    createTweet("103"),
    createTweet("104"),
    createTweet("104"),
    createTweet("106", { retweetedTweet: createTweet("99") }),
    createTweet("107", { tweetBy: { userName: "other" } }),
  ];

  const unseen = getUnseenTweets(tweets, "103");

  assert.deepEqual(
    unseen.map((tweet) => tweet.id),
    ["104", "105"],
  );
});

test("runResetMonitor seeds the watermark on first run", async () => {
  const calls = [];
  const newestTweet = createTweet("205");

  const result = await withAutomationEnv(() =>
    runResetMonitor({
      classifyTweet: async () => {
        throw new Error("should not classify during seed");
      },
      clearAutomationError: async () => {
        calls.push("clear");
      },
      fetchLatestTimelineTweets: async () => [newestTweet],
      readSiteState: async () => ({
        automation: {
          lastSeenTweetId: null,
        },
      }),
      recordAutomationError: async () => {
        calls.push("error");
      },
      seedTimelineWatermark: async (tweet) => {
        calls.push(["seed", tweet.id]);
      },
    }),
  );

  assert.deepEqual(calls, [["seed", "205"]]);
  assert.deepEqual(result, {
    lastSeenTweetId: "205",
    outcome: "seeded",
    processedCount: 0,
  });
});

test("runResetMonitor marks non-reset tweets and stops on a confirmed reset", async () => {
  const calls = [];
  const tweet104 = createTweet("104");
  const tweet105 = createTweet("105");

  const result = await withAutomationEnv(() =>
    runResetMonitor({
      classifyTweet: async (tweet) =>
        tweet.id === "104"
          ? { confidence: 0.12, rationale: "not a reset", verdict: "not_reset" }
          : { confidence: 0.96, rationale: "explicit reset", verdict: "reset_confirmed" },
      fetchLatestTimelineTweets: async () => [tweet105, tweet104],
      markTweetAsNotReset: async (tweet, classification) => {
        calls.push(["not_reset", tweet.id, classification.verdict]);
      },
      markTweetAsResetConfirmed: async (tweet, classification) => {
        calls.push(["reset_confirmed", tweet.id, classification.verdict]);
      },
      readSiteState: async () => ({
        automation: {
          lastSeenTweetId: "103",
        },
      }),
    }),
  );

  assert.deepEqual(calls, [
    ["not_reset", "104", "not_reset"],
    ["reset_confirmed", "105", "reset_confirmed"],
  ]);
  assert.deepEqual(result, {
    outcome: "reset_confirmed",
    processedCount: 2,
    tweetId: "105",
    tweetUrl: "https://x.com/thsottiaux/status/105",
  });
});

test("runResetMonitor requests manual review for uncertain tweets", async () => {
  const calls = [];
  const tweet = createTweet("301");

  const result = await withAutomationEnv(() =>
    runResetMonitor({
      classifyTweet: async () => ({
        confidence: 0.5,
        rationale: "ambiguous",
        verdict: "uncertain",
      }),
      fetchLatestTimelineTweets: async () => [tweet],
      markTweetForManualReview: async (inputTweet, classification) => {
        calls.push(["review", inputTweet.id, classification.verdict]);
      },
      readSiteState: async () => ({
        automation: {
          lastSeenTweetId: "300",
        },
      }),
      sendReviewEmail: async (inputTweet, classification) => {
        calls.push(["email", inputTweet.id, classification.verdict]);
      },
    }),
  );

  assert.deepEqual(calls, [
    ["email", "301", "uncertain"],
    ["review", "301", "uncertain"],
  ]);
  assert.deepEqual(result, {
    outcome: "review_requested",
    processedCount: 1,
    tweetId: "301",
    tweetUrl: "https://x.com/thsottiaux/status/301",
  });
});

test("runResetMonitor records errors before rethrowing", async () => {
  const recorded = [];

  await withAutomationEnv(() =>
    assert.rejects(
      runResetMonitor({
        fetchLatestTimelineTweets: async () => {
          throw new Error("timeline failed");
        },
        readSiteState: async () => ({
          automation: {
            lastSeenTweetId: "100",
          },
        }),
        recordAutomationError: async (message) => {
          recorded.push(message);
        },
      }),
      /timeline failed/,
    ),
  );

  assert.deepEqual(recorded, ["timeline failed"]);
});

test("runResetMonitor records wrapped provider errors without collapsing to unknown", async () => {
  const recorded = [];

  await withAutomationEnv(() =>
    assert.rejects(
      runResetMonitor({
        fetchLatestTimelineTweets: async () => {
          throw new Error("Tweet fetch failed: Unknown error (Couldn't get KEY_BYTE indices)");
        },
        readSiteState: async () => ({
          automation: {
            lastSeenTweetId: "100",
          },
        }),
        recordAutomationError: async (message) => {
          recorded.push(message);
        },
      }),
      /Tweet fetch failed: Unknown error \(Couldn't get KEY_BYTE indices\)/,
    ),
  );

  assert.deepEqual(recorded, ["Tweet fetch failed: Unknown error (Couldn't get KEY_BYTE indices)"]);
});
