'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { CategoryWithFields } from '@/lib/types/unit-data';

const PAGE_SIZE = 20;

export interface ImportConfig {
  targetCat: string;
  dataStartRow: number;
  dataEndRow: number;
  startCol: number;
  endCol: number;
  colMapping: Record<number, string>;
  newFieldNames: Record<number, string>;
}

interface ImportToCategoryModalProps {
  isOpen: boolean;
  fileName: string;
  importRows: unknown[][];
  categories: CategoryWithFields[];
  uploading: boolean;
  onClose: () => void;
  onImport: (config: ImportConfig) => void;
}

export function ImportToCategoryModal({ isOpen, fileName, importRows, categories, uploading, onClose, onImport }: ImportToCategoryModalProps) {
  const [targetCat, setTargetCat] = useState('');
  const [dataStartRow, setDataStartRow] = useState(2);
  const [dataEndRow, setDataEndRow] = useState(0);
  const [startCol, setStartCol] = useState(0);
  const [endCol, setEndCol] = useState(0);
  const [colMapping, setColMapping] = useState<Record<number, string>>({});
  const [newFieldNames, setNewFieldNames] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);

  // Selection state
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<{ r: number; c: number } | null>(null);
  const [selEnd, setSelEnd] = useState<{ r: number; c: number } | null>(null);

  // Reset state when new file opens
  const [lastFileName, setLastFileName] = useState(fileName);
  if (fileName !== lastFileName) {
    setLastFileName(fileName);
    setTargetCat('');
    setDataStartRow(2);
    setDataEndRow(importRows.length);
    setStartCol(0);
    setEndCol(Math.max(...importRows.map((r) => r.length), 1) - 1);
    setColMapping({});
    setNewFieldNames({});
    setPage(0);
  }

  const handleCategoryChange = (catId: string) => {
    setTargetCat(catId);
    setColMapping({});
    setNewFieldNames({});
  };

  const mappedCount = Object.values(colMapping).filter((v) => v !== '').length;
  const maxCols = Math.max(...importRows.map((r) => r.length), 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Import to Category — ${fileName}`} maxWidth="7xl">
      <div className="flex flex-col" style={{ maxHeight: '75vh' }}>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-border/50 bg-muted/20">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Category</span>
            <div className="relative">
              <select value={targetCat} onChange={(e) => handleCategoryChange(e.target.value)}
                className="px-3 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs font-medium appearance-none pr-7 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all">
                <option value="">Select category...</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            </div>
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
        </div>

        {/* Column-to-field mapping */}
        {targetCat && (
          <div className="px-5 py-3 border-b border-border/50 overflow-x-auto bg-muted/10">
            <div className="flex items-end gap-1 min-w-max">
              <div className="w-10 shrink-0" />
              {Array.from({ length: Math.min(maxCols, endCol + 1) }, (_, colIdx) => {
                if (colIdx < startCol) return null;
                const cat = categories.find((c) => c.id === targetCat);
                const mappedVal = colMapping[colIdx] ?? '';
                const isNew = mappedVal === '__new__';
                return (
                  <div key={colIdx} className="w-28 shrink-0 space-y-1">
                    <select value={mappedVal} onChange={(e) => setColMapping((prev) => ({ ...prev, [colIdx]: e.target.value }))}
                      className={`w-full px-1.5 py-1 border rounded-lg text-[10px] font-medium transition-all ${mappedVal ? 'border-primary/40 bg-primary/10 text-primary font-bold' : 'border-border/50 bg-background/50 text-muted-foreground'}`}>
                      <option value="">— Skip —</option>
                      {cat?.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      <option value="__new__">+ New field...</option>
                    </select>
                    {isNew && (
                      <input value={newFieldNames[colIdx] ?? ''} onChange={(e) => setNewFieldNames((prev) => ({ ...prev, [colIdx]: e.target.value }))}
                        placeholder="Field name..."
                        className="w-full px-1.5 py-1 border border-primary/20 rounded-lg text-[10px] bg-background/50 font-medium focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Data preview */}
        <div className="flex-1 overflow-auto px-5 py-3">
          <div className="min-w-max">
            {(() => {
              const pageStart = page * PAGE_SIZE;
              const pageEnd = Math.min(pageStart + PAGE_SIZE, importRows.length);
              const visibleRows = importRows.slice(pageStart, pageEnd);

              const selR1 = selStart && selEnd ? Math.min(selStart.r, selEnd.r) : null;
              const selR2 = selStart && selEnd ? Math.max(selStart.r, selEnd.r) : null;
              const selC1 = selStart && selEnd ? Math.min(selStart.c, selEnd.c) : null;
              const selC2 = selStart && selEnd ? Math.max(selStart.c, selEnd.c) : null;

              return visibleRows.map((row, rIdx) => {
                const actualRowIdx = pageStart + rIdx;
                const inDataRange = actualRowIdx >= dataStartRow - 1 && (dataEndRow === 0 || actualRowIdx < dataEndRow);
                return (
                  <div key={actualRowIdx} className={`flex items-center gap-1 rounded-lg transition-all ${inDataRange ? 'hover:bg-muted/30' : 'opacity-30'}`}>
                    <div className="w-10 shrink-0 text-xs text-center py-1.5 text-muted-foreground/60 font-mono">{actualRowIdx + 1}</div>
                    {Array.from({ length: maxCols }, (_, cIdx) => {
                      const val = row[cIdx];
                      const inColRange = cIdx >= startCol && cIdx <= endCol;
                      const inSelection = selR1 !== null && selC1 !== null && actualRowIdx >= selR1 && actualRowIdx <= selR2! && cIdx >= selC1 && cIdx <= selC2!;
                      return (
                        <div key={cIdx}
                          className={`w-28 shrink-0 px-2 py-1.5 text-xs truncate border-r border-border/20 cursor-cell font-medium transition-all ${
                            inSelection ? 'bg-primary/20 ring-1 ring-primary/40 rounded' : inColRange ? 'text-foreground/80' : 'opacity-20'
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
                              setDataStartRow(r1 + 1);
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
              Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, importRows.length)} of {importRows.length}
            </span>
            <button disabled={(page + 1) * PAGE_SIZE >= importRows.length} onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-border/50 text-xs disabled:opacity-30 hover:bg-muted transition-all"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
              Mapped: {mappedCount} field(s)
            </span>
            <button onClick={onClose}
              className="px-4 py-2.5 text-xs border border-border rounded-2xl hover:bg-muted font-bold transition-all">Cancel</button>
            <button onClick={() => onImport({ targetCat, dataStartRow, dataEndRow, startCol, endCol, colMapping, newFieldNames })}
              disabled={uploading || !targetCat || mappedCount === 0}
              className="px-5 py-2.5 text-xs bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-600/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]">
              {uploading ? 'Importing...' : 'Import to Category'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
