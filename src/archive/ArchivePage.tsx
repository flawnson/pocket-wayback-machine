import * as React from "react";

import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Label } from "@/components/ui/label.jsx";
import { Separator } from "@/components/ui/separator.jsx";
import {
    getVisitsPage,
    type Visit,
    getVersionsByUrlKey,
    getVersion,
    deleteVersion,
    type PageVersion,
} from "../../db.ts";

function fmt(ts: number) {
    const d = new Date(ts);
    return d.toLocaleString();
}

export default function ArchivePage() {
    const [rows, setRows] = React.useState<Visit[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [nextBefore, setNextBefore] = React.useState<number | null>(null);
    const [hasMore, setHasMore] = React.useState(true);

    // Map urlKey -> versions (so we can show a button per history row)
    const [versionsByUrlKey, setVersionsByUrlKey] = React.useState<Record<string, PageVersion[]>>({});

    // Search-by-URL (bring back old Archive behavior)
    const [urlInput, setUrlInput] = React.useState("");
    const [loadedUrlKey, setLoadedUrlKey] = React.useState("");
    const [searchedVersions, setSearchedVersions] = React.useState<PageVersion[]>([]);
    const [searchLoading, setSearchLoading] = React.useState(false);

    // Viewer state (renders saved HTML offline)
    const [viewerOpen, setViewerOpen] = React.useState(false);
    const [viewerHtml, setViewerHtml] = React.useState("");
    const viewerWrapRef = React.useRef<HTMLDivElement | null>(null);

    const sentinelRef = React.useRef<HTMLDivElement | null>(null);
    const loadingMoreRef = React.useRef(false);

    async function hydrateVersionsForVisits(visits: Visit[]) {
        // Fetch versions for newly-seen urlKeys only
        const missingUrlKeys = Array.from(
            new Set(visits.map((v) => v.urlKey).filter((k) => k && versionsByUrlKey[k] == null))
        );

        if (missingUrlKeys.length === 0) return;

        try {
            const pairs = await Promise.all(
                missingUrlKeys.map(async (urlKey) => {
                    const versions = await getVersionsByUrlKey(urlKey);
                    return [urlKey, versions ?? []] as const;
                })
            );

            setVersionsByUrlKey((prev) => {
                const next = { ...prev };
                for (const [urlKey, versions] of pairs) next[urlKey] = versions;
                return next;
            });
        } catch (e: any) {
            // Non-fatal: history can still render even if snapshots lookup fails
            setError(e?.message ?? "Failed to load saved versions for some history items.");
        }
    }

    async function openSnapshotByVersionId(versionId: string) {
        setError(null);
        try {
            const full = await getVersion(versionId);
            if (!full) return;

            setViewerHtml(full.html);
            setViewerOpen(true);

            requestAnimationFrame(() => {
                viewerWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        } catch (e: any) {
            setError(e?.message ?? "Failed to open snapshot.");
        }
    }

    async function openLatestSnapshotFor(urlKey: string) {
        setError(null);
        try {
            const versions = versionsByUrlKey[urlKey] ?? (await getVersionsByUrlKey(urlKey));
            if (!versions || versions.length === 0) return;

            const latest = versions[0]!;
            await openSnapshotByVersionId(latest.versionId);
        } catch (e: any) {
            setError(e?.message ?? "Failed to open snapshot.");
        }
    }

    async function loadByUrlKey(raw: string) {
        const key = raw.trim();
        setLoadedUrlKey(key);
        setError(null);
        setViewerOpen(false);
        setViewerHtml("");

        if (!key) {
            setSearchedVersions([]);
            return;
        }

        setSearchLoading(true);
        try {
            const versions = await getVersionsByUrlKey(key);
            setSearchedVersions(versions ?? []);

            // Keep the cache in sync so history rows benefit too
            setVersionsByUrlKey((prev) => ({ ...prev, [key]: versions ?? [] }));
        } catch (e: any) {
            setError(e?.message ?? "Failed to load versions for that URL.");
            setSearchedVersions([]);
        } finally {
            setSearchLoading(false);
        }
    }

    async function onDeleteVersion(versionId: string) {
        setError(null);
        try {
            await deleteVersion(versionId);

            // refresh search list (if applicable)
            if (loadedUrlKey) {
                await loadByUrlKey(loadedUrlKey);
            }

            // also refresh cache entries for history cards
            // (cheap: just drop cache and let hydrate reload as you scroll)
            setVersionsByUrlKey((prev) => {
                const next = { ...prev };
                for (const k of Object.keys(next)) {
                    const list = next[k] ?? [];
                    next[k] = list.filter((v) => v.versionId !== versionId);
                }
                return next;
            });
        } catch (e: any) {
            setError(e?.message ?? "Failed to delete version.");
        }
    }

    function closeViewer() {
        setViewerOpen(false);
        setViewerHtml("");
    }

    async function loadFirstPage() {
        setError(null);
        setLoading(true);
        try {
            const page = await getVisitsPage({ limit: 60 });
            setRows(page.rows);
            setNextBefore(page.nextBefore);
            setHasMore(page.rows.length > 0);

            await hydrateVersionsForVisits(page.rows);
        } catch (e: any) {
            setError(e?.message ?? "Failed to load history.");
            setRows([]);
            setNextBefore(null);
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }

    async function loadMore() {
        if (loadingMoreRef.current) return;
        if (!hasMore) return;
        if (nextBefore == null) {
            setHasMore(false);
            return;
        }

        loadingMoreRef.current = true;
        setError(null);
        setLoading(true);
        try {
            const page = await getVisitsPage({ limit: 60, before: nextBefore });

            setRows((prev) => {
                const merged = prev.concat(page.rows);
                const seen = new Set<string>();
                return merged.filter((v) => {
                    if (seen.has(v.visitId)) return false;
                    seen.add(v.visitId);
                    return true;
                });
            });

            setNextBefore(page.nextBefore);
            setHasMore(page.rows.length > 0);

            await hydrateVersionsForVisits(page.rows);
        } catch (e: any) {
            setError(e?.message ?? "Failed to load more history.");
        } finally {
            setLoading(false);
            loadingMoreRef.current = false;
        }
    }

    React.useEffect(() => {
        // Optional: support ?url=... like your old page
        const params = new URLSearchParams(window.location.search);
        const urlFromQuery = params.get("url") ?? "";
        if (urlFromQuery) {
            setUrlInput(urlFromQuery);
            loadByUrlKey(urlFromQuery);
        }

        loadFirstPage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        if (!hasMore) return;

        const obs = new IntersectionObserver(
            (entries) => {
                const first = entries[0];
                if (first?.isIntersecting) loadMore();
            },
            { root: null, rootMargin: "600px 0px 600px 0px", threshold: 0 }
        );

        obs.observe(el);
        return () => obs.disconnect();
    }, [hasMore, nextBefore]);

    return (
        <div className="min-h-screen p-6 space-y-4">
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold">Archive</h1>

                <div className="flex gap-2">
                    <Input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="Paste a URL to view snapshots (exact match)"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") loadByUrlKey(urlInput);
                        }}
                    />
                    <Button onClick={() => loadByUrlKey(urlInput)} disabled={searchLoading}>
                        {searchLoading ? "Loading…" : "Load"}
                    </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                    Tip: this matches the exact URL key used for saving (currently the full URL).
                </div>

                {error && <div className="text-sm text-destructive">{error}</div>}
            </div>

            <div className="space-y-2">
                {!loadedUrlKey ? null : searchedVersions.length === 0 ? (
                    <Card>
                        <CardContent className="p-4 text-sm">
                            <div>No saved versions for:</div>
                            <code className="font-mono break-all">{loadedUrlKey}</code>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">
                            {searchedVersions.length} snapshot(s) for{" "}
                            <code className="font-mono break-all">{loadedUrlKey}</code>
                        </div>

                        {searchedVersions.map((v) => (
                            <Card key={v.versionId}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 space-y-1">
                                            <div className="font-medium truncate">{v.title || "(untitled)"}</div>
                                            <div className="text-sm text-muted-foreground break-all">{v.url}</div>
                                            <div className="text-sm text-muted-foreground">Captured: {fmt(v.capturedAt)}</div>
                                        </div>

                                        <div className="shrink-0 flex gap-2">
                                            <Button variant="secondary" onClick={() => openSnapshotByVersionId(v.versionId)}>
                                                Open
                                            </Button>
                                            <Button variant="destructive" onClick={() => onDeleteVersion(v.versionId)}>
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Separator />

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">History</h2>
                    <Button variant="outline" onClick={loadFirstPage} disabled={loading}>
                        Refresh
                    </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                    Showing visits stored in IndexedDB (newest first). “Open snapshot” uses the newest saved snapshot for that URL key.
                </div>
            </div>

            <div className="space-y-2">
                {rows.map((v) => {
                    const versions = versionsByUrlKey[v.urlKey];
                    const hasSnapshot = (versions?.length ?? 0) > 0;

                    return (
                        <Card key={v.visitId}>
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1">
                                        <div className="text-sm text-muted-foreground">{fmt(v.visitAt)}</div>
                                        <div className="text-sm break-all">{v.url}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {hasSnapshot ? `${versions!.length} saved snapshot(s)` : "No saved snapshot for this URL key"}
                                        </div>
                                    </div>

                                    <div className="shrink-0 flex gap-2">
                                        <Button
                                            variant="secondary"
                                            disabled={!hasSnapshot}
                                            onClick={() => openLatestSnapshotFor(v.urlKey)}
                                            title={hasSnapshot ? "Open the newest saved snapshot" : "No snapshot saved for this URL"}
                                        >
                                            Open snapshot
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}

                <div ref={sentinelRef} />

                <div className="text-sm text-muted-foreground py-4">
                    {loading ? "Loading…" : hasMore ? "Scroll for more…" : "End of stored history."}
                </div>
            </div>

            <div ref={viewerWrapRef} className={viewerOpen ? "space-y-2" : "hidden"}>
                <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Offline Snapshot Viewer</div>
                    <Button variant="outline" onClick={closeViewer}>
                        Close Viewer
                    </Button>
                </div>

                <Card>
                    <CardContent className="p-4 space-y-2">
                        <Label className="text-xs text-muted-foreground">
                            Rendered locally via <code className="font-mono">iframe.srcDoc</code>
                        </Label>
                        <iframe title="viewer" className="w-full h-[70vh] rounded-md border" srcDoc={viewerHtml} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}