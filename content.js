// content.js
(() => {
    function getSnapshot() {
        const title = document.title || "";
        const html = "<!doctype html>\n" + document.documentElement.outerHTML;
        return { title, html };
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === "PW_GET_SNAPSHOT") {
            try {
                sendResponse({ ok: true, ...getSnapshot() });
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
        }
        // return true not needed (sync response)
    });
})();
