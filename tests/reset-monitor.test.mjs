import test from "node:test";
import assert from "node:assert/strict";

import { compareTweetIds, getUnseenTweets, isAuthoredTimelineTweet } from "../api/_lib/reset-monitor.mjs";

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
