// sw.js (ESM)
import { putVisit, purgeVisitsOlderThan, putPageVersion, getVersionsByUrlKey } from "./db.js";

const SETTINGS_KEY = "pw_settings";
const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

// Simple structured logging helpers (visible in Chrome's SW console)
const LOG_PREFIX = "[PW]";
const DEBUG = true; // flip to false to reduce noise
const info = (...args) => console.log(LOG_PREFIX, ...args);
const debug = (...args) => { if (DEBUG) console.debug(LOG_PREFIX, ...args); };
const warn = (...args) => console.warn(LOG_PREFIX, ...args);
const error = (...args) => console.error(LOG_PREFIX, ...args);

async function logVisit({ tabId, url, urlKey, transitionType }) {
    const visit = {
        visitId: crypto.randomUUID(),
        url,
        urlKey,
        visitAt: Date.now(),
        transitionType: transitionType || "",
        tabId: tabId ?? null
    };
    debug("logVisit -> creating visit", { tabId, url, urlKey, transitionType });

    await putVisit(visit);
    debug("logVisit -> stored", { visitId: visit.visitId });

    // Keep only the last 30 days
    const cutoff = Date.now() - DAYS_30_MS;
    await purgeVisitsOlderThan(cutoff);
    debug("logVisit -> purged visits older than", new Date(cutoff).toISOString());
}

// Settings shape:
// {
//   enabled: true,
//   minStayMs: 2000, // if you leave/close within this window -> don't archive
//   disabledHosts: ["mail.google.com"],
//   disabledUrlPatterns: ["*://*.github.com/*/settings/*"]
// }

function isHttpUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function hostOf(url) {
    try {
        return new URL(url).host;
    } catch {
        return "";
    }
}

// Exact URL by default. (Includes query/hash.)
function toUrlKey(url) {
    return url;
}

function wildcardToRegExp(pattern) {
    // Escape regex metacharacters, then convert '*' wildcards into '.*'
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regexStr = "^" + escaped.replace(/\\\*/g, ".*") + "$";
    return new RegExp(regexStr);
}

function urlMatchesPatterns(url, patterns) {
    for (const p of patterns) {
        try {
            if (wildcardToRegExp(p).test(url)) return true;
        } catch {
            // ignore malformed patterns
            warn("urlMatchesPatterns -> malformed pattern ignored", p);
        }
    }
    return false;
}

async function getSettings() {
    const obj = await chrome.storage.local.get([SETTINGS_KEY]);
    const s = obj[SETTINGS_KEY] || {};
    const normalized = {
        enabled: s.enabled ?? true,
        minStayMs: s.minStayMs ?? 2000,
        disabledHosts: s.disabledHosts ?? [],
        disabledUrlPatterns: s.disabledUrlPatterns ?? []
    };
    debug("getSettings ->", normalized);
    return normalized;
}

async function setSettings(next) {
    debug("setSettings <-", next);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}

async function shouldArchiveUrl(url) {
    if (!isHttpUrl(url)) {
        debug("shouldArchiveUrl -> false (non-http(s))", { url });
        return false;
    }

    const settings = await getSettings();
    if (!settings.enabled) {
        debug("shouldArchiveUrl -> false (disabled globally)");
        return false;
    }

    const host = hostOf(url);
    if (host && settings.disabledHosts.includes(host)) {
        debug("shouldArchiveUrl -> false (host disabled)", { host });
        return false;
    }

    if (settings.disabledUrlPatterns.length && urlMatchesPatterns(url, settings.disabledUrlPatterns)) {
        debug("shouldArchiveUrl -> false (matches disabledUrlPatterns)");
        return false;
    }

    debug("shouldArchiveUrl -> true", { url });
    return true;
}

async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const bytes = new Uint8Array(buf);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function makeVersionId() {
    return crypto.randomUUID();
}

