async function main() {
  const status = document.getElementById("status");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      status.textContent = "No active tab.";
      status.className = "bad";
      return;
    }
    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      status.textContent = "Open a normal website tab (e.g. x.com).";
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
      status.textContent = "Running on this tab.";
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

main();
