import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type Placement = { page: number; xPct: number; yPct: number };

/** Shows the prepared form; a tap marks where the signature goes on the form itself. */
export function FormPlacementPicker({ pdfPath, value, onChange }: { pdfPath: string; value: Placement | null; onChange: (p: Placement | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<{ numPages: number; getPage: (n: number) => Promise<any> } | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const res = await fetch(apiUrl(pdfPath), { credentials: "include" });
        if (!res.ok) throw new Error("Could not load the form.");
        const loaded = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        if (!cancelled) setDoc(loaded);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the form."); }
    })();
    return () => { cancelled = true; };
  }, [pdfPath]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    void (async () => {
      const p = await doc.getPage(page + 1);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: Math.min(1.2, 440 / base.width) });
      const el = canvas.current;
      if (!el || cancelled) return;
      el.width = viewport.width; el.height = viewport.height;
      await p.render({ canvasContext: el.getContext("2d")!, viewport, canvas: el }).promise;
    })();
    return () => { cancelled = true; };
  }, [doc, page]);

  function pick(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    onChange({ page, xPct: (e.clientX - r.left) / r.width, yPct: (e.clientY - r.top) / r.height });
  }

  if (error) return <p className="text-xs text-rose-600">{error}</p>;
  if (!doc) return <p className="text-xs text-[var(--color-muted-foreground)]">Loading the form…</p>;
  return (
    <div className="space-y-2">
      <div className="relative inline-block max-w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-white">
        <canvas ref={canvas} onClick={pick} className="block max-w-full cursor-crosshair" aria-label="Tap where the signature goes" />
        {value && value.page === page ? (
          <span className="pointer-events-none absolute h-6 w-24 -translate-y-full rounded border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/15"
            style={{ left: `${value.xPct * 100}%`, top: `${value.yPct * 100}%` }} />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--color-muted-foreground)]">{value ? `Signature goes on page ${value.page + 1}` : "Tap the signature line (optional)"}</span>
        <span className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="self-center px-1">{page + 1}/{doc.numPages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= doc.numPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
          {value ? <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button> : null}
        </span>
      </div>
    </div>
  );
}
