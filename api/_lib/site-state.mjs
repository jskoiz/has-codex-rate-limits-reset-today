import crypto from "node:crypto";

const DEFAULT_AUTO_RESET_HOURS = 20;
const DEFAULT_NO_SUBTITLES = ["Limits have not reset yet."];
const ADMIN_COOKIE_NAME = "site_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_TRACKED_LOGIN_FAILURES = 128;
const MAX_ACTIVE_SESSIONS = 32;
const MAX_GITHUB_WRITE_ATTEMPTS = 3;
const MAX_AUTOMATION_LOG_ENTRIES = 20;
const PRIVATE_STATE_VERSION = 1;
const SITE_STATE_PATH = "data/site-state.json";
const DEFAULT_GITHUB_COMMIT_NAME = "codex-limit-bot";
const DEFAULT_GITHUB_COMMIT_EMAIL = "codex-limit-bot@users.noreply.github.com";

const jsonHeaders = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "cdn-cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  expires: "0",
  pragma: "no-cache",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const getEnvValue = (key, fallback = "") => {
  const runtimeValue = globalThis.__CF_PAGES_ENV__?.[key];

  if (typeof runtimeValue === "string") {
    return runtimeValue;
  }

  const envValue = process.env[key];
  return typeof envValue === "string" ? envValue : fallback;
};

const base64UrlEncode = (value) => Buffer.from(value).toString("base64url");

const base64UrlDecode = (value) => Buffer.from(value, "base64url").toString("utf8");

const parseCookieHeader = (cookieHeader) => {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(/;\s*/).reduce((cookies, chunk) => {
    const separatorIndex = chunk.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = value;
    }

    return cookies;
  }, {});
};

const createSignature = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const getSessionSecret = () => getEnvValue("SITE_SESSION_SECRET", "").trim() || getEnvValue("ADMIN_SESSION_SECRET", "").trim();

const getPrivateStateSecret = () => getEnvValue("SITE_PRIVATE_STATE_SECRET", "").trim() || getSessionSecret();

const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

const createSessionToken = (session) => {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("Missing SITE_SESSION_SECRET environment variable");
  }

  const payload = JSON.stringify({
    exp: session.exp,
    nonce: crypto.randomBytes(12).toString("hex"),
    sid: session.id,
  });
  const encodedPayload = base64UrlEncode(payload);
  const signature = createSignature(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

const readSessionTokenPayload = (token) => {
  const secret = getSessionSecret();

  if (!secret || !token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, providedSignature] = token.split(".");
  const expectedSignature = createSignature(encodedPayload, secret);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!Number.isFinite(payload?.exp) || payload.exp <= Date.now() || typeof payload?.sid !== "string") {
      return null;
    }

    return {
      exp: payload.exp,
      sid: payload.sid,
    };
  } catch (_error) {
    return null;
  }
};

const normalizeState = (state) => (state === "yes" ? "yes" : "no");

const normalizeHours = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : DEFAULT_AUTO_RESET_HOURS;
};

const normalizeNoSubtitles = (value) => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_NO_SUBTITLES];
  }

  const subtitles = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  return subtitles.length > 0 ? subtitles : [...DEFAULT_NO_SUBTITLES];
};

const normalizeConfidence = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.min(1, numericValue));
};

const normalizeAutomationDecision = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const verdict = ["reset_confirmed", "not_reset", "uncertain"].includes(value?.verdict) ? value.verdict : null;
  const tweetId = typeof value?.tweetId === "string" ? value.tweetId : null;
  const tweetUrl = typeof value?.tweetUrl === "string" ? value.tweetUrl : null;

  if (!verdict || !tweetId || !tweetUrl) {
    return null;
  }

  return {
    confidence: normalizeConfidence(value?.confidence),
    decidedAt: Number.isFinite(value?.decidedAt) ? value.decidedAt : null,
    rationale: typeof value?.rationale === "string" ? value.rationale.trim() : "",
    tweetId,
    tweetUrl,
    verdict,
  };
};

