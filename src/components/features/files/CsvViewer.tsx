'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Save, Plus, Trash2, Undo2, Redo2 } from 'lucide-react';

interface CsvViewerProps {
  content: string;
  fileName?: string;
  onSave?: (csv: string) => Promise<{ ok: boolean; error?: string }>;
}

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

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(data: string[][]): string {
  return data.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function colLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

interface CellRef {
  row: number;
  col: number;
}

export function CsvViewer({ content, fileName, onSave }: CsvViewerProps) {
  const [data, setData] = useState<string[][]>(() => parseCsv(content));
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellRef | null>({ row: 0, col: 0 });
  const [history, setHistory] = useState<string[][][]>([]);
  const [future, setFuture] = useState<string[][][]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const formulaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setData(parseCsv(content));
    setDirty(false);
    setHistory([]);
    setFuture([]);
  }, [content]);

  const maxCols = Math.max(data.reduce((max, row) => Math.max(max, row.length), 0), 10);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-50), data.map((r) => [...r])]);
    setFuture([]);
  }, [data]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setFuture((prev) => [data.map((r) => [...r]), ...prev]);
    setData(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
    setDirty(true);
  }, [data, history]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setHistory((prev) => [...prev, data.map((r) => [...r])]);
    setData(future[0]);
    setFuture((prev) => prev.slice(1));
    setDirty(true);
  }, [data, future]);

  const updateCell = useCallback((row: number, col: number, value: string) => {
    pushHistory();
    setData((prev) => {
      const next = prev.map((r) => [...r]);
      while (next[row].length <= col) next[row].push('');
      next[row][col] = value;
      return next;
    });
    setDirty(true);
  }, [pushHistory]);

  const addRow = useCallback(() => {
    pushHistory();
    setData((prev) => [...prev, Array(maxCols).fill('')]);
    setDirty(true);
  }, [maxCols, pushHistory]);

  const deleteRow = useCallback((rowIdx: number) => {
    pushHistory();
    setData((prev) => prev.filter((_, i) => i !== rowIdx));
    setDirty(true);
    setSelectedCell(null);
    setEditing(null);
  }, [pushHistory]);

  const addColumn = useCallback(() => {
    pushHistory();
    setData((prev) => prev.map((row) => [...row, '']));
    setDirty(true);
  }, [pushHistory]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    setSaveStatus(null);
    const csv = toCsv(data);
    const result = await onSave(csv);
    if (result.ok) {
      setSaveStatus('Saved!');
      setDirty(false);
      setTimeout(() => setSaveStatus(null), 2000);
    } else {
      setSaveStatus(result.error || 'Failed to save');
    }
    setSaving(false);
  }, [data, onSave]);

  const startEditing = useCallback((row: number, col: number) => {
    setEditing({ row, col });
    setSelectedCell({ row, col });
  }, []);

  const stopEditing = useCallback(() => {
    setEditing(null);
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const selectedValue = selectedCell ? (data[selectedCell.row]?.[selectedCell.col] ?? '') : '';
  const cellRef = selectedCell ? `${colLabel(selectedCell.col)}${selectedCell.row + 1}` : '';

  const sheetName = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Sheet1';

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0e0e0e]">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 border-b border-[#e1e3e6] dark:border-[#333] px-2 py-1 bg-[#f3f3f3] dark:bg-[#1a1a1a] shrink-0">
        {onSave && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            title="Save"
            className="p-1.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving ? (
              <div className="h-4 w-4 border-2 border-[#444] dark:border-[#999] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="h-4 w-4 text-[#444] dark:text-[#999]" />
            )}
          </button>
        )}

        <button onClick={undo} disabled={history.length === 0} title="Undo" className="p-1.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#333] disabled:opacity-30">
          <Undo2 className="h-4 w-4 text-[#444] dark:text-[#999]" />
        </button>
        <button onClick={redo} disabled={future.length === 0} title="Redo" className="p-1.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#333] disabled:opacity-30">
          <Redo2 className="h-4 w-4 text-[#444] dark:text-[#999]" />
        </button>

        <div className="h-5 w-px bg-[#dadce0] dark:bg-[#444] mx-1" />

        <button onClick={addRow} title="Add Row" className="p-1.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#333] flex items-center gap-1">
          <Plus className="h-3.5 w-3.5 text-[#444] dark:text-[#999]" />
          <span className="text-[11px] text-[#444] dark:text-[#999] font-medium">Row</span>
        </button>
        <button onClick={addColumn} title="Add Column" className="p-1.5 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#333] flex items-center gap-1">
          <Plus className="h-3.5 w-3.5 text-[#444] dark:text-[#999]" />
          <span className="text-[11px] text-[#444] dark:text-[#999] font-medium">Col</span>
        </button>

        {selectedCell && (
          <>
            <div className="h-5 w-px bg-[#dadce0] dark:bg-[#444] mx-1" />
            <button
              onClick={() => deleteRow(selectedCell.row)}
              title="Delete Row"
              className="p-1.5 rounded hover:bg-[#fce8e6] dark:hover:bg-[#3a1a1a] flex items-center gap-1"
            >
              <Trash2 className="h-3.5 w-3.5 text-[#c5221f] dark:text-[#f28b82]" />
              <span className="text-[11px] text-[#c5221f] dark:text-[#f28b82] font-medium">Row</span>
            </button>
          </>
        )}

        {saveStatus && (
          <span className={`ml-auto text-[11px] font-bold px-2 ${
            saveStatus === 'Saved!' ? 'text-[#188038]' : 'text-[#c5221f]'
          }`}>
            {saveStatus}
          </span>
        )}
        {dirty && !saveStatus && (
          <span className="ml-auto text-[11px] text-[#e37400] font-medium px-2">Unsaved changes</span>
        )}
      </div>

      {/* ── Formula bar ── */}
      <div className="flex items-center border-b border-[#e1e3e6] dark:border-[#333] shrink-0">
        {/* Cell reference */}
        <div className="w-16 shrink-0 border-r border-[#e1e3e6] dark:border-[#333] px-2 py-1 bg-[#f8f9fa] dark:bg-[#1a1a1a]">
          <span className="text-[12px] font-medium text-[#222] dark:text-[#ccc] select-none">{cellRef}</span>
        </div>
        {/* fx icon */}
        <div className="px-2 text-[13px] italic text-[#999] dark:text-[#666] select-none shrink-0">fx</div>
        {/* Formula / value input */}
        <input
          ref={formulaRef}
          type="text"
          value={selectedValue}
          onChange={(e) => {
            if (selectedCell) updateCell(selectedCell.row, selectedCell.col, e.target.value);
          }}
          onFocus={() => {
            if (selectedCell) setEditing(selectedCell);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              formulaRef.current?.blur();
              stopEditing();
            }
          }}
          className="flex-1 text-[13px] px-1 py-1.5 bg-white dark:bg-[#0e0e0e] text-[#222] dark:text-[#ddd] outline-none border-none"
          readOnly={!onSave}
        />
      </div>

      {/* ── Spreadsheet grid ── */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-[13px] font-sans w-full" style={{ minWidth: maxCols * 100 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-[#f8f9fa] dark:bg-[#1a1a1a] border border-[#e1e3e6] dark:border-[#333] px-1 py-1 text-[11px] font-medium text-[#666] dark:text-[#888] text-center w-[46px] min-w-[46px]" />
              {Array.from({ length: maxCols }, (_, i) => {
                const isSelectedCol = selectedCell?.col === i;
                return (
                  <th
                    key={i}
                    className={`border border-[#e1e3e6] dark:border-[#333] px-2 py-1 text-[11px] font-medium text-center min-w-[80px] ${
                      isSelectedCol
                        ? 'bg-[#d3e3fd] dark:bg-[#1a3050] text-[#174ea6] dark:text-[#8ab4f8]'
                        : 'bg-[#f8f9fa] dark:bg-[#1a1a1a] text-[#666] dark:text-[#888]'
                    }`}
                  >
                    {colLabel(i)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => {
              const isSelectedRow = selectedCell?.row === rowIdx;
              return (
                <tr key={rowIdx}>
                  {/* Row number */}
                  <td
                    className={`border border-[#e1e3e6] dark:border-[#333] px-1 py-0.5 text-[11px] font-medium text-center sticky left-0 z-[5] ${
                      isSelectedRow
                        ? 'bg-[#d3e3fd] dark:bg-[#1a3050] text-[#174ea6] dark:text-[#8ab4f8]'
                        : 'bg-[#f8f9fa] dark:bg-[#1a1a1a] text-[#666] dark:text-[#888]'
                    }`}
                  >
                    {rowIdx + 1}
                  </td>
                  {Array.from({ length: maxCols }, (_, colIdx) => {
                    const value = row[colIdx] ?? '';
                    const isNumeric = value !== '' && !isNaN(Number(value));
                    const isEditing = editing?.row === rowIdx && editing?.col === colIdx;
                    const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;

                    return (
                      <td
                        key={colIdx}
                        className={`border p-0 text-[13px] text-[#222] dark:text-[#ddd] ${
                          isSelected
                            ? 'border-2 border-[#1a73e8] dark:border-[#8ab4f8]'
                            : 'border-[#e1e3e6] dark:border-[#333]'
                        }`}
                        onClick={() => {
                          setSelectedCell({ row: rowIdx, col: colIdx });
                          if (onSave) startEditing(rowIdx, colIdx);
                        }}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)}
                            onBlur={stopEditing}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                stopEditing();
                                if (rowIdx < data.length - 1) startEditing(rowIdx + 1, colIdx);
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                stopEditing();
                                if (colIdx < maxCols - 1) startEditing(rowIdx, colIdx + 1);
                                else if (rowIdx < data.length - 1) startEditing(rowIdx + 1, 0);
                              } else if (e.key === 'Escape') {
                                stopEditing();
                              }
                            }}
                            className={`w-full h-full bg-white dark:bg-[#1a1a2e] outline-none px-2 py-[3px] text-[13px] ${
                              isNumeric ? 'text-right font-mono' : 'text-left'
                            }`}
                          />
                        ) : (
                          <div
                            className={`px-2 py-[3px] whitespace-nowrap min-h-[26px] cursor-cell ${
                              isNumeric ? 'text-right font-mono' : 'text-left'
                            }`}
                          >
                            {value}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Sheet tab bar ── */}
      <div className="flex items-center border-t border-[#e1e3e6] dark:border-[#333] bg-[#f8f9fa] dark:bg-[#1a1a1a] shrink-0">
        <button className="px-2 py-1.5 text-[#444] dark:text-[#888] hover:bg-[#e0e0e0] dark:hover:bg-[#333]" title="Add sheet" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
        </button>
        <div className="h-5 w-px bg-[#dadce0] dark:bg-[#444]" />
        <div className="flex items-center">
          <div className="px-4 py-1.5 text-[12px] font-medium text-[#222] dark:text-[#ddd] bg-white dark:bg-[#0e0e0e] border-t-[3px] border-t-[#0b8043] dark:border-t-[#34a853] border-x border-[#e1e3e6] dark:border-[#333] cursor-default">
            {sheetName}
          </div>
        </div>
      </div>
    </div>
  );
}
