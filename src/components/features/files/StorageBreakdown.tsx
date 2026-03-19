'use client';

import { useMemo } from 'react';
import { FileText, Folder, HardDrive } from 'lucide-react';
import type { DriveItem } from '@/lib/types/files';
import type { FileTreeNode } from '@/lib/types/files';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function flattenTree(nodes: FileTreeNode[]): DriveItem[] {
  const result: DriveItem[] = [];
  for (const n of nodes) {
    if (!n.item.isFolder && n.item.size) {
      result.push(n.item);
    }
    result.push(...flattenTree(n.children));
  }
  return result;
}

// Color by file type
function getTypeColor(mime: string | null): string {
  if (!mime) return 'bg-gray-500';
  if (mime.startsWith('image/')) return 'bg-blue-500';
  if (mime.startsWith('video/')) return 'bg-purple-500';
  if (mime === 'application/pdf') return 'bg-red-500';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'bg-green-500';
  if (mime.includes('document') || mime.includes('word')) return 'bg-blue-400';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'bg-orange-500';
  if (mime.startsWith('text/') || mime === 'application/json') return 'bg-gray-400';
  return 'bg-gray-500';
}

function getTypeLabel(mime: string | null): string {
  if (!mime) return 'Other';
  if (mime.startsWith('image/')) return 'Images';
  if (mime.startsWith('video/')) return 'Videos';
  if (mime === 'application/pdf') return 'PDFs';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Spreadsheets';
  if (mime.includes('document') || mime.includes('word')) return 'Documents';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'Presentations';
  if (mime.startsWith('text/') || mime === 'application/json') return 'Text';
  return 'Other';
}

interface StorageBreakdownProps {
  tree: FileTreeNode[];
  onSelectFile?: (item: DriveItem) => void;
}

export function StorageBreakdown({ tree, onSelectFile }: StorageBreakdownProps) {
  const allFiles = useMemo(() => flattenTree(tree), [tree]);

  const sortedFiles = useMemo(
    () => [...allFiles].sort((a, b) => (b.size || 0) - (a.size || 0)),
    [allFiles],
  );

  const totalSize = useMemo(
    () => allFiles.reduce((sum, f) => sum + (f.size || 0), 0),
    [allFiles],
  );

  // Group by type for summary
  const typeBreakdown = useMemo(() => {
    const map = new Map<string, { label: string; color: string; size: number; count: number }>();
    for (const f of allFiles) {
      const label = getTypeLabel(f.mimeType);
      const color = getTypeColor(f.mimeType);
      const existing = map.get(label);
      if (existing) {
        existing.size += f.size || 0;
        existing.count += 1;
      } else {
        map.set(label, { label, color, size: f.size || 0, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.size - a.size);
  }, [allFiles]);

  if (allFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <HardDrive className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">No files to analyze.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Expand folders in the file tree first.</p>
      </div>
    );
  }

  const maxSize = sortedFiles[0]?.size || 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold tracking-tight">Storage Breakdown</span>
          </div>
          <span className="text-xs font-bold text-primary">{formatBytes(totalSize)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{allFiles.length} files</p>
      </div>

      {/* Type breakdown bar */}
      <div className="px-4 py-3 border-b border-border/40 space-y-2">
        <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
          {typeBreakdown.map((t) => (
            <div
              key={t.label}
              className={`${t.color} transition-all`}
              style={{ width: `${Math.max((t.size / totalSize) * 100, 1)}%` }}
              title={`${t.label}: ${formatBytes(t.size)} (${t.count} files)`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {typeBreakdown.map((t) => (
            <div key={t.label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${t.color}`} />
              <span className="text-[10px] text-muted-foreground font-medium">
                {t.label} <span className="font-bold text-foreground">{formatBytes(t.size)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* File list sorted by size */}
      <div className="flex-1 overflow-y-auto">
        {sortedFiles.map((file) => {
          const pct = ((file.size || 0) / maxSize) * 100;
          return (
            <button
              key={file.id}
              onClick={() => onSelectFile?.(file)}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors text-left group"
            >
              <div className="p-1 rounded shrink-0 bg-muted/30">
                {file.isFolder
                  ? <Folder className="h-3.5 w-3.5 text-amber-500" />
                  : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">{file.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getTypeColor(file.mimeType)} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground shrink-0 w-16 text-right">
                    {formatBytes(file.size || 0)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
