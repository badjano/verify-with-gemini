(() => {
  if (window.__verifyWithGeminiOverlay) {
    window.__verifyWithGeminiOverlay.rescan?.();
    return;
  }

  const MIN_EDGE = 64;
  const PROMPT = "is this true?";
  const HOST_ID = "vwg-overlay-host";

  /** @type {Map<string, { el: HTMLButtonElement, getRect: () => DOMRect | null, src: string }>} */
  const badges = new Map();
  let isBusy = false;
  let rafPending = false;
  let host = null;
  let shadow = null;
  let statusPill = null;

  function ensureHost() {
    host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) {
      shadow = host.shadowRoot;
      statusPill = shadow.getElementById("status");
      return;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = [
      "all:unset",
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
        :host { all: initial; }
        .badge, .status {
          position: fixed;
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 0;
          border-radius: 999px;
          box-shadow: 0 4px 14px rgba(0,0,0,.45);
          font: 700 12px/1.2 "Segoe UI", system-ui, sans-serif;
          color: #fff;
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
      <button class="status" id="status" type="button" title="Verify with Gemini is active on this page">
        <span class="dot"></span>
        <span>Verify ready</span>
      </button>
    `;
    statusPill = shadow.getElementById("status");
    statusPill?.addEventListener("click", () => {
      alert(
        "Verify with Gemini is running.\n\nClick the blue Verify button on a photo, or right-click an image and choose Verify with Gemini."
      );
    });

    (document.documentElement || document.body).appendChild(host);
  }

  function keepHostAlive() {
    ensureHost();
    if (!document.contains(host)) {
      (document.documentElement || document.body).appendChild(host);
    }
  }

  function mediaKey(src, rect) {
    return `${src}|${Math.round(rect.left)}|${Math.round(rect.top)}|${Math.round(rect.width)}|${Math.round(rect.height)}`;
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
    const bg = window.getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") return "";
    const match = /url\((['"]?)(.*?)\1\)/.exec(bg);
    return match?.[2] || "";
  }

  function collectTargets() {
    /** @type {{ src: string, getRect: () => DOMRect, node: Element }[]} */
    const out = [];

    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (!src || isAvatarSrc(src)) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < MIN_EDGE || rect.height < MIN_EDGE) continue;
      const style = window.getComputedStyle(img);
      if (style.visibility === "hidden" || style.display === "none") continue;
      out.push({
        src,
        node: img,
        getRect: () => img.getBoundingClientRect(),
      });
    }

    const containers = document.querySelectorAll(
      '[data-testid="tweetPhoto"], [data-testid="image"], a[href*="/photo/"]'
    );
    for (const el of containers) {
      const img = el.querySelector("img");
      if (img) continue;
      const src = bgUrl(el);
      if (!src || isAvatarSrc(src)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < MIN_EDGE || rect.height < MIN_EDGE) continue;
      out.push({
        src,
        node: el,
        getRect: () => el.getBoundingClientRect(),
      });
    }

    return out;
  }

  function positionBadge(entry) {
    const rect = entry.getRect();
    if (
      !rect ||
      rect.width < MIN_EDGE ||
      rect.height < MIN_EDGE ||
      rect.bottom < 0 ||
      rect.top > innerHeight ||
      rect.right < 0 ||
      rect.left > innerWidth
    ) {
      entry.el.classList.add("is-hidden");
      return;
    }
    entry.el.classList.remove("is-hidden");
    const width = entry.el.offsetWidth || 92;
    entry.el.style.top = `${Math.max(8, rect.top + 8)}px`;
    entry.el.style.left = `${Math.max(8, Math.min(rect.right - width - 8, innerWidth - width - 8))}px`;
  }

  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      keepHostAlive();
      for (const entry of badges.values()) positionBadge(entry);
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
    // Prefer on-page canvas first so clipboard write stays close to the click.
    if (node instanceof HTMLImageElement) {
      try {
        return canvasCaptureFromImg(node);
      } catch (_) {
        // Fall through to background fetch.
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

  async function verify(src, node, badge) {
    if (isBusy) return;
    isBusy = true;
    const label = badge.querySelector(".label");
    badge.classList.add("is-busy");
    if (label) label.textContent = "Copying…";
    try {
      const captured = await captureSrc(src, node);
      if (!captured?.dataUrl) throw new Error("Could not copy image");

      await writePngClipboard(captured.dataUrl);

      if (label) label.textContent = "Opening…";
      const open = await chrome.runtime.sendMessage({
        type: "vwg_open_gemini",
        prompt: PROMPT,
      });
      if (!open?.ok) throw new Error(open?.error || "Could not open Gemini");

      if (label) {
        label.textContent = open.pasted ? "Sent" : "Opened";
      }
    } catch (err) {
      console.warn("[Verify with Gemini]", err);
      alert(`Verify with Gemini failed: ${err?.message || err}`);
    } finally {
      isBusy = false;
      badge.classList.remove("is-busy");
      if (label) label.textContent = "Verify";
    }
  }

  function ensureBadge(target) {
    const rect = target.getRect();
    const key = mediaKey(target.src, rect);
    let entry = badges.get(key);
    if (entry) {
      entry.getRect = target.getRect;
      entry.src = target.src;
      entry.node = target.node;
      return entry;
    }

    // Drop stale keys for same node by src near same place.
    for (const [k, existing] of badges) {
      if (existing.src === target.src) {
        const r = existing.getRect();
        if (!r || Math.abs(r.top - rect.top) < 40) {
          existing.el.remove();
          badges.delete(k);
        }
      }
    }

    const el = document.createElement("button");
    el.type = "button";
    el.className = "badge";
    el.innerHTML = '<span class="icon">?</span><span class="label">Verify</span>';
    el.title = "Copy image and ask Gemini: is this true?";
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
    entry = { el, getRect: target.getRect, src: target.src, node: target.node };
    badges.set(key, entry);
    positionBadge(entry);
    return entry;
  }

  function rescan() {
    keepHostAlive();
    const targets = collectTargets();
    for (const target of targets) {
      ensureBadge(target);
    }

    for (const [key, entry] of badges) {
      const rect = entry.getRect?.();
      if (!rect || rect.width < 1 || (entry.node && !document.contains(entry.node))) {
        entry.el.remove();
        badges.delete(key);
      }
    }
    scheduleReposition();
    const label = statusPill?.querySelector("span:last-of-type");
    if (label) label.textContent = `Verify ready (${badges.size})`;
  }

  window.__verifyWithGeminiOverlay = { rescan };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "vwg_ping") {
      keepHostAlive();
      rescan();
      sendResponse({ ok: true, badges: badges.size, href: location.href });
      return true;
    }
    return false;
  });

  ensureHost();
  rescan();

  const mo = new MutationObserver(() => {
    clearTimeout(window.__vwgScanTimer);
    window.__vwgScanTimer = setTimeout(rescan, 200);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);
  setInterval(rescan, 1500);

  document.addEventListener(
    "mousemove",
    (event) => {
      const stack = document.elementsFromPoint(event.clientX, event.clientY);
      for (const el of stack) {
        if (el === host) continue;
        if (el instanceof HTMLImageElement) {
          ensureBadge({
            src: el.currentSrc || el.src,
            node: el,
            getRect: () => el.getBoundingClientRect(),
          });
          scheduleReposition();
          return;
        }
        const photo = el.closest?.(
          '[data-testid="tweetPhoto"], [data-testid="image"], a[href*="/photo/"]'
        );
        if (photo) {
          const img = photo.querySelector("img");
          if (img) {
            ensureBadge({
              src: img.currentSrc || img.src,
              node: img,
              getRect: () => img.getBoundingClientRect(),
            });
            scheduleReposition();
          }
          return;
        }
      }
    },
    { passive: true, capture: true }
  );
})();
