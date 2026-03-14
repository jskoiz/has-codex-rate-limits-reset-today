import { fetchAdminConfig, loginAdmin, logoutAdmin, runAutomationMonitor, updateAdminConfig } from "./site-api.js";

const DEFAULT_NO_SUBTITLE = "Limits have not reset yet.";

const authPanel = document.querySelector("#authPanel");
const controlPanel = document.querySelector("#controlPanel");
const authForm = document.querySelector("#authForm");
const authInput = document.querySelector("#configPassword");
const authError = document.querySelector("#authError");
const stateButtons = Array.from(document.querySelectorAll("[data-next-state]"));
const hoursInput = document.querySelector("#autoResetHours");
const statusValue = document.querySelector("#configStatusValue");
const configUpdatedValue = document.querySelector("#configUpdatedValue");
const timerValue = document.querySelector("#configTimerValue");
const resetMetaValue = document.querySelector("#configResetMetaValue");
const configNotice = document.querySelector("#configNotice");
const saveButton = document.querySelector("#saveHoursButton");
const logoutButton = document.querySelector("#logoutButton");
const subtitleList = document.querySelector("#subtitleList");
const addSubtitleButton = document.querySelector("#addSubtitleButton");
const saveSubtitlesButton = document.querySelector("#saveSubtitlesButton");
const runAutomationButton = document.querySelector("#runAutomationButton");
const automationHealthValue = document.querySelector("#automationHealthValue");
const automationHealthMeta = document.querySelector("#automationHealthMeta");
const automationLastSeenValue = document.querySelector("#automationLastSeenValue");
const automationDecisionValue = document.querySelector("#automationDecisionValue");
const automationPendingValue = document.querySelector("#automationPendingValue");
const automationErrorValue = document.querySelector("#automationErrorValue");
const automationInputTokensValue = document.querySelector("#automationInputTokensValue");
const automationOutputTokensValue = document.querySelector("#automationOutputTokensValue");
const automationReasoningTokensValue = document.querySelector("#automationReasoningTokensValue");
const automationTotalTokensValue = document.querySelector("#automationTotalTokensValue");
const automationStatusNote = document.querySelector("#automationStatusNote");
const automationLog = document.querySelector("#automationLog");
const trafficValue = document.querySelector("#trafficValue");
const trafficMetaValue = document.querySelector("#trafficMetaValue");
const analyticsLink = document.querySelector("#analyticsLink");
let currentNoSubtitles = [];
let noticeTimeoutId = null;

const formatDateTime = (value) => {
  if (!value) {
    return "Not set";
  }

  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
};

const truncateText = (value, maxLength = 120) => {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
};

const formatAutomationVerdict = (value) => {
  if (value === "reset_confirmed") {
    return "Reset confirmed";
  }

  if (value === "not_reset") {
    return "Not reset";
  }

  return "Needs review";
};

const formatAutomationVerdictShort = (value) => {
  if (value === "reset_confirmed") {
    return "Yes";
  }

  if (value === "not_reset") {
    return "No";
  }

  return "Review";
};

const formatTokenCount = (value) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);

const buildTweetUrl = (tweetId) => {
  if (!tweetId) {
    return null;
  }

  return `https://x.com/thsottiaux/status/${tweetId}`;
};

const setLinkState = (element, href, text, fallbackText) => {
  if (!element) {
    return;
  }

  if (href) {
    element.href = href;
    element.textContent = text;
    element.dataset.empty = "false";
    element.removeAttribute("aria-disabled");
    return;
  }

  element.textContent = fallbackText;
  element.dataset.empty = "true";
  element.setAttribute("aria-disabled", "true");
  element.removeAttribute("href");
};

const getResetDisplay = (state, resetAt) => {
  if (state !== "yes") {
    return {
      meta: "Timer starts when the state is Yes.",
      value: "State is No",
    };
  }

  if (!resetAt) {
    return {
      meta: "Save the timer to schedule the fallback.",
      value: "No timer running",
    };
  }

  const remainingMs = resetAt - Date.now();

  if (remainingMs <= 0) {
    return {
      meta: `Reset scheduled ${formatDateTime(resetAt)}.`,
      value: "Switching now",
    };
  }

  const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeLeft = hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;

  return {
    meta: `Resets ${formatDateTime(resetAt)}.`,
    value: timeLeft,
  };
};

const getAutomationHealth = (automation = {}) => {
  if (automation.lastError) {
    return {
      meta: automation.lastError,
      tone: "error",
      value: "Error",
    };
  }

  if (automation.pendingReview?.tweetId) {
    return {
      meta: `Pending since ${formatDateTime(automation.pendingReview.createdAt)}.`,
      tone: "warning",
      value: "Review needed",
    };
  }

  if (automation.lastDecision?.decidedAt) {
    return {
      meta: `Last decision ${formatDateTime(automation.lastDecision.decidedAt)}.`,
      tone: "success",
      value: "Healthy",
    };
  }

  return {
    meta: "Polling every 5 minutes via GitHub Actions.",
    tone: "muted",
    value: "Healthy",
  };
};

