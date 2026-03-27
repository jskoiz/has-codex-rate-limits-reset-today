import test from "node:test";
import assert from "node:assert/strict";

import {
  clearAdminSessionCookie,
  getDefaultAutomationState,
  normalizeStoredState,
  serializeStoredState,
} from "../api/_lib/site-state.mjs";

const withPrivateStateEnv = async (fn) => {
  const previous = {
    SITE_PRIVATE_STATE_SECRET: process.env.SITE_PRIVATE_STATE_SECRET,
    SITE_SESSION_SECRET: process.env.SITE_SESSION_SECRET,
  };

  process.env.SITE_PRIVATE_STATE_SECRET = "private-state-test-secret";
  process.env.SITE_SESSION_SECRET = "session-test-secret";

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

test("serializeStoredState keeps auth and automation data encrypted", async () => {
  await withPrivateStateEnv(async () => {
    const stored = serializeStoredState({
      auth: {
        sessions: [
          {
            createdAt: 10,
            exp: Date.now() + 60_000,
            id: "session-1",
          },
        ],
      },
      automation: {
        lastSeenTweetId: "123",
        lastSeenTweetUrl: "https://x.com/thsottiaux/status/123",
      },
      autoResetHours: 6,
      currentState: "yes",
      noSubtitles: ["Not yet"],
      resetAt: 20,
      updatedAt: 30,
    });

    assert.equal("auth" in stored, false);
    assert.equal("automation" in stored, false);
    assert.equal(typeof stored.privateState?.ciphertext, "string");
    assert.equal(typeof stored.privateState?.iv, "string");
    assert.equal(typeof stored.privateState?.tag, "string");

    const roundTrip = normalizeStoredState(stored);

    assert.equal(roundTrip.currentState, "yes");
    assert.equal(roundTrip.auth.sessions[0]?.id, "session-1");
    assert.equal(roundTrip.automation.lastSeenTweetId, "123");
    assert.equal(roundTrip.automation.lastSeenTweetUrl, "https://x.com/thsottiaux/status/123");
  });
});

test("normalizeStoredState preserves public fields when private state cannot be decrypted", async () => {
  await withPrivateStateEnv(async () => {
    const stored = serializeStoredState({
      auth: {
        sessions: [
          {
            createdAt: 10,
            exp: Date.now() + 60_000,
            id: "session-1",
          },
        ],
      },
      automation: {
        lastSeenTweetId: "123",
        lastSeenTweetUrl: "https://x.com/thsottiaux/status/123",
      },
      autoResetHours: 6,
      currentState: "yes",
      noSubtitles: ["Not yet"],
      resetAt: 20,
      updatedAt: 30,
    });

    process.env.SITE_PRIVATE_STATE_SECRET = "different-private-state-secret";

    const recovered = normalizeStoredState(stored);

    assert.equal(recovered.currentState, "yes");
    assert.equal(recovered.autoResetHours, 6);
    assert.deepEqual(recovered.noSubtitles, ["Not yet"]);
    assert.equal(recovered.resetAt, 20);
    assert.equal(recovered.updatedAt, 30);
    assert.equal(recovered.auth.sessions.length, 0);
    assert.equal(recovered.automation.lastSeenTweetId, null);
    assert.equal(recovered.automation.lastSeenTweetUrl, null);
  });
});

test("clearAdminSessionCookie sets Secure only for HTTPS requests", () => {
  const httpsCookie = clearAdminSessionCookie(new Request("https://example.com/config"));
  const httpCookie = clearAdminSessionCookie(new Request("http://localhost:8788/config"));

  assert.match(httpsCookie, /; Secure/);
  assert.doesNotMatch(httpCookie, /; Secure/);
});
