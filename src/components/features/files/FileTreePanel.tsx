'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Search, Folder, FolderOpen, FileText, Image, File, ChevronRight, Loader2,
  FileSpreadsheet, Presentation, Video, GripVertical,
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
  rootFolderId?: string;
  onToggleFolder: (nodeId: string) => void;
  onSelectFile: (node: FileTreeNode) => void;
  onMoveItem?: (fileId: string, fromFolderId: string, toFolderId: string) => Promise<void>;
  onReorderItem?: (dragId: string, targetId: string, position: 'before' | 'after', parentFolderId: string) => void;
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

// ── Drag state ───────────────────────────────────────────────────────────────

interface DragState {
  dragId: string | null;
  dragParentId: string | null;
  /** For folder-drop (move into folder) */
  dropFolderId: string | null;
  /** For reorder-drop (insert before/after a sibling) */
  dropInsert: { targetId: string; position: 'before' | 'after' } | null;
}

const EMPTY_DRAG: DragState = { dragId: null, dragParentId: null, dropFolderId: null, dropInsert: null };

// ── Tree node component ──────────────────────────────────────────────────────

function TreeNode({
  node, depth = 0, selectedId, loadingId, parentId, onToggleFolder, onSelectFile,
  showPermissions, canManagePermissions, folderPermissions, filePermissions,
  onToggleFolderPermission, onToggleFilePermission,
  dragState, setDragState, onDropFolder, onDropReorder,
}: {
  node: FileTreeNode;
  depth?: number;
  selectedId?: string;
  loadingId?: string;
  parentId?: string;
  onToggleFolder: (nodeId: string) => void;
  onSelectFile: (node: FileTreeNode) => void;
  showPermissions?: boolean;
  canManagePermissions?: boolean;
  folderPermissions?: Map<string, ProjectFileFolderPermissions>;
  filePermissions?: Map<string, ProjectFileItemPermissions>;
  onToggleFolderPermission?: (folderId: string, key: PermissionKey) => void;
  onToggleFilePermission?: (fileId: string, key: PermissionKey) => void;
  dragState: DragState;
  setDragState: React.Dispatch<React.SetStateAction<DragState>>;
  onDropFolder: (targetFolderId: string) => void;
  onDropReorder: (targetId: string, position: 'before' | 'after', parentFolderId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isFolder = node.item.mimeType === FOLDER_MIME;
  const isSelected = selectedId === node.item.id;
  const isLoading = loadingId === node.item.id;
  const isDragging = dragState.dragId === node.item.id;
  const isDropFolder = isFolder && dragState.dropFolderId === node.item.id && dragState.dragId !== node.item.id;
  const insertBefore = dragState.dropInsert?.targetId === node.item.id && dragState.dropInsert?.position === 'before';
  const insertAfter = dragState.dropInsert?.targetId === node.item.id && dragState.dropInsert?.position === 'after';

  const perms = isFolder
    ? folderPermissions?.get(node.item.id)
    : filePermissions?.get(node.item.id);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dragState.dragId || dragState.dragId === node.item.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    if (isFolder && y > height * 0.25 && y < height * 0.75) {
      // Middle zone of a folder → drop INTO the folder
      setDragState((prev) => ({ ...prev, dropFolderId: node.item.id, dropInsert: null }));
    } else if (y < height * 0.5) {
      // Top half → insert before
      setDragState((prev) => ({ ...prev, dropFolderId: null, dropInsert: { targetId: node.item.id, position: 'before' } }));
    } else {
      // Bottom half → insert after
      setDragState((prev) => ({ ...prev, dropFolderId: null, dropInsert: { targetId: node.item.id, position: 'after' } }));
    }
  }, [dragState.dragId, node.item.id, isFolder, setDragState]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragState.dragId || dragState.dragId === node.item.id) return;

    if (dragState.dropFolderId === node.item.id) {
      onDropFolder(node.item.id);
    } else if (dragState.dropInsert?.targetId === node.item.id && parentId) {
      onDropReorder(node.item.id, dragState.dropInsert.position, parentId);
    }
  }, [dragState, node.item.id, parentId, onDropFolder, onDropReorder]);

  return (
    <div className="relative">
      {/* Insert-before indicator */}
      {insertBefore && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-20 pointer-events-none" style={{ marginLeft: `${depth * 16 + 8}px` }}>
          <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-primary" />
        </div>
      )}

      <div
        ref={rowRef}
        className={`flex items-center transition-colors group ${
          isDropFolder
            ? 'bg-primary/20 ring-1 ring-inset ring-primary/40'
            : isDragging
              ? 'opacity-40'
              : isSelected
                ? 'bg-primary/10'
                : 'hover:bg-muted/50'
        }`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.item.id);
          // Small delay so browser captures the drag image before we dim
          requestAnimationFrame(() => {
            setDragState({ dragId: node.item.id, dragParentId: parentId || null, dropFolderId: null, dropInsert: null });
          });
        }}
        onDragEnd={() => setDragState(EMPTY_DRAG)}
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragState((prev) => ({
            ...prev,
            dropFolderId: prev.dropFolderId === node.item.id ? null : prev.dropFolderId,
            dropInsert: prev.dropInsert?.targetId === node.item.id ? null : prev.dropInsert,
          }));
        }}
        onDrop={handleDrop}
      >
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

        {/* Drag handle */}
        <div className="shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing pl-1" style={{ marginLeft: `${depth * 16}px` }}>
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        {/* Tree node button */}
        <button
          onClick={() => isFolder ? onToggleFolder(node.item.id) : onSelectFile(node)}
          className={`flex flex-1 items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm min-w-0 ${
            isSelected ? 'text-primary font-medium' : 'text-foreground/80'
          }`}
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

      {/* Insert-after indicator */}
      {insertAfter && !(isFolder && node.isExpanded && node.children.length > 0) && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-20 pointer-events-none" style={{ marginLeft: `${depth * 16 + 8}px` }}>
          <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-primary" />
        </div>
      )}

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
              parentId={node.item.id}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              showPermissions={showPermissions}
              canManagePermissions={canManagePermissions}
              folderPermissions={folderPermissions}
              filePermissions={filePermissions}
              onToggleFolderPermission={onToggleFolderPermission}
              onToggleFilePermission={onToggleFilePermission}
              dragState={dragState}
              setDragState={setDragState}
              onDropFolder={onDropFolder}
              onDropReorder={onDropReorder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function FileTreePanel({
  tree, loading, error, selectedId, loadingId, rootFolderId, onToggleFolder, onSelectFile, onMoveItem, onReorderItem,
  showPermissions, canManagePermissions, folderPermissions, filePermissions,
  onToggleFolderPermission, onToggleFilePermission,
}: FileTreePanelProps) {
  const [search, setSearch] = useState('');
  const [dragState, setDragState] = useState<DragState>(EMPTY_DRAG);

  const filteredTree = useMemo(() => filterTree(tree, search), [tree, search]);

  const handleDropFolder = useCallback(async (targetFolderId: string) => {
    const { dragId, dragParentId } = dragState;
    setDragState(EMPTY_DRAG);

    if (!dragId || !onMoveItem) return;
    const fromFolderId = dragParentId || rootFolderId;
    if (!fromFolderId || fromFolderId === targetFolderId) return;

    await onMoveItem(dragId, fromFolderId, targetFolderId);
  }, [dragState, onMoveItem, rootFolderId]);

  const handleDropReorder = useCallback((targetId: string, position: 'before' | 'after', parentFolderId: string) => {
    const { dragId } = dragState;
    setDragState(EMPTY_DRAG);

    if (!dragId || dragId === targetId || !onReorderItem) return;
    onReorderItem(dragId, targetId, position, parentFolderId);
  }, [dragState, onReorderItem]);

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
      <div
        className="flex-1 overflow-y-auto p-2"
        onDragOver={(e) => {
          if (dragState.dragId && rootFolderId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          if (dragState.dragId && rootFolderId && !dragState.dropFolderId && !dragState.dropInsert) {
            e.preventDefault();
            handleDropFolder(rootFolderId);
          }
        }}
      >
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
              parentId={rootFolderId}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              showPermissions={showPermissions}
              canManagePermissions={canManagePermissions}
              folderPermissions={folderPermissions}
              filePermissions={filePermissions}
              onToggleFolderPermission={onToggleFolderPermission}
              onToggleFilePermission={onToggleFilePermission}
              dragState={dragState}
              setDragState={setDragState}
              onDropFolder={handleDropFolder}
              onDropReorder={handleDropReorder}
            />
          ))
        )}
      </div>
    </div>
  );
}