const renderTraffic = (analyticsUrl) => {
  if (!trafficValue || !trafficMetaValue || !analyticsLink) {
    return;
  }

  trafficValue.textContent = analyticsUrl ? "Dashboard linked" : "Dashboard not linked";
  trafficMetaValue.textContent = analyticsUrl
    ? "Use your analytics dashboard for visitor and pageview totals."
    : "Add SITE_ANALYTICS_URL to jump straight into your traffic dashboard.";
  analyticsLink.hidden = !analyticsUrl;

  if (analyticsUrl) {
    analyticsLink.href = analyticsUrl;
  } else {
    analyticsLink.removeAttribute("href");
  }
};

const renderAutomationLog = (automation = {}) => {
  if (!automationLog) {
    return;
  }

  const entries = Array.isArray(automation.recentEvaluations) ? automation.recentEvaluations : [];

  if (entries.length === 0) {
    automationLog.innerHTML = '<p class="config-note">No tweet evaluations logged yet.</p>';
    return;
  }

  automationLog.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("article");
      item.className = "config-log-item";

      const header = document.createElement("div");
      header.className = "config-log-header";

      const verdict = document.createElement("strong");
      verdict.className = "config-log-verdict";
      verdict.textContent = formatAutomationVerdictShort(entry.verdict);
      verdict.dataset.tone = entry.verdict;

      const timestamp = document.createElement("span");
      timestamp.className = "config-log-meta";
      timestamp.textContent = formatDateTime(entry.evaluatedAt);

      header.append(verdict, timestamp);

      const reason = document.createElement("p");
      reason.className = "config-log-reason";
      reason.textContent = entry.rationale || "No rationale recorded.";

      const usage = document.createElement("p");
      usage.className = "config-log-usage";
      usage.textContent = `${formatAutomationVerdict(entry.verdict)} · ${formatTokenCount(entry.totalTokens || 0)} tokens`;

      const tweetLink = document.createElement("a");
      tweetLink.className = "config-log-link";
      tweetLink.href = entry.tweetUrl;
      tweetLink.target = "_blank";
      tweetLink.rel = "noreferrer";
      tweetLink.textContent = truncateText(entry.tweetText, 140);

      item.append(header, reason, usage, tweetLink);
      return item;
    }),
  );
};

const renderAutomation = (automation = {}) => {
  if (!automationHealthValue) {
    return;
  }

  const health = getAutomationHealth(automation);
  automationHealthValue.textContent = health.value;
  automationHealthValue.dataset.tone = health.tone;
  automationHealthMeta.textContent = health.meta;

  setLinkState(
    automationLastSeenValue,
    automation.lastSeenTweetUrl || buildTweetUrl(automation.lastSeenTweetId),
    "Open tweet on X",
    automation.lastSeenTweetId ? "Link unavailable" : "Not set",
  );

  if (automation.lastDecision?.verdict) {
    automationDecisionValue.textContent = `${formatAutomationVerdict(automation.lastDecision.verdict)} · ${formatDateTime(automation.lastDecision.decidedAt)}`;
  } else {
    automationDecisionValue.textContent = "None yet";
  }

  if (automation.pendingReview?.tweetId) {
    const summary = `${formatDateTime(automation.pendingReview.createdAt)} · ${truncateText(automation.pendingReview.tweetText, 56)}`;
    setLinkState(automationPendingValue, automation.pendingReview.tweetUrl, summary, "None");
  } else {
    setLinkState(automationPendingValue, null, "", "None");
  }

  automationErrorValue.textContent = automation.lastError || "None";
  automationErrorValue.dataset.tone = automation.lastError ? "error" : "muted";
  automationInputTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalInputTokens || 0);
  automationOutputTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalOutputTokens || 0);
  automationReasoningTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalReasoningTokens || 0);
  automationTotalTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalTokens || 0);
  automationStatusNote.textContent = automation.lastError
    ? `Latest issue: ${automation.lastError}`
    : automation.pendingReview?.tweetId
      ? "Pending manual review for the most recent tweet."
      : "Polls every 5 minutes via GitHub Actions.";

  renderAutomationLog(automation);
};

const showAuth = (message = "") => {
  authPanel.hidden = false;
  controlPanel.hidden = true;
  authError.textContent = message;
};

const showControls = () => {
  authPanel.hidden = true;
  controlPanel.hidden = false;
  authError.textContent = "";
};

const clearNotice = () => {
  if (!configNotice) {
    return;
  }

  if (noticeTimeoutId) {
    window.clearTimeout(noticeTimeoutId);
    noticeTimeoutId = null;
  }

  configNotice.textContent = "";
  configNotice.dataset.tone = "";
};

const showNotice = (message, tone = "success") => {
  if (!configNotice) {
    return;
  }

  if (noticeTimeoutId) {
    window.clearTimeout(noticeTimeoutId);
  }

  configNotice.textContent = message;
  configNotice.dataset.tone = tone;

  if (tone === "success") {
    noticeTimeoutId = window.setTimeout(() => {
      configNotice.textContent = "";
      configNotice.dataset.tone = "";
      noticeTimeoutId = null;
    }, 4000);
  } else {
    noticeTimeoutId = null;
  }
};

