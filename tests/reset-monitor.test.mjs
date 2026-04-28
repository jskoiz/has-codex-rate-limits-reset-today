import test from "node:test";
import assert from "node:assert/strict";

import {
  compareTweetIds,
  fetchRecentTweetsFromRettiwt,
  getUnseenTweets,
  isAuthorizedAutomationRequest,
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

test("fetchRecentTweetsFromRettiwt falls back to user timelines when search fails", async () => {
  const recentTimelineTweet = createTweet("110", {
    createdAt: "2026-03-12T12:00:00.000Z",
  });
  const oldReplyTweet = createTweet("109", {
    createdAt: "2026-03-10T12:00:00.000Z",
  });
  const startDate = new Date("2026-03-12T00:00:00.000Z");

  const tweets = await fetchRecentTweetsFromRettiwt(
    {
      tweet: {
        search: async () => {
          throw new Error("search broke");
        },
      },
      user: {
        details: async () => ({ id: "user-1" }),
        replies: async () => ({ list: [oldReplyTweet, recentTimelineTweet] }),
        timeline: async () => ({ list: [recentTimelineTweet] }),
      },
    },
    startDate,
  );

  assert.deepEqual(
    tweets.map((tweet) => tweet.id),
    ["110"],
  );
});

test("fetchRecentTweetsFromRettiwt uses the known target user id when user details lookup is broken", async () => {
  const recentTimelineTweet = createTweet("111", {
    createdAt: "2026-03-12T12:00:00.000Z",
  });
  const startDate = new Date("2026-03-12T00:00:00.000Z");
  const calls = [];

  const tweets = await fetchRecentTweetsFromRettiwt(
    {
      tweet: {
        search: async () => ({ list: [] }),
      },
      user: {
        details: async () => {
          throw new Error("Cannot read properties of undefined (reading '0')");
        },
        replies: async (userId) => {
          calls.push(["replies", userId]);
          return { list: [] };
        },
        timeline: async (userId) => {
          calls.push(["timeline", userId]);
          return { list: [recentTimelineTweet] };
        },
      },
    },
    startDate,
  );

  assert.deepEqual(
    calls,
    [
      ["timeline", "1953337039510003712"],
      ["replies", "1953337039510003712"],
    ],
  );
  assert.deepEqual(
    tweets.map((tweet) => tweet.id),
    ["111"],
  );
});

test("fetchRecentTweetsFromRettiwt falls back when search returns no recent tweets", async () => {
  const recentReplyTweet = createTweet("210", {
    createdAt: "2026-03-12T03:00:00.000Z",
  });
  const startDate = new Date("2026-03-12T00:00:00.000Z");

  const tweets = await fetchRecentTweetsFromRettiwt(
    {
      tweet: {
        search: async () => ({ list: [] }),
      },
      user: {
        details: async () => ({ id: "user-2" }),
        replies: async () => ({ list: [recentReplyTweet] }),
        timeline: async () => ({ list: [] }),
      },
    },
    startDate,
  );

  assert.deepEqual(
    tweets.map((tweet) => tweet.id),
    ["210"],
  );
});

test("fetchRecentTweetsFromRettiwt merges timeline tweets even when search succeeds", async () => {
  const searchTweet = createTweet("220", {
    createdAt: "2026-03-12T03:00:00.000Z",
  });
  const timelineTweet = createTweet("221", {
    createdAt: "2026-03-12T04:00:00.000Z",
    fullText: "I have reset Codex rate limits.",
  });
  const startDate = new Date("2026-03-12T00:00:00.000Z");

  const tweets = await fetchRecentTweetsFromRettiwt(
    {
      tweet: {
        search: async () => ({ list: [searchTweet] }),
      },
      user: {
        details: async () => ({ id: "user-3" }),
        replies: async () => ({ list: [] }),
        timeline: async () => ({ list: [timelineTweet] }),
      },
    },
    startDate,
  );

  assert.deepEqual(
    tweets.map((tweet) => tweet.id),
    ["220", "221"],
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

test("runResetMonitor uses quoted reset context for future-looking tweets with a short public rationale", async () => {
  const stored = [];
  const tweet = createTweet("401", {
    fullText:
      "At the current codex growth pace, we will owe you all another reset in less than two weeks.",
    quoted: {
      createdAt: "2026-04-07T16:33:00.000Z",
      fullText: "To celebrate, we're resetting rate limits so you can keep building.",
      url: "https://x.com/thsottiaux/status/399",
    },
  });

  await withAutomationEnv(() =>
    runResetMonitor({
      classifyTweet: async () => ({
        confidence: 0.87,
        rationale:
          "The quoted post explicitly says Codex rate limits are being reset now; the new tweet discusses when the next reset will be needed, implying a reset has already happened.",
        verdict: "reset_confirmed",
      }),
      fetchLatestTimelineTweets: async () => [tweet],
      markTweetAsResetConfirmed: async (_tweet, classification) => {
        stored.push(classification);
      },
      readSiteState: async () => ({
        automation: {
          lastSeenTweetId: "400",
        },
      }),
    }),
  );

  assert.equal(stored.length, 1);
  assert.equal(stored[0].rationale, "Quoted post confirms limits already reset; this post discusses the next reset.");
  assert.equal(stored[0].verdict, "reset_confirmed");
});

test("runResetMonitor trims long rationales before they reach public state", async () => {
  const stored = [];
  const tweet = createTweet("402");

  await withAutomationEnv(() =>
    runResetMonitor({
      classifyTweet: async () => ({
        confidence: 0.42,
        rationale:
          "This post talks around rate limits in a way that could be interpreted as a reset signal, but it never clearly states limits are available again right now for users.",
        verdict: "uncertain",
      }),
      fetchLatestTimelineTweets: async () => [tweet],
      markTweetForManualReview: async (_tweet, classification) => {
        stored.push(classification);
      },
      readSiteState: async () => ({
        automation: {
          lastSeenTweetId: "401",
        },
      }),
      sendReviewEmail: async () => {},
    }),
  );

  assert.equal(stored.length, 1);
  assert.ok(stored[0].rationale.length <= 120);
  assert.match(stored[0].rationale, /…$/);
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

test("isAuthorizedAutomationRequest accepts normalized bearer tokens", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = '  "test-secret"  ';

  try {
    assert.equal(
      isAuthorizedAutomationRequest({
        headers: new Headers({
          authorization: "Bearer test-secret",
        }),
      }),
      true,
    );
    assert.equal(
      isAuthorizedAutomationRequest({
        headers: new Headers({
          authorization: 'Bearer "test-secret"',
        }),
      }),
      true,
    );
    assert.equal(
      isAuthorizedAutomationRequest({
        headers: new Headers({
          authorization: "Bearer wrong-secret",
        }),
      }),
      false,
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  }
});
