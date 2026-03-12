import crypto from "node:crypto";

const DEFAULT_AUTO_RESET_HOURS = 20;
const DEFAULT_NO_SUBTITLES = ["Limits have not reset yet."];
const ADMIN_COOKIE_NAME = "site_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_TRACKED_LOGIN_FAILURES = 128;
const SITE_STATE_PATH = "data/site-state.json";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
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

const getSessionSecret = () => process.env.SITE_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || "";

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

const normalizeAuthState = (value, now = Date.now()) => {
  const loginFailureMap = new Map();

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
    sessions: [],
  };
};

const normalizeStoredState = (value) => {
  const currentState = normalizeState(value?.currentState);
  const autoResetHours = normalizeHours(value?.autoResetHours);
  const noSubtitles = normalizeNoSubtitles(value?.noSubtitles);
  const resetAt = Number.isFinite(value?.resetAt) ? value.resetAt : null;
  const updatedAt = Number.isFinite(value?.updatedAt) ? value.updatedAt : null;
  const auth = normalizeAuthState(value?.auth);

  return {
    auth,
    currentState,
    autoResetHours,
    noSubtitles,
    resetAt: currentState === "yes" ? resetAt : null,
    updatedAt,
  };
};

const getGithubConfig = () => {
  const token = process.env.GITHUB_TOKEN || "";
  const owner = process.env.GITHUB_REPO_OWNER || "";
  const repo = process.env.GITHUB_REPO_NAME || "";
  const branch = process.env.GITHUB_REPO_BRANCH || "main";

  return {
    branch,
    owner,
    repo,
    token,
  };
};

const getRawGithubUrl = () => {
  const github = getGithubConfig();
  return `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${github.branch}/${SITE_STATE_PATH}?ts=${Date.now()}`;
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

  const response = await fetch(getRawGithubUrl(), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${getGithubConfig().token}`,
      "User-Agent": "codex-limit-site",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub raw read failed with ${response.status}`);
  }

  return {
    sha: null,
    value: await response.json(),
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

export const readSiteState = async () => {
  const storedState = await readStoredSiteState();
  const now = Date.now();
  const isExpired = storedState.currentState === "yes" && storedState.resetAt && now >= storedState.resetAt;

  return {
    ...storedState,
    currentState: isExpired ? "no" : storedState.currentState,
    resetAt: isExpired ? null : storedState.resetAt,
  };
};

export const writeSiteState = async (nextState) => {
  const github = getGithubConfig();
  const normalizedState = normalizeStoredState(nextState);
  const currentSha = typeof nextState?.sha === "string" ? nextState.sha : (await readGithubContentMeta()).sha;
  const response = await githubRequest(`/repos/${github.owner}/${github.repo}/contents/${SITE_STATE_PATH}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: github.branch,
      content: Buffer.from(JSON.stringify(normalizedState, null, 2) + "\n").toString("base64"),
      message: `Update site state to ${normalizedState.currentState}`,
      sha: currentSha || undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub write failed with ${response.status}: ${errorText}`);
  }
};

export const updateSiteState = async (buildNextState) => {
  const current = await readSiteState();
  const nextState = await buildNextState(current);

  if (!nextState) {
    return current;
  }

  const normalizedState = normalizeStoredState(nextState);

  await writeSiteState({
    ...normalizedState,
    sha: current.sha,
  });

  return {
    ...normalizedState,
    configured: current.configured,
    sha: current.sha,
  };
};

export const buildNextState = async (updates, currentState = null) => {
  const current = currentState || (await readSiteState());
  const next = {
    auth: current.auth,
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

export const clearAdminSessionCookie = () => {
  const secureAttribute = process.env.VERCEL_ENV === "development" ? "" : "; Secure";
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=0`;
};

const createAdminSessionCookie = (session) => {
  const secureAttribute = process.env.VERCEL_ENV === "development" ? "" : "; Secure";
  return `${ADMIN_COOKIE_NAME}=${createSessionToken(session)}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
};

const getLoginAttemptKey = (request) => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const clientAddress = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
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
  const current = await readStoredSiteState();
  const now = Date.now();
  const key = getLoginAttemptKey(request);
  const nextAuth = normalizeAuthState({
    loginFailures: buildNextLoginFailureState(current.auth.loginFailures, key, now),
    sessions: current.auth.sessions,
  }, now);

  await writeSiteState({
    ...current,
    auth: nextAuth,
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
      sessions: [],
    }, now);

    return {
      ...current,
      auth: nextAuth,
    };
  });

  return createAdminSessionCookie(session);
};

export const revokeAdminSession = async (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return Boolean(readSessionTokenPayload(cookies[ADMIN_COOKIE_NAME]));
};

export const isAuthorizedRequest = async (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return Boolean(readSessionTokenPayload(cookies[ADMIN_COOKIE_NAME]));
};

export const getAdminPassword = () => process.env.SITE_ADMIN_PASSWORD || "";

export const getDefaultAutoResetHours = () => DEFAULT_AUTO_RESET_HOURS;
export const getDefaultNoSubtitles = () => [...DEFAULT_NO_SUBTITLES];
