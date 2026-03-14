'use client';

import { useState, useMemo } from 'react';
import {
  Search, Folder, FolderOpen, FileText, Image, File, ChevronRight, Loader2,
  FileSpreadsheet, Presentation, Video,
} from 'lucide-react';
import type { FileTreeNode } from '@/lib/types/files';
import type { ProjectFileFolderPermissions, ProjectFileItemPermissions } from '@/lib/types/files';

// ── MIME constants ───────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';

const WORD_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];
const EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const PPTX_MIMES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];

// ── Permission columns ───────────────────────────────────────────────────────

type PermissionKey =
  | 'allow_all_users'
  | 'allow_project_manager'
  | 'allow_property_manager'
  | 'allow_accountant'
  | 'allow_anyone_with_link'
  | 'link_enabled';

const PERM_COLUMNS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'allow_all_users', label: 'All Users' },
  { key: 'allow_project_manager', label: 'Project Manager' },
  { key: 'allow_property_manager', label: 'Property Manager' },
  { key: 'allow_accountant', label: 'Accountant' },
  { key: 'allow_anyone_with_link', label: 'Anyone with Link' },
  { key: 'link_enabled', label: 'Link' },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface FileTreePanelProps {
  tree: FileTreeNode[];
  loading: boolean;
  error: string | null;
  selectedId?: string;
  loadingId?: string;
  onToggleFolder: (nodeId: string) => void;
  onSelectFile: (node: FileTreeNode) => void;
  // Permissions
  showPermissions?: boolean;
  canManagePermissions?: boolean;
  folderPermissions?: Map<string, ProjectFileFolderPermissions>;
  filePermissions?: Map<string, ProjectFileItemPermissions>;
  onToggleFolderPermission?: (folderId: string, key: PermissionKey) => void;
  onToggleFilePermission?: (fileId: string, key: PermissionKey) => void;
}

// ── Search filter ────────────────────────────────────────────────────────────

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();
  return nodes.reduce<FileTreeNode[]>((acc, node) => {
    const nameMatch = node.item.name.toLowerCase().includes(lower);
    const filteredChildren = filterTree(node.children, query);
    if (nameMatch || filteredChildren.length > 0) {
      acc.push({
        ...node,
        children: filteredChildren,
        isExpanded: filteredChildren.length > 0 ? true : node.isExpanded,
      });
    }
    return acc;
  }, []);
}

// ── MIME-based icon ──────────────────────────────────────────────────────────

