import type { PDFDocumentProxy } from "pdfjs-dist";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** A page's size in PDF points. */
export type PageSize = { width: number; height: number };

/** pdf.js is large, so it loads with the first PDF shown. */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * Draws every page of a PDF at the container's width, filled form values included.
 * `overlay` draws on top of each page; `scale` turns PDF points into pixels.
 */
export function PdfPages({
  url,
  overlay,
}: {
  url: string;
  overlay?: (page: number, scale: number, size: PageSize) => ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      // Whole pixels, so a scrollbar appearing does not redraw every page.
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setFailed(false);
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url }).promise)
      .then((d) => {
        loaded = d;
        if (cancelled) void d.destroy();
        else setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [url]);

  return (
    <div ref={wrap} className="flex w-full flex-col gap-3">
      {failed ? (
        <p className="rounded-2xl bg-bg px-4 py-6 text-center text-sm text-muted">
          The PDF could not be shown. Download it instead.
        </p>
      ) : !doc || width === 0 ? (
        <div aria-busy="true" className="aspect-[1/1.414] w-full animate-pulse rounded-2xl bg-bg" />
      ) : (
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage
            // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for a document, and a new document redraws them all
            key={`${doc.fingerprints[0]}-${i}`}
            doc={doc}
            index={i}
            width={width}
            overlay={overlay}
          />
        ))
      )}
    </div>
  );
}

function PdfPage({
  doc,
  index,
  width,
  overlay,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  overlay?: (page: number, scale: number, size: PageSize) => ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<PageSize | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void (async () => {
      const [pdfjs, page] = await Promise.all([loadPdfjs(), doc.getPage(index + 1)]);
      const el = canvas.current;
      if (cancelled || !el) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      setSize({ width: base.width, height: base.height });
      // Form values are drawn from their appearance, as a printed copy shows them.
      task = page.render({ canvas: el, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });
      // A redraw cancels the one before it.
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, width]);

  const scale = size ? width / size.width : 1;
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-white ring-1 ring-line"
      style={{ width, height: size ? size.height * scale : width * Math.SQRT2 }}
    >
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full"
        aria-label={`Page ${index + 1}`}
      />
      {size && overlay?.(index, scale, size)}
    </div>
  );
}
