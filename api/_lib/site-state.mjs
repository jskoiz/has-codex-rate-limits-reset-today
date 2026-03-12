import crypto from "node:crypto";

const DEFAULT_AUTO_RESET_HOURS = 20;
const ADMIN_COOKIE_NAME = "site_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
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

const createSessionToken = () => {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("Missing SITE_SESSION_SECRET environment variable");
  }

  const payload = JSON.stringify({
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
    nonce: crypto.randomBytes(12).toString("hex"),
  });
  const encodedPayload = base64UrlEncode(payload);
  const signature = createSignature(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
};

const verifySessionToken = (token) => {
  const secret = getSessionSecret();

  if (!secret || !token || !token.includes(".")) {
    return false;
  }

  const [encodedPayload, providedSignature] = token.split(".");
  const expectedSignature = createSignature(encodedPayload, secret);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return false;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return Number.isFinite(payload?.exp) && payload.exp > Date.now();
  } catch (_error) {
    return false;
  }
};

const normalizeState = (state) => (state === "yes" ? "yes" : "no");

const normalizeHours = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : DEFAULT_AUTO_RESET_HOURS;
};

const normalizeStoredState = (value) => {
  const currentState = normalizeState(value?.currentState);
  const autoResetHours = normalizeHours(value?.autoResetHours);
  const resetAt = Number.isFinite(value?.resetAt) ? value.resetAt : null;
  const updatedAt = Number.isFinite(value?.updatedAt) ? value.updatedAt : null;

  return {
    currentState,
    autoResetHours,
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

export const readSiteState = async () => {
  const githubPayload = await readFromGithub();
  const storedState = normalizeStoredState(githubPayload?.value || {});
  const now = Date.now();
  const isExpired = storedState.currentState === "yes" && storedState.resetAt && now >= storedState.resetAt;

  return {
    configured: isGithubConfigured(),
    currentState: isExpired ? "no" : storedState.currentState,
    storedState: storedState.currentState,
    autoResetHours: storedState.autoResetHours,
    resetAt: isExpired ? null : storedState.resetAt,
    sha: githubPayload?.sha || null,
    updatedAt: storedState.updatedAt,
  };
};

export const writeSiteState = async (nextState) => {
  const github = getGithubConfig();
  const current = await readGithubContentMeta();
  const normalizedState = normalizeStoredState(nextState);
  const response = await githubRequest(`/repos/${github.owner}/${github.repo}/contents/${SITE_STATE_PATH}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: github.branch,
      content: Buffer.from(JSON.stringify(normalizedState, null, 2) + "\n").toString("base64"),
      message: `Update site state to ${normalizedState.currentState}`,
      sha: current.sha || undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub write failed with ${response.status}: ${errorText}`);
  }
};

export const buildNextState = async (updates) => {
  const current = await readSiteState();
  const next = {
    currentState: normalizeState(updates.state ?? current.currentState),
    autoResetHours: normalizeHours(updates.autoResetHours ?? current.autoResetHours),
    resetAt: current.resetAt,
    updatedAt: Date.now(),
  };

  if (updates.state === "yes") {
    next.resetAt = Date.now() + next.autoResetHours * 60 * 60 * 1000;
  } else if (updates.state === "no") {
    next.resetAt = null;
  } else if (updates.applyTimerToCurrentState && next.currentState === "yes") {
    next.resetAt = Date.now() + next.autoResetHours * 60 * 60 * 1000;
  }

  return normalizeStoredState(next);
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

export const clearAdminSessionCookie = () =>
  `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export const createAdminSessionCookie = () => {
  const secureAttribute = process.env.VERCEL_ENV === "development" ? "" : "; Secure";
  return `${ADMIN_COOKIE_NAME}=${createSessionToken()}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
};

export const isAuthorizedRequest = (request) => {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return verifySessionToken(cookies[ADMIN_COOKIE_NAME]);
};

export const getAdminPassword = () => process.env.SITE_ADMIN_PASSWORD || "";

export const getDefaultAutoResetHours = () => DEFAULT_AUTO_RESET_HOURS;
