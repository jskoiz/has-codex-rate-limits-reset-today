import { fetchAdminConfig, loginAdmin, logoutAdmin, runAutomationMonitor, updateAdminConfig } from "./site-api.js";

const DEFAULT_NO_SUBTITLE = "Limits have not reset yet.";
const DEFAULT_YES_SUBTITLE = "Limits reset, go crazy";

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
const noSubtitleList = document.querySelector("#noSubtitleList");
const yesSubtitleList = document.querySelector("#yesSubtitleList");
const addNoSubtitleButton = document.querySelector("#addNoSubtitleButton");
const addYesSubtitleButton = document.querySelector("#addYesSubtitleButton");
const saveNoSubtitlesButton = document.querySelector("#saveNoSubtitlesButton");
const saveYesSubtitlesButton = document.querySelector("#saveYesSubtitlesButton");
const runAutomationButton = document.querySelector("#runAutomationButton");
const reviewResetButton = document.querySelector("#reviewResetButton");
const reviewNotResetButton = document.querySelector("#reviewNotResetButton");
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
const automationHistoryState = document.querySelector("#automationHistoryState");
const automationLog = document.querySelector("#automationLog");
const automationModelValue = document.querySelector("#automationModelValue");
let currentNoSubtitles = [];
let currentYesSubtitles = [];
let noticeTimeoutId = null;

const formatDateTime = (value) => {
  if (!value) {
    return "Not set";
  }

  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Not set";
  }

  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

const formatAutomationEventLabel = (event) => {
  if (event?.type === "reset_confirmed") {
    return "Yes";
  }

  if (event?.type === "not_reset") {
    return "No";
  }

  if (event?.type === "review_requested") {
    return "Review";
  }

  if (event?.type === "error") {
    return "Error";
  }

  return "Seeded";
};

const getAutomationEventTone = (event) => {
  if (event?.type === "reset_confirmed") {
    return "reset_confirmed";
  }

  if (event?.type === "review_requested") {
    return "uncertain";
  }

  if (event?.type === "error") {
    return "error";
  }

  if (event?.type === "seeded") {
    return "seeded";
  }

  return "not_reset";
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

  const lastDecisionAt = Number.isFinite(automation.lastDecision?.decidedAt) ? automation.lastDecision.decidedAt : 0;
  const pendingReviewAt = Number.isFinite(automation.pendingReview?.createdAt) ? automation.pendingReview.createdAt : 0;
  const hasUnresolvedReview = automation.pendingReview?.tweetId && pendingReviewAt >= lastDecisionAt;

  if (hasUnresolvedReview) {
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

const getAutomationHistoryState = (automation = {}, automationEvents = []) => {
  const entries = Array.isArray(automation.recentEvaluations) ? automation.recentEvaluations : [];
  const durableEvents = Array.isArray(automationEvents) ? automationEvents : [];
  const durableEvaluationEvents = durableEvents.filter((event) =>
    ["not_reset", "reset_confirmed", "review_requested"].includes(event?.type),
  );
  const durableSeedEvent = durableEvents.find((event) => event?.type === "seeded");

  if (entries.length === 0 && durableEvaluationEvents.length > 0) {
    return {
      kind: "reset",
      tone: "warning",
      title: "Recovered from summary reset",
      text: "The live summary was cleared, but the durable activity log is still available below.",
    };
  }

  if (entries.length === 0 && durableSeedEvent && !automation.lastDecision?.tweetId && !automation.pendingReview?.tweetId) {
    return {
      kind: "seeded",
      tone: "muted",
      title: "Waiting for first classification",
      text: "The monitor has seeded its watermark and is waiting for the next unseen tweet to classify.",
    };
  }

  if (
    !automation.lastSeenTweetId &&
    entries.length === 0 &&
    durableEvents.length === 0 &&
    !automation.lastDecision?.tweetId &&
    !automation.pendingReview?.tweetId &&
    (automation.tokenUsage?.totalTokens || 0) === 0
  ) {
    return {
      kind: "empty",
      tone: "muted",
      title: "No history yet",
      text: "The monitor has not recorded any tweet evaluations on this state file yet.",
    };
  }

  if (automation.lastSeenTweetId && entries.length === 0 && durableEvents.length === 0 && !automation.lastDecision?.tweetId) {
    return {
      kind: "reset",
      tone: "warning",
      title: "History reset or recovered",
      text: "A tweet watermark exists, but no evaluation history is available on this state file.",
    };
  }

  return null;
};

const renderAutomationEventLog = (automationEvents = []) => {
  const entries = Array.isArray(automationEvents) ? automationEvents : [];

  automationLog.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("article");
      item.className = "config-log-item";

      const header = document.createElement("div");
      header.className = "config-log-header";

      const verdict = document.createElement("strong");
      verdict.className = "config-log-verdict";
      verdict.textContent = formatAutomationEventLabel(entry);
      verdict.dataset.tone = getAutomationEventTone(entry);

      const timestamp = document.createElement("span");
      timestamp.className = "config-log-meta";
      timestamp.textContent = formatDateTime(entry.createdAt);

      header.append(verdict, timestamp);

      const reason = document.createElement("p");
      reason.className = "config-log-reason";
      reason.textContent =
        entry.type === "error"
          ? entry.message || "Monitor error"
          : entry.type === "seeded"
            ? "Timeline watermark seeded on the newest seen tweet."
            : entry.rationale || "No rationale recorded.";

      const usage = document.createElement("p");
      usage.className = "config-log-usage";
      usage.textContent =
        entry.type === "error"
          ? "Automation error"
          : `${formatAutomationEventLabel(entry)} · ${formatTokenCount(entry.totalTokens || 0)} tokens`;

      item.append(header, reason, usage);

      if (entry.tweetUrl) {
        const tweetLink = document.createElement("a");
        tweetLink.className = "config-log-link";
        tweetLink.href = entry.tweetUrl;
        tweetLink.target = "_blank";
        tweetLink.rel = "noreferrer";
        tweetLink.textContent = truncateText(entry.tweetText || entry.tweetUrl, 140);
        item.append(tweetLink);
      }

      return item;
    }),
  );
};

