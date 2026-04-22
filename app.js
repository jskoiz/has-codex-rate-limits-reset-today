import { fetchStatus } from "./site-api.js";

const DEFAULT_AUTOMATION_REASON = "Fresh posts get scored here.";
const DEFAULT_NO_SUBTITLE = "Limits have not reset yet.";
const DEFAULT_YES_SUBTITLE = "Limits reset, go crazy";

const root = document.documentElement;
const answerValue = document.querySelector("#answerValue");
const subtitle = document.querySelector("#subtitle");
const automationTrace = document.querySelector(".automation-trace");
const automationTweetLabel = document.querySelector("#automationTweetLabel");
const automationTweetLink = document.querySelector("#automationTweetLink");
const automationTweetText = document.querySelector("#automationTweetText");
const automationTweetMeta = document.querySelector("#automationTweetMeta");
const automationReasoningLabel = document.querySelector("#automationReasoningLabel");
const automationVerdictValue = document.querySelector("#automationVerdictValue");
const automationVerdictMeta = document.querySelector("#automationVerdictMeta");
const automationReasoningValue = document.querySelector("#automationReasoningValue");
const automationInactiveLatestCard = document.querySelector("#automationInactiveLatestCard");
const automationInactiveResetCard = document.querySelector("#automationInactiveResetCard");
const automationInactiveLatestLabel = document.querySelector("#automationInactiveLatestLabel");
const automationInactiveLatestTime = document.querySelector("#automationInactiveLatestTime");
const automationInactiveVerdictValue = document.querySelector("#automationInactiveVerdictValue");
const automationInactiveResetTime = document.querySelector("#automationInactiveResetTime");
const automationTokensLabel = document.querySelector("#automationTokensLabel");
const automationInputTokensValue = document.querySelector("#automationInputTokensValue");
const automationModelValue = document.querySelector("#automationModelValue");
const automationOutputTokensValue = document.querySelector("#automationOutputTokensValue");
const automationReasoningTokensValue = document.querySelector("#automationReasoningTokensValue");
const asciiField = document.querySelector("#asciiField");
const heroVideo = document.querySelector(".hero-video");
const heroMarkShell = document.querySelector(".hero-mark-shell");
const heroMarkVideo = document.querySelector(".hero-mark-video");
const heroVideoCanvas = document.querySelector("#heroVideoCanvas");
const heroMarkCanvas = document.querySelector("#heroMarkCanvas");
const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileVideoQuery = window.matchMedia("(hover: none), (pointer: coarse), (max-width: 820px)");
const liveAgeElements = [];
let latestStatusPayload = null;
let statusRefreshInFlight = null;

const pickRandomSubtitle = (subtitles) => {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return DEFAULT_NO_SUBTITLE;
  }

  const index = Math.floor(Math.random() * subtitles.length);
  return subtitles[index] || DEFAULT_NO_SUBTITLE;
};

const formatDateTime = (value) => {
  if (!value) {
    return "Awaiting first pass";
  }

  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Awaiting first pass";
  }

  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatElapsedAge = (value) => {
  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Awaiting first pass";
  }

  const totalMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const segments = [];

  if (days > 0) {
    segments.push(`${days}d`);
  }

  if (hours > 0 || days > 0) {
    segments.push(`${hours}h`);
  }

  segments.push(`${minutes}m`);

  return `${segments.join(" ")} ago`;
};

const formatTokenCount = (value) => new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0);

const getTrackedUsername = (tweetUrl) => {
  if (!tweetUrl) {
    return "thsottiaux";
  }

  const match = tweetUrl.match(/x\.com\/([^/]+)\/status/i);
  return match?.[1] || "thsottiaux";
};

const formatAutomationVerdict = (value) => {
  if (value === "reset_confirmed") {
    return "Yes";
  }

  if (value === "not_reset") {
    return "No";
  }

  if (value === "uncertain") {
    return "Review";
  }

  return "Monitoring";
};

