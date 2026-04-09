import { fetchStatus } from "./site-api.js";

const DEFAULT_AUTOMATION_REASON = "Fresh posts get scored here.";
const DEFAULT_NO_SUBTITLE = "Limits have not reset yet.";
const DEFAULT_YES_SUBTITLE = "Limits reset, go crazy";

const root = document.documentElement;
const answerValue = document.querySelector("#answerValue");
const subtitle = document.querySelector("#subtitle");
const automationTweetLabel = document.querySelector("#automationTweetLabel");
const automationTweetLink = document.querySelector("#automationTweetLink");
const automationTweetText = document.querySelector("#automationTweetText");
const automationTweetMeta = document.querySelector("#automationTweetMeta");
const automationVerdictValue = document.querySelector("#automationVerdictValue");
const automationVerdictMeta = document.querySelector("#automationVerdictMeta");
const automationReasoningValue = document.querySelector("#automationReasoningValue");
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

const normalizeInlineText = (value) => {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
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
    return;
  }

  element.dataset.empty = "true";
  element.setAttribute("aria-disabled", "true");
  element.removeAttribute("href");

  if (fallbackText) {
    element.setAttribute("aria-label", fallbackText);
  }
};

const applyAutomationSummary = (summary = null) => {
  if (!automationTweetText) {
    return;
  }

  if (!summary) {
    setLinkState(automationTweetLink, null, "Waiting for first tracked post");
    automationTweetLabel.textContent = "Last tweet seen by thsottiaux";
    automationTweetText.textContent = "Waiting for first tracked post";
    automationTweetMeta.textContent = "Monitor is live.";
    automationVerdictValue.textContent = "Monitoring";
    automationVerdictValue.dataset.state = "";
    automationVerdictMeta.textContent = "No classification yet.";
    automationReasoningValue.textContent = DEFAULT_AUTOMATION_REASON;
    automationInputTokensValue.textContent = "0";
    automationModelValue.textContent = "CHATGPT-5.4";
    automationOutputTokensValue.textContent = "0";
    automationReasoningTokensValue.textContent = "0";
    return;
  }

  const tweetText =
    truncateText(normalizeInlineText(summary.tweetText), 132) ||
    (summary.tweetId ? `Tracked post ${summary.tweetId}` : "Tracked post");
  const checkedAtText = formatDateTime(summary.checkedAt);
  const confidenceText = Number.isFinite(summary.confidence) ? `${Math.round(summary.confidence * 100)}% conf` : null;
  const trackedUsername = getTrackedUsername(summary.tweetUrl);

  setLinkState(automationTweetLink, summary.tweetUrl, tweetText);
  automationTweetLabel.textContent = `Last tweet seen by ${trackedUsername}`;
  automationTweetText.textContent = tweetText;
  automationTweetMeta.textContent = summary.tweetUrl ? checkedAtText : "Waiting for first linked post.";
  automationVerdictValue.textContent = formatAutomationVerdict(summary.verdict);
  automationVerdictValue.dataset.state =
    summary.verdict === "reset_confirmed" ? "yes" : summary.verdict === "not_reset" ? "no" : "review";
  automationVerdictMeta.textContent = confidenceText || "Live classification";
  automationReasoningValue.textContent = truncateText(normalizeInlineText(summary.rationale), 260) || DEFAULT_AUTOMATION_REASON;
  automationInputTokensValue.textContent = formatTokenCount(summary.usage?.inputTokens || 0);
  automationModelValue.textContent = String(summary.model || "chatgpt-5.4").toUpperCase();
  automationOutputTokensValue.textContent = formatTokenCount(summary.usage?.outputTokens || 0);
  automationReasoningTokensValue.textContent = formatTokenCount(summary.usage?.reasoningTokens || 0);
};

const applyState = ({ automationSummary = null, configured = true, noSubtitles = [], state, yesSubtitles = [] }) => {
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
  answerValue.textContent = "No";
  subtitle.textContent = DEFAULT_NO_SUBTITLE;
  applyAutomationSummary(null);
};

fetchStatus().then(applyState).catch(applyUnavailableState);
window.setInterval(() => {
  fetchStatus().then(applyState).catch(() => {});
}, 60 * 1000);

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
  heroMarkShell.addEventListener("pointerenter", playHeroMark, { passive: true });
  heroMarkShell.addEventListener("click", playHeroMark);
  heroMarkShell.addEventListener("touchstart", playHeroMark, { passive: true });
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