const normalizePendingReview = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const tweetId = typeof value?.tweetId === "string" ? value.tweetId : null;
  const tweetText = typeof value?.tweetText === "string" ? value.tweetText.trim() : "";
  const tweetUrl = typeof value?.tweetUrl === "string" ? value.tweetUrl : null;

  if (!tweetId || !tweetText || !tweetUrl || !Number.isFinite(value?.createdAt)) {
    return null;
  }

  return {
    confidence: normalizeConfidence(value?.confidence),
    createdAt: value.createdAt,
    rationale: typeof value?.rationale === "string" ? value.rationale.trim() : "",
    tweetId,
    tweetText,
    tweetUrl,
  };
};

const normalizeAutomationLogEntry = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const verdict = ["reset_confirmed", "not_reset", "uncertain"].includes(value?.verdict) ? value.verdict : null;
  const tweetId = typeof value?.tweetId === "string" ? value.tweetId : null;
  const tweetUrl = typeof value?.tweetUrl === "string" ? value.tweetUrl : null;
  const tweetText = typeof value?.tweetText === "string" ? value.tweetText.trim() : "";

  if (!verdict || !tweetId || !tweetUrl || !tweetText || !Number.isFinite(value?.evaluatedAt)) {
    return null;
  }

  return {
    confidence: normalizeConfidence(value?.confidence),
    evaluatedAt: value.evaluatedAt,
    inputTokens: Number.isFinite(value?.inputTokens) ? value.inputTokens : 0,
    outputTokens: Number.isFinite(value?.outputTokens) ? value.outputTokens : 0,
    rationale: typeof value?.rationale === "string" ? value.rationale.trim() : "",
    reasoningTokens: Number.isFinite(value?.reasoningTokens) ? value.reasoningTokens : 0,
    totalTokens: Number.isFinite(value?.totalTokens) ? value.totalTokens : 0,
    tweetId,
    tweetText,
    tweetUrl,
    verdict,
  };
};

const deriveLastSeenTweetUrl = (lastSeenTweetId, sources = []) => {
  if (!lastSeenTweetId) {
    return null;
  }

  for (const source of sources) {
    if (source?.tweetId === lastSeenTweetId && typeof source?.tweetUrl === "string") {
      return source.tweetUrl;
    }
  }

  return null;
};

export const getDefaultAutomationState = () => ({
  lastDecision: null,
  lastError: null,
  lastSeenTweetId: null,
  lastSeenTweetUrl: null,
  pendingReview: null,
  recentEvaluations: [],
  tokenUsage: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalTokens: 0,
  },
});

const normalizeAutomationState = (value) => {
  const defaults = getDefaultAutomationState();
  const lastError = typeof value?.lastError === "string" ? value.lastError.trim() : "";
  const lastDecision = normalizeAutomationDecision(value?.lastDecision);
  const pendingReview = normalizePendingReview(value?.pendingReview);
  const recentEvaluations = Array.isArray(value?.recentEvaluations)
    ? value.recentEvaluations
        .map(normalizeAutomationLogEntry)
        .filter(Boolean)
        .sort((left, right) => right.evaluatedAt - left.evaluatedAt)
        .slice(0, MAX_AUTOMATION_LOG_ENTRIES)
    : [];
  const lastSeenTweetId = typeof value?.lastSeenTweetId === "string" ? value.lastSeenTweetId : null;
  const persistedLastSeenTweetUrl =
    typeof value?.lastSeenTweetUrl === "string" ? value.lastSeenTweetUrl.trim() : "";

  return {
    ...defaults,
    lastDecision,
    lastError: lastError || null,
    lastSeenTweetId,
    lastSeenTweetUrl:
      persistedLastSeenTweetUrl || deriveLastSeenTweetUrl(lastSeenTweetId, [pendingReview, lastDecision, ...recentEvaluations]),
    pendingReview,
    recentEvaluations,
    tokenUsage: {
      totalInputTokens: Number.isFinite(value?.tokenUsage?.totalInputTokens) ? value.tokenUsage.totalInputTokens : 0,
      totalOutputTokens: Number.isFinite(value?.tokenUsage?.totalOutputTokens) ? value.tokenUsage.totalOutputTokens : 0,
      totalReasoningTokens:
        Number.isFinite(value?.tokenUsage?.totalReasoningTokens) ? value.tokenUsage.totalReasoningTokens : 0,
      totalTokens: Number.isFinite(value?.tokenUsage?.totalTokens) ? value.tokenUsage.totalTokens : 0,
    },
  };
};

