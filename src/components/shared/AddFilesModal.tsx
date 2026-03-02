'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Upload, FileUp } from 'lucide-react';
import { useAppState } from '@/app/(app)/AppStateContext';
import { useAuth } from '@/lib/auth-context';
import { getFileFolders, uploadFile, renameFile, linkFileToUnitData } from '@/lib/db/files';
import { getCategories, getRows, getValues, upsertValue } from '@/lib/db/unit-data';
import { ProjectFileFolder } from '@/lib/types/files';
import { CategoryWithFields, UnitDataRow, UnitDataValue } from '@/lib/types/unit-data';

interface AddFilesModalProps {
  open: boolean;
  onClose: () => void;
}

// Build indented flat list from nested folders
function buildFolderTree(folders: ProjectFileFolder[]): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  const childrenMap = new Map<string | null, ProjectFileFolder[]>();

  for (const f of folders) {
    const key = f.parent_folder_id;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(f);
  }

  function traverse(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId) ?? [];
    for (const child of children) {
      result.push({ id: child.id, label: '\u00A0\u00A0'.repeat(depth) + child.name });
      traverse(child.id, depth + 1);
    }
  }

  traverse(null, 0);
  return result;
}

export default function AddFilesModal({ open, onClose }: AddFilesModalProps) {
  const { projects, selectedProject } = useAppState();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [selectedRowId, setSelectedRowId] = useState('');
  const [selectedFieldId, setSelectedFieldId] = useState('');

  // Dropdown data
  const [folders, setFolders] = useState<ProjectFileFolder[]>([]);
  const [categories, setCategories] = useState<CategoryWithFields[]>([]);
  const [rows, setRows] = useState<UnitDataRow[]>([]);
  const [values, setValues] = useState<UnitDataValue[]>([]);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize on open
  useEffect(() => {
    if (open && selectedProject) {
      setSelectedProjectId(selectedProject.id);
      setFile(null);
      setFileName('');
      setSelectedFolderId('');
      setSelectedRowId('');
      setSelectedFieldId('');
      setError(null);
    }
  }, [open, selectedProject]);

  // Fetch data when project changes
  useEffect(() => {
    if (!selectedProjectId) return;

    setSelectedFolderId('');
    setSelectedRowId('');
    setSelectedFieldId('');

    let cancelled = false;
    const load = async () => {
      const [foldersData, categoriesData, rowsData, valuesData] = await Promise.all([
        getFileFolders(selectedProjectId),
        getCategories(selectedProjectId),
        getRows(selectedProjectId),
        getValues(selectedProjectId),
      ]);
      if (cancelled) return;
      setFolders(foldersData);
      setCategories(categoriesData);
      setRows(rowsData);
      setValues(valuesData);
    };
    load();
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  // Escape key + body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose]);

  // Derived: folder tree for dropdown
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  // Derived: ordered field IDs (all fields across all categories, in display order)
  const orderedFieldIds = useMemo(() => {
    return categories.flatMap((cat) => cat.fields.map((f) => f.id));
  }, [categories]);

  // Derived: row options — label each row by its first non-empty value in field order
  const rowOptions = useMemo(() => {
    // Build lookup: rowId -> Map<fieldId, value>
    const rowValueMap = new Map<string, Map<string, string>>();
    for (const v of values) {
      if (!v.value) continue;
      if (!rowValueMap.has(v.row_id)) rowValueMap.set(v.row_id, new Map());
      rowValueMap.get(v.row_id)!.set(v.field_id, v.value);
    }

    return rows.map((row, idx) => {
      const valMap = rowValueMap.get(row.id);
      if (!valMap) return { id: row.id, label: `Row ${idx + 1}` };

      // Find the first non-empty value in field display order
      for (const fId of orderedFieldIds) {
        const v = valMap.get(fId);
        if (v) return { id: row.id, label: v };
      }

      // Fallback: use any value we have (field might not be in categories anymore)
      const firstVal = valMap.values().next().value;
      if (firstVal) return { id: row.id, label: firstVal };

      return { id: row.id, label: `Row ${idx + 1}` };
    });
  }, [orderedFieldIds, rows, values]);

  // Derived: field options (Category > Field)
  const fieldOptions = useMemo(() => {
    return categories.flatMap((cat) =>
      cat.fields.map((f) => ({
        id: f.id,
        label: `${cat.name} > ${f.name}`,
      })),
    );
  }, [categories]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileName(f?.name ?? '');
  };

  const handleSubmit = async () => {
    if (!file || !selectedProjectId) return;
    setSubmitting(true);
    setError(null);

    try {
      const uploaded = await uploadFile(
        selectedProjectId,
        selectedFolderId || null,
        file,
        user?.id ?? null,
      );
      if (!uploaded) throw new Error('File upload failed');

      // Rename if changed
      if (fileName && fileName !== file.name) {
        await renameFile(uploaded.id, fileName);
      }

      // Link to unit data cell — store file name as value and storage path as file_url
      if (selectedRowId && selectedFieldId && uploaded.storage_path) {
        const displayName = fileName || file.name;
        await upsertValue(selectedRowId, selectedFieldId, displayName, uploaded.storage_path);
        // Also link to the field so the Files page shows the link icon
        await linkFileToUnitData('field', selectedFieldId, displayName, uploaded.storage_path);
      }

      // Notify FilesPage (or any listener) that a file was uploaded
      window.dispatchEvent(new CustomEvent('files-updated'));
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Add Files</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Project Name
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* File Picker */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-input rounded-md px-4 py-6 text-sm text-muted-foreground hover:border-accent hover:text-accent transition-colors"
            >
              <FileUp className="h-5 w-5" />
              {file ? file.name : 'Click to select a file'}
            </button>
          </div>

          {/* Rename File To */}
          {file && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Rename File To
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Enter file name"
              />
            </div>
          )}

          {/* Organize Under */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Organize Under
            </label>
            <select
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">(Root / No folder)</option>
              {folderTree.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Which Unit Is This For */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Which Unit Is This For?
            </label>
            <select
              value={selectedRowId}
              onChange={(e) => setSelectedRowId(e.target.value)}
              disabled={rowOptions.length === 0}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            >
              <option value="">
                {rowOptions.length === 0 ? 'No units found' : '(None)'}
              </option>
              {rowOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* What Column Should This Go Under */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              What Column Should This Go Under?
            </label>
            <select
              value={selectedFieldId}
              onChange={(e) => setSelectedFieldId(e.target.value)}
              disabled={fieldOptions.length === 0}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            >
              <option value="">
                {fieldOptions.length === 0 ? 'No fields found' : '(None)'}
              </option>
              {fieldOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 font-medium">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-input rounded-md bg-background text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !file}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="h-4 w-4" />
            {submitting ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
