'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Trash2, Type, Loader2 } from 'lucide-react';
import { Button } from '@/components/shared/Button';

interface TextAnnotation {
  id: string;
  pageIndex: number;
  /** X position as fraction of page width (0-1) */
  xRatio: number;
  /** Y position as fraction of page height (0-1) */
  yRatio: number;
  text: string;
  fontSize: number;
  color: string;
}

interface PdfEditorProps {
  /** The raw PDF bytes */
  pdfData: ArrayBuffer;
  onSave: (modifiedPdf: Uint8Array) => Promise<{ ok: boolean; error?: string }>;
}

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32];
const COLORS = [
  { label: 'Black', value: '#000000' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Purple', value: '#a855f7' },
];

export function PdfEditor({ pdfData, onSave }: PdfEditorProps) {
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState('#000000');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageDimsRef = useRef<{ width: number; height: number }[]>([]);

  // Render PDF pages to canvas
  useEffect(() => {
    let cancelled = false;

    async function renderPages() {
      setLoading(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        // Clone the buffer so pdfjs worker transfer doesn't detach the original
        const cloned = pdfData.slice(0);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(cloned) }).promise;
        setPageCount(pdf.numPages);

        const canvases: HTMLCanvasElement[] = [];
        const dims: { width: number; height: number }[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const scale = 1.5;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          canvases.push(canvas);
          dims.push({ width: viewport.width, height: viewport.height });
        }

        if (!cancelled) {
          pageDimsRef.current = dims;
          setPages(canvases);
        }
      } catch (err) {
        console.error('Failed to render PDF:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    renderPages();
    return () => { cancelled = true; };
  }, [pdfData]);

  const handlePageClick = useCallback((e: React.MouseEvent<HTMLDivElement>, pageIndex: number) => {
    if (!addMode) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    const newAnnotation: TextAnnotation = {
      id: crypto.randomUUID(),
      pageIndex,
      xRatio,
      yRatio,
      text: '',
      fontSize,
      color,
    };

    setAnnotations((prev) => [...prev, newAnnotation]);
    setSelectedId(newAnnotation.id);
    setAddMode(false);
  }, [addMode, fontSize, color]);

  const updateAnnotation = useCallback((id: string, updates: Partial<TextAnnotation>) => {
    setAnnotations((prev) => prev.map((a) => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);

    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfData);
      const pdfPages = pdfDoc.getPages();

      for (const ann of annotations) {
        if (!ann.text.trim()) continue;
        const page = pdfPages[ann.pageIndex];
        if (!page) continue;

        const { width, height } = page.getSize();

        // Parse hex color to RGB
        const hex = ann.color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;

        // Convert screen coordinates to PDF coordinates (PDF origin is bottom-left)
        const x = ann.xRatio * width;
        const y = height - (ann.yRatio * height);

        // Draw each line separately for multiline text
        const lines = ann.text.split('\n');
        lines.forEach((line, lineIdx) => {
          page.drawText(line, {
            x,
            y: y - (lineIdx * ann.fontSize * 1.2),
            size: ann.fontSize,
            color: rgb(r, g, b),
          });
        });
      }

      const modifiedPdf = await pdfDoc.save();
      const result = await onSave(modifiedPdf);

      if (result.ok) {
        setSaveStatus('Saved!');
        setAnnotations([]);
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus(result.error || 'Failed to save');
      }
    } catch (err) {
      console.error('PDF save failed:', err);
      setSaveStatus('Failed to save');
    } finally {
      setSaving(false);
    }
  }, [pdfData, annotations, onSave]);

  const hasChanges = annotations.some((a) => a.text.trim());
  const selected = annotations.find((a) => a.id === selectedId);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground font-medium">Loading PDF editor...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5 bg-muted/20 shrink-0 flex-wrap">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          isLoading={saving}
          className="gap-1.5 text-[11px] font-bold mr-1"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>

        <div className="h-5 w-px bg-border/40 mx-1" />

        <Button
          variant={addMode ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setAddMode(!addMode)}
          className="gap-1.5 text-[11px] font-bold"
        >
          <Type className="h-3.5 w-3.5" />
          {addMode ? 'Click on PDF...' : 'Add Text'}
        </Button>

        <div className="h-5 w-px bg-border/40 mx-1" />

        <select
          value={fontSize}
          onChange={(e) => {
            const newSize = Number(e.target.value);
            setFontSize(newSize);
            if (selectedId) updateAnnotation(selectedId, { fontSize: newSize });
          }}
          className="bg-transparent border border-border/30 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground cursor-pointer"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => {
                setColor(c.value);
                if (selectedId) updateAnnotation(selectedId, { color: c.value });
              }}
              className={`w-5 h-5 rounded-full border-2 transition-all ${
                color === c.value ? 'border-foreground scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
        </div>

        {selected && (
          <>
            <div className="h-5 w-px bg-border/40 mx-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteAnnotation(selected.id)}
              className="gap-1.5 text-[11px] font-bold text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        )}

        {saveStatus && (
          <span className={`ml-auto text-[11px] font-bold ${
            saveStatus === 'Saved!' ? 'text-green-500' : 'text-red-400'
          }`}>
            {saveStatus}
          </span>
        )}
        {hasChanges && !saveStatus && (
          <span className="ml-auto text-[11px] text-amber-500 font-medium">
            {annotations.filter((a) => a.text.trim()).length} annotation(s)
          </span>
        )}
      </div>

      {/* PDF pages with annotation overlays */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto bg-muted/30 p-4 space-y-4 ${addMode ? 'cursor-crosshair' : ''}`}
        onClick={() => { if (!addMode) setSelectedId(null); }}
      >
        {pages.map((canvas, pageIndex) => (
          <div key={pageIndex} className="mx-auto" style={{ maxWidth: canvas.width }}>
            <div
              className="relative shadow-lg rounded-sm overflow-hidden"
              onClick={(e) => {
                e.stopPropagation();
                if (addMode) handlePageClick(e, pageIndex);
                else setSelectedId(null);
              }}
            >
              {/* Rendered PDF page */}
              <img
                src={canvas.toDataURL()}
                alt={`Page ${pageIndex + 1}`}
                className="w-full h-auto block"
                draggable={false}
              />

              {/* Text annotation overlays */}
              {annotations
                .filter((a) => a.pageIndex === pageIndex)
                .map((ann) => (
                  <div
                    key={ann.id}
                    className={`absolute ${
                      selectedId === ann.id
                        ? 'ring-2 ring-primary ring-offset-1'
                        : 'hover:ring-1 hover:ring-primary/50'
                    }`}
                    style={{
                      left: `${ann.xRatio * 100}%`,
                      top: `${ann.yRatio * 100}%`,
                      transform: 'translate(0, -100%)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(ann.id);
                    }}
                  >
                    <textarea
                      value={ann.text}
                      onChange={(e) => updateAnnotation(ann.id, { text: e.target.value })}
                      onFocus={() => setSelectedId(ann.id)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Type here..."
                      autoFocus={ann.text === ''}
                      className="bg-transparent border-none outline-none resize min-w-[100px] min-h-[1.5em] p-0.5"
                      style={{
                        fontSize: `${ann.fontSize}px`,
                        color: ann.color,
                        lineHeight: '1.2',
                        fontFamily: 'Helvetica, Arial, sans-serif',
                      }}
                      rows={1}
                    />
                  </div>
                ))}
            </div>

            {/* Page number */}
            <p className="text-center text-[10px] text-muted-foreground mt-1 font-medium">
              {pageIndex + 1} / {pageCount}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