const normalizeAuthState = (value, now = Date.now()) => {
  const sessionMap = new Map();
  const loginFailureMap = new Map();

  if (Array.isArray(value?.sessions)) {
    value.sessions.forEach((entry) => {
      if (typeof entry?.id !== "string" || !Number.isFinite(entry?.exp) || entry.exp <= now) {
        return;
      }

      sessionMap.set(entry.id, {
        createdAt: Number.isFinite(entry?.createdAt) ? entry.createdAt : now,
        exp: entry.exp,
        id: entry.id,
      });
    });
  }

  if (Array.isArray(value?.loginFailures)) {
    value.loginFailures.forEach((entry) => {
      if (typeof entry?.key !== "string") {
        return;
      }

      const count = Math.max(0, Math.floor(Number(entry?.count) || 0));
      const firstFailedAt = Number.isFinite(entry?.firstFailedAt) ? entry.firstFailedAt : now;
      const lastFailedAt = Number.isFinite(entry?.lastFailedAt) ? entry.lastFailedAt : firstFailedAt;
      const lockedUntil = Number.isFinite(entry?.lockedUntil) ? entry.lockedUntil : null;
      const isStillRelevant = (lockedUntil && lockedUntil > now) || now - lastFailedAt <= LOGIN_FAILURE_WINDOW_MS;

      if (!count || !isStillRelevant) {
        return;
      }

      loginFailureMap.set(entry.key, {
        count,
        firstFailedAt,
        key: entry.key,
        lastFailedAt,
        lockedUntil,
      });
    });
  }

  return {
    loginFailures: Array.from(loginFailureMap.values())
      .sort((left, right) => right.lastFailedAt - left.lastFailedAt)
      .slice(0, MAX_TRACKED_LOGIN_FAILURES),
    sessions: Array.from(sessionMap.values())
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_ACTIVE_SESSIONS),
  };
};

const normalizePublicState = (value) => {
  const currentState = normalizeState(value?.currentState);

  return {
    currentState,
    autoResetHours: normalizeHours(value?.autoResetHours),
    noSubtitles: normalizeNoSubtitles(value?.noSubtitles),
    resetAt: currentState === "yes" && Number.isFinite(value?.resetAt) ? value.resetAt : null,
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
  };
};

const normalizePrivateState = (value) => ({
  auth: normalizeAuthState(value?.auth),
  automation: normalizeAutomationState(value?.automation),
});

const createPrivateStateKey = (secret) => crypto.createHash("sha256").update(secret).digest();