const runConfigAction = async (callback, successMessage = "") => {
  authError.textContent = "";
  clearNotice();

  try {
    const result = await callback();

    if (successMessage) {
      showNotice(successMessage, "success");
    }

    return result;
  } catch (error) {
    if (error?.status === 401) {
      showAuth("Session expired");
      return null;
    }

    showNotice(error.message || "Unable to update config", "error");
    return null;
  }
};

const renderConfig = (config) => {
  showControls();
  statusValue.textContent = config.state === "yes" ? "Yes" : "No";
  statusValue.dataset.state = config.state;
  configUpdatedValue.textContent = formatDateTime(config.updatedAt);
  hoursInput.value = String(config.autoResetHours);
  currentNoSubtitles = Array.isArray(config.noSubtitles) ? [...config.noSubtitles] : [];

  const resetDisplay = getResetDisplay(config.state, config.resetAt);
  timerValue.textContent = resetDisplay.value;
  resetMetaValue.textContent = resetDisplay.meta;

  renderAutomation(config.automation);
  renderTraffic(config.analyticsUrl || config.vercelAnalyticsUrl);

  stateButtons.forEach((button) => {
    const isActive = button.dataset.nextState === config.state;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  renderSubtitleInputs();
};

const createSubtitleRow = (value, index) => {
  const row = document.createElement("div");
  row.className = "config-subtitle-row";

  const input = document.createElement("input");
  input.className = "config-subtitle-input";
  input.type = "text";
  input.value = value;
  input.placeholder = DEFAULT_NO_SUBTITLE;
  input.setAttribute("aria-label", `No subtitle ${index + 1}`);
  input.addEventListener("input", (event) => {
    clearNotice();
    currentNoSubtitles[index] = event.target.value;
  });

  const removeButton = document.createElement("button");
  removeButton.className = "config-icon-button";
  removeButton.type = "button";
  removeButton.textContent = "−";
  removeButton.setAttribute("aria-label", `Remove subtitle ${index + 1}`);
  removeButton.disabled = currentNoSubtitles.length <= 1;
  removeButton.addEventListener("click", () => {
    currentNoSubtitles.splice(index, 1);
    renderSubtitleInputs();
  });

  row.append(input, removeButton);
  return row;
};

const renderSubtitleInputs = () => {
  if (!subtitleList) {
    return;
  }

  const normalizedSubtitles = currentNoSubtitles.map((value) => (typeof value === "string" ? value : ""));

  if (normalizedSubtitles.length === 0) {
    normalizedSubtitles.push(DEFAULT_NO_SUBTITLE);
  }

  currentNoSubtitles = normalizedSubtitles;
  subtitleList.replaceChildren(...currentNoSubtitles.map((value, index) => createSubtitleRow(value, index)));
};

const refreshConfig = async () => {
  try {
    renderConfig(await fetchAdminConfig());
  } catch (error) {
    if (error?.status === 401) {
      showAuth();
      return;
    }

    showAuth(error.message || "Unable to load config");
  }
};

const saveHours = async () => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      applyTimerToCurrentState: true,
      autoResetHours: hoursInput.value,
    });
    renderConfig(config);
  }, "Auto-reset timer saved.");
};

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  clearNotice();

  try {
    await loginAdmin(authInput.value);
    authInput.value = "";
    await refreshConfig();
  } catch (error) {
    showAuth(error.message || "Sign in failed");
  }
});

stateButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await runConfigAction(async () => {
      const config = await updateAdminConfig({ state: button.dataset.nextState });
      renderConfig(config);
    }, `State updated to ${button.dataset.nextState === "yes" ? "Yes" : "No"}.`);
  });
});

saveButton?.addEventListener("click", saveHours);

hoursInput?.addEventListener("input", () => {
  clearNotice();
});

hoursInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  await saveHours();
});

addSubtitleButton?.addEventListener("click", () => {
  clearNotice();
  currentNoSubtitles.push("");
  renderSubtitleInputs();
});

saveSubtitlesButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      noSubtitles: currentNoSubtitles,
    });
    renderConfig(config);
  }, "Subtitles saved.");
});

logoutButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    await logoutAdmin();
    showAuth();
  });
});

runAutomationButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    runAutomationButton.disabled = true;
    automationStatusNote.textContent = "Running monitor now...";

    try {
      const result = await runAutomationMonitor();
      await refreshConfig();

      const outcome = result?.outcome ? result.outcome.replaceAll("_", " ") : "completed";
      automationStatusNote.textContent = `Last manual run: ${outcome}`;
    } finally {
      runAutomationButton.disabled = false;
    }
  });
});

refreshConfig();
window.setInterval(() => {
  if (!controlPanel.hidden) {
    refreshConfig();
  }
}, 30 * 1000);