const renderAutomationLog = (automation = {}, automationEvents = []) => {
  if (!automationLog) {
    return;
  }

  const entries = Array.isArray(automation.recentEvaluations) ? automation.recentEvaluations : [];
  const historyState = getAutomationHistoryState(automation, automationEvents);

  if (automationHistoryState) {
    if (historyState) {
      automationHistoryState.hidden = false;
      automationHistoryState.textContent = `${historyState.title}. ${historyState.text}`;
      automationHistoryState.dataset.tone = historyState.tone;
    } else {
      automationHistoryState.hidden = true;
      automationHistoryState.textContent = "";
      automationHistoryState.dataset.tone = "";
    }
  }

  if (entries.length === 0) {
    if (Array.isArray(automationEvents) && automationEvents.length > 0) {
      renderAutomationEventLog(automationEvents);
      return;
    }

    automationLog.innerHTML = `<p class="config-note">${historyState?.kind === "reset"
      ? "No in-memory summary entries are available. The next classified tweet will rebuild them."
      : "No tweet evaluations logged yet."}</p>`;
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

const renderAutomation = (automation = {}, automationEvents = []) => {
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

  const lastDecisionAt = Number.isFinite(automation.lastDecision?.decidedAt) ? automation.lastDecision.decidedAt : 0;
  const pendingReviewAt = Number.isFinite(automation.pendingReview?.createdAt) ? automation.pendingReview.createdAt : 0;
  const hasPendingReview = Boolean(automation.pendingReview?.tweetId && pendingReviewAt >= lastDecisionAt);

  if (hasPendingReview) {
    const summary = `${formatDateTime(automation.pendingReview.createdAt)} · ${truncateText(automation.pendingReview.tweetText, 56)}`;
    setLinkState(automationPendingValue, automation.pendingReview.tweetUrl, summary, "None");
  } else {
    setLinkState(automationPendingValue, null, "", "None");
  }

  if (reviewResetButton) {
    reviewResetButton.hidden = !hasPendingReview;
  }

  if (reviewNotResetButton) {
    reviewNotResetButton.hidden = !hasPendingReview;
  }

  automationErrorValue.textContent = automation.lastError || "None";
  automationErrorValue.dataset.tone = automation.lastError ? "error" : "muted";
  automationInputTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalInputTokens || 0);
  automationOutputTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalOutputTokens || 0);
  automationReasoningTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalReasoningTokens || 0);
  automationTotalTokensValue.textContent = formatTokenCount(automation.tokenUsage?.totalTokens || 0);
  const historyState = getAutomationHistoryState(automation, automationEvents);
  automationStatusNote.textContent = automation.lastError
    ? `Latest issue: ${automation.lastError}`
    : historyState?.kind === "reset"
      ? "Summary state was reset. Showing the durable activity history below."
      : historyState?.kind === "seeded"
        ? "Watermark seeded. Waiting for the next unseen tweet to classify."
      : historyState?.kind === "empty"
        ? "No tweet history yet. Polls every 5 minutes via GitHub Actions."
        : hasPendingReview
          ? "Pending manual review for the most recent tweet."
          : "Polls every 5 minutes via GitHub Actions.";

  renderAutomationLog(automation, automationEvents);
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
  const dot = statusValue.querySelector(".config-status-dot");
  if (dot) {
    statusValue.childNodes.forEach((n) => { if (n !== dot) n.remove(); });
    statusValue.append(config.state === "yes" ? "Yes" : "No");
  } else {
    statusValue.textContent = config.state === "yes" ? "Yes" : "No";
  }
  statusValue.dataset.state = config.state;
  configUpdatedValue.textContent = formatDateTime(config.updatedAt);
  hoursInput.value = String(config.autoResetHours);
  currentNoSubtitles = Array.isArray(config.noSubtitles) ? [...config.noSubtitles] : [];
  currentYesSubtitles = Array.isArray(config.yesSubtitles) ? [...config.yesSubtitles] : [];

  const resetDisplay = getResetDisplay(config.state, config.resetAt);
  timerValue.textContent = resetDisplay.value;
  resetMetaValue.textContent = resetDisplay.meta;

  renderAutomation(config.automation, config.automationEvents || []);

  if (automationModelValue) {
    automationModelValue.textContent = config.reasoningModel || "--";
  }

  stateButtons.forEach((button) => {
    const isActive = button.dataset.nextState === config.state;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  renderSubtitleInputs("no");
  renderSubtitleInputs("yes");
};

const getSubtitleState = (tone) => (tone === "yes" ? currentYesSubtitles : currentNoSubtitles);

const getSubtitleDefault = (tone) => (tone === "yes" ? DEFAULT_YES_SUBTITLE : DEFAULT_NO_SUBTITLE);

const getSubtitleList = (tone) => (tone === "yes" ? yesSubtitleList : noSubtitleList);

const createSubtitleRow = (tone, value, index) => {
  const subtitleState = getSubtitleState(tone);
  const row = document.createElement("div");
  row.className = "config-subtitle-row";

  const input = document.createElement("input");
  input.className = "config-subtitle-input";
  input.type = "text";
  input.value = value;
  input.placeholder = getSubtitleDefault(tone);
  input.setAttribute("aria-label", `${tone === "yes" ? "Yes" : "No"} subtitle ${index + 1}`);
  input.addEventListener("input", (event) => {
    clearNotice();
    subtitleState[index] = event.target.value;
  });
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    await saveSubtitles();
  });

  const removeButton = document.createElement("button");
  removeButton.className = "config-icon-button";
  removeButton.type = "button";
  removeButton.textContent = "−";
  removeButton.setAttribute("aria-label", `Remove ${tone === "yes" ? "Yes" : "No"} subtitle ${index + 1}`);
  removeButton.disabled = subtitleState.length <= 1;
  removeButton.addEventListener("click", () => {
    subtitleState.splice(index, 1);
    renderSubtitleInputs(tone);
  });

  row.append(input, removeButton);
  return row;
};