function getMimeIcon(mimeType: string | null) {
  if (!mimeType) return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
  if (mimeType === DOC_MIME || WORD_MIMES.includes(mimeType)) return <FileText className="h-4 w-4 text-blue-500 shrink-0" />;
  if (mimeType === SHEET_MIME || EXCEL_MIMES.includes(mimeType)) return <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (mimeType === SLIDES_MIME || PPTX_MIMES.includes(mimeType)) return <Presentation className="h-4 w-4 text-amber-500 shrink-0" />;
  if (mimeType === 'application/pdf') return <FileText className="h-4 w-4 text-red-400 shrink-0" />;
  if (mimeType.startsWith('image/')) return <Image className="h-4 w-4 text-purple-400 shrink-0" />;
  if (mimeType.startsWith('video/')) return <Video className="h-4 w-4 text-pink-400 shrink-0" />;
  return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

// ── Tree node component ──────────────────────────────────────────────────────

function TreeNode({
  node, depth = 0, selectedId, loadingId, onToggleFolder, onSelectFile,
  showPermissions, canManagePermissions, folderPermissions, filePermissions,
  onToggleFolderPermission, onToggleFilePermission,
}: {
  node: FileTreeNode;
  depth?: number;
  selectedId?: string;
  loadingId?: string;
  onToggleFolder: (nodeId: string) => void;
  onSelectFile: (node: FileTreeNode) => void;
  showPermissions?: boolean;
  canManagePermissions?: boolean;
  folderPermissions?: Map<string, ProjectFileFolderPermissions>;
  filePermissions?: Map<string, ProjectFileItemPermissions>;
  onToggleFolderPermission?: (folderId: string, key: PermissionKey) => void;
  onToggleFilePermission?: (fileId: string, key: PermissionKey) => void;
}) {
  const isFolder = node.item.mimeType === FOLDER_MIME;
  const isSelected = selectedId === node.item.id;
  const isLoading = loadingId === node.item.id;

  const perms = isFolder
    ? folderPermissions?.get(node.item.id)
    : filePermissions?.get(node.item.id);

  return (
    <div>
      <div className={`flex items-center ${
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
      } transition-colors`}>
        {/* Permission checkboxes */}
        {showPermissions && (
          <div className="flex items-center shrink-0">
            {PERM_COLUMNS.map((col) => (
              <div key={col.key} className="w-[30px] flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={Boolean(perms?.[col.key as keyof typeof perms])}
                  disabled={!canManagePermissions}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (isFolder) {
                      onToggleFolderPermission?.(node.item.id, col.key);
                    } else {
                      onToggleFilePermission?.(node.item.id, col.key);
                    }
                  }}
                  className="rounded border-border h-3 w-3 text-primary focus:ring-primary/20 cursor-pointer"
                />
              </div>
            ))}
          </div>
        )}

        {/* Tree node button */}
        <button
          onClick={() => isFolder ? onToggleFolder(node.item.id) : onSelectFile(node)}
          className={`flex flex-1 items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm min-w-0 ${
            isSelected ? 'text-primary font-medium' : 'text-foreground/80'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isFolder ? (
            isLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  node.isExpanded ? 'rotate-90' : ''
                }`}
              />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {isFolder ? (
            node.isExpanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-amber-500" />
            )
          ) : (
            getMimeIcon(node.item.mimeType)
          )}

          <span className="truncate text-[13px]">{node.item.name}</span>
        </button>
      </div>

      {/* Children */}
      {isFolder && node.isExpanded && node.children.length > 0 && (
        <div className="overflow-hidden">
          {node.children.map((child) => (
            <TreeNode
              key={child.item.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              loadingId={loadingId}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              showPermissions={showPermissions}
              canManagePermissions={canManagePermissions}
              folderPermissions={folderPermissions}
              filePermissions={filePermissions}
              onToggleFolderPermission={onToggleFolderPermission}
              onToggleFilePermission={onToggleFilePermission}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function FileTreePanel({
  tree, loading, error, selectedId, loadingId, onToggleFolder, onSelectFile,
  showPermissions, canManagePermissions, folderPermissions, filePermissions,
  onToggleFolderPermission, onToggleFilePermission,
}: FileTreePanelProps) {
  const [search, setSearch] = useState('');

  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search]);

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b border-border/40 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="h-9 w-full rounded-xl border border-border/30 bg-background/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
          />
        </div>
      </div>

      {/* Permission column headers */}
      {showPermissions && (
        <div className="flex items-end border-b border-border/40 bg-muted/20 shrink-0">
          <div className="flex items-end shrink-0">
            {PERM_COLUMNS.map((col) => (
              <div key={col.key} className="w-[30px] flex items-end justify-center pb-2" style={{ height: '120px' }}>
                <span
                  className="text-[9px] font-bold tracking-wider uppercase text-foreground/70 whitespace-nowrap"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {col.label}
                </span>
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-end pb-2 pl-2">
            <span className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground">Name</span>
          </div>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && tree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground font-medium">Loading your Drive...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : filteredTree.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Folder className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground font-medium">
              {search ? 'No files match your search' : 'No files found'}
            </p>
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeNode
              key={node.item.id}
              node={node}
              selectedId={selectedId}
              loadingId={loadingId}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              showPermissions={showPermissions}
              canManagePermissions={canManagePermissions}
              folderPermissions={folderPermissions}
              filePermissions={filePermissions}
              onToggleFolderPermission={onToggleFolderPermission}
              onToggleFilePermission={onToggleFilePermission}
            />
          ))
        )}
      </div>
    </div>
  );
}
