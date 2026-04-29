import test from "node:test";
import assert from "node:assert/strict";

import { createPublicAutomationSummary } from "../api/status.mjs";

test("createPublicAutomationSummary pins the last reset details while the site is yes", () => {
  const summary = createPublicAutomationSummary({
    lastDecision: {
      confidence: 0.99,
      decidedAt: 50,
      rationale: "decision rationale",
      tweetId: "111",
      tweetUrl: "https://x.com/thsottiaux/status/111",
      verdict: "reset_confirmed",
    },
    recentEvaluations: [
      {
        confidence: 0.99,
        evaluatedAt: 120,
        inputTokens: 378,
        outputTokens: 66,
        rationale: "conversational reply",
        reasoningTokens: 22,
        totalTokens: 466,
        tweetId: "333",
        tweetText: "not a banana",
        tweetUrl: "https://x.com/thsottiaux/status/333",
        verdict: "not_reset",
      },
      {
        confidence: 0.97,
        evaluatedAt: 100,
        inputTokens: 376,
        outputTokens: 91,
        rationale: "explicit reset statement",
        reasoningTokens: 36,
        totalTokens: 467,
        tweetId: "222",
        tweetText: "we're resetting rate limits",
        tweetUrl: "https://x.com/thsottiaux/status/222",
        verdict: "reset_confirmed",
      },
    ],
    tokenUsage: {
      totalInputTokens: 19932,
      totalOutputTokens: 6412,
      totalReasoningTokens: 3147,
      totalTokens: 26344,
    },
  }, "yes");

  assert.equal(summary.checkedAt, 100);
  assert.equal(summary.tweetId, "222");
  assert.equal(summary.tweetText, "we're resetting rate limits");
  assert.equal(summary.usage.totalTokens, 467);
  assert.equal(summary.totals.totalTokens, 26344);
  assert.equal(summary.verdict, "reset_confirmed");
  assert.equal(summary.mode, "active");
  assert.equal(summary.latest?.tweetId, "333");
  assert.equal(summary.latest?.verdict, "not_reset");
  assert.equal(summary.lastReset?.tweetId, "222");
});

test("createPublicAutomationSummary keeps the last reset pinned when the site is no", () => {
  const summary = createPublicAutomationSummary({
    recentEvaluations: [
      {
        confidence: 0.99,
        evaluatedAt: 120,
        inputTokens: 378,
        outputTokens: 66,
        rationale: "conversational reply",
        reasoningTokens: 22,
        totalTokens: 466,
        tweetId: "333",
        tweetText: "not a banana",
        tweetUrl: "https://x.com/thsottiaux/status/333",
        verdict: "not_reset",
      },
      {
        confidence: 0.97,
        evaluatedAt: 100,
        inputTokens: 376,
        outputTokens: 91,
        rationale: "explicit reset statement",
        reasoningTokens: 36,
        totalTokens: 467,
        tweetId: "222",
        tweetText: "we're resetting rate limits",
        tweetUrl: "https://x.com/thsottiaux/status/222",
        verdict: "reset_confirmed",
      },
    ],
  }, "no");

  assert.equal(summary.mode, "inactive");
  assert.equal(summary.tweetId, "222");
  assert.equal(summary.verdict, "reset_confirmed");
  assert.equal(summary.latest?.tweetId, "333");
  assert.equal(summary.latest?.verdict, "not_reset");
  assert.equal(summary.lastReset?.tweetId, "222");
});

test("createPublicAutomationSummary falls back to the last seen tweet watermark", () => {
  const summary = createPublicAutomationSummary({
    lastSeenTweetId: "333",
    lastSeenTweetUrl: "https://x.com/thsottiaux/status/333",
  });

  assert.equal(summary.checkedAt, null);
  assert.equal(summary.tweetId, "333");
  assert.equal(summary.tweetUrl, "https://x.com/thsottiaux/status/333");
  assert.equal(summary.verdict, null);
  assert.equal(summary.usage.totalTokens, 0);
});

test("createPublicAutomationSummary returns null when nothing is tracked yet", () => {
  assert.equal(createPublicAutomationSummary({}), null);
});