const decodeHtmlEntities = (value) => {
  if (!value) {
    return "";
  }

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity) => {
    const normalized = String(entity).toLowerCase();

    if (normalized === "amp") {
      return "&";
    }

    if (normalized === "lt") {
      return "<";
    }

    if (normalized === "gt") {
      return ">";
    }

    if (normalized === "quot") {
      return '"';
    }

    if (normalized === "apos" || normalized === "#39" || normalized === "#x27") {
      return "'";
    }

    if (normalized === "nbsp") {
      return " ";
    }

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
    }

    return `&${entity};`;
  });
};

const normalizeInlineText = (value) => {
  if (!value) {
    return "";
  }

  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
};

const truncateText = (value, maxLength = 144) => {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
};

const setLinkState = (element, href, fallbackText) => {
  if (!element) {
    return;
  }

  if (href) {
    element.href = href;
    element.dataset.empty = "false";
    element.removeAttribute("aria-disabled");
    element.removeAttribute("aria-label");
    return;
  }

  element.dataset.empty = "true";
  element.setAttribute("aria-disabled", "true");
  element.removeAttribute("href");

  if (fallbackText) {
    element.setAttribute("aria-label", fallbackText);
  }
};

const setInactiveCardState = (visible) => {
  if (automationInactiveLatestCard) {
    automationInactiveLatestCard.hidden = !visible;
  }

  if (automationInactiveResetCard) {
    automationInactiveResetCard.hidden = !visible;
  }
};

const setLiveAgeText = (element, value, prefix = "") => {
  if (!element) {
    return;
  }

  const timestamp = typeof value === "number" ? value : Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    delete element.dataset.liveAgeTimestamp;
    delete element.dataset.liveAgePrefix;
    element.textContent = prefix ? `${prefix}Awaiting first pass` : "Awaiting first pass";
    return;
  }

  element.dataset.liveAgeTimestamp = String(timestamp);
  element.dataset.liveAgePrefix = prefix;
  element.textContent = `${prefix}${formatElapsedAge(timestamp)}`;

  if (!liveAgeElements.includes(element)) {
    liveAgeElements.push(element);
  }
};

const refreshLiveAgeText = () => {
  for (const element of liveAgeElements) {
    const timestamp = Number(element.dataset.liveAgeTimestamp);

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    element.textContent = `${element.dataset.liveAgePrefix || ""}${formatElapsedAge(timestamp)}`;
  }
};

const parseTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasDistinctLatestCheck = (summary) => {
  if (!summary?.latest) {
    return false;
  }

  if (!summary.lastReset) {
    return true;
  }

  return (
    summary.latest.tweetId !== summary.lastReset.tweetId ||
    summary.latest.verdict !== summary.lastReset.verdict ||
    summary.latest.checkedAt !== summary.lastReset.checkedAt
  );
};

