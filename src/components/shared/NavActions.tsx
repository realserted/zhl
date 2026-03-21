'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertCircle, CheckCircle, AlertTriangle, Upload, X, Loader2, FileUp,
  Folder, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { getDriveConfig, listDriveFolderDirect, uploadFileToDrive } from '@/lib/db/files';
import { getCategories, getRows, getValues, createField, upsertValue } from '@/lib/db/unit-data';
import type { DriveItem } from '@/lib/types/files';
import type { CategoryWithFields, UnitDataField, UnitDataRow, UnitDataValue } from '@/lib/types/unit-data';

const STATUS_CONFIG: Record<string, { icon: typeof AlertCircle; colorClass: string }> = {
  Critical: { icon: AlertCircle, colorClass: 'border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950' },
  Problematic: { icon: AlertTriangle, colorClass: 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950' },
  'Needs Attention': { icon: AlertTriangle, colorClass: 'border-yellow-500 text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950' },
  Good: { icon: CheckCircle, colorClass: 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950' },
  Excellent: { icon: CheckCircle, colorClass: 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950' },
};

interface NavActionsProps {
  projectStatus?: string;
  vertical?: boolean;
  selectedProjectId?: string | null;
  projectName?: string | null;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ── Folder Picker (inline tree) ──────────────────────────────────────────────

interface FolderNode {
  item: DriveItem;
  children: FolderNode[];
  isExpanded: boolean;
  isLoaded: boolean;
}

function FolderPickerNode({
  node, depth, selectedId, loadingId,
  onSelect, onToggle,
}: {
  node: FolderNode; depth: number; selectedId: string; loadingId: string | null;
  onSelect: (id: string, name: string) => void;
  onToggle: (id: string) => void;
}) {
  const isSelected = node.item.id === selectedId;
  const isLoading = node.item.id === loadingId;

  return (
    <div>
      <div
        className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm cursor-pointer transition-colors ${
          isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50 text-foreground/80'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(node.item.id, node.item.name);
          if (!node.isLoaded) onToggle(node.item.id);
        }}
      >
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggle(node.item.id); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggle(node.item.id); } }}
          className="p-0.5 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : node.isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="truncate text-[13px]">{node.item.name}</span>
      </div>
      {node.isExpanded && node.children.map((child) => (
        <FolderPickerNode
          key={child.item.id} node={child} depth={depth + 1}
          selectedId={selectedId} loadingId={loadingId}
          onSelect={onSelect} onToggle={onToggle}
        />
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function NavActions({ projectStatus, vertical, selectedProjectId, projectName }: NavActionsProps) {
  const status = projectStatus || 'Good';
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['Good'];
  const Icon = config.icon;

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState<boolean | null>(null);
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected file
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Form fields
  const [renameTo, setRenameTo] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [targetFolderName, setTargetFolderName] = useState('Root Folder');

  // Folder picker
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folderLoadingId, setFolderLoadingId] = useState<string | null>(null);

  // Unit data linking
  const [categories, setCategories] = useState<CategoryWithFields[]>([]);
  const [rows, setRows] = useState<UnitDataRow[]>([]);
  const [values, setValues] = useState<UnitDataValue[]>([]);
  const [unitDataLoaded, setUnitDataLoaded] = useState(false);

  // Selected unit + column
  const [selectedRowId, setSelectedRowId] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnCategoryId, setNewColumnCategoryId] = useState('');
  const [showNewColumn, setShowNewColumn] = useState(false);

  // Upload result
  const [uploadResult, setUploadResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // ── Load config when modal opens ───────────────────────────────
  useEffect(() => {
    if (!showUploadModal || !selectedProjectId) return;
    setDriveConfigured(null);
    getDriveConfig(selectedProjectId).then((cfg) => {
      setDriveConfigured(!!cfg);
      const rootId = cfg?.root_folder_id ?? null;
      setRootFolderId(rootId);
      if (rootId) {
        setTargetFolderId(rootId);
        setTargetFolderName('Root Folder');
      }
    });
  }, [showUploadModal, selectedProjectId]);

  // ── Load unit data when modal opens ────────────────────────────
  useEffect(() => {
    if (!showUploadModal || !selectedProjectId || unitDataLoaded) return;
    (async () => {
      const [cats, rws, vals] = await Promise.all([
        getCategories(selectedProjectId),
        getRows(selectedProjectId),
        getValues(selectedProjectId),
      ]);
      setCategories(cats);
      setRows(rws);
      setValues(vals);
      setUnitDataLoaded(true);
    })();
  }, [showUploadModal, selectedProjectId, unitDataLoaded]);

  // ── Find ID fields and their values ────────────────────────────
  const idFields: UnitDataField[] = [];
  for (const cat of categories) {
    for (const field of cat.fields) {
      if (field.is_auto_id) idFields.push(field);
    }
  }

  // Build a list of unit options: { rowId, label } from ID column values
  // Auto-ID fields compute sequential numbers (not stored in DB), so we generate them here.
  const unitOptions: Array<{ rowId: string; label: string; fieldId: string }> = [];
  if (idFields.length > 0) {
    const idField = idFields[0]; // Use the first auto-ID field
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Check for a stored value first, otherwise use computed auto-ID
      const val = values.find((v) => v.row_id === row.id && v.field_id === idField.id);
      const label = val?.value || `${idField.name} ${i + 1}`;
      unitOptions.push({ rowId: row.id, label, fieldId: idField.id });
    }
  }

  // Build list of non-ID fields for column selection
  const allFields: UnitDataField[] = [];
  for (const cat of categories) {
    for (const field of cat.fields) {
      if (!field.is_auto_id) allFields.push(field);
    }
  }

  // ── Folder tree loading ────────────────────────────────────────
  const loadFolderChildren = useCallback(async (folderId: string): Promise<FolderNode[]> => {
    if (!selectedProjectId) return [];
    const { items } = await listDriveFolderDirect(selectedProjectId, folderId);
    return items
      .filter((item) => item.mimeType === FOLDER_MIME)
      .map((item) => ({ item, children: [], isExpanded: false, isLoaded: false }));
  }, [selectedProjectId]);

  const handleOpenFolderPicker = async () => {
    if (!rootFolderId) return;
    setShowFolderPicker(true);
    if (folderTree.length === 0) {
      setFolderLoadingId(rootFolderId);
      const children = await loadFolderChildren(rootFolderId);
      setFolderTree(children);
      setFolderLoadingId(null);
    }
  };

  const handleToggleFolder = async (folderId: string) => {
    const toggle = async (nodes: FolderNode[]): Promise<FolderNode[]> => {
      const result: FolderNode[] = [];
      for (const node of nodes) {
        if (node.item.id === folderId) {
          if (!node.isLoaded) {
            setFolderLoadingId(folderId);
            const children = await loadFolderChildren(folderId);
            setFolderLoadingId(null);
            result.push({ ...node, children, isExpanded: true, isLoaded: true });
          } else {
            result.push({ ...node, isExpanded: !node.isExpanded });
          }
        } else {
          result.push({ ...node, children: await toggle(node.children) });
        }
      }
      return result;
    };
    setFolderTree(await toggle(folderTree));
  };

  // ── File selection ─────────────────────────────────────────────
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setRenameTo(file.name);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Upload handler ─────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedProjectId || !targetFolderId || !selectedFile) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const result = await uploadFileToDrive(
        selectedProjectId,
        selectedFile,
        targetFolderId,
        renameTo || undefined,
      );

      if (!result.ok) {
        setUploadResult({ ok: false, error: result.error || 'Upload failed' });
        setUploading(false);
        return;
      }

      // Link to unit data cell if selected
      if (selectedRowId && result.fileId) {
        let fieldId = selectedFieldId;

        // Create new column if requested
        if (showNewColumn && newColumnName && newColumnCategoryId) {
          const cat = categories.find((c) => c.id === newColumnCategoryId);
          const maxSort = cat ? Math.max(0, ...cat.fields.map((f) => f.sort_order)) : 0;
          const newField = await createField(
            newColumnCategoryId,
            selectedProjectId,
            newColumnName,
            'text',
            null,
            true, // is_file_link
            false,
            maxSort + 1,
          );
          if (newField) fieldId = newField.id;
        }

        if (fieldId && result.fileId) {
          await upsertValue(selectedRowId, fieldId, result.fileName || selectedFile.name, result.fileId);
        }
      }

      setUploadResult({ ok: true });
      // Notify unit data to refresh so the linked file appears immediately
      window.dispatchEvent(new Event('files-updated'));
    } catch {
      setUploadResult({ ok: false, error: 'Network error' });
    }

    setUploading(false);
  };

  // ── Reset modal state ──────────────────────────────────────────
  const resetModal = () => {
    setSelectedFile(null);
    setRenameTo('');
    setShowFolderPicker(false);
    setFolderTree([]);
    setSelectedRowId('');
    setSelectedFieldId('');
    setNewColumnName('');
    setNewColumnCategoryId('');
    setShowNewColumn(false);
    setUploadResult(null);
    setUnitDataLoaded(false);
    setShowUploadModal(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <div className={vertical ? 'flex flex-col gap-2' : 'flex gap-3 items-center'}>
        {/* Status Display */}
        <div
          className={`inline-flex items-center gap-2 border rounded-md px-3 py-1.5 text-xs font-semibold ${config.colorClass} ${vertical ? 'w-full justify-center' : 'px-4 py-2 text-sm'}`}
        >
          <Icon className="h-4 w-4" />
          Status: {status.toUpperCase()}
        </div>

        {/* Add Files Button */}
        {selectedProjectId && (
          <button
            onClick={() => {
              resetModal();
              setShowUploadModal(true);
            }}
            className={`inline-flex items-center gap-2 border border-primary/30 rounded-md px-3 py-1.5 text-xs font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-colors ${vertical ? 'w-full justify-center' : 'px-4 py-2 text-sm'}`}
          >
            <Upload className="h-4 w-4" />
            ADD FILES
          </button>
        )}
      </div>

      {/* Upload Modal */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => { if (!uploading) resetModal(); }}
        title="Add File to Google Drive"
        maxWidth="lg"
      >
        <div className="space-y-5">
          {driveConfigured === null ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Checking Drive configuration...</span>
            </div>
          ) : !driveConfigured ? (
            <div className="text-center py-8">
              <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Google Drive not configured</p>
              <p className="text-xs text-muted-foreground">Set up Google Drive in the Files tab first.</p>
            </div>
          ) : uploadResult?.ok ? (
            /* Success state */
            <div className="text-center py-8">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">File uploaded successfully!</p>
              {selectedRowId && <p className="text-xs text-muted-foreground">File has been linked to the selected unit.</p>}
              <button
                onClick={resetModal}
                className="mt-4 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:opacity-90 transition-all"
              >
                DONE
              </button>
            </div>
          ) : (
            <>
              {/* File picker */}
              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border/60 rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <FileUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Click to select a file</p>
                  <p className="text-xs text-muted-foreground mt-1">File will be uploaded to your Google Drive</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelected}
                    className="hidden"
                  />
                </div>
              ) : (
                <>
                  {/* Selected file info */}
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
                    <FileUp className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatSize(selectedFile.size)}</p>
                    </div>
                    <button onClick={() => { setSelectedFile(null); setRenameTo(''); }} className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Form fields */}
                  <div className="space-y-4">
                    {/* Project Name (read-only) */}
                    <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                      <label className="text-sm font-medium text-muted-foreground">Project Name:</label>
                      <div className="text-sm font-medium text-foreground">{projectName || 'Active Project'}</div>
                    </div>

                    {/* Rename File */}
                    <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                      <label className="text-sm font-medium text-muted-foreground">Rename File to:</label>
                      <input
                        type="text"
                        value={renameTo}
                        onChange={(e) => setRenameTo(e.target.value)}
                        placeholder={selectedFile.name}
                        className="h-9 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* Organize under (folder picker) */}
                    <div className="grid grid-cols-[160px_1fr] items-start gap-3">
                      <label className="text-sm font-medium text-muted-foreground pt-2">Organize under:</label>
                      <div>
                        <button
                          onClick={handleOpenFolderPicker}
                          className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border/50 bg-background/50 text-sm text-foreground hover:bg-muted/50 transition-colors w-full text-left"
                        >
                          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                          <span className="truncate">{targetFolderName}</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                        </button>
                        {showFolderPicker && (
                          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border/50 bg-background p-1">
                            {/* Root option */}
                            <button
                              onClick={() => {
                                setTargetFolderId(rootFolderId!);
                                setTargetFolderName('Root Folder');
                                setShowFolderPicker(false);
                              }}
                              className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 px-2 text-left text-sm transition-colors ${
                                targetFolderId === rootFolderId ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50 text-foreground/80'
                              }`}
                            >
                              <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                              <span className="text-[13px]">Root Folder</span>
                            </button>
                            {folderTree.map((node) => (
                              <FolderPickerNode
                                key={node.item.id} node={node} depth={1}
                                selectedId={targetFolderId} loadingId={folderLoadingId}
                                onSelect={(id, name) => {
                                  setTargetFolderId(id);
                                  setTargetFolderName(name);
                                  setShowFolderPicker(false);
                                }}
                                onToggle={handleToggleFolder}
                              />
                            ))}
                            {folderTree.length === 0 && !folderLoadingId && (
                              <p className="text-xs text-muted-foreground py-2 px-2">No subfolders</p>
                            )}
                            {folderLoadingId === rootFolderId && (
                              <div className="flex items-center gap-2 py-2 px-2 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span className="text-xs">Loading folders...</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-border/30 pt-4">
                      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-3">Link to Unit Data (optional)</p>
                    </div>

                    {/* Which unit is this for? */}
                    <div className="grid grid-cols-[160px_1fr] items-center gap-3">
                      <label className="text-sm font-medium text-muted-foreground">Which unit is this for?</label>
                      <select
                        value={selectedRowId}
                        onChange={(e) => setSelectedRowId(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">— None —</option>
                        {unitOptions.map((opt) => (
                          <option key={opt.rowId} value={opt.rowId}>{opt.label}</option>
                        ))}
                      </select>
                      {idFields.length > 0 && (
                        <span className="col-start-2 text-[10px] text-muted-foreground -mt-2">
                          Values from &ldquo;{idFields[0].name}&rdquo; column
                        </span>
                      )}
                    </div>

                    {/* What column should this go under? */}
                    {selectedRowId && (
                      <div className="grid grid-cols-[160px_1fr] items-start gap-3">
                        <label className="text-sm font-medium text-muted-foreground pt-2">Column to link under:</label>
                        <div className="space-y-2">
                          <select
                            value={showNewColumn ? '__new__' : selectedFieldId}
                            onChange={(e) => {
                              if (e.target.value === '__new__') {
                                setShowNewColumn(true);
                                setSelectedFieldId('');
                              } else {
                                setShowNewColumn(false);
                                setSelectedFieldId(e.target.value);
                              }
                            }}
                            className="h-9 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            <option value="">— Select Column —</option>
                            {categories.map((cat) => (
                              <optgroup key={cat.id} label={cat.name}>
                                {cat.fields.filter((f) => !f.is_auto_id).map((field) => (
                                  <option key={field.id} value={field.id}>{field.name}</option>
                                ))}
                              </optgroup>
                            ))}
                            <option value="__new__">+ Add Column</option>
                          </select>

                          {showNewColumn && (
                            <div className="space-y-2 p-3 rounded-lg border border-border/30 bg-muted/20">
                              <input
                                type="text"
                                value={newColumnName}
                                onChange={(e) => setNewColumnName(e.target.value)}
                                placeholder="New column name"
                                className="h-9 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                              />
                              <select
                                value={newColumnCategoryId}
                                onChange={(e) => setNewColumnCategoryId(e.target.value)}
                                className="h-9 w-full rounded-lg border border-border/50 bg-background/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                              >
                                <option value="">— Which category? —</option>
                                {categories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Error message */}
                  {uploadResult && !uploadResult.ok && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                      <p className="text-sm text-destructive">{uploadResult.error}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleUpload}
                      disabled={uploading || !selectedFile}
                      className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50"
                    >
                      {uploading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Uploading...
                        </span>
                      ) : (
                        'UPLOAD'
                      )}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
