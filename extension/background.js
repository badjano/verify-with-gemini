const GEMINI_URL = "https://gemini.google.com/app";
const MENU_ID = "vwg-verify-image";
const DEFAULT_PROMPT = "is this true?";

/** @type {{ prompt: string } | null} */
let memoryPending = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getStoredPrompt() {
  try {
    const stored = await chrome.storage.sync.get({ prompt: DEFAULT_PROMPT });
    const prompt = String(stored.prompt || "").trim();
    return prompt || DEFAULT_PROMPT;
  } catch (_) {
    return DEFAULT_PROMPT;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        dataUrl: String(reader.result || ""),
        mimeType: blob.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(src, pageUrl) {
  if (!src) throw new Error("Missing image URL");

  if (src.startsWith("data:")) {
    const mimeType = src.slice(5, src.indexOf(";")) || "image/png";
    return { dataUrl: src, mimeType };
  }

  const headers = {};
  if (pageUrl) headers.Referer = pageUrl;

  const response = await fetch(src, {
    credentials: "include",
    headers,
    cache: "force-cache",
  });

  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status})`);
  }

  const blob = await response.blob();
  if (!blob || blob.size < 32) {
    throw new Error("Image was empty");
  }

  return blobToDataUrl(blob);
}

async function findOrCreateGeminiTab() {
  const existing = await chrome.tabs.query({
    url: ["*://gemini.google.com/*"],
  });

  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return tab.id;
  }

  const created = await chrome.tabs.create({ url: GEMINI_URL, active: true });
  return created.id;
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Gemini tab timed out"));
    }, timeoutMs);

    function onUpdated(id, info) {
      if (id !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    }).catch(reject);
  });
}

async function ensureGeminiScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "vwg_ping_gemini" });
    if (res?.ok) return;
  } catch (_) {
    // Not injected yet.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["gemini-inject.js"],
  });
}

async function debuggerSend(target, method, params) {
  return chrome.debugger.sendCommand(target, method, params || {});
}

async function focusGeminiComposer(target) {
  const focused = await debuggerSend(target, "Runtime.evaluate", {
    expression: `(() => {
      const walk = (root) => {
        const nodes = root.querySelectorAll
          ? [...root.querySelectorAll('div[contenteditable="true"], textarea')]
          : [];
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 16) return el;
        }
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of all) {
          if (el.shadowRoot) {
            const hit = walk(el.shadowRoot);
            if (hit) return hit;
          }
        }
        return null;
      };
      const el = walk(document);
      if (!el) return { ok: false };
      el.focus();
      el.click();
      const r = el.getBoundingClientRect();
      return {
        ok: true,
        x: Math.round(r.left + Math.min(r.width / 2, 120)),
        y: Math.round(r.top + Math.min(r.height / 2, 24)),
      };
    })()`,
    returnByValue: true,
  });

  const value = focused?.result?.value;
  const point = value?.ok
    ? value
    : await (async () => {
        const { result: size } = await debuggerSend(target, "Runtime.evaluate", {
          expression: `({ w: window.innerWidth, h: window.innerHeight })`,
          returnByValue: true,
        });
        return {
          x: Math.round((size?.value?.w || 1200) / 2),
          y: Math.round((size?.value?.h || 800) * 0.9),
        };
      })();

  await debuggerSend(target, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await debuggerSend(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function dispatchPasteShortcut(target) {
  const isMac = (await chrome.runtime.getPlatformInfo()).os === "mac";
  const modifiers = isMac ? 4 : 2;

  await debuggerSend(target, "Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers,
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    commands: ["paste"],
  });
  await debuggerSend(target, "Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers,
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
  });
}

async function pasteClipboardIntoGemini(tabId, prompt) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await debuggerSend(target, "Runtime.enable");
    await sleep(500);
    await focusGeminiComposer(target);
    await sleep(300);
    await dispatchPasteShortcut(target);
    await sleep(800);
    await debuggerSend(target, "Input.insertText", {
      text: prompt || DEFAULT_PROMPT,
    });
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch (_) {
      // Already detached.
    }
  }
}

/**
 * Clipboard is already filled by the source page.
 * Here we only open Gemini and try a trusted Ctrl+V on that tab.
 */
async function openGeminiAndTryPaste(prompt) {
  const finalPrompt = String(prompt || "").trim() || (await getStoredPrompt());
  memoryPending = { prompt: finalPrompt };

  const tabId = await findOrCreateGeminiTab();
  await waitForTabComplete(tabId);
  await sleep(1500);
  await ensureGeminiScript(tabId);

  try {
    await pasteClipboardIntoGemini(tabId, memoryPending.prompt);
    memoryPending = null;
    await chrome.tabs.sendMessage(tabId, { type: "vwg_hide_fallback" }).catch(() => {});
    return { tabId, opened: true, pasted: true };
  } catch (err) {
    await chrome.tabs
      .sendMessage(tabId, {
        type: "vwg_show_fallback",
        prompt: memoryPending.prompt,
      })
      .catch(() => {});
    return {
      tabId,
      opened: true,
      pasted: false,
      pasteError: String(err?.message || err),
    };
  }
}

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Verify with Gemini",
      contexts: ["image"],
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);
ensureContextMenu();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  try {
    // Context-menu path: fetch image, write clipboard in this extension SW via a
    // focused Gemini tab is unreliable — ask the source tab to copy if possible.
    const src = info.srcUrl;
    if (!src) throw new Error("No image URL");
    const fetched = await fetchImageAsDataUrl(src, tab?.url || "");
    if (tab?.id != null) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (dataUrl) => {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          let pngBlob = blob;
          if (blob.type !== "image/png") {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext("2d").drawImage(bitmap, 0, 0);
            bitmap.close?.();
            pngBlob = await new Promise((resolve, reject) => {
              canvas.toBlob(
                (png) => (png ? resolve(png) : reject(new Error("PNG convert failed"))),
                "image/png"
              );
            });
          }
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": pngBlob }),
          ]);
        },
        args: [fetched.dataUrl],
      });
    }
    await openGeminiAndTryPaste(await getStoredPrompt());
  } catch (err) {
    if (tab?.id != null) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message) => alert(message),
        args: [`Verify with Gemini failed: ${String(err?.message || err)}`],
      });
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;
  const url = tab.url || "";
  if (!/^https?:/i.test(url)) return;
  if (/^https:\/\/gemini\.google\.com/i.test(url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-overlay.js"],
    });
  } catch (_) {
    // Restricted pages.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "vwg_fetch_image") {
    fetchImageAsDataUrl(message.src, message.pageUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "vwg_open_gemini") {
    openGeminiAndTryPaste(message.prompt || "")
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "vwg_fallback_paste") {
    (async () => {
      const tabId = sender.tab?.id;
      if (tabId == null) throw new Error("Missing Gemini tab");
      const prompt = memoryPending?.prompt || (await getStoredPrompt());
      await pasteClipboardIntoGemini(tabId, prompt);
      memoryPending = null;
      sendResponse({ ok: true });
    })().catch((err) => {
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
    return true;
  }

  return false;
});
