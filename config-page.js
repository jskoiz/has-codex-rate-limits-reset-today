import { fetchAdminConfig, loginAdmin, logoutAdmin, updateAdminConfig } from "./site-api.js";

const authPanel = document.querySelector("#authPanel");
const controlPanel = document.querySelector("#controlPanel");
const authForm = document.querySelector("#authForm");
const authInput = document.querySelector("#configPassword");
const authError = document.querySelector("#authError");
const stateButtons = Array.from(document.querySelectorAll("[data-next-state]"));
const hoursInput = document.querySelector("#autoResetHours");
const statusValue = document.querySelector("#configStatusValue");
const timerValue = document.querySelector("#configTimerValue");
const saveButton = document.querySelector("#saveHoursButton");
const logoutButton = document.querySelector("#logoutButton");

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

const runConfigAction = async (callback) => {
  authError.textContent = "";

  try {
    await callback();
  } catch (error) {
    if (error?.status === 401) {
      showAuth("Session expired");
      return;
    }

    authError.textContent = error.message || "Unable to update config";
  }
};

const renderConfig = (config) => {
  showControls();
  statusValue.textContent = config.state === "yes" ? "Yes" : "No";
  statusValue.dataset.state = config.state;
  hoursInput.value = String(config.autoResetHours);
  timerValue.textContent = config.state === "yes" ? formatResetTime(config.resetAt) : "State is No";

  stateButtons.forEach((button) => {
    const isActive = button.dataset.nextState === config.state;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
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
    });
  });
});

saveButton?.addEventListener("click", async () => {
  await runConfigAction(async () => {
    const config = await updateAdminConfig({
      applyTimerToCurrentState: true,
      autoResetHours: hoursInput.value,
    });
    renderConfig(config);
  });
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
  });
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