async function captureTabSnapshot(tabId) {
    debug("captureTabSnapshot -> injecting content script", { tabId });
    // Inject content script (best practice for MV3)
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
    });

    const res = await chrome.tabs.sendMessage(tabId, { type: "PW_GET_SNAPSHOT" });
    if (!res?.ok) {
        warn("captureTabSnapshot -> failed", { tabId, error: res?.error });
        throw new Error(res?.error || "Snapshot failed");
    }
    const snap = { title: res.title || "", html: res.html || "" };
    debug("captureTabSnapshot -> success", { tabId, title: snap.title, htmlBytes: snap.html.length });
    return snap;
}

async function archiveIfChanged(tabId, url) {
    if (!(await shouldArchiveUrl(url))) {
        debug("archiveIfChanged -> skip (shouldArchiveUrl=false)", { tabId, url });
        return;
    }

    // Some pages cannot be scripted (chrome://, webstore, etc.)
    let snap;
    try {
        snap = await captureTabSnapshot(tabId);
    } catch (e) {
        warn("archiveIfChanged -> snapshot failed; skipping", { tabId, url, error: (e && e.message) || String(e) });
        return;
    }

    const urlKey = toUrlKey(url);
    const hash = await sha256Hex(snap.html);
    debug("archiveIfChanged -> computed hash", { urlKey, hash, title: snap.title });

    const versions = await getVersionsByUrlKey(urlKey);
    const latest = versions?.[0];
    if (latest?.hash === hash) {
        debug("archiveIfChanged -> no change detected; not storing", { urlKey });
        return;
    }

    const versionId = makeVersionId();
    await putPageVersion({
        versionId,
        url,
        urlKey,
        title: snap.title,
        capturedAt: Date.now(),
        hash,
        contentType: "text/html",
        html: snap.html
    });
    info("archiveIfChanged -> stored new version", { urlKey, versionId, title: snap.title });
}

/**
 * Bounce + error tracking
 *
 * We only archive if:
 * - navigation completes successfully (no onErrorOccurred)
 * - AND the tab stays on that URL for at least minStayMs after completion
 */
const navByTab = new Map();      // tabId -> { url, completedAt, errored, timerId }
const erroredTabUrl = new Map(); // tabId -> lastErroredUrl

function clearTabState(tabId) {
    const st = navByTab.get(tabId);
    if (st?.timerId) {
        debug("clearTabState -> clearing timer", { tabId, timerId: st.timerId });
        clearTimeout(st.timerId);
    }
    navByTab.delete(tabId);
    erroredTabUrl.delete(tabId);
    debug("clearTabState -> cleared", { tabId });
}

chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    const { tabId, url } = details;
    if (!isHttpUrl(url)) return;

    debug("onCommitted", { tabId, url });
    // New navigation: cancel any pending archive timer for this tab
    clearTabState(tabId);
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
    if (details.frameId !== 0) return;
    // Mark that this URL errored for this tab
    erroredTabUrl.set(details.tabId, details.url);
    warn("onErrorOccurred", { tabId: details.tabId, url: details.url, error: details.error });
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const { tabId, url } = details;
    if (!isHttpUrl(url)) return;

    const settings = await getSettings();
    const minStayMs = settings.minStayMs ?? 2000;
    debug("onCompleted -> considering archive", { tabId, url, minStayMs });

    // If this navigation errored, skip
    if (erroredTabUrl.get(tabId) === url) {
        debug("onCompleted -> skip (previous error for this tab/url)", { tabId, url });
        clearTabState(tabId);
        return;
    }

    // If blacklisted/disabled, skip early (no timer)
    if (!(await shouldArchiveUrl(url))) {
        debug("onCompleted -> skip (disabled/blacklisted)", { url });
        clearTabState(tabId);
        return;
    }

    // Start a "must stay open on this URL for X ms" timer.
    // If they leave/close, we cancel, so it won't archive.
    const timerId = setTimeout(async () => {
        debug("archive-timer fired", { tabId, url });
        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab?.url || tab.url !== url) {
                debug("archive-timer -> tab url mismatch; skipping", { expected: url, actual: tab?.url });
                return;
            }

            // Record visit (history-like)
            await logVisit({
                tabId,
                url,
                urlKey: toUrlKey(url),
                transitionType: "" // if you have details.transitionType, pass it here
            });
            debug("archive-timer -> visit recorded", { tabId, url });

            // Snapshot (your existing behavior)
            await archiveIfChanged(tabId, url);
            debug("archive-timer -> archive attempted", { tabId, url });
        } catch (e) {
            warn("archive-timer -> failed", { tabId, url, error: (e && e.message) || String(e) });
            // tab may have been closed
        } finally {
            clearTabState(tabId);
        }
    }, minStayMs);

    debug("onCompleted -> scheduled archive timer", { tabId, url, timerId, delay: minStayMs });
    navByTab.set(tabId, {
        url,
        completedAt: Date.now(),
        errored: false,
        timerId
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    debug("tabs.onRemoved", { tabId });
    clearTabState(tabId);
});