const renderSubtitleInputs = (tone) => {
  const subtitleList = getSubtitleList(tone);

  if (!subtitleList) {
    return;
  }

  const subtitleState = getSubtitleState(tone);
  const normalizedSubtitles = subtitleState.map((value) => (typeof value === "string" ? value : ""));

  if (normalizedSubtitles.length === 0) {
    normalizedSubtitles.push(getSubtitleDefault(tone));
  }

  if (tone === "yes") {
    currentYesSubtitles = normalizedSubtitles;
  } else {
    currentNoSubtitles = normalizedSubtitles;
  }

  subtitleList.replaceChildren(...normalizedSubtitles.map((value, index) => createSubtitleRow(tone, value, index)));
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

const saveSubtitles = async () => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      noSubtitles: currentNoSubtitles,
      yesSubtitles: currentYesSubtitles,
    });
    renderConfig(config);
  }, "Subtitles saved.");
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

addNoSubtitleButton?.addEventListener("click", () => {
  clearNotice();
  currentNoSubtitles.push("");
  renderSubtitleInputs("no");
});

addYesSubtitleButton?.addEventListener("click", () => {
  clearNotice();
  currentYesSubtitles.push("");
  renderSubtitleInputs("yes");
});

saveNoSubtitlesButton?.addEventListener("click", saveSubtitles);
saveYesSubtitlesButton?.addEventListener("click", saveSubtitles);

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

const resolvePendingReview = async (verdict) => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      manualReviewVerdict: verdict,
    });
    renderConfig(config);
  }, `Pending review marked ${verdict === "reset_confirmed" ? "Yes" : "No"}.`);
};

reviewResetButton?.addEventListener("click", async () => {
  await resolvePendingReview("reset_confirmed");
});

reviewNotResetButton?.addEventListener("click", async () => {
  await resolvePendingReview("not_reset");
});

refreshConfig();
window.setInterval(() => {
  if (!controlPanel.hidden) {
    refreshConfig();
  }
}, 30 * 1000);
