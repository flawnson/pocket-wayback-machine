import React, { useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function getSettings() {
    const resp = await chrome.runtime.sendMessage({ type: "PW_GET_SETTINGS" });
    return resp?.settings ?? { enabled: true, disabledHosts: [], disabledUrlPatterns: [], minStayMs: 2000 };
}

export default function App() {
    const [loading, setLoading] = useState(true);
    const [tabUrl, setTabUrl] = useState("");
    const [settings, setSettings] = useState(null);
    const [patternInput, setPatternInput] = useState("");
    const [minStayMs, setMinStayMs] = useState(2000);

    const host = useMemo(() => {
        try {
            return tabUrl ? new URL(tabUrl).host : "";
        } catch {
            return "";
        }
    }, [tabUrl]);

    const hostDisabled = useMemo(() => {
        return !!host && !!settings?.disabledHosts?.includes(host);
    }, [host, settings]);

    const statusText = useMemo(() => {
        if (!settings) return "";
        return `Archiving is ${settings.enabled ? "ON" : "OFF"} • Host: ${host || "(n/a)"}${hostDisabled ? " (disabled)" : ""}`;
    }, [settings, host, hostDisabled]);

    async function refresh() {
        setLoading(true);
        const tab = await getActiveTab();
        const url = tab?.url || "";
        const s = await getSettings();

        setTabUrl(url);
        setSettings(s);
        setMinStayMs(Number.isFinite(s.minStayMs) ? s.minStayMs : 2000);
        setLoading(false);
    }

    useEffect(() => {
        refresh();
    }, []);

    async function toggleEnabled() {
        await chrome.runtime.sendMessage({ type: "PW_TOGGLE_ENABLED" });
        await refresh();
    }

    async function toggleHost() {
        const tab = await getActiveTab();
        await chrome.runtime.sendMessage({ type: "PW_TOGGLE_HOST", url: tab?.url || "" });
        await refresh();
    }

    async function openArchive() {
        chrome.tabs.create({ url: chrome.runtime.getURL("archive.html") });
    }

    async function saveMinStay(next) {
        const v = Number(next);
        await chrome.runtime.sendMessage({
            type: "PW_SET_MIN_STAY_MS",
            minStayMs: Number.isFinite(v) ? v : 2000
        });
        await refresh();
    }

    async function addPattern() {
        const p = patternInput.trim();
        if (!p) return;
        await chrome.runtime.sendMessage({ type: "PW_ADD_URL_PATTERN", pattern: p });
        setPatternInput("");
        await refresh();
    }

    async function removePattern(p) {
        await chrome.runtime.sendMessage({ type: "PW_REMOVE_URL_PATTERN", pattern: p });
        await refresh();
    }

    const patterns = settings?.disabledUrlPatterns ?? [];

    return (
        <div className="p-3 space-y-3 text-sm">
            <div className="flex items-center justify-between">
                <div className="text-base font-semibold">Personal Wayback</div>
            </div>

            <div className="text-xs text-muted-foreground">
                {loading ? "Loading…" : statusText}
            </div>

            <div className="grid grid-cols-1 gap-2">
                <Button onClick={toggleEnabled} variant={settings?.enabled ? "outline" : "default"} disabled={loading}>
                    {settings?.enabled ? "Turn OFF archiving" : "Turn ON archiving"}
                </Button>

                <Button onClick={toggleHost} variant="outline" disabled={loading || !host}>
                    {hostDisabled ? "Enable this host" : "Disable this host"}
                </Button>

                <Button onClick={openArchive} variant="secondary" disabled={loading}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Archive
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Capture behavior</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="minStay">Min stay (ms)</Label>
                        <Input
                            id="minStay"
                            type="number"
                            min={0}
                            step={250}
                            className="w-28"
                            value={String(minStayMs)}
                            onChange={(e) => setMinStayMs(Number(e.target.value))}
                            onBlur={(e) => saveMinStay(e.target.value)}
                            disabled={loading}
                        />
                    </div>
                    <div className="text-xs text-muted-foreground">
                        Pages you leave/close before this won’t be saved.
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Blacklist URL patterns</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex gap-2">
                        <Input
                            value={patternInput}
                            onChange={(e) => setPatternInput(e.target.value)}
                            placeholder="e.g. *://*.github.com/*/settings*"
                            disabled={loading}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") addPattern();
                            }}
                        />
                        <Button onClick={addPattern} disabled={loading || !patternInput.trim()}>
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    {patterns.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                            No patterns. Example: <code className="px-1 py-0.5 rounded bg-muted">*://mail.google.com/*</code>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {patterns.map((p) => (
                                <div key={p} className="flex items-center justify-between gap-2">
                                    <code className="text-xs px-2 py-1 rounded bg-muted max-w-[230px] truncate">
                                        {p}
                                    </code>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => removePattern(p)}
                                        disabled={loading}
                                        title="Remove"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
