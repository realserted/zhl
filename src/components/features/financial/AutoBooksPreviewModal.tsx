'use client';

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const TEMPLATE_FIELDS = ['Date', 'Amount', 'Description', 'Category', 'Notes', 'Auto-Grouping'] as const;
export type TemplateField = typeof TEMPLATE_FIELDS[number];

export interface AutoBooksPreviewConfig {
  headerRow: number;
  dataStartRow: number;
  columnMapping: Record<number, TemplateField | 'skip' | string>;
}

interface AutoBooksPreviewModalProps {
  isOpen: boolean;
  fileName: string;
  rows: unknown[][];
  initialConfig: AutoBooksPreviewConfig;
  onClose: () => void;
  onUpload: (config: AutoBooksPreviewConfig) => void;
}

const PAGE_SIZE = 20;

export function AutoBooksPreviewModal({ isOpen, fileName, rows, initialConfig, onClose, onUpload }: AutoBooksPreviewModalProps) {
  const [headerRow, setHeaderRow] = useState(initialConfig.headerRow);
  const [dataStartRow, setDataStartRow] = useState(initialConfig.dataStartRow);
  const [columnMapping, setColumnMapping] = useState(initialConfig.columnMapping);
  const [page, setPage] = useState(0);

  // Reset when config changes (new file)
  const [lastFile, setLastFile] = useState(fileName);
  if (fileName !== lastFile) {
    setLastFile(fileName);
    setHeaderRow(initialConfig.headerRow);
    setDataStartRow(initialConfig.dataStartRow);
    setColumnMapping(initialConfig.columnMapping);
    setPage(0);
  }

  if (!isOpen || rows.length === 0) return null;

  const maxCols = Math.max(...rows.map((r) => r.length), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-bold">Preview &amp; Configure Upload</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fileName} — {rows.length} rows detected
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold whitespace-nowrap">Header row:</label>
            <input
              type="number"
              min={0}
              max={rows.length}
              value={headerRow}
              onChange={(e) => {
                const v = Math.max(0, Math.min(rows.length, parseInt(e.target.value) || 0));
                setHeaderRow(v);
                if (v >= dataStartRow) setDataStartRow(v + 1);
                setPage(0);
              }}
              className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
            />
            <span className="text-xs text-muted-foreground">(0 = none)</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold whitespace-nowrap">Data starts at row:</label>
            <input
              type="number"
              min={1}
              max={rows.length}
              value={dataStartRow}
              onChange={(e) => {
                const v = Math.max(1, Math.min(rows.length, parseInt(e.target.value) || 1));
                setDataStartRow(v);
                if (v >= 2) setHeaderRow(v - 1);
                setPage(0);
              }}
              className="w-16 px-2 py-1 bg-background border border-input rounded text-xs text-center"
            />
            <span className="text-xs text-muted-foreground">
              ({rows.length - dataStartRow + 1} data rows)
            </span>
          </div>
        </div>

        {/* Column mapping row */}
        <div className="px-5 py-2 border-b border-border overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            <div className="w-12 flex-shrink-0 text-xs font-semibold text-muted-foreground text-center">Row</div>
            {Array.from({ length: maxCols }, (_, colIdx) => {
              const hdrVal = headerRow >= 1 ? String(rows[headerRow - 1]?.[colIdx] ?? '').trim() : '';
              const currentVal = columnMapping[colIdx] ?? 'skip';
              const isCustom = currentVal !== 'skip' && !(TEMPLATE_FIELDS as readonly string[]).includes(currentVal);
              return (
                <div key={colIdx} className="w-32 flex-shrink-0">
                  {hdrVal && (
                    <div className="text-xs text-blue-400 font-medium truncate mb-0.5 px-1" title={hdrVal}>
                      {hdrVal}
                    </div>
                  )}
                  {isCustom ? (
                    <div className="flex gap-0.5">
                      <input
                        value={currentVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setColumnMapping((prev) => ({ ...prev, [colIdx]: val || 'skip' }));
                        }}
                        className="flex-1 min-w-0 px-1.5 py-1 border border-accent bg-accent/10 text-accent font-semibold rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Column name"
                      />
                      <button
                        onClick={() => setColumnMapping((prev) => ({ ...prev, [colIdx]: 'skip' }))}
                        className="px-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                        title="Clear"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <select
                      value={currentVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__custom__') {
                          setColumnMapping((prev) => ({ ...prev, [colIdx]: hdrVal || 'Custom' }));
                          return;
                        }
                        setColumnMapping((prev) => {
                          const next = { ...prev };
                          if (val !== 'skip' && (TEMPLATE_FIELDS as readonly string[]).includes(val)) {
                            for (const [k, v] of Object.entries(next)) {
                              if (v === val) next[Number(k)] = 'skip';
                            }
                          }
                          next[colIdx] = val;
                          return next;
                        });
                      }}
                      className={`w-full px-1.5 py-1 border rounded text-xs ${
                        currentVal !== 'skip'
                          ? 'border-accent bg-accent/10 text-accent font-semibold'
                          : 'border-input bg-background text-muted-foreground'
                      }`}
                    >
                      <option value="skip">— Skip —</option>
                      {TEMPLATE_FIELDS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      <option value="__custom__">Custom name...</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Data preview table */}
        <div className="flex-1 overflow-auto px-5 py-2">
          <div className="min-w-max">
            {(() => {
              const pageStart = page * PAGE_SIZE;
              const pageEnd = Math.min(pageStart + PAGE_SIZE, rows.length);
              const visibleRows = rows.slice(pageStart, pageEnd);

              return visibleRows.map((row, rIdx) => {
                const actualRowIdx = pageStart + rIdx;
                const isHeaderRowIdx = headerRow >= 1 && actualRowIdx === headerRow - 1;
                const isBeforeStart = actualRowIdx < dataStartRow - 1;
                const isStartRow = actualRowIdx === dataStartRow - 1;

                return (
                  <div
                    key={actualRowIdx}
                    className={`flex items-center gap-1 ${
                      isHeaderRowIdx
                        ? 'bg-blue-500/10 font-semibold'
                        : isBeforeStart
                        ? 'opacity-40 bg-amber-500/5'
                        : isStartRow
                        ? 'bg-accent/10 border-l-2 border-accent'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <div
                      className={`w-12 flex-shrink-0 text-xs text-center py-1 cursor-pointer hover:text-accent font-mono ${
                        isHeaderRowIdx ? 'text-blue-500 font-bold' : isStartRow ? 'text-accent font-bold' : 'text-muted-foreground'
                      }`}
                      onClick={() => { setDataStartRow(actualRowIdx + 1); if (actualRowIdx >= 1) setHeaderRow(actualRowIdx); setPage(0); }}
                      title={`Click to set data start at row ${actualRowIdx + 1}`}
                    >
                      {actualRowIdx + 1}
                    </div>
                    {Array.from({ length: maxCols }, (_, cIdx) => {
                      const val = row[cIdx];
                      const mapped = columnMapping[cIdx];
                      const isMapped = mapped && mapped !== 'skip';
                      return (
                        <div
                          key={cIdx}
                          className={`w-32 flex-shrink-0 px-1.5 py-1 text-xs truncate border-r border-border/30 ${
                            isMapped && !isBeforeStart ? 'font-medium' : ''
                          }`}
                          title={String(val ?? '')}
                        >
                          {val != null && val !== '' ? String(val) : <span className="text-muted-foreground/30">-</span>}
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
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-muted-foreground">
              Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <button
              disabled={(page + 1) * PAGE_SIZE >= rows.length}
              onClick={() => setPage((p) => p + 1)}
              className="p-1 rounded border border-input text-xs disabled:opacity-30 hover:bg-muted"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Mapped: {Object.values(columnMapping).filter((v) => v !== 'skip').length}/{maxCols} fields
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-input rounded hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => onUpload({ headerRow, dataStartRow, columnMapping })}
              disabled={!Object.values(columnMapping).some((v) => v !== 'skip')}
              className="px-4 py-1.5 text-xs bg-accent text-white rounded font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              Upload {rows.length - dataStartRow + 1} rows
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