const encryptPrivateState = (value) => {
  const secret = getPrivateStateSecret();

  if (!secret) {
    throw new Error("Missing SITE_PRIVATE_STATE_SECRET or SITE_SESSION_SECRET environment variable");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", createPrivateStateKey(secret), iv);
  const plaintext = JSON.stringify(normalizePrivateState(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    version: PRIVATE_STATE_VERSION,
  };
};

const decryptPrivateState = (value) => {
  if (!value || typeof value !== "object") {
    return normalizePrivateState({});
  }

  const ciphertext = typeof value?.ciphertext === "string" ? value.ciphertext : "";
  const iv = typeof value?.iv === "string" ? value.iv : "";
  const tag = typeof value?.tag === "string" ? value.tag : "";

  if (!ciphertext || !iv || !tag) {
    return normalizePrivateState({});
  }

  if (value.version !== PRIVATE_STATE_VERSION) {
    throw new Error(`Unsupported private state version: ${value.version}`);
  }

  const secret = getPrivateStateSecret();

  if (!secret) {
    throw new Error("Missing SITE_PRIVATE_STATE_SECRET or SITE_SESSION_SECRET environment variable");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      createPrivateStateKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    return normalizePrivateState(JSON.parse(plaintext));
  } catch (error) {
    console.warn(`Unable to decrypt private state: ${error instanceof Error ? error.message : "Unknown error"}`);
    return normalizePrivateState({});
  }
};

const getStoredPrivateState = (value) => {
  if (value?.privateState && typeof value.privateState === "object") {
    return decryptPrivateState(value.privateState);
  }

  return normalizePrivateState({
    auth: value?.auth,
    automation: value?.automation,
  });
};

export const normalizeStoredState = (value) => ({
  ...normalizePublicState(value),
  ...getStoredPrivateState(value),
});

export const serializeStoredState = (value) => {
  const normalizedState = normalizeStoredState(value);

  return {
    ...normalizePublicState(normalizedState),
    privateState: encryptPrivateState(normalizedState),
  };
};

const getTrimmedEnv = (key, fallback = "") => {
  return getEnvValue(key, fallback).trim();
};

const getGithubCommitMetadata = () => {
  const commitName = getTrimmedEnv("GITHUB_COMMIT_NAME", DEFAULT_GITHUB_COMMIT_NAME);
  const commitEmail = getTrimmedEnv("GITHUB_COMMIT_EMAIL", DEFAULT_GITHUB_COMMIT_EMAIL);

  return {
    author: {
      email: getTrimmedEnv("GITHUB_AUTHOR_EMAIL", commitEmail),
      name: getTrimmedEnv("GITHUB_AUTHOR_NAME", commitName),
    },
    committer: {
      email: getTrimmedEnv("GITHUB_COMMITTER_EMAIL", commitEmail),
      name: getTrimmedEnv("GITHUB_COMMITTER_NAME", commitName),
    },
  };
};

const getGithubConfig = () => {
  const token = process.env.GITHUB_TOKEN || "";
  const owner = process.env.GITHUB_REPO_OWNER || "";
  const repo = process.env.GITHUB_REPO_NAME || "";
  const branch = process.env.GITHUB_REPO_BRANCH || "main";

  return {
    ...getGithubCommitMetadata(),
    branch,
    owner,
    repo,
    token,
  };
};

const isGithubConfigured = () => {
  const github = getGithubConfig();
  return Boolean(github.token && github.owner && github.repo && github.branch);
};

const githubRequest = async (path, init = {}) => {
  const github = getGithubConfig();

  if (!isGithubConfigured()) {
    throw new Error("Missing GitHub repository environment variables");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "User-Agent": "codex-limit-site",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });

  return response;
};

const readFromGithub = async () => {
  if (!isGithubConfigured()) {
    return null;
  }

  const github = getGithubConfig();
  const response = await githubRequest(
    `/repos/${github.owner}/${github.repo}/contents/${SITE_STATE_PATH}?ref=${encodeURIComponent(github.branch)}`,
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub raw read failed with ${response.status}`);
  }

  const payload = await response.json();
  const encodedContent = typeof payload?.content === "string" ? payload.content.replace(/\n/g, "") : "";

  if (!encodedContent) {
    return {
      sha: payload?.sha || null,
      value: null,
    };
  }

  return {
    sha: payload?.sha || null,
    value: JSON.parse(Buffer.from(encodedContent, "base64").toString("utf8")),
  };
};

const readGithubContentMeta = async () => {
  const github = getGithubConfig();
  const response = await githubRequest(
    `/repos/${github.owner}/${github.repo}/contents/${SITE_STATE_PATH}?ref=${encodeURIComponent(github.branch)}`,
  );

  if (response.status === 404) {
    return { sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub content read failed with ${response.status}`);
  }

  const payload = await response.json();
  return {
    sha: payload?.sha || null,
  };
};

const readStoredSiteState = async () => {
  const githubPayload = await readFromGithub();
  return {
    configured: isGithubConfigured(),
    sha: githubPayload?.sha || null,
    ...normalizeStoredState(githubPayload?.value || {}),
  };
};