const applyAutomationSummary = (summary = null) => {
  if (!automationTweetText) {
    return;
  }

  if (!summary) {
    if (automationTrace) {
      automationTrace.dataset.mode = "empty";
    }
    setInactiveCardState(false);
    setLinkState(automationTweetLink, null, "Waiting for first tracked post");
    automationTweetLabel.textContent = "Last tweet seen by thsottiaux";
    automationTweetText.textContent = "Waiting for first tracked post";
    automationTweetMeta.textContent = "Monitor is live.";
    automationReasoningLabel.textContent = "Reasoning";
    automationVerdictValue.textContent = "Monitoring";
    automationVerdictValue.dataset.state = "";
    automationVerdictMeta.textContent = "No classification yet.";
    automationReasoningValue.textContent = DEFAULT_AUTOMATION_REASON;
    automationTokensLabel.textContent = "TOKENS USED:";
    setLinkState(automationInactiveLatestCard, null, "Waiting for first tracked post");
    setLinkState(automationInactiveResetCard, null, "Awaiting reset");
    delete automationTweetMeta.dataset.liveAgeTimestamp;
    delete automationTweetMeta.dataset.liveAgePrefix;
    delete automationInactiveLatestTime.dataset.liveAgeTimestamp;
    delete automationInactiveLatestTime.dataset.liveAgePrefix;
    delete automationInactiveResetTime.dataset.liveAgeTimestamp;
    delete automationInactiveResetTime.dataset.liveAgePrefix;
    automationInputTokensValue.textContent = "0";
    automationModelValue.textContent = "CHATGPT-5.4";
    automationOutputTokensValue.textContent = "0";
    automationReasoningTokensValue.textContent = "0";
    return;
  }

  const displayEntry = summary.lastReset || summary.latest || summary;
  const latestEntry = summary.latest || summary;
  const latestCheckIsDistinct = summary.mode === "inactive" && hasDistinctLatestCheck(summary);
  const tokenSource = summary.mode === "inactive" ? latestEntry || displayEntry : displayEntry;
  const isPinnedReset = Boolean(summary.lastReset) || displayEntry.verdict === "reset_confirmed";
  const isCollapsedInactive = summary.mode === "inactive" && isPinnedReset;
  const displayAgeSource = displayEntry.tweetCreatedAt || displayEntry.checkedAt;
  const latestAgeSource = latestEntry?.tweetCreatedAt || latestEntry?.checkedAt || displayAgeSource;
  const resetAgeSource = summary.lastReset?.tweetCreatedAt || summary.lastReset?.checkedAt || displayAgeSource;
  const tweetText =
    truncateText(normalizeInlineText(displayEntry.tweetText), 132) ||
    (displayEntry.tweetId ? `Tracked post ${displayEntry.tweetId}` : "Tracked post");
  const checkedAtText = formatDateTime(displayEntry.checkedAt);
  const confidenceText = Number.isFinite(displayEntry.confidence) ? `${Math.round(displayEntry.confidence * 100)}% conf` : null;
  const trackedUsername = getTrackedUsername(displayEntry.tweetUrl);

  if (automationTrace) {
    automationTrace.dataset.mode = isCollapsedInactive ? "inactive" : summary.mode || "active";
  }
  setInactiveCardState(isCollapsedInactive);

  setLinkState(automationTweetLink, displayEntry.tweetUrl, tweetText);
  automationTweetLabel.textContent =
    isCollapsedInactive
      ? `Last reset tweet by ${trackedUsername}`
      : isPinnedReset
        ? `Reset tweet by ${trackedUsername}`
        : `Last tweet seen by ${trackedUsername}`;
  automationTweetText.textContent = tweetText;
  setLiveAgeText(automationTweetMeta, displayAgeSource, "Posted ");
  automationReasoningLabel.textContent = isCollapsedInactive
    ? `Last reset reasoning · ${checkedAtText}`
    : "Reasoning";
  automationVerdictValue.textContent = formatAutomationVerdict(displayEntry.verdict);
  automationVerdictValue.dataset.state =
    displayEntry.verdict === "reset_confirmed" ? "yes" : displayEntry.verdict === "not_reset" ? "no" : "review";
  automationVerdictMeta.textContent = confidenceText || "Live classification";
  automationReasoningValue.textContent =
    truncateText(normalizeInlineText(displayEntry.rationale), 260) || DEFAULT_AUTOMATION_REASON;
  if (isCollapsedInactive) {
    const latestUsername = getTrackedUsername(latestEntry?.tweetUrl || displayEntry.tweetUrl);
    automationInactiveLatestLabel.textContent = `Last @${latestUsername} tweet:`;
    setLiveAgeText(automationInactiveLatestTime, latestAgeSource, "Posted ");
    automationInactiveVerdictValue.textContent = "No";
    automationInactiveVerdictValue.dataset.state = "no";
    setLinkState(
      automationInactiveLatestCard,
      latestEntry?.tweetUrl || displayEntry.tweetUrl,
      automationInactiveLatestTime.textContent,
    );
    setLiveAgeText(automationInactiveResetTime, resetAgeSource);
    setLinkState(
      automationInactiveResetCard,
      summary.lastReset?.tweetUrl || displayEntry.tweetUrl,
      `Last Yes verdict ${formatElapsedAge(resetAgeSource)}`,
    );
    automationTokensLabel.textContent = "LATEST CHECK COST:";
  } else {
    automationInactiveVerdictValue.dataset.state = "";
    setLinkState(automationInactiveLatestCard, null, "Waiting for first tracked post");
    setLinkState(automationInactiveResetCard, null, "Awaiting reset");
    delete automationInactiveLatestTime.dataset.liveAgeTimestamp;
    delete automationInactiveLatestTime.dataset.liveAgePrefix;
    delete automationInactiveResetTime.dataset.liveAgeTimestamp;
    delete automationInactiveResetTime.dataset.liveAgePrefix;
    automationTokensLabel.textContent = "TOKENS USED:";
  }
  automationInputTokensValue.textContent = formatTokenCount(tokenSource.usage?.inputTokens || 0);
  automationModelValue.textContent = String(summary.model || "chatgpt-5.4").toUpperCase();
  automationOutputTokensValue.textContent = formatTokenCount(tokenSource.usage?.outputTokens || 0);
  automationReasoningTokensValue.textContent = formatTokenCount(tokenSource.usage?.reasoningTokens || 0);
};

