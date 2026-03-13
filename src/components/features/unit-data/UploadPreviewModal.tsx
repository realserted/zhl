'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';

const PAGE_SIZE = 20;

export interface UploadPreviewConfig {
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
  startCol: number;
  endCol: number;
  columnSkip: Record<number, boolean>;
}

interface UploadPreviewModalProps {
  isOpen: boolean;
  fileName: string;
  previewRows: unknown[][];
  uploading: boolean;
  initialConfig: UploadPreviewConfig;
  onClose: () => void;
  onUpload: (config: UploadPreviewConfig) => void;
}

export function UploadPreviewModal({ isOpen, fileName, previewRows, uploading, initialConfig, onClose, onUpload }: UploadPreviewModalProps) {
  const [headerRow, setHeaderRow] = useState(initialConfig.headerRow);
  const [dataStartRow, setDataStartRow] = useState(initialConfig.dataStartRow);
  const [dataEndRow, setDataEndRow] = useState(initialConfig.dataEndRow);
  const [startCol, setStartCol] = useState(initialConfig.startCol);
  const [endCol, setEndCol] = useState(initialConfig.endCol);
  const [columnSkip, setColumnSkip] = useState(initialConfig.columnSkip);
  const [page, setPage] = useState(0);

  // Selection state
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);

  // Sync state when initialConfig changes (new file opened)
  const [lastFileName, setLastFileName] = useState(fileName);
  if (fileName !== lastFileName) {
    setLastFileName(fileName);
    setHeaderRow(initialConfig.headerRow);
    setDataStartRow(initialConfig.dataStartRow);
    setDataEndRow(initialConfig.dataEndRow);
    setStartCol(initialConfig.startCol);
    setEndCol(initialConfig.endCol);
    setColumnSkip(initialConfig.columnSkip);
    setPage(0);
  }

  const dataRowCount = Math.max(0, (dataEndRow || previewRows.length) - dataStartRow + 1);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Upload Preview — ${fileName}`} maxWidth="7xl">
      <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-border/50 bg-muted/20">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Header</span>
            <input type="number" min={0} value={headerRow} onChange={(e) => { setHeaderRow(Number(e.target.value)); setPage(0); }}
              className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Start</span>
            <input type="number" min={1} value={dataStartRow} onChange={(e) => { setDataStartRow(Number(e.target.value)); setPage(0); }}
              className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">End</span>
            <input type="number" min={0} value={dataEndRow} onChange={(e) => setDataEndRow(Number(e.target.value))}
              className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col Start</span>
            <input type="number" min={0} value={startCol} onChange={(e) => setStartCol(Number(e.target.value))}
              className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Col End</span>
            <input type="number" min={0} value={endCol} onChange={(e) => setEndCol(Number(e.target.value))}
              className="w-16 px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs text-center font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
          </label>
          <span className="text-[10px] font-bold tracking-widest uppercase text-primary ml-auto">
            {dataRowCount} data rows
          </span>
        </div>

        {/* Data preview */}
        <div className="flex-1 overflow-auto px-5 py-3">
          <div className="min-w-max">
            {(() => {
              const pageStart = page * PAGE_SIZE;
              const pageEnd = Math.min(pageStart + PAGE_SIZE, previewRows.length);
              const visibleRows = previewRows.slice(pageStart, pageEnd);
              const maxCols = Math.max(...previewRows.map((r) => r.length), 0);

              const selR1 = selStart && selEnd ? Math.min(selStart.r, selEnd.r) : null;
              const selR2 = selStart && selEnd ? Math.max(selStart.r, selEnd.r) : null;
              const selC1 = selStart && selEnd ? Math.min(selStart.c, selEnd.c) : null;
              const selC2 = selStart && selEnd ? Math.max(selStart.c, selEnd.c) : null;

              return visibleRows.map((row, rIdx) => {
                const actualRowIdx = pageStart + rIdx;
                const isHeaderRow = headerRow >= 1 && actualRowIdx === headerRow - 1;
                const isBeforeStart = actualRowIdx < dataStartRow - 1;
                const isStartRow = actualRowIdx === dataStartRow - 1;
                const isAfterEnd = dataEndRow > 0 && actualRowIdx >= dataEndRow;

                return (
                  <div
                    key={actualRowIdx}
                    className={`flex items-center gap-1 rounded-lg transition-all ${
                      isHeaderRow ? 'bg-blue-500/10 font-semibold'
                      : isBeforeStart || isAfterEnd ? 'opacity-30'
                      : isStartRow ? 'bg-primary/10 border-l-2 border-primary'
                      : 'hover:bg-muted/30'
                    }`}
                  >
                    <div
                      className={`w-10 shrink-0 text-xs text-center py-1.5 cursor-pointer hover:text-primary font-mono transition-colors ${
                        isHeaderRow ? 'text-blue-500 font-bold' : isStartRow ? 'text-primary font-bold' : 'text-muted-foreground/60'
                      }`}
                      onClick={() => { setDataStartRow(actualRowIdx + 1); if (actualRowIdx >= 1) setHeaderRow(actualRowIdx); setPage(0); }}
                      title={`Click to set data start at row ${actualRowIdx + 1}`}
                    >
                      {actualRowIdx + 1}
                    </div>
                    {Array.from({ length: maxCols }, (_, cIdx) => {
                      const val = row[cIdx];
                      const inRange = cIdx >= startCol && cIdx <= endCol && !columnSkip[cIdx];
                      const inSelection = selR1 !== null && selC1 !== null && actualRowIdx >= selR1 && actualRowIdx <= selR2! && cIdx >= selC1 && cIdx <= selC2!;
                      return (
                        <div
                          key={cIdx}
                          className={`w-28 shrink-0 px-2 py-1.5 text-xs truncate border-r border-border/20 cursor-cell font-medium transition-all ${
                            inSelection ? 'bg-primary/20 ring-1 ring-primary/40 rounded' : inRange ? 'text-foreground/80' : 'opacity-20'
                          }`}
                          title={val != null ? String(val) : ''}
                          onMouseDown={() => { setSelecting(true); setSelStart({ r: actualRowIdx, c: cIdx }); setSelEnd({ r: actualRowIdx, c: cIdx }); }}
                          onMouseEnter={() => { if (selecting) setSelEnd({ r: actualRowIdx, c: cIdx }); }}
                          onMouseUp={() => {
                            setSelecting(false);
                            if (selStart && selEnd) {
                              const r1 = Math.min(selStart.r, selEnd.r);
                              const r2 = Math.max(selStart.r, selEnd.r);
                              const c1 = Math.min(selStart.c, selEnd.c);
                              const c2 = Math.max(selStart.c, selEnd.c);
                              setHeaderRow(r1 + 1);
                              setDataStartRow(r1 + 2);
                              setDataEndRow(r2 + 1);
                              setStartCol(c1);
                              setEndCol(c2);
                            }
                          }}
                        >
                          {val != null ? String(val) : ''}
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Pagination + Actions */}
        <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="text-xs text-muted-foreground font-medium">
              Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, previewRows.length)} of {previewRows.length}
            </span>
            <button disabled={(page + 1) * PAGE_SIZE >= previewRows.length} onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-4 py-2.5 text-xs border border-border rounded-2xl hover:bg-muted font-bold transition-all">Cancel</button>
            <button onClick={() => onUpload({ headerRow, dataStartRow, dataEndRow, startCol, endCol, columnSkip })} disabled={uploading}
              className="px-5 py-2.5 text-xs bg-primary text-primary-foreground rounded-2xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
              {uploading ? 'Uploading...' : `Upload ${dataRowCount} rows`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
