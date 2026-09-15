(() => {
  if (window.__verifyWithGeminiInject) return;
  window.__verifyWithGeminiInject = true;

  const HOST_ID = "vwg-gemini-fallback";

  function ensureBanner() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "display:none",
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .card {
          width: 300px;
          padding: 14px;
          border-radius: 14px;
          background: #0f172a;
          color: #f8fafc;
          font: 600 13px/1.4 "Segoe UI", system-ui, sans-serif;
          box-shadow: 0 12px 40px rgba(0,0,0,.4);
        }
        p { margin: 0 0 10px; font-weight: 500; color: #cbd5e1; }
        button {
          width: 100%;
          border: 0;
          border-radius: 999px;
          padding: 10px 12px;
          background: #1a73e8;
          color: #fff;
          font: 700 13px/1 "Segoe UI", system-ui, sans-serif;
          cursor: pointer;
        }
        button:hover { background: #1557b0; }
        .hint { margin-top: 8px; font-size: 11px; color: #94a3b8; font-weight: 500; }
      </style>
      <div class="card">
        <p>Image is already on your clipboard. Auto-paste did not finish.</p>
        <button id="paste" type="button">Paste now (Ctrl+V)</button>
        <div class="hint">Or click the Gemini text box and press Ctrl+V yourself, then type your saved prompt.</div>
      </div>
    `;

    shadow.getElementById("paste").addEventListener("click", async () => {
      const btn = shadow.getElementById("paste");
      btn.textContent = "Pasting…";
      try {
        const res = await chrome.runtime.sendMessage({ type: "vwg_fallback_paste" });
        if (!res?.ok) throw new Error(res?.error || "Paste failed");
        host.style.display = "none";
      } catch (err) {
        btn.textContent = "Paste now (Ctrl+V)";
        alert(`Paste failed: ${err?.message || err}`);
      }
    });

    document.documentElement.appendChild(host);
    return host;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "vwg_ping_gemini") {
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "vwg_show_fallback") {
      ensureBanner().style.display = "block";
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "vwg_hide_fallback") {
      const host = document.getElementById(HOST_ID);
      if (host) host.style.display = "none";
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
