import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  clearAdminSessionCookie,
  getDefaultAutomationState,
  getDefaultAutomationEvents,
  isAuthorizedRequest,
  issueAdminSession,
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

test("default automation events are empty", () => {
  assert.deepEqual(getDefaultAutomationEvents(), []);
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

test("serializeStoredState keeps auth encrypted and automation durable", async () => {
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
      automationEvents: [
        {
          createdAt: 40,
          tweetId: "123",
          tweetText: "limits are back",
          tweetUrl: "https://x.com/thsottiaux/status/123",
          type: "reset_confirmed",
          verdict: "reset_confirmed",
        },
      ],
      autoResetHours: 6,
      currentState: "yes",
      noSubtitles: ["Not yet"],
      yesSubtitles: ["It is back"],
      resetAt: 20,
      updatedAt: 30,
    });

    assert.equal("auth" in stored, false);
    assert.equal(stored.automation.lastSeenTweetId, "123");
    assert.equal(typeof stored.privateState?.ciphertext, "string");
    assert.equal(typeof stored.privateState?.iv, "string");
    assert.equal(typeof stored.privateState?.tag, "string");

    const roundTrip = normalizeStoredState(stored);

    assert.equal(roundTrip.currentState, "yes");
    assert.equal(roundTrip.auth.sessions[0]?.id, "session-1");
    assert.equal(roundTrip.automation.lastSeenTweetId, "123");
    assert.equal(roundTrip.automation.lastSeenTweetUrl, "https://x.com/thsottiaux/status/123");
    assert.equal(roundTrip.automationEvents[0]?.tweetId, "123");
    assert.equal(roundTrip.automationEvents[0]?.type, "reset_confirmed");
    assert.deepEqual(roundTrip.yesSubtitles, ["It is back"]);
  });
});

test("normalizeStoredState reads legacy automation history from encrypted private state", async () => {
  await withPrivateStateEnv(async () => {
    const secret = crypto.createHash("sha256").update(process.env.SITE_PRIVATE_STATE_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
    const plaintext = JSON.stringify({
      auth: {
        sessions: [],
      },
      automation: {
        lastDecision: {
          confidence: 0.91,
          decidedAt: 50,
          rationale: "explicit reset",
          tweetId: "555",
          tweetUrl: "https://x.com/thsottiaux/status/555",
          verdict: "reset_confirmed",
        },
        lastSeenTweetId: "555",
        lastSeenTweetUrl: "https://x.com/thsottiaux/status/555",
      },
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const legacyStored = {
      autoResetHours: 6,
      currentState: "yes",
      noSubtitles: ["Not yet"],
      yesSubtitles: ["It is back"],
      privateState: {
        ciphertext: ciphertext.toString("base64url"),
        iv: iv.toString("base64url"),
        tag: tag.toString("base64url"),
        version: 1,
      },
      resetAt: 20,
      updatedAt: 30,
    };

    const roundTrip = normalizeStoredState(legacyStored);

    assert.equal(roundTrip.automation.lastSeenTweetId, "555");
    assert.equal(roundTrip.automation.lastDecision?.tweetId, "555");
    assert.equal(roundTrip.automationEvents.length, 0);
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
      yesSubtitles: ["It is back"],
      resetAt: 20,
      updatedAt: 30,
    });

    process.env.SITE_PRIVATE_STATE_SECRET = "different-private-state-secret";

    const recovered = normalizeStoredState(stored);

    assert.equal(recovered.currentState, "yes");
    assert.equal(recovered.autoResetHours, 6);
    assert.deepEqual(recovered.noSubtitles, ["Not yet"]);
    assert.deepEqual(recovered.yesSubtitles, ["It is back"]);
    assert.equal(recovered.resetAt, 20);
    assert.equal(recovered.updatedAt, 30);
    assert.equal(recovered.auth.sessions.length, 0);
    assert.equal(recovered.automation.lastSeenTweetId, "123");
    assert.equal(recovered.automation.lastSeenTweetUrl, "https://x.com/thsottiaux/status/123");
  });
});

test("normalizeStoredState derives automation events from durable evaluation history", () => {
  const state = normalizeStoredState({
    automation: {
      recentEvaluations: [
        {
          evaluatedAt: 50,
          rationale: "clear reset statement",
          tweetId: "456",
          tweetText: "limits reset",
          tweetUrl: "https://x.com/thsottiaux/status/456",
          verdict: "reset_confirmed",
        },
      ],
    },
  });

  assert.equal(state.automationEvents[0]?.type, "reset_confirmed");
  assert.equal(state.automationEvents[0]?.tweetId, "456");
});

test("clearAdminSessionCookie sets Secure only for HTTPS requests", () => {
  const httpsCookie = clearAdminSessionCookie(new Request("https://example.com/config"));
  const httpCookie = clearAdminSessionCookie(new Request("http://localhost:8788/config"));

  assert.match(httpsCookie, /; Secure/);
  assert.doesNotMatch(httpCookie, /; Secure/);
});

test("issueAdminSession creates a stateless cookie accepted by isAuthorizedRequest", async () => {
  await withPrivateStateEnv(async () => {
    const request = new Request("https://example.com/config", {
      headers: {
        "user-agent": "site-state-test",
        "x-forwarded-for": "127.0.0.1",
      },
    });

    const cookie = await issueAdminSession(request);
    const token = cookie.match(/site_admin_session=([^;]+)/)?.[1];

    assert.ok(token);

    const authorized = await isAuthorizedRequest(new Request("https://example.com/config", {
      headers: {
        cookie: `site_admin_session=${token}`,
      },
    }));

    assert.equal(authorized, true);
  });
});
