(() => {
  const MIN_EDGE = 64;
  const DEFAULT_PROMPT = "is this true?";
  const HOST_ID = "vwg-overlay-host";
  const HIDE_DELAY_MS = 220;

  if (window.__verifyWithGeminiOverlay?.reinit) {
    window.__verifyWithGeminiOverlay.reinit();
    return;
  }

  let promptText = DEFAULT_PROMPT;
  let isBusy = false;
  let activeTarget = null;
  let hideTimer = null;
  let host = null;
  let shadow = null;
  let badge = null;
  let statusPill = null;
  let listenersBound = false;

  function ensureHost() {
    const existing = document.getElementById(HOST_ID);
    if (existing?.shadowRoot?.getElementById("badge")) {
      host = existing;
      shadow = existing.shadowRoot;
      badge = shadow.getElementById("badge");
      statusPill = shadow.getElementById("status");
      return;
    }

    existing?.remove();

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = [
      "display:block",
      "position:fixed",
      "inset:0",
      "width:100vw",
      "height:100vh",
      "z-index:2147483646",
      "pointer-events:none",
      "overflow:visible",
    ].join(";");

    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .badge, .status {
          position: fixed;
          pointer-events: auto;
          display: none;
          align-items: center;
          gap: 6px;
          border: 0;
          border-radius: 999px;
          color: #fff;
          font: 700 12px/1.2 "Segoe UI", system-ui, sans-serif;
          box-shadow: 0 4px 14px rgba(0,0,0,.45);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
        }
        .badge {
          padding: 7px 12px;
          background: #1a73e8;
        }
        .badge.is-visible { display: inline-flex; }
        .badge:hover { background: #1557b0; }
        .badge.is-busy { opacity: .85; cursor: wait; }
        .status {
          left: 12px;
          bottom: 12px;
          padding: 8px 12px;
          background: #0f172a;
          display: inline-flex;
          z-index: 2147483647;
        }
        .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #22c55e; flex: 0 0 auto;
        }
        .icon {
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff; color: #1a73e8;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800;
        }
      </style>
      <button class="badge" id="badge" type="button">
        <span class="icon">?</span>
        <span class="label">Verify</span>
      </button>
      <button class="status" id="status" type="button" title="Verify with Gemini is active">
        <span class="dot"></span>
        <span>Verify ready</span>
      </button>
    `;
    badge = shadow.getElementById("badge");
    statusPill = shadow.getElementById("status");

    badge.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    badge.addEventListener("mouseleave", scheduleHide);
    badge.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (activeTarget) verify(activeTarget.src, activeTarget.node, badge);
      },
      true
    );
    statusPill.addEventListener("click", () => {
      alert(
        "Verify with Gemini is running.\n\nHover a photo to show Verify, or right-click an image → Verify with Gemini."
      );
    });

    (document.documentElement || document.body).appendChild(host);
  }

  function keepHostAlive() {
    ensureHost();
    if (host && !document.contains(host)) {
      (document.documentElement || document.body).appendChild(host);
    }
  }

  async function readPrompt() {
    try {
      if (!chrome?.storage) return DEFAULT_PROMPT;
      const area = chrome.storage.sync || chrome.storage.local;
      const stored = await area.get({ prompt: DEFAULT_PROMPT });
      const next = String(stored.prompt || "").trim();
      return next || DEFAULT_PROMPT;
    } catch (_) {
      return DEFAULT_PROMPT;
    }
  }

  async function refreshPrompt() {
    promptText = await readPrompt();
    if (badge) badge.title = `Copy image and ask Gemini: ${promptText}`;
  }

  function isAvatarSrc(src) {
    const s = String(src || "").toLowerCase();
    return (
      s.includes("profile_images") ||
      s.includes("_normal.") ||
      s.includes("_bigger.") ||
      s.includes("avatar")
    );
  }

  function bgUrl(el) {
    try {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") return "";
      const match = /url\((['"]?)(.*?)\1\)/.exec(bg);
      return match?.[2] || "";
    } catch (_) {
      return "";
    }
  }

  function isEligibleImg(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    const src = img.currentSrc || img.src;
    if (!src || isAvatarSrc(src)) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < MIN_EDGE || rect.height < MIN_EDGE) return false;
    try {
      const style = window.getComputedStyle(img);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (Number(style.opacity) === 0) return false;
    } catch (_) {
      return false;
    }
    return true;
  }

  function targetFromElement(el) {
    if (!el || el === host || (shadow && shadow.contains(el))) return null;

    if (el instanceof HTMLImageElement && isEligibleImg(el)) {
      return {
        src: el.currentSrc || el.src,
        node: el,
        getRect: () => el.getBoundingClientRect(),
      };
    }

    const photo = el.closest?.(
      '[data-testid="tweetPhoto"], [data-testid="image"], a[href*="/photo/"]'
    );
    if (photo) {
      const img = photo.querySelector("img");
      if (img && isEligibleImg(img)) {
        return {
          src: img.currentSrc || img.src,
          node: img,
          getRect: () => img.getBoundingClientRect(),
        };
      }
      const src = bgUrl(photo);
      if (src && !isAvatarSrc(src)) {
        const rect = photo.getBoundingClientRect();
        if (rect.width >= MIN_EDGE && rect.height >= MIN_EDGE) {
          return {
            src,
            node: photo,
            getRect: () => photo.getBoundingClientRect(),
          };
        }
      }
    }

    const nested = el.querySelector?.("img");
    if (nested && isEligibleImg(nested)) {
      return {
        src: nested.currentSrc || nested.src,
        node: nested,
        getRect: () => nested.getBoundingClientRect(),
      };
    }

    return null;
  }

  function targetFromPoint(x, y) {
    let stack = [];
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (_) {
      return null;
    }
    for (const el of stack) {
      const target = targetFromElement(el);
      if (target) return target;
    }
    return null;
  }

  function placeBadge(target) {
    keepHostAlive();
    if (!badge) return;
    const rect = target.getRect();
    if (!rect || rect.width < MIN_EDGE || rect.height < MIN_EDGE) {
      badge.classList.remove("is-visible");
      return;
    }
    badge.classList.add("is-visible");
    const width = badge.offsetWidth || 92;
    const top = Math.max(8, Math.min(rect.top + 8, innerHeight - 40));
    const left = Math.max(
      8,
      Math.min(rect.right - width - 8, innerWidth - width - 8)
    );
    badge.style.top = `${top}px`;
    badge.style.left = `${left}px`;
    badge.title = `Copy image and ask Gemini: ${promptText}`;
  }

  function showFor(target) {
    if (isBusy || !target) return;
    activeTarget = target;
    clearTimeout(hideTimer);
    placeBadge(target);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (isBusy) return;
      activeTarget = null;
      badge?.classList.remove("is-visible");
    }, HIDE_DELAY_MS);
  }

  function canvasCaptureFromImg(img) {
    const width = img.naturalWidth || Math.round(img.getBoundingClientRect().width);
    const height = img.naturalHeight || Math.round(img.getBoundingClientRect().height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), mimeType: "image/png" };
  }

  async function blobToPngBlob(blob) {
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("PNG convert failed"))),
        "image/png"
      );
    });
  }

  async function writePngClipboard(dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const pngBlob = await blobToPngBlob(blob);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": pngBlob }),
    ]);
  }

  async function captureSrc(src, node) {
    if (node instanceof HTMLImageElement) {
      try {
        return canvasCaptureFromImg(node);
      } catch (_) {
        // Fall through.
      }
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "vwg_fetch_image",
        src,
        pageUrl: location.href,
      });
      if (response?.ok) return response;
    } catch (_) {
      // Fall through.
    }
    throw new Error("Could not copy this image");
  }

  async function verify(src, node, button) {
    if (isBusy) return;
    isBusy = true;
    const label = button.querySelector(".label");
    button.classList.add("is-busy");
    if (label) label.textContent = "Copying…";
    try {
      await refreshPrompt();
      const captured = await captureSrc(src, node);
      if (!captured?.dataUrl) throw new Error("Could not copy image");
      await writePngClipboard(captured.dataUrl);
      if (label) label.textContent = "Opening…";
      const open = await chrome.runtime.sendMessage({
        type: "vwg_open_gemini",
        prompt: promptText,
      });
      if (!open?.ok) throw new Error(open?.error || "Could not open Gemini");
      if (label) label.textContent = open.pasted ? "Sent" : "Opened";
      setTimeout(() => {
        if (label) label.textContent = "Verify";
        button.classList.remove("is-visible");
      }, 700);
    } catch (err) {
      console.warn("[Verify with Gemini]", err);
      alert(`Verify with Gemini failed: ${err?.message || err}`);
      if (label) label.textContent = "Verify";
    } finally {
      isBusy = false;
      button.classList.remove("is-busy");
    }
  }

  function onMouseMove(event) {
    const target = targetFromPoint(event.clientX, event.clientY);
    if (target) showFor(target);
    else scheduleHide();
  }

  function onMouseOver(event) {
    const target = targetFromElement(event.target);
    if (target) showFor(target);
  }

  function onScrollOrResize() {
    if (activeTarget && badge?.classList.contains("is-visible")) {
      placeBadge(activeTarget);
    }
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    document.addEventListener("mousemove", onMouseMove, {
      passive: true,
      capture: true,
    });
    document.addEventListener("mouseover", onMouseOver, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
  }

  function reinit() {
    keepHostAlive();
    bindListeners();
    refreshPrompt();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "vwg_ping") {
      reinit();
      sendResponse({ ok: true, href: location.href });
      return true;
    }
    if (message?.type === "vwg_prompt_updated") {
      refreshPrompt().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if ((area === "sync" || area === "local") && changes.prompt) {
        refreshPrompt();
      }
    });
  } catch (_) {
    // Storage may be unavailable until the extension is reloaded.
  }

  window.__verifyWithGeminiOverlay = { refreshPrompt, reinit };
  reinit();
})();