const applyState = ({ automationSummary = null, configured = true, noSubtitles = [], resetAt = null, state, yesSubtitles = [] }) => {
  latestStatusPayload = { automationSummary, configured, noSubtitles, resetAt, state, yesSubtitles };
  const hasReset = state !== "no";

  answerValue.textContent = hasReset ? "Yes" : "No";
  applyAutomationSummary(automationSummary);

  if (!configured) {
    subtitle.textContent = "Site config is not set up yet";
    return;
  }

  subtitle.textContent = hasReset ? pickRandomSubtitle(yesSubtitles.length ? yesSubtitles : [DEFAULT_YES_SUBTITLE]) : pickRandomSubtitle(noSubtitles);
};

const applyUnavailableState = () => {
  latestStatusPayload = null;
  answerValue.textContent = "No";
  subtitle.textContent = DEFAULT_NO_SUBTITLE;
  applyAutomationSummary(null);
};

const refreshStatus = async (quiet = false) => {
  if (statusRefreshInFlight) {
    return statusRefreshInFlight;
  }

  statusRefreshInFlight = fetchStatus()
    .then((payload) => {
      applyState(payload);
      return payload;
    })
    .catch((error) => {
      if (!quiet) {
        applyUnavailableState();
      }

      throw error;
    })
    .finally(() => {
      statusRefreshInFlight = null;
    });

  return statusRefreshInFlight;
};

const syncLivePresentation = () => {
  refreshLiveAgeText();

  const resetAt = parseTimestamp(latestStatusPayload?.resetAt);

  if (latestStatusPayload?.state === "yes" && resetAt && Date.now() >= resetAt) {
    refreshStatus(true).catch(() => {});
  }
};

refreshStatus().catch(() => {});
window.setInterval(() => {
  refreshStatus(true).catch(() => {});
}, 60 * 1000);
window.setInterval(syncLivePresentation, 1000);

const primeVideoPlayback = (video) => {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");

  const playVideo = () => {
    const playAttempt = video.play();
    if (playAttempt?.catch) {
      playAttempt.catch(() => {});
    }
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    playVideo();
  } else {
    video.addEventListener("canplay", playVideo, { once: true });
    video.addEventListener("loadeddata", playVideo, { once: true });
  }
};

primeVideoPlayback(heroVideo);

const resumeVideos = () => {
  if (!heroVideo || !heroVideo.paused) {
    return;
  }

  const playAttempt = heroVideo.play();
  if (playAttempt?.catch) {
    playAttempt.catch(() => {});
  }
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    resumeVideos();
  }
});

