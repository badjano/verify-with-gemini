(() => {
  const MIN_EDGE = 64;
  const DEFAULT_PROMPT = "is this true?";
  const HOST_ID = "vwg-overlay-host";

  if (window.__verifyWithGeminiOverlay?.reinit) {
    window.__verifyWithGeminiOverlay.reinit();
    return;
  }

  /** @type {Map<Element, { el: HTMLButtonElement, src: string, getRect: () => DOMRect }>} */
  const badges = new Map();
  let promptText = DEFAULT_PROMPT;
  let isBusy = false;
  let rafPending = false;
  let host = null;
  let shadow = null;
  let statusPill = null;

  function ensureHost() {
    const existing = document.getElementById(HOST_ID);
    if (existing?.shadowRoot?.getElementById("status")) {
      host = existing;
      shadow = existing.shadowRoot;
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
          display: inline-flex;
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
        .badge:hover { background: #1557b0; }
        .badge.is-busy { opacity: .85; cursor: wait; }
        .badge.is-hidden { display: none !important; }
        .status {
          left: 12px;
          bottom: 12px;
          padding: 8px 12px;
          background: #0f172a;
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
      <button class="status" id="status" type="button" title="Verify with Gemini is active">
        <span class="dot"></span>
        <span>Verify ready</span>
      </button>
    `;
    statusPill = shadow.getElementById("status");
    statusPill.addEventListener("click", () => {
      alert(
        "Verify with Gemini is running.\n\nBlue Verify buttons appear on photos. You can also right-click an image → Verify with Gemini."
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
  }

  function isAvatarSrc(src) {
    const s = String(src || "").toLowerCase();
    return (
      s.includes("profile_images") ||
      s.includes("_normal.") ||
      s.includes("_bigger.") ||
      s.includes("avatar") ||
      s.includes("twemoji") ||
      s.includes("emoji")
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

  function isOnScreen(rect) {
    return (
      rect.width >= MIN_EDGE &&
      rect.height >= MIN_EDGE &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth
    );
  }

  function collectTargets() {
    /** @type {{ node: Element, src: string, getRect: () => DOMRect }[]} */
    const out = [];
    const seen = new Set();

    const add = (node, src, getRect) => {
      if (!node || !src || seen.has(node) || isAvatarSrc(src)) return;
      const rect = getRect();
      if (!isOnScreen(rect)) return;
      seen.add(node);
      out.push({ node, src, getRect });
    };

    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      add(img, src, () => img.getBoundingClientRect());
    }

    // X / Twitter media containers (even when overlays cover the <img>).
    for (const el of document.querySelectorAll(
      '[data-testid="tweetPhoto"], [data-testid="image"], a[href*="/photo/"]'
    )) {
      const img = el.querySelector("img");
      if (img) {
        add(img, img.currentSrc || img.src, () => img.getBoundingClientRect());
        continue;
      }
      const src = bgUrl(el);
      add(el, src, () => el.getBoundingClientRect());
    }

    return out;
  }

  function positionBadge(entry) {
    const rect = entry.getRect();
    if (!isOnScreen(rect)) {
      entry.el.classList.add("is-hidden");
      return;
    }
    entry.el.classList.remove("is-hidden");
    const width = entry.el.offsetWidth || 92;
    entry.el.style.top = `${Math.max(8, Math.min(rect.top + 8, innerHeight - 40))}px`;
    entry.el.style.left = `${Math.max(
      8,
      Math.min(rect.right - width - 8, innerWidth - width - 8)
    )}px`;
    entry.el.title = `Copy image and ask Gemini: ${promptText}`;
  }

  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      keepHostAlive();
      for (const [node, entry] of badges) {
        if (!node.isConnected) {
          entry.el.remove();
          badges.delete(node);
          continue;
        }
        positionBadge(entry);
      }
      const label = statusPill?.querySelector("span:last-of-type");
      if (label) label.textContent = `Verify ready (${badges.size})`;
    });
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

  function ensureBadge(target) {
    let entry = badges.get(target.node);
    if (entry) {
      entry.src = target.src;
      entry.getRect = target.getRect;
      return entry;
    }

    const el = document.createElement("button");
    el.type = "button";
    el.className = "badge";
    el.innerHTML = '<span class="icon">?</span><span class="label">Verify</span>';
    el.title = `Copy image and ask Gemini: ${promptText}`;
    el.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        verify(target.src, target.node, el);
      },
      true
    );

    shadow.appendChild(el);
    entry = { el, src: target.src, getRect: target.getRect };
    badges.set(target.node, entry);
    positionBadge(entry);
    return entry;
  }

  function rescan() {
    keepHostAlive();
    const targets = collectTargets();
    const keep = new Set();
    for (const target of targets) {
      ensureBadge(target);
      keep.add(target.node);
    }
    for (const [node, entry] of badges) {
      if (!keep.has(node) || !node.isConnected) {
        entry.el.remove();
        badges.delete(node);
      }
    }
    scheduleReposition();
  }

  function reinit() {
    keepHostAlive();
    refreshPrompt().then(rescan);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "vwg_ping") {
      reinit();
      sendResponse({ ok: true, href: location.href, badges: badges.size });
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
    // Storage may be unavailable until reload.
  }

  const mo = new MutationObserver(() => {
    clearTimeout(window.__vwgScanTimer);
    window.__vwgScanTimer = setTimeout(rescan, 250);
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "style", "class"],
  });

  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);
  setInterval(rescan, 1500);

  window.__verifyWithGeminiOverlay = { refreshPrompt, reinit, rescan };
  reinit();
})();