const withAppliedExpiration = (state) => {
  const now = Date.now();
  const isExpired = state.currentState === "yes" && state.resetAt && now >= state.resetAt;

  return {
    ...state,
    currentState: isExpired ? "no" : state.currentState,
    resetAt: isExpired ? null : state.resetAt,
  };
};

export const readSiteState = async () => {
  return withAppliedExpiration(await readStoredSiteState());
};

const createGithubWriteError = (status, errorText) => {
  const error = new Error(`GitHub write failed with ${status}: ${errorText}`);
  error.isConflict = status === 409 || status === 422;
  error.status = status;
  return error;
};

export const writeSiteState = async (nextState) => {
  const github = getGithubConfig();
  const normalizedState = normalizeStoredState(nextState);
  const serializedState = serializeStoredState(normalizedState);
  const currentSha = typeof nextState?.sha === "string" ? nextState.sha : (await readGithubContentMeta()).sha;
  const response = await githubRequest(`/repos/${github.owner}/${github.repo}/contents/${SITE_STATE_PATH}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author: github.author,
      branch: github.branch,
      committer: github.committer,
      content: Buffer.from(JSON.stringify(serializedState, null, 2) + "\n").toString("base64"),
      message: `Update site state to ${normalizedState.currentState}`,
      sha: currentSha || undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw createGithubWriteError(response.status, errorText);
  }
};

export const updateSiteState = async (transform) => {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_GITHUB_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readSiteState();
    const nextState = await transform(current);

    if (!nextState) {
      return current;
    }

    const normalizedState = normalizeStoredState(nextState);

    try {
      await writeSiteState({
        ...normalizedState,
        sha: current.sha,
      });

      return {
        ...withAppliedExpiration({
          ...normalizedState,
          configured: current.configured,
          sha: current.sha,
        }),
      };
    } catch (error) {
      lastError = error;

      if (!error?.isConflict || attempt === MAX_GITHUB_WRITE_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw lastError;
};

export const buildNextState = async (updates, currentState = null) => {
  const current = currentState || (await readSiteState());
  const next = {
    auth: current.auth,
    automation: current.automation,
    currentState: normalizeState(updates.state ?? current.currentState),
    autoResetHours: normalizeHours(updates.autoResetHours ?? current.autoResetHours),
    noSubtitles: normalizeNoSubtitles(updates.noSubtitles ?? current.noSubtitles),
    resetAt: current.resetAt,
    sha: current.sha,
    updatedAt: Date.now(),
  };

  if (updates.state === "yes") {
    next.resetAt = Date.now() + next.autoResetHours * 60 * 60 * 1000;
  } else if (updates.state === "no") {
    next.resetAt = null;
  } else if (updates.applyTimerToCurrentState && next.currentState === "yes") {
    next.resetAt = Date.now() + next.autoResetHours * 60 * 60 * 1000;
  }

  return {
    ...normalizeStoredState(next),
    sha: current.sha,
  };
};

export const readJsonBody = async (request) => {
  try {
    return await request.json();
  } catch (_error) {
    return {};
  }
};

export const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...extraHeaders,
    },
  });

const isSecureRequest = (request) => {
  const forwardedProto = request?.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedProto) {
    return forwardedProto === "https";
  }

  if (request?.url) {
    try {
      return new URL(request.url).protocol === "https:";
    } catch (_error) {
      return getEnvValue("NODE_ENV", "") !== "development";
    }
  }

  return getEnvValue("NODE_ENV", "") !== "development";
};

export const clearAdminSessionCookie = (request) => {
  const secureAttribute = isSecureRequest(request) ? "; Secure" : "";
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=0`;
};

const createAdminSessionCookie = (session, request) => {
  const secureAttribute = isSecureRequest(request) ? "; Secure" : "";
  return `${ADMIN_COOKIE_NAME}=${createSessionToken(session)}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
};

const getLoginAttemptKey = (request) => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const clientAddress =
    forwardedFor.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-client-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";

  return hashValue(`${getSessionSecret()}:${clientAddress}:${userAgent}`);
};

const buildNextLoginFailureState = (entries, key, now) => {
  const remainingEntries = entries.filter((entry) => entry.key !== key);
  const existingEntry = entries.find((entry) => entry.key === key);
  const shouldResetWindow = !existingEntry || now - existingEntry.lastFailedAt > LOGIN_FAILURE_WINDOW_MS;
  const nextCount = shouldResetWindow ? 1 : existingEntry.count + 1;
  const nextEntry = {
    count: nextCount,
    firstFailedAt: shouldResetWindow ? now : existingEntry.firstFailedAt,
    key,
    lastFailedAt: now,
    lockedUntil: nextCount >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : null,
  };

  return normalizeAuthState({
    loginFailures: [...remainingEntries, nextEntry],
    sessions: [],
  }, now).loginFailures;
};

export const getLoginThrottle = async (request) => {
  const current = await readStoredSiteState();
  const key = getLoginAttemptKey(request);
  const now = Date.now();
  const entry = current.auth.loginFailures.find((failure) => failure.key === key);
  const lockedUntil = entry?.lockedUntil && entry.lockedUntil > now ? entry.lockedUntil : null;

  return {
    isLocked: Boolean(lockedUntil),
    retryAfterSeconds: lockedUntil ? Math.ceil((lockedUntil - now) / 1000) : null,
  };
};

export const recordFailedLogin = async (request) => {
  const now = Date.now();
  const key = getLoginAttemptKey(request);
  let nextAuth = null;

  await updateSiteState((current) => {
    nextAuth = normalizeAuthState({
      loginFailures: buildNextLoginFailureState(current.auth.loginFailures, key, now),
      sessions: current.auth.sessions,
    }, now);

    return {
      ...current,
      auth: nextAuth,
    };
  });

  const entry = nextAuth.loginFailures.find((failure) => failure.key === key);

  return {
    isLocked: Boolean(entry?.lockedUntil && entry.lockedUntil > now),
    retryAfterSeconds:
      entry?.lockedUntil && entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : null,
  };
};

export const issueAdminSession = async (request) => {
  const now = Date.now();
  const session = {
    createdAt: now,
    exp: now + SESSION_TTL_SECONDS * 1000,
    id: crypto.randomBytes(18).toString("hex"),
  };
  const loginAttemptKey = getLoginAttemptKey(request);
  await updateSiteState((current) => {
    const nextAuth = normalizeAuthState({
      loginFailures: current.auth.loginFailures.filter((entry) => entry.key !== loginAttemptKey),
      sessions: [...current.auth.sessions, session],
    }, now);

    return {
      ...current,
      auth: nextAuth,
    };
  });

  return createAdminSessionCookie(session, request);
};

export const revokeAdminSession = async (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const payload = readSessionTokenPayload(cookies[ADMIN_COOKIE_NAME]);

  if (!payload) {
    return false;
  }

  let revoked = false;

  await updateSiteState((current) => {
    const nextSessions = current.auth.sessions.filter((entry) => entry.id !== payload.sid);
    revoked = nextSessions.length !== current.auth.sessions.length;

    if (!revoked) {
      return null;
    }

    return {
      ...current,
      auth: normalizeAuthState({
        loginFailures: current.auth.loginFailures,
        sessions: nextSessions,
      }),
    };
  });

  return revoked;
};

export const isAuthorizedRequest = async (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const payload = readSessionTokenPayload(cookies[ADMIN_COOKIE_NAME]);

  if (!payload) {
    return false;
  }

  const current = await readStoredSiteState();
  return current.auth.sessions.some((entry) => entry.id === payload.sid && entry.exp === payload.exp);
};

export const getAdminPassword = () => getEnvValue("SITE_ADMIN_PASSWORD", "");

export const getDefaultAutoResetHours = () => DEFAULT_AUTO_RESET_HOURS;
export const getDefaultNoSubtitles = () => [...DEFAULT_NO_SUBTITLES];
