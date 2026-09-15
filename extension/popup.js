const DEFAULT_PROMPT = "is this true?";

async function loadPrompt() {
  const stored = await chrome.storage.sync.get({ prompt: DEFAULT_PROMPT });
  const value = String(stored.prompt || "").trim() || DEFAULT_PROMPT;
  document.getElementById("prompt").value = value;
}

async function savePrompt() {
  const status = document.getElementById("status");
  const prompt = String(document.getElementById("prompt").value || "").trim() || DEFAULT_PROMPT;
  document.getElementById("prompt").value = prompt;
  await chrome.storage.sync.set({ prompt });
  status.textContent = "Prompt saved.";
  status.className = "ok";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "vwg_prompt_updated" }).catch(() => {});
    }
  } catch (_) {
    // Ignore.
  }
}

async function checkTab() {
  const status = document.getElementById("status");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      status.textContent = "No active tab.";
      status.className = "bad";
      return;
    }
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      status.textContent = "Open a normal website tab to use Verify.";
      status.className = "bad";
      return;
    }

    let alive = false;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "vwg_ping" });
      alive = !!res?.ok;
    } catch (_) {
      alive = false;
    }

    if (!alive) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-overlay.js"],
      });
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: "vwg_ping" });
        alive = !!res?.ok;
      } catch (_) {
        alive = false;
      }
    }

    if (alive) {
      status.textContent = "Running on this tab. Verify buttons appear on photos.";
      status.className = "ok";
    } else {
      status.textContent = "Not running. Reload this page, then try again.";
      status.className = "bad";
    }
  } catch (err) {
    status.textContent = String(err?.message || err);
    status.className = "bad";
  }
}

document.getElementById("save").addEventListener("click", savePrompt);
document.getElementById("reset").addEventListener("click", async () => {
  document.getElementById("prompt").value = DEFAULT_PROMPT;
  await savePrompt();
});

loadPrompt().then(checkTab);