/**
 * Messages from popup/UI
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    debug("onMessage <-", { type: msg?.type });
    (async () => {
        if (msg?.type === "PW_GET_SETTINGS") {
            const settings = await getSettings();
            debug("onMessage -> PW_GET_SETTINGS", settings);
            sendResponse({ ok: true, settings });
            return;
        }

        if (msg?.type === "PW_TOGGLE_ENABLED") {
            const settings = await getSettings();
            settings.enabled = !settings.enabled;
            await setSettings(settings);
            info("onMessage -> PW_TOGGLE_ENABLED", { enabled: settings.enabled });
            sendResponse({ ok: true, settings });
            return;
        }

        if (msg?.type === "PW_SET_MIN_STAY_MS") {
            const settings = await getSettings();
            const v = Number(msg?.minStayMs);
            if (Number.isFinite(v)) settings.minStayMs = Math.max(0, Math.floor(v));
            await setSettings(settings);
            info("onMessage -> PW_SET_MIN_STAY_MS", { minStayMs: settings.minStayMs });
            sendResponse({ ok: true, settings });
            return;
        }

        if (msg?.type === "PW_TOGGLE_HOST") {
            const url = String(msg?.url || "");
            const host = hostOf(url);
            const settings = await getSettings();
            const set = new Set(settings.disabledHosts);
            if (host) {
                if (set.has(host)) set.delete(host);
                else set.add(host);
            }
            settings.disabledHosts = [...set].sort();
            await setSettings(settings);
            info("onMessage -> PW_TOGGLE_HOST", { host, disabledHosts: settings.disabledHosts });
            sendResponse({ ok: true, settings });
            return;
        }

        if (msg?.type === "PW_ADD_URL_PATTERN") {
            const pattern = String(msg?.pattern || "").trim();
            const settings = await getSettings();
            if (pattern) {
                const set = new Set(settings.disabledUrlPatterns);
                set.add(pattern);
                settings.disabledUrlPatterns = [...set].sort();
                await setSettings(settings);
            }
            const updated = await getSettings();
            info("onMessage -> PW_ADD_URL_PATTERN", { pattern, disabledUrlPatterns: updated.disabledUrlPatterns });
            sendResponse({ ok: true, settings: updated });
            return;
        }

        if (msg?.type === "PW_REMOVE_URL_PATTERN") {
            const pattern = String(msg?.pattern || "").trim();
            const settings = await getSettings();
            settings.disabledUrlPatterns = settings.disabledUrlPatterns.filter(p => p !== pattern);
            await setSettings(settings);
            info("onMessage -> PW_REMOVE_URL_PATTERN", { pattern, disabledUrlPatterns: settings.disabledUrlPatterns });
            sendResponse({ ok: true, settings });
            return;
        }

        warn("onMessage -> unknown message", { type: msg?.type });
        sendResponse({ ok: false, error: "Unknown message" });
    })();

    return true;
});
