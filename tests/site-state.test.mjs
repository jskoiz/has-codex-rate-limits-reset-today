import test from "node:test";
import assert from "node:assert/strict";

import { getDefaultAutomationState, normalizeStoredState } from "../api/_lib/site-state.mjs";

test("default automation state includes a nullable last seen tweet URL", () => {
  const automation = getDefaultAutomationState();

  assert.equal(automation.lastSeenTweetId, null);
  assert.equal(automation.lastSeenTweetUrl, null);
});

test("normalizeStoredState preserves a persisted last seen tweet URL", () => {
  const state = normalizeStoredState({
    automation: {
      lastSeenTweetId: "123",
      lastSeenTweetUrl: "https://x.com/thsottiaux/status/123",
    },
  });

  assert.equal(state.automation.lastSeenTweetId, "123");
  assert.equal(state.automation.lastSeenTweetUrl, "https://x.com/thsottiaux/status/123");
});

test("normalizeStoredState derives a legacy last seen tweet URL from recent automation data", () => {
  const state = normalizeStoredState({
    automation: {
      lastSeenTweetId: "123",
      recentEvaluations: [
        {
          evaluatedAt: 1,
          tweetId: "123",
          tweetText: "limits are back",
          tweetUrl: "https://x.com/thsottiaux/status/123",
          verdict: "reset_confirmed",
        },
      ],
    },
  });

  assert.equal(state.automation.lastSeenTweetId, "123");
  assert.equal(state.automation.lastSeenTweetUrl, "https://x.com/thsottiaux/status/123");
});
