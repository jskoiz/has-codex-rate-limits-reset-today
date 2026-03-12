import { fetchAdminConfig, loginAdmin, logoutAdmin, updateAdminConfig } from "./site-api.js";

const DEFAULT_NO_SUBTITLE = "Limits have not reset yet.";

const authPanel = document.querySelector("#authPanel");
const controlPanel = document.querySelector("#controlPanel");
const authForm = document.querySelector("#authForm");
const authInput = document.querySelector("#configPassword");
const authError = document.querySelector("#authError");
const stateButtons = Array.from(document.querySelectorAll("[data-next-state]"));
const hoursInput = document.querySelector("#autoResetHours");
const statusValue = document.querySelector("#configStatusValue");
const timerValue = document.querySelector("#configTimerValue");
const configNotice = document.querySelector("#configNotice");
const saveButton = document.querySelector("#saveHoursButton");
const logoutButton = document.querySelector("#logoutButton");
const subtitleList = document.querySelector("#subtitleList");
const addSubtitleButton = document.querySelector("#addSubtitleButton");
const saveSubtitlesButton = document.querySelector("#saveSubtitlesButton");
let currentNoSubtitles = [];
let noticeTimeoutId = null;

const formatResetTime = (timestamp) => {
  if (!timestamp) {
    return "No timer running";
  }

  const remainingMs = timestamp - Date.now();

  if (remainingMs <= 0) {
    return "Switching back to No now";
  }

  const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const absoluteTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);

  return hours > 0
    ? `${hours}h ${minutes}m left, resets ${absoluteTime}`
    : `${minutes}m left, resets ${absoluteTime}`;
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
      return;
    }

    showNotice(error.message || "Unable to update config", "error");
  }
};

const renderConfig = (config) => {
  showControls();
  statusValue.textContent = config.state === "yes" ? "Yes" : "No";
  statusValue.dataset.state = config.state;
  hoursInput.value = String(config.autoResetHours);
  timerValue.textContent = config.state === "yes" ? formatResetTime(config.resetAt) : "State is No";
  currentNoSubtitles = Array.isArray(config.noSubtitles) ? [...config.noSubtitles] : [];

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

saveButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      applyTimerToCurrentState: true,
      autoResetHours: hoursInput.value,
    });
    renderConfig(config);
  }, "Auto-reset timer saved.");
});

hoursInput?.addEventListener("input", () => {
  clearNotice();
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

hoursInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      applyTimerToCurrentState: true,
      autoResetHours: hoursInput.value,
    });
    renderConfig(config);
  }, "Auto-reset timer saved.");
});

logoutButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    await logoutAdmin();
    showAuth();
  });
});

refreshConfig();
window.setInterval(() => {
  if (!controlPanel.hidden) {
    refreshConfig();
  }
}, 30 * 1000);
