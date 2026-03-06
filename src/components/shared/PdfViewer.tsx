'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PdfViewerProps {
  data: ArrayBuffer;
}

export default function PdfViewer({ data }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const pdfDocRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
      const pdf = await loadingTask.promise;
      if (cancelled) return;

      pdfDocRef.current = pdf;
      setNumPages(pdf.numPages);
      setCurrentPage(1);
    };

    loadPdf();
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || currentPage < 1) return;

    const renderPage = async () => {
      const pdf = pdfDocRef.current as { getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> } }> };
      const page = await pdf.getPage(currentPage);

      const canvas = canvasRef.current!;
      const context = canvas.getContext('2d')!;

      // Fit to container width
      const container = containerRef.current;
      const containerWidth = container ? container.clientWidth - 32 : 800;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min(containerWidth / unscaledViewport.width, scale);

      const viewport = page.getViewport({ scale: fitScale });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;
    };

    renderPage();
  }, [currentPage, numPages, scale]);

  if (numPages === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-center gap-3 py-2 shrink-0 bg-muted/20 rounded-t-lg border-b border-border/30">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-muted-foreground">
          Page {currentPage} of {numPages}
        </span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
          disabled={currentPage >= numPages}
          className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="text-border/50">|</span>
        <button onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} className="px-2 py-0.5 text-xs font-bold rounded hover:bg-muted/50 transition-colors">-</button>
        <span className="text-xs font-medium text-muted-foreground">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} className="px-2 py-0.5 text-xs font-bold rounded hover:bg-muted/50 transition-colors">+</button>
      </div>
      {/* Canvas */}
      <div className="flex-1 overflow-auto flex justify-center p-4" style={{ background: '#525659' }}>
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>
    </div>
  );
}
