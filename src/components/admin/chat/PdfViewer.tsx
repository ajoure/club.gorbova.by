import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2, ZoomIn, ZoomOut, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Use bundled worker via Vite (?url) to avoid CDN/CORS issues
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfViewerProps {
  url: string;
  fileName?: string | null;
}

export function PdfViewer({ url, fileName }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseWidth = Math.max(280, Math.min(containerWidth - 16, 1200));
  const pageWidth = baseWidth * zoom;

  return (
    <div className="relative w-full h-full flex flex-col bg-neutral-900">
      {/* Zoom controls */}
      <div
        className="absolute z-40 right-3 flex items-center gap-1 rounded-full border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur"
        style={{ bottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
          title="Уменьшить"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs px-1 tabular-nums min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
          title="Увеличить"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setZoom(1)}
          title="По ширине"
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto overscroll-contain"
        style={{
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y pinch-zoom",
        }}
      >
        <div className="flex flex-col items-center gap-3 py-3">
          {error ? (
            <div className="text-sm text-destructive-foreground bg-destructive/80 rounded-md px-3 py-2 m-4">
              Не удалось открыть PDF: {error}
            </div>
          ) : (
            <Document
              file={url}
              onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              onLoadError={(e) => setError(e.message)}
              loading={
                <div className="flex items-center gap-2 text-white/80 mt-10">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Загрузка PDF…
                </div>
              }
            >
              {Array.from({ length: numPages }, (_, i) => (
                <Page
                  key={`page_${i + 1}`}
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  className="shadow-lg"
                />
              ))}
            </Document>
          )}
        </div>
      </div>
    </div>
  );
}

export default PdfViewer;
