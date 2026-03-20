'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Save, Plus, Trash2, Undo2, Loader2 } from 'lucide-react';
import { Button } from '@/components/shared/Button';

// ── CSV parsing / serializing ───────────────────────────────────────────────

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }

  // Last row
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function serializeCsv(data: string[][]): string {
  return data
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(',')
    )
    .join('\n');
}

// ── Component ───────────────────────────────────────────────────────────────

interface CsvEditorProps {
  initialContent: string;
  onSave: (content: string) => Promise<{ ok: boolean; error?: string }>;
  readOnly?: boolean;
}

export function CsvEditor({ initialContent, onSave, readOnly }: CsvEditorProps) {
  const [data, setData] = useState<string[][]>(() => parseCsv(initialContent));
  const [originalData] = useState<string[][]>(() => parseCsv(initialContent));
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Normalize column count
  const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0) || 1;

  const hasChanges = serializeCsv(data) !== serializeCsv(originalData);

  const updateCell = useCallback((r: number, c: number, value: string) => {
    setData((prev) => {
      const next = prev.map((row) => [...row]);
      // Ensure row has enough columns
      while (next[r].length <= c) next[r].push('');
      next[r][c] = value;
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setData((prev) => [...prev, new Array(maxCols).fill('')]);
  }, [maxCols]);

  const addColumn = useCallback(() => {
    setData((prev) => prev.map((row) => [...row, '']));
  }, []);

  const deleteRow = useCallback((r: number) => {
    setData((prev) => prev.filter((_, i) => i !== r));
  }, []);

  const deleteColumn = useCallback((c: number) => {
    setData((prev) => prev.map((row) => row.filter((_, i) => i !== c)));
  }, []);

  const handleUndo = useCallback(() => {
    setData(originalData.map((row) => [...row]));
    setSaveStatus(null);
  }, [originalData]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const csv = serializeCsv(data);
      const result = await onSave(csv);
      if (result.ok) {
        setSaveStatus('Saved!');
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        setSaveStatus(result.error || 'Failed to save');
      }
    } catch {
      setSaveStatus('Failed to save');
    } finally {
      setSaving(false);
    }
  }, [data, onSave]);

  // Focus input when editing
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, r: number, c: number) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const nextC = e.shiftKey ? c - 1 : c + 1;
        if (nextC >= 0 && nextC < maxCols) {
          setEditingCell({ r, c: nextC });
        } else if (!e.shiftKey && r + 1 < data.length) {
          setEditingCell({ r: r + 1, c: 0 });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (r + 1 < data.length) {
          setEditingCell({ r: r + 1, c });
        } else {
          setEditingCell(null);
        }
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      }
    },
    [maxCols, data.length]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2 bg-muted/20 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            isLoading={saving}
            className="gap-1.5 text-[11px] font-bold"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={!hasChanges}
            className="gap-1.5 text-[11px] font-bold shadow-none"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reset
          </Button>
          <div className="h-4 w-px bg-border/40 mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={addRow}
            className="gap-1 text-[11px] font-bold shadow-none"
          >
            <Plus className="h-3 w-3" />
            Row
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={addColumn}
            className="gap-1 text-[11px] font-bold shadow-none"
          >
            <Plus className="h-3 w-3" />
            Column
          </Button>
          {saveStatus && (
            <span
              className={`ml-auto text-[11px] font-bold ${
                saveStatus === 'Saved!' ? 'text-green-500' : 'text-red-400'
              }`}
            >
              {saveStatus}
            </span>
          )}
          {hasChanges && !saveStatus && (
            <span className="ml-auto text-[11px] text-amber-500 font-medium">Unsaved changes</span>
          )}
        </div>
      )}

      {/* Spreadsheet */}
      <div ref={tableRef} className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/50 backdrop-blur-sm">
              {/* Row number header */}
              <th className="w-10 border border-border/30 bg-muted/80 px-2 py-1.5 text-[10px] font-bold text-muted-foreground text-center sticky left-0 z-20">
                #
              </th>
              {Array.from({ length: maxCols }, (_, c) => (
                <th
                  key={c}
                  className="border border-border/30 bg-muted/80 px-2 py-1.5 text-[10px] font-bold text-muted-foreground text-left min-w-[100px] group"
                >
                  <div className="flex items-center justify-between">
                    <span>{String.fromCharCode(65 + (c % 26))}{c >= 26 ? String.fromCharCode(65 + Math.floor(c / 26) - 1) : ''}</span>
                    {!readOnly && (
                      <button
                        onClick={() => deleteColumn(c)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 transition-all"
                        title="Delete column"
                      >
                        <Trash2 className="h-3 w-3 text-destructive/60" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => (
              <tr key={r} className="group/row hover:bg-muted/10">
                {/* Row number */}
                <td className="border border-border/30 bg-muted/30 px-2 py-1 text-[10px] font-bold text-muted-foreground text-center sticky left-0 z-10">
                  <div className="flex items-center justify-center gap-1">
                    <span>{r + 1}</span>
                    {!readOnly && (
                      <button
                        onClick={() => deleteRow(r)}
                        className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-destructive/10 transition-all"
                        title="Delete row"
                      >
                        <Trash2 className="h-2.5 w-2.5 text-destructive/60" />
                      </button>
                    )}
                  </div>
                </td>
                {Array.from({ length: maxCols }, (_, c) => {
                  const value = row[c] ?? '';
                  const isEditing = editingCell?.r === r && editingCell?.c === c;
                  const isHeader = r === 0;

                  return (
                    <td
                      key={c}
                      className={`border border-border/30 px-0 py-0 ${
                        isHeader ? 'bg-muted/20 font-semibold' : ''
                      } ${isEditing ? 'ring-2 ring-primary ring-inset' : ''}`}
                      onClick={() => !readOnly && setEditingCell({ r, c })}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={value}
                          onChange={(e) => updateCell(r, c, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, r, c)}
                          onBlur={() => setEditingCell(null)}
                          className="w-full px-2 py-1.5 bg-background text-sm outline-none"
                        />
                      ) : (
                        <div className="px-2 py-1.5 truncate min-h-[32px] cursor-default" title={value}>
                          {value}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="shrink-0 border-t border-border/40 px-3 py-1.5 bg-muted/20 flex items-center gap-4 text-[10px] text-muted-foreground font-medium">
        <span>{data.length} rows</span>
        <span>{maxCols} columns</span>
        {editingCell && (
          <span>
            Editing: {String.fromCharCode(65 + (editingCell.c % 26))}{editingCell.r + 1}
          </span>
        )}
      </div>
    </div>
  );
}
