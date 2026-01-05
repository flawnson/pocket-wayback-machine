async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function refresh() {
    const tab = await getActiveTab();
    const url = tab?.url || "";

    const resp = await chrome.runtime.sendMessage({ type: "PW_GET_SETTINGS" });
    const settings = resp?.settings || { enabled: true, disabledHosts: [] };

    await refreshExtended(settings);

    const status = document.getElementById("status");
    const toggleEnabled = document.getElementById("toggleEnabled");
    const toggleHost = document.getElementById("toggleHost");

    const host = (() => {
        try { return new URL(url).host; } catch { return ""; }
    })();

    const hostDisabled = host && settings.disabledHosts?.includes(host);

    status.textContent = `Archiving is ${settings.enabled ? "ON" : "OFF"} • Host: ${host || "(n/a)"} ${hostDisabled ? "(disabled)" : ""}`;

    toggleEnabled.textContent = settings.enabled ? "Turn OFF archiving" : "Turn ON archiving";
    toggleHost.textContent = hostDisabled ? `Enable this host` : `Disable this host`;
    toggleHost.disabled = !host;
}

document.getElementById("toggleEnabled").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "PW_TOGGLE_ENABLED" });
    refresh();
});

document.getElementById("toggleHost").addEventListener("click", async () => {
    const tab = await getActiveTab();
    await chrome.runtime.sendMessage({ type: "PW_TOGGLE_HOST", url: tab?.url || "" });
    refresh();
});

document.getElementById("openArchive").addEventListener("click", async () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("archive.html") });
});

function escapeHtml(s) {
    return (s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function refreshExtended(settings) {
    // min stay
    const minStay = document.getElementById("minStay");
    minStay.value = String(settings.minStayMs ?? 2000);

    minStay.onchange = async () => {
        const v = Number(minStay.value);
        await chrome.runtime.sendMessage({ type: "PW_SET_MIN_STAY_MS", minStayMs: v });
        const resp = await chrome.runtime.sendMessage({ type: "PW_GET_SETTINGS" });
        renderPatterns(resp.settings);
    };

    // patterns list
    renderPatterns(settings);
}

function renderPatterns(settings) {
    const list = document.getElementById("patternList");
    const patterns = settings.disabledUrlPatterns || [];

    if (!patterns.length) {
        list.innerHTML = `<div class="muted">No patterns. Examples: <code>*://mail.google.com/*</code></div>`;
        return;
    }

    list.innerHTML = patterns.map(p => `
    <div class="row space-between" style="margin-top:8px;">
      <code style="max-width: 210px; overflow:hidden; text-overflow: ellipsis; white-space:nowrap;">${escapeHtml(p)}</code>
      <button data-rm="${escapeHtml(p)}" class="danger">Remove</button>
    </div>
  `).join("");

    list.querySelectorAll("button[data-rm]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const p = btn.getAttribute("data-rm");
            await chrome.runtime.sendMessage({ type: "PW_REMOVE_URL_PATTERN", pattern: p });
            const resp = await chrome.runtime.sendMessage({ type: "PW_GET_SETTINGS" });
            renderPatterns(resp.settings);
        });
    });
}

document.getElementById("addPattern").addEventListener("click", async () => {
    const input = document.getElementById("patternInput");
    const pattern = input.value.trim();
    if (!pattern) return;
    await chrome.runtime.sendMessage({ type: "PW_ADD_URL_PATTERN", pattern });
    input.value = "";
    const resp = await chrome.runtime.sendMessage({ type: "PW_GET_SETTINGS" });
    renderPatterns(resp.settings);
});

refresh();