window.addEventListener("pageshow", resumeVideos, { passive: true });
window.addEventListener("touchstart", resumeVideos, { passive: true, once: true });

const createVideoCanvasRenderer = (video, canvas, measureBounds) => {
  if (!video || !canvas) {
    return null;
  }

  const ctx = canvas.getContext("2d", { alpha: true });

  if (!ctx) {
    return null;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let drawWidth = 0;
  let drawHeight = 0;

  const resize = () => {
    const bounds = measureBounds();
    drawWidth = Math.max(1, Math.round(bounds.width));
    drawHeight = Math.max(1, Math.round(bounds.height));
    canvas.width = Math.max(1, Math.round(drawWidth * dpr));
    canvas.height = Math.max(1, Math.round(drawHeight * dpr));
    canvas.style.width = `${drawWidth}px`;
    canvas.style.height = `${drawHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const render = () => {
    if (!drawWidth || !drawHeight) {
      resize();
    }

    ctx.clearRect(0, 0, drawWidth, drawHeight);

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const sourceRatio = video.videoWidth / video.videoHeight;
    const targetRatio = drawWidth / drawHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;

    if (sourceRatio > targetRatio) {
      sourceWidth = video.videoHeight * targetRatio;
      sourceX = (video.videoWidth - sourceWidth) * 0.5;
    } else {
      sourceHeight = video.videoWidth / targetRatio;
      sourceY = (video.videoHeight - sourceHeight) * 0.5;
    }

    try {
      ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, drawWidth, drawHeight);
    } catch (_error) {
      root.dataset.videoMode = "native";
    }
  };

  resize();
  return { resize, render };
};

const videoCanvasRenderers = [];

const resizeVideoCanvases = () => {
  videoCanvasRenderers.forEach((renderer) => renderer.resize());
};

const renderVideoCanvases = () => {
  videoCanvasRenderers.forEach((renderer) => renderer.render());
  window.requestAnimationFrame(renderVideoCanvases);
};

if (mobileVideoQuery.matches) {
  root.dataset.videoMode = "canvas";

  const heroRenderer = createVideoCanvasRenderer(
    document.querySelector(".hero-video"),
    heroVideoCanvas,
    () => ({ width: window.innerWidth, height: window.innerHeight }),
  );

  if (heroRenderer) {
    videoCanvasRenderers.push(heroRenderer);
  }
} else {
  root.dataset.videoMode = "native";
}

const heroMarkRenderer = createVideoCanvasRenderer(
  heroMarkVideo,
  heroMarkCanvas,
  () => {
    const bounds = heroMarkCanvas.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  },
);

if (heroMarkRenderer) {
  videoCanvasRenderers.push(heroMarkRenderer);
}

resizeVideoCanvases();
window.addEventListener("resize", resizeVideoCanvases, { passive: true });

if (window.ResizeObserver && heroMarkCanvas) {
  const markObserver = new ResizeObserver(resizeVideoCanvases);
  markObserver.observe(heroMarkCanvas);
}

if (videoCanvasRenderers.length > 0) {
  window.requestAnimationFrame(renderVideoCanvases);
}

const resetHeroMark = () => {
  if (!heroMarkVideo || !heroMarkRenderer) {
    return;
  }

  heroMarkVideo.pause();
  heroMarkVideo.currentTime = 0;
  heroMarkRenderer.render();
};

const playHeroMark = () => {
  if (!heroMarkVideo) {
    return;
  }

  heroMarkVideo.pause();
  heroMarkVideo.currentTime = 0;
  const playAttempt = heroMarkVideo.play();

  if (playAttempt?.catch) {
    playAttempt.catch(() => {});
  }
};

if (heroMarkVideo) {
  heroMarkVideo.loop = false;
  heroMarkVideo.addEventListener("loadeddata", () => {
    heroMarkRenderer?.render();
    heroMarkVideo.pause();
  });
  heroMarkVideo.addEventListener("seeked", () => {
    heroMarkRenderer?.render();
  });
  heroMarkVideo.addEventListener("ended", resetHeroMark);
  heroMarkVideo.load();
}

if (heroMarkShell) {
  if (!mobileVideoQuery.matches) {
    heroMarkShell.addEventListener("pointerenter", playHeroMark, { passive: true });
    heroMarkShell.addEventListener("click", playHeroMark);
    heroMarkShell.addEventListener("touchstart", playHeroMark, { passive: true });
  }
}

if (!mediaQuery.matches) {
  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    targetX: window.innerWidth / 2,
    targetY: window.innerHeight / 2,
  };

  const updatePointer = ({ clientX, clientY }) => {
    const x = clientX / window.innerWidth;
    const y = clientY / window.innerHeight;

    pointer.targetX = clientX;
    pointer.targetY = clientY;
    root.style.setProperty("--pointer-x", `${(x * 100).toFixed(2)}%`);
    root.style.setProperty("--pointer-y", `${(y * 100).toFixed(2)}%`);
  };

  window.addEventListener("pointermove", updatePointer, { passive: true });

  window.addEventListener(
    "pointerleave",
    () => {
      pointer.targetX = window.innerWidth / 2;
      pointer.targetY = window.innerHeight / 2;
    },
    { passive: true },
  );

  if (asciiField) {
    const ctx = asciiField.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const glyphs = [" ", ".", ":", "+", "*", "o", "O", "#"];
    let width = 0;
    let height = 0;
    let spacing = 22;

    const resizeField = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      spacing = width < 720 ? 18 : 22;
      asciiField.width = Math.floor(width * dpr);
      asciiField.height = Math.floor(height * dpr);
      asciiField.style.width = `${width}px`;
      asciiField.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${width < 720 ? 12 : 13}px Menlo, Monaco, monospace`;
    };

    resizeField();
    window.addEventListener("resize", resizeField, { passive: true });

    const render = (time) => {
      pointer.x += (pointer.targetX - pointer.x) * 0.08;
      pointer.y += (pointer.targetY - pointer.y) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const cols = Math.ceil(width / spacing);
      const rows = Math.ceil(height / spacing);
      const radius = Math.min(width, height) * 0.24;
      const t = time * 0.0012;

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const baseX = col * spacing + (row % 2) * 5;
          const baseY = row * spacing + 8;
          const dx = pointer.x - baseX;
          const dy = pointer.y - baseY;
          const dist = Math.hypot(dx, dy);
          const influence = Math.max(0, 1 - dist / radius);
          const wave =
            Math.sin(baseX * 0.018 + t + row * 0.14) +
            Math.cos(baseY * 0.015 - t * 0.9 + col * 0.11);
          const driftX = Math.sin(t + row * 0.37 + col * 0.13) * 1.6;
          const driftY = Math.cos(t * 1.1 - row * 0.18 + col * 0.17) * 1.4;
          const pullX = dist > 0 ? (dx / dist) * influence * 9 : 0;
          const pullY = dist > 0 ? (dy / dist) * influence * 9 : 0;
          const intensity = (wave + 2) / 4 + influence * 0.9;
          const glyphIndex = Math.min(
            glyphs.length - 1,
            Math.max(0, Math.floor(intensity * (glyphs.length - 1))),
          );

          if (glyphIndex === 0 && influence < 0.06) {
            continue;
          }

          ctx.fillStyle =
            influence > 0.18 ? "rgba(98, 112, 210, 0.42)" : "rgba(84, 90, 150, 0.22)";
          ctx.globalAlpha = Math.min(0.7, 0.1 + influence * 0.5 + glyphIndex * 0.045);
          ctx.fillText(glyphs[glyphIndex], baseX + driftX + pullX, baseY + driftY + pullY);
        }
      }

      ctx.globalAlpha = 1;
      window.requestAnimationFrame(render);
    };

    window.requestAnimationFrame(render);
  }
}
