import * as React from "react";
import { getVersionsByUrlKey, getVersion, deleteVersion } from "../../db.ts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Separator } from "@/components/ui/separator.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Label } from "@/components/ui/label.jsx";

type VersionRow = {
    versionId: string;
    url: string;
    title?: string;
    capturedAt: number;
};

type VersionFull = VersionRow & { html: string };

function fmt(ts: number) {
    const d = new Date(ts);
    return d.toLocaleString();
}

export default function ArchivePage() {
    const [urlInput, setUrlInput] = React.useState("");
    const [loadedUrl, setLoadedUrl] = React.useState(""); // the URL key currently displayed
    const [versions, setVersions] = React.useState<VersionRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const [viewerOpen, setViewerOpen] = React.useState(false);
    const [viewerHtml, setViewerHtml] = React.useState("");

    const viewerWrapRef = React.useRef<HTMLDivElement | null>(null);

    async function load(urlKey: string) {
        setLoadedUrl(urlKey);
        setError(null);
        setViewerOpen(false);
        setViewerHtml("");

        if (!urlKey) {
            setVersions([]);
            return;
        }

        setLoading(true);
        try {
            const rows = (await getVersionsByUrlKey(urlKey)) as VersionRow[];
            setVersions(rows ?? []);
        } catch (e: any) {
            setError(e?.message ?? "Failed to load versions.");
            setVersions([]);
        } finally {
            setLoading(false);
        }
    }

    async function openVersion(versionId: string) {
        setError(null);
        try {
            const v = (await getVersion(versionId)) as VersionFull | null;
            if (!v) return;

            setViewerHtml(v.html);
            setViewerOpen(true);

            // match your smooth scroll behavior
            requestAnimationFrame(() => {
                viewerWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        } catch (e: any) {
            setError(e?.message ?? "Failed to open version.");
        }
    }

    async function onDelete(versionId: string) {
        setError(null);
        try {
            await deleteVersion(versionId);
            await load(loadedUrl); // re-render current URL key, same as your JS
        } catch (e: any) {
            setError(e?.message ?? "Failed to delete version.");
        }
    }

    function closeViewer() {
        setViewerOpen(false);
        setViewerHtml("");
    }

    // On mount: support ?url=...
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlFromQuery = params.get("url") ?? "";
        setUrlInput(urlFromQuery);
        load(urlFromQuery);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sortedVersions = React.useMemo(() => {
        return [...versions].sort((a, b) => b.capturedAt - a.capturedAt);
    }, [versions]);

    return (
        <div className="min-h-screen p-6 space-y-4">
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold">Archive</h1>

                <div className="flex gap-2">
                    <Input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="Paste a URL to view versions (exact match)"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") load(urlInput.trim());
                        }}
                    />
                    <Button onClick={() => load(urlInput.trim())} disabled={loading}>
                        {loading ? "Loading…" : "Load"}
                    </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                    Tip: by default this matches the exact URL (including query string). You can change normalization in{" "}
                    <code className="font-mono">toUrlKey()</code>.
                </div>

                {error && <div className="text-sm text-destructive">{error}</div>}
            </div>

            <div className="space-y-3">
                {!loadedUrl ? (
                    <Card>
                        <CardContent className="p-4 text-sm text-muted-foreground">
                            Enter a URL above to load versions.
                        </CardContent>
                    </Card>
                ) : sortedVersions.length === 0 ? (
                    <Card>
                        <CardContent className="p-4 text-sm">
                            <div>No saved versions for:</div>
                            <code className="font-mono break-all">{loadedUrl}</code>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-2">
                        {sortedVersions.map((v) => (
                            <Card key={v.versionId}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{v.title || "(untitled)"}</div>
                                            <div className="text-sm text-muted-foreground break-all">{v.url}</div>
                                            <div className="text-sm text-muted-foreground">Captured: {fmt(v.capturedAt)}</div>
                                        </div>

                                        <div className="flex gap-2 shrink-0">
                                            <Button variant="secondary" onClick={() => openVersion(v.versionId)}>
                                                Open
                                            </Button>
                                            <Button variant="destructive" onClick={() => onDelete(v.versionId)}>
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

            <div
                ref={viewerWrapRef}
                className={viewerOpen ? "space-y-2" : "hidden"}
            >
                <Separator />
                <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Viewer</div>
                    <Button variant="outline" onClick={closeViewer}>
                        Close Viewer
                    </Button>
                </div>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Snapshot</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                            Rendered locally via <code className="font-mono">iframe.srcdoc</code>
                        </Label>

                        <iframe
                            title="viewer"
                            className="w-full h-[70vh] rounded-md border"
                            // React prop is srcDoc (capital D)
                            srcDoc={viewerHtml}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
