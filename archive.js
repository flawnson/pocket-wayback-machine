import { getVersionsByUrlKey, getVersion, deleteVersion } from "./db.js";

function fmt(ts) {
    const d = new Date(ts);
    return d.toLocaleString();
}

function escapeHtml(s) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function render(url) {
    const results = document.getElementById("results");
    results.innerHTML = "";

    if (!url) {
        results.innerHTML = `<div class="card">Enter a URL above to load versions.</div>`;
        return;
    }

    const versions = await getVersionsByUrlKey(url);
    if (!versions.length) {
        results.innerHTML = `<div class="card">No saved versions for:<br><code>${escapeHtml(url)}</code></div>`;
        return;
    }

    const list = document.createElement("div");
    list.className = "list";

    for (const v of versions) {
        const card = document.createElement("div");
        card.className = "card";

        card.innerHTML = `
      <div class="row space-between">
        <div>
          <div class="cardTitle">${escapeHtml(v.title || "(untitled)")}</div>
          <div class="muted">${escapeHtml(v.url)}</div>
          <div class="muted">Captured: ${fmt(v.capturedAt)}</div>
        </div>
        <div class="row gap">
          <button data-open="${v.versionId}">Open</button>
          <button data-del="${v.versionId}" class="danger">Delete</button>
        </div>
      </div>
    `;

        list.appendChild(card);
    }

    results.appendChild(list);

    results.querySelectorAll("button[data-open]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const versionId = btn.getAttribute("data-open");
            if (!versionId) return;
            await openVersion(versionId);
        });
    });

    results.querySelectorAll("button[data-del]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const versionId = btn.getAttribute("data-del");
            if (!versionId) return;
            await deleteVersion(versionId);
            await render(url);
        });
    });
}

async function openVersion(versionId) {
    const v = await getVersion(versionId);
    if (!v) return;

    const wrap = document.getElementById("viewerWrap");
    const iframe = document.getElementById("viewer");

    // Use srcdoc so it’s fully local and doesn’t re-request network resources.
    iframe.srcdoc = v.html;

    wrap.classList.remove("hidden");
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("closeViewer").addEventListener("click", () => {
    document.getElementById("viewerWrap").classList.add("hidden");
    document.getElementById("viewer").srcdoc = "";
});

document.getElementById("loadBtn").addEventListener("click", async () => {
    const url = document.getElementById("urlInput").value.trim();
    await render(url);
});

// Convenience: if archive opened with ?url=...
const params = new URLSearchParams(location.search);
const urlFromQuery = params.get("url");
if (urlFromQuery) {
    document.getElementById("urlInput").value = urlFromQuery;
    render(urlFromQuery);
} else {
    render("");
}
