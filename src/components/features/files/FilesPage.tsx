'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, Folder, FolderUp, Plus, Loader2, Download, DatabaseBackup, ShieldCheck, FileText, Upload, Trash2, Pencil, AlertTriangle, X, Link as LinkIcon } from 'lucide-react';
import { ProjectPermission } from '@/lib/types/project';
import { useAuth } from '@/lib/auth-context';
import {
  createBackupRequest,
  createCustomField,
  createFileFolder,
  deleteFile,
  deleteFolder,
  downloadFileUrl,
  getAllFilePermissions,
  getAllFolderPermissions,
  getBackupRequests,
  getBackups,
  getCustomFields,
  getFileFolders,
  getFilesForProject,
  getMonthlyDownloadLog,
  logDownloadAll,
  getLinkedUnitDataMap,
  linkFileToUnitData,
  renameFile,
  renameFolder,
  uploadFile,
  upsertFilePermissions,
  upsertFolderPermissions,
} from '@/lib/db/files';
import { getCategories } from '@/lib/db/unit-data';
import type { CategoryWithFields } from '@/lib/types/unit-data';
import {
  ProjectFileBackup,
  ProjectFileBackupRequest,
  ProjectFileCustomField,
  ProjectFileFolder,
  ProjectFileFolderPermissions,
  ProjectFileItem,
  ProjectFileItemPermissions,
} from '@/lib/types/files';
import { supabase } from '@/lib/supabase/client';
import { logUserAction } from '@/lib/db/user-logs';
import { Modal } from '@/components/shared/Modal';

interface FilesPageProps {
  selectedProjectId: string | null;
  userPermission?: ProjectPermission | null;
}

type PermissionKey =
  | 'allow_all_users'
  | 'allow_project_manager'
  | 'allow_property_manager'
  | 'allow_accountant'
  | 'allow_anyone_with_link'
  | 'link_enabled';

const permissionColumns: Array<{ key: PermissionKey; label: string }> = [
  { key: 'allow_all_users', label: 'All Users' },
  { key: 'allow_project_manager', label: 'Project Manager' },
  { key: 'allow_property_manager', label: 'Property Manager' },
  { key: 'allow_accountant', label: 'Accountant' },
  { key: 'allow_anyone_with_link', label: 'Anyone with Link' },
  { key: 'link_enabled', label: 'Link' },
];

function monthStartIso(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}

function nextMonthLabel(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).toLocaleDateString();
}

export default function FilesPage({ selectedProjectId, userPermission }: FilesPageProps) {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const permLevel = userPermission?.perm_files ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;
  const canManagePermissions = !userPermission || (userPermission.project_role?.includes('Project Manager') ?? false);

  /** Check if the current user can access a file/folder based on its permission entry */
  const hasFileAccess = useCallback(
    (permEntry: ProjectFileFolderPermissions | ProjectFileItemPermissions | undefined): boolean => {
      // Owner / admin always has access (userPermission is null for owners)
      if (!userPermission) return true;
      // No permission row = default open (everyone can access)
      if (!permEntry) return true;
      // Check permission flags against user's project_role
      if (permEntry.allow_all_users) return true;
      const role = userPermission.project_role || '';
      if (permEntry.allow_project_manager && role.includes('Project Manager')) return true;
      if (permEntry.allow_property_manager && role.includes('Property Manager')) return true;
      if (permEntry.allow_accountant && role.includes('Accountant')) return true;
      return false;
    },
    [userPermission],
  );

  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [folders, setFolders] = useState<ProjectFileFolder[]>([]);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [showPermissions, setShowPermissions] = useState(true);
  const [allPermissions, setAllPermissions] = useState<Map<string, ProjectFileFolderPermissions>>(new Map());
  const [allFilePermissions, setAllFilePermissions] = useState<Map<string, ProjectFileItemPermissions>>(new Map());
  const [savingPermission, setSavingPermission] = useState<string | null>(null);

  const [customFields, setCustomFields] = useState<ProjectFileCustomField[]>([]);

  const [showAddCustomField, setShowAddCustomField] = useState(false);
  const [newCustomFieldName, setNewCustomFieldName] = useState('');
  const [newCustomFieldTarget, setNewCustomFieldTarget] = useState<'folder' | 'file'>('file');
  const [newCustomFieldWarning, setNewCustomFieldWarning] = useState('Missing! This is a critical document!');
  const [newCustomFieldIgnoreDays, setNewCustomFieldIgnoreDays] = useState('90');
  const [newCustomFieldRequired, setNewCustomFieldRequired] = useState(true);

  const [downloadingAll, setDownloadingAll] = useState(false);
  const [monthlyDownloadsCount, setMonthlyDownloadsCount] = useState(0);

  const [backups, setBackups] = useState<ProjectFileBackup[]>([]);
  const [backupRequests, setBackupRequests] = useState<ProjectFileBackupRequest[]>([]);
  const [showBackupRequest, setShowBackupRequest] = useState(false);
  const [backupReason, setBackupReason] = useState('Need a restoration point for audit review.');

  const [notice, setNotice] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null);
  const [uploadFolderTargetId, setUploadFolderTargetId] = useState<string | null>(null); // parent folder for subfolder uploads
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const subfolderInputRef = useRef<HTMLInputElement>(null);

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null);

  // Unit linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pendingLinkFiles, setPendingLinkFiles] = useState<Array<{ name: string; storagePath: string }>>([]); // generic: works for new uploads + existing files/folders
  const [unitCategories, setUnitCategories] = useState<CategoryWithFields[]>([]);
  const [unitDataLoaded, setUnitDataLoaded] = useState(false);
  const [linkSelections, setLinkSelections] = useState<Map<number, { type: 'field' | 'category'; id: string }>>(new Map()); // index -> target
  const [linkingInProgress, setLinkingInProgress] = useState(false);
  const [linkedMap, setLinkedMap] = useState<Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>>(new Map());

  const log = (action: string) => {
    if (!user || !selectedProjectId) return;
    logUserAction({
      projectId: selectedProjectId,
      userId: user.id,
      userName: displayNameRef.current,
      userEmail: userEmailRef.current,
      action,
    });
  };

  const loadUnitDataForLinking = async () => {
    if (unitDataLoaded || !selectedProjectId) return;
    const cats = await getCategories(selectedProjectId);
    setUnitCategories(cats);
    setUnitDataLoaded(true);
  };

  const handleLinkFiles = async () => {
    setLinkingInProgress(true);
    let linked = 0;
    for (const [idx, target] of linkSelections.entries()) {
      if (!target.id) continue;
      const item = pendingLinkFiles[idx];
      if (!item) continue;
      const ok = await linkFileToUnitData(target.type, target.id, item.name, item.storagePath);
      if (ok) linked++;
    }
    setLinkingInProgress(false);
    setShowLinkModal(false);
    if (linked > 0) {
      setNotice(`${linked} file(s) linked to unit data.`);
      log(`Linked ${linked} file(s) to unit data`);
      if (selectedProjectId) getLinkedUnitDataMap(selectedProjectId).then(setLinkedMap);
    }
  };

  const openLinkModal = (items: Array<{ name: string; storagePath: string }>) => {
    setPendingLinkFiles(items);
    setLinkSelections(new Map());
    setShowLinkModal(true);
    loadUnitDataForLinking();
  };

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('zhl_accounts')
      .select('display_name, is_admin')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        displayNameRef.current = data?.display_name || user.email || 'Unknown';
        setIsAdmin(data?.is_admin === true);
      });
  }, [user]);

  useEffect(() => {
    if (!selectedProjectId) {
      setFolders([]);
      setFiles([]);
      return;
    }

    // Reset cached unit data on project change
    setUnitDataLoaded(false);
    setUnitCategories([]);

    const load = async () => {
      setLoading(true);
      const [folderData, fileData, fieldData, backupData, backupRequestData, monthLogs, permData, filePermData] = await Promise.all([
        getFileFolders(selectedProjectId),
        getFilesForProject(selectedProjectId),
        getCustomFields(selectedProjectId),
        getBackups(selectedProjectId),
        getBackupRequests(selectedProjectId),
        getMonthlyDownloadLog(selectedProjectId, monthStartIso(new Date())),
        getAllFolderPermissions(selectedProjectId),
        getAllFilePermissions(selectedProjectId),
      ]);

      setFolders(folderData);
      setFiles(fileData);
      setCustomFields(fieldData);
      setBackups(backupData);
      setBackupRequests(backupRequestData);
      setMonthlyDownloadsCount(monthLogs.length);

      // Start all folders collapsed — user clicks to expand
      setCollapsedFolders(new Set(folderData.map((f) => f.id)));

      const permMap = new Map<string, ProjectFileFolderPermissions>();
      permData.forEach((p) => permMap.set(p.folder_id, p));
      setAllPermissions(permMap);

      const filePermMap = new Map<string, ProjectFileItemPermissions>();
      filePermData.forEach((p) => filePermMap.set(p.file_id, p));
      setAllFilePermissions(filePermMap);

      // Load linked unit data map
      getLinkedUnitDataMap(selectedProjectId).then(setLinkedMap);

      setLoading(false);
    };

    load();
  }, [selectedProjectId]);

  // Listen for file uploads from AddFilesModal (or other sources) and refresh
  useEffect(() => {
    const refresh = () => {
      if (!selectedProjectId) return;
      Promise.all([
        getFileFolders(selectedProjectId),
        getFilesForProject(selectedProjectId),
      ]).then(([folderData, fileData]) => {
        setFolders(folderData);
        setFiles(fileData);
      });
    };
    window.addEventListener('files-updated', refresh);
    return () => window.removeEventListener('files-updated', refresh);
  }, [selectedProjectId]);

  const folderChildrenMap = useMemo(() => {
    const map = new Map<string | null, ProjectFileFolder[]>();
    folders.forEach((folder) => {
      const key = folder.parent_folder_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(folder);
    });
    return map;
  }, [folders]);

  const filesInFolderMap = useMemo(() => {
    const map = new Map<string, ProjectFileItem[]>();
    files.forEach((file) => {
      if (!file.folder_id) return;
      if (!map.has(file.folder_id)) map.set(file.folder_id, []);
      map.get(file.folder_id)?.push(file);
    });
    return map;
  }, [files]);

  const hasRequiredFolderFields = useMemo(() => {
    return customFields.some((f) => f.required && f.target_type === 'folder');
  }, [customFields]);

  // ── Auto-expand & highlight linked file/folder from URL param ────
  const highlightProcessed = useRef(false);
  useEffect(() => {
    const highlightParam = searchParams.get('highlight');
    if (!highlightParam || folders.length === 0 || highlightProcessed.current) return;
    highlightProcessed.current = true;

    // Build a folder lookup by ID for walking up the parent chain
    const folderById = new Map(folders.map((f) => [f.id, f]));

    const expandParentChain = (folderId: string | null) => {
      const toExpand: string[] = [];
      let current = folderId;
      while (current) {
        toExpand.push(current);
        current = folderById.get(current)?.parent_folder_id ?? null;
      }
      if (toExpand.length > 0) {
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          toExpand.forEach((id) => next.delete(id));
          return next;
        });
      }
    };

    // Check if highlight is a folder reference (folder:{id})
    if (highlightParam.startsWith('folder:')) {
      const folderId = highlightParam.slice(7);
      expandParentChain(folderId);
      setHighlightedId(folderId);
    } else {
      // It's a file storage_path — find the file
      const file = files.find((f) => f.storage_path === highlightParam);
      if (file) {
        expandParentChain(file.folder_id);
        setHighlightedId(file.id);
      }
    }

    // Clear highlight after 4 seconds
    setTimeout(() => setHighlightedId(null), 4000);
  }, [searchParams, folders, files]);

  // Reset highlight processing when project changes
  useEffect(() => {
    highlightProcessed.current = false;
  }, [selectedProjectId]);

  // Scroll highlighted row into view
  const highlightRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (highlightedId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedId]);

  // ── Handlers ─────────────────────────────────────────────────────

  const togglePermission = async (folderId: string, key: PermissionKey) => {
    if (!canManagePermissions || !selectedProjectId || !user) return;

    const existing = allPermissions.get(folderId);
    const current = existing ?? {
      id: '',
      project_id: selectedProjectId,
      folder_id: folderId,
      allow_all_users: false,
      allow_project_manager: false,
      allow_property_manager: false,
      allow_accountant: false,
      allow_anyone_with_link: false,
      link_enabled: false,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const next = { ...current, [key]: !current[key] };

    setAllPermissions((prev) => {
      const map = new Map(prev);
      map.set(folderId, next);
      return map;
    });
    setSavingPermission(folderId);

    const saved = await upsertFolderPermissions({
      projectId: selectedProjectId,
      folderId,
      userId: user.id,
      allow_all_users: next.allow_all_users,
      allow_project_manager: next.allow_project_manager,
      allow_property_manager: next.allow_property_manager,
      allow_accountant: next.allow_accountant,
      allow_anyone_with_link: next.allow_anyone_with_link,
      link_enabled: next.link_enabled,
    });

    if (saved) {
      setAllPermissions((prev) => {
        const map = new Map(prev);
        map.set(folderId, saved);
        return map;
      });
    }
    setSavingPermission(null);
  };

  const toggleFilePermission = async (fileId: string, key: PermissionKey) => {
    if (!canManagePermissions || !selectedProjectId || !user) return;

    const existing = allFilePermissions.get(fileId);
    const current = existing ?? {
      id: '',
      project_id: selectedProjectId,
      file_id: fileId,
      allow_all_users: false,
      allow_project_manager: false,
      allow_property_manager: false,
      allow_accountant: false,
      allow_anyone_with_link: false,
      link_enabled: false,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const next = { ...current, [key]: !current[key] };

    setAllFilePermissions((prev) => {
      const map = new Map(prev);
      map.set(fileId, next);
      return map;
    });
    setSavingPermission(fileId);

    const saved = await upsertFilePermissions({
      projectId: selectedProjectId,
      fileId,
      userId: user.id,
      allow_all_users: next.allow_all_users,
      allow_project_manager: next.allow_project_manager,
      allow_property_manager: next.allow_property_manager,
      allow_accountant: next.allow_accountant,
      allow_anyone_with_link: next.allow_anyone_with_link,
      link_enabled: next.link_enabled,
    });

    if (saved) {
      setAllFilePermissions((prev) => {
        const map = new Map(prev);
        map.set(fileId, saved);
        return map;
      });
    }
    setSavingPermission(null);
  };

  /** Upload a folder: preserves subfolder structure, creates nested folders, uploads files into correct locations.
   *  If parentFolderId is provided, the uploaded folder becomes a child of that folder. */
  const handleUploadFolder = async (fileList: File[], parentFolderId?: string | null) => {
    if (!selectedProjectId || !user || !canEdit || fileList.length === 0) return;

    setUploading(true);

    // Map of "folderPath" -> folder DB id (e.g. "MyFolder" -> uuid, "MyFolder/Sub" -> uuid)
    const folderMap = new Map<string, string>();
    const newFolders: ProjectFileFolder[] = [];

    // Helper: ensure a folder path exists, creating parent folders as needed
    const ensureFolder = async (pathParts: string[], depth: number = 0): Promise<string> => {
      const key = pathParts.slice(0, depth + 1).join('/');
      if (folderMap.has(key)) return folderMap.get(key)!;

      const folderName = pathParts[depth];
      const parentKey = depth > 0 ? pathParts.slice(0, depth).join('/') : null;

      // If parent doesn't exist yet, create it first
      if (depth > 0 && parentKey && !folderMap.has(parentKey)) {
        await ensureFolder(pathParts, depth - 1);
      }

      // For root-level folders in the upload, use the provided parentFolderId
      const resolvedParentId = depth === 0
        ? (parentFolderId ?? null)
        : (parentKey ? folderMap.get(parentKey) ?? null : null);

      // Count existing siblings for sort_order
      const siblingCount = newFolders.filter((f) => f.parent_folder_id === resolvedParentId).length
        + folders.filter((f) => f.parent_folder_id === resolvedParentId).length;

      const created = await createFileFolder(selectedProjectId, folderName, resolvedParentId, siblingCount, user.id);
      if (created) {
        folderMap.set(key, created.id);
        newFolders.push(created);
      }
      return folderMap.get(key) ?? '';
    };

    // Process all files: create folders from their paths, then upload
    const uploaded: ProjectFileItem[] = [];

    for (const f of fileList) {
      const relativePath = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      const parts = relativePath.split('/');
      // parts = ["RootFolder", "SubFolder", "file.txt"] — last part is the file name
      const folderParts = parts.slice(0, -1); // all except file name

      // Ensure all folders in the path exist
      let targetFolderId: string | null = null;
      if (folderParts.length > 0) {
        for (let depth = 0; depth < folderParts.length; depth++) {
          await ensureFolder(folderParts, depth);
        }
        targetFolderId = folderMap.get(folderParts.join('/')) ?? null;
      }

      const result = await uploadFile(selectedProjectId, targetFolderId, f, user.id);
      if (result) uploaded.push(result);
    }

    if (newFolders.length > 0) {
      setFolders((prev) => [...prev, ...newFolders]);
    }
    if (uploaded.length > 0) {
      setFiles((prev) => [...uploaded, ...prev]);
    }

    const rootName = newFolders[0]?.name ?? 'folder';
    log(`Uploaded folder "${rootName}" with ${newFolders.length} folder(s) and ${uploaded.length} file(s)`);
    setNotice(`Folder "${rootName}" uploaded with ${uploaded.length} file(s) across ${newFolders.length} folder(s).`);
    setUploading(false);
    if (uploaded.length > 0) openLinkModal(uploaded.filter((f) => f.storage_path).map((f) => ({ name: f.name, storagePath: f.storage_path! })));
  };

  const handleUploadFiles = async (fileList: FileList) => {
    if (!selectedProjectId || !user || !uploadTargetFolderId || !canEdit) return;

    setUploading(true);
    const uploaded: ProjectFileItem[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const result = await uploadFile(selectedProjectId, uploadTargetFolderId, f, user.id);
      if (result) uploaded.push(result);
    }

    if (uploaded.length > 0) {
      setFiles((prev) => [...uploaded, ...prev]);
      log(`Uploaded ${uploaded.length} file(s)`);
      setNotice(`${uploaded.length} file(s) uploaded successfully.`);
      openLinkModal(uploaded.filter((f) => f.storage_path).map((f) => ({ name: f.name, storagePath: f.storage_path! })));
    }
    setUploading(false);
    setUploadTargetFolderId(null);
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!canEdit) return;
    const folder = folders.find((f) => f.id === folderId);
    const ok = await deleteFolder(folderId);
    if (!ok) return;

    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setFiles((prev) => prev.filter((f) => f.folder_id !== folderId));
    setConfirmDeleteFolder(null);
    log(`Deleted folder "${folder?.name ?? folderId}"`);
  };

  const handleRenameFolder = async () => {
    if (!renamingFolderId || !renameValue.trim()) return;
    const ok = await renameFolder(renamingFolderId, renameValue.trim());
    if (ok) {
      setFolders((prev) => prev.map((f) => f.id === renamingFolderId ? { ...f, name: renameValue.trim() } : f));
      log(`Renamed folder to "${renameValue.trim()}"`);
    }
    setRenamingFolderId(null);
    setRenameValue('');
  };

  const handleDownloadFile = async (file: ProjectFileItem) => {
    if (!file.storage_path) return;
    // Permission gate: check file-level, fall back to folder-level
    const filePerm = allFilePermissions.get(file.id);
    const folderPerm = file.folder_id ? allPermissions.get(file.folder_id) : undefined;
    if (!hasFileAccess(filePerm ?? folderPerm)) return;
    const url = await downloadFileUrl(file.storage_path);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      log(`Downloaded file "${file.name}"`);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!canEdit) return;
    const file = files.find((f) => f.id === fileId);
    const ok = await deleteFile(fileId);
    if (!ok) return;

    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    log(`Deleted file "${file?.name ?? fileId}"`);
  };

  const handleRenameFile = async () => {
    if (!renamingFileId || !renameValue.trim()) return;
    const ok = await renameFile(renamingFileId, renameValue.trim());
    if (ok) {
      setFiles((prev) => prev.map((f) => f.id === renamingFileId ? { ...f, name: renameValue.trim() } : f));
      log(`Renamed file to "${renameValue.trim()}"`);
    }
    setRenamingFileId(null);
    setRenameValue('');
  };

  const handleDownloadAll = async () => {
    if (!selectedProjectId || !user) return;
    if (monthlyDownloadsCount >= 1) return;

    setDownloadingAll(true);
    const logged = await logDownloadAll(selectedProjectId, user.id);
    if (logged) {
      setMonthlyDownloadsCount((prev) => prev + 1);
      // Filter files through permission checks
      const accessibleFiles = files.filter((file) => {
        const filePerm = allFilePermissions.get(file.id);
        const folderPerm = file.folder_id ? allPermissions.get(file.folder_id) : undefined;
        return hasFileAccess(filePerm ?? folderPerm);
      });
      for (const file of accessibleFiles) {
        if (file.storage_path) {
          const url = await downloadFileUrl(file.storage_path);
          if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }
      setNotice('Download-all completed. Limit reached for this month.');
      log('Downloaded all files');
    }
    setDownloadingAll(false);
  };

  const handleAddCustomField = async () => {
    if (!selectedProjectId || !user || !newCustomFieldName.trim() || !canEdit) return;

    const created = await createCustomField({
      projectId: selectedProjectId,
      name: newCustomFieldName.trim(),
      targetType: newCustomFieldTarget,
      warningMessage: newCustomFieldWarning.trim() || null,
      ignoreWarningDays: newCustomFieldIgnoreDays.trim() ? Number(newCustomFieldIgnoreDays) : null,
      required: newCustomFieldRequired,
      userId: user.id,
    });

    if (!created) return;

    setCustomFields((prev) => [...prev, created]);
    setNewCustomFieldName('');
    setShowAddCustomField(false);
    log(`Created custom field "${created.name}"`);
  };

  const handleRequestBackup = async () => {
    if (!selectedProjectId || !user || !backupReason.trim()) return;

    const created = await createBackupRequest(selectedProjectId, user.id, backupReason.trim());
    if (!created) return;

    setBackupRequests((prev) => [created, ...prev]);
    setShowBackupRequest(false);
    setNotice('Backup request submitted. Admins/developers can fulfill it.');
    log('Requested backup');
  };

  // ── Build flat row list ──────────────────────────────────────────

  type TableRow =
    | { type: 'folder'; folder: ProjectFileFolder; depth: number }
    | { type: 'file'; file: ProjectFileItem; folderId: string; depth: number };

  const buildRows = (parentId: string | null, depth: number): TableRow[] => {
    const children = folderChildrenMap.get(parentId) ?? [];
    const rows: TableRow[] = [];

    for (const folder of children) {
      // Check folder-level permission
      const folderPerm = allPermissions.get(folder.id);
      if (!hasFileAccess(folderPerm)) continue; // skip folder + children

      rows.push({ type: 'folder', folder, depth });

      if (!collapsedFolders.has(folder.id)) {
        const folderFiles = filesInFolderMap.get(folder.id) ?? [];
        for (const file of folderFiles) {
          // Check file-level permission, fall back to folder permission
          const filePerm = allFilePermissions.get(file.id);
          const effectivePerm = filePerm ?? folderPerm;
          if (!hasFileAccess(effectivePerm)) continue;
          rows.push({ type: 'file', file, folderId: folder.id, depth: depth + 1 });
        }
        rows.push(...buildRows(folder.id, depth + 1));
      }
    }

    return rows;
  };

  const tableRows = useMemo(() => buildRows(null, 0), [folderChildrenMap, filesInFolderMap, collapsedFolders, allPermissions, allFilePermissions, hasFileAccess]);

  // ── Render ───────────────────────────────────────────────────────

  if (loading && selectedProjectId) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading files...
        </div>
      </main>
    );
  }

  if (!selectedProjectId) {
    return (
      <main className="bg-background text-foreground min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No project selected. Create or select a project first.</p>
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground min-h-screen p-4 sm:p-6">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      {/* Folder upload input — webkitdirectory lets user select a folder (root level) */}
      <input
        ref={(el) => {
          folderInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const filesArray = Array.from(e.target.files);
            handleUploadFolder(filesArray);
            e.target.value = '';
          }
        }}
      />
      {/* Subfolder upload input — uploads a folder into an existing folder */}
      <input
        ref={(el) => {
          subfolderInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            const filesArray = Array.from(e.target.files);
            handleUploadFolder(filesArray, uploadFolderTargetId);
            e.target.value = '';
            setUploadFolderTargetId(null);
          }
        }}
      />

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        {/* ── Left Pane ── */}
        <aside className="space-y-4 p-4 glass-card backdrop-blur-md bg-background/80 border border-white/10 rounded-2xl shadow-xl self-start sticky top-20">
          {/* Security notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-amber-600 dark:text-amber-500">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-[11px] font-medium leading-relaxed">
              All files are highly secure and encrypted - only authorized users can access.
            </p>
          </div>

          {/* Permissions toggle */}
          <button
            onClick={() => setShowPermissions((p) => !p)}
            className="text-[10px] font-bold tracking-widest uppercase text-primary hover:text-primary/80 transition-all flex items-center gap-1.5 px-1"
          >
            {showPermissions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showPermissions ? 'Hide Permissions' : 'Show Permissions'}
          </button>

          {/* Actions */}
          <div className="space-y-3 pt-2">
            <button
              onClick={() => setCollapsedFolders(new Set())}
              className="w-full text-left text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all px-1"
            >
              Expand all Folders
            </button>

            <button
              onClick={() => setShowAddCustomField(true)}
              disabled={!canEdit}
              className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all disabled:opacity-50 px-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add Custom Field
            </button>

            <div className="space-y-1">
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll || monthlyDownloadsCount >= 1}
                className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all disabled:opacity-50 px-1"
              >
                <Download className="h-3.5 w-3.5" /> Download All Files
              </button>
              {monthlyDownloadsCount >= 1 && (
                <p className="text-[10px] text-muted-foreground/60 font-medium pl-6 font-mono uppercase tracking-tighter">Next: {nextMonthLabel(new Date())}</p>
              )}
            </div>

            <button
              onClick={() => canEdit && folderInputRef.current?.click()}
              disabled={!canEdit || uploading}
              className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all disabled:opacity-50 px-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add New Folder
            </button>

            <button
              onClick={() => setShowBackupRequest(true)}
              className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all px-1"
            >
              <DatabaseBackup className="h-3.5 w-3.5" /> Request Backup
            </button>
          </div>

          <div className="h-px bg-white/5 mx-1" />

          {/* Backup info */}
          <div className="glass-card bg-muted/20 border border-border/50 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1.5 px-1">
              <ShieldCheck className="h-3.5 w-3.5 text-green-500" /> Backup History
            </p>
            <div className="space-y-1 px-1">
              <p className="text-[11px] font-medium">Backups: <span className="text-primary">{backups.length}</span></p>
              <p className="text-[11px] font-medium">Open requests: <span className="text-amber-500">{backupRequests.filter((r) => r.status === 'pending').length}</span></p>
              {backupRequests[0] && (
                <p className="text-[10px] text-muted-foreground/60 leading-tight">
                  Latest: {new Date(backupRequests[0].created_at).toLocaleDateString()} <span className="uppercase tracking-tighter ml-1">[{backupRequests[0].status}]</span>
                </p>
              )}
            </div>
          </div>

          {notice && (
            <div className="p-2.5 rounded-xl bg-green-500/5 border border-green-500/20 text-green-600 dark:text-green-500 text-[10px] font-bold tracking-wide uppercase px-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {notice}
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-primary px-3">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
            </div>
          )}
        </aside>

        {/* ── Right: Main Table ── */}
        <div className="glass-card backdrop-blur-md bg-background/50 border border-white/10 dark:border-white/5 rounded-2xl overflow-hidden shadow-2xl relative">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {/* Expand/collapse column */}
                <th className="w-8 px-2 py-2 border-r border-border/50" />

                {/* Permission column headers — diagonal text */}
                {showPermissions && permissionColumns.map((col) => (
                  <th key={col.key} className="px-1 pb-3 border-r border-border/50 w-10 min-w-[40px]">
                    <div className="flex items-end justify-center h-[140px]">
                      <span
                        className="text-[10px] font-bold tracking-wider uppercase text-foreground/80 whitespace-nowrap"
                        style={{
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                        }}
                      >
                        {col.label}
                      </span>
                    </div>
                  </th>
                ))}

                <th className="text-left px-4 py-4 font-bold text-[11px] tracking-wider uppercase text-primary whitespace-nowrap border-r border-border/50 drop-shadow-sm">
                  Name
                </th>
                <th className="text-right px-4 py-4 font-bold text-[11px] tracking-wider uppercase text-primary w-24 whitespace-nowrap drop-shadow-sm">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={showPermissions ? permissionColumns.length + 3 : 3} className="px-4 py-12 text-center">
                    <p className="text-sm font-bold tracking-widest text-muted-foreground uppercase mb-1">No folders yet</p>
                    <p className="text-xs text-muted-foreground/60 uppercase tracking-tighter">Click "+ Add New Folder" to start.</p>
                  </td>
                </tr>
              )}

              {tableRows.map((row) => {
                if (row.type === 'folder') {
                  const folder = row.folder;
                  const hasChildren = (folderChildrenMap.get(folder.id)?.length ?? 0) > 0;
                  const hasFiles = (filesInFolderMap.get(folder.id)?.length ?? 0) > 0;
                  const isCollapsed = collapsedFolders.has(folder.id);
                  const isRenaming = renamingFolderId === folder.id;
                  const perms = allPermissions.get(folder.id);
                  const hasWarning = hasRequiredFolderFields;

                  const isFolderHighlighted = highlightedId === folder.id;
                  return (
                    <tr
                      key={`folder-${folder.id}`}
                      ref={isFolderHighlighted ? highlightRowRef : undefined}
                      className={`border-b border-border/50 hover:bg-primary/5 group transition-all duration-300 ${isFolderHighlighted ? 'bg-primary/10 ring-1 ring-primary/20' : ''}`}
                    >
                      {/* Collapse toggle */}
                      <td className="px-2 py-3 border-r border-border/50 text-center">
                        {(hasChildren || hasFiles) ? (
                          <button
                            onClick={() => {
                              setCollapsedFolders((prev) => {
                                const next = new Set(prev);
                                if (next.has(folder.id)) next.delete(folder.id);
                                else next.add(folder.id);
                                return next;
                              });
                            }}
                            className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-primary/10"
                          >
                            {isCollapsed
                              ? <ChevronRight className="h-3.5 w-3.5" />
                              : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                      </td>

                      {/* Permission checkboxes */}
                      {showPermissions && permissionColumns.map((col) => (
                        <td key={col.key} className="text-center px-1 py-1 border-r border-border/50 bg-muted/10">
                          <input
                            type="checkbox"
                            checked={Boolean(perms?.[col.key])}
                            disabled={!canManagePermissions}
                            onChange={() => togglePermission(folder.id, col.key)}
                            className="rounded border-border h-3.5 w-3.5 text-primary focus:ring-primary/20"
                          />
                        </td>
                      ))}

                      {/* Folder name — click to expand/collapse */}
                      <td
                        className="px-4 py-3 cursor-pointer select-none"
                        onClick={() => {
                          if (isRenaming) return;
                          setCollapsedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(folder.id)) next.delete(folder.id);
                            else next.add(folder.id);
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 24}px` }}>
                          {hasWarning && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />}
                          <div className="p-1.5 rounded-lg bg-amber-500/10 shrink-0">
                            <Folder className="h-4 w-4 text-amber-500" />
                          </div>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={handleRenameFolder}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameFolder();
                                if (e.key === 'Escape') { setRenamingFolderId(null); setRenameValue(''); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-bold text-primary bg-background/50 border border-primary/20 rounded-lg px-2 py-1 w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            />
                          ) : (
                            <span className="font-bold text-[13px] tracking-tight text-foreground/90 group-hover:text-primary transition-colors">{folder.name}</span>
                          )}
                          {(() => {
                            const linkInfo = linkedMap.get(`folder:${folder.id}`);
                            if (!linkInfo) return null;
                            const label = linkInfo.type === 'field' && linkInfo.parentName
                              ? `${linkInfo.parentName} → ${linkInfo.name}`
                              : linkInfo.name;
                            return (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded-full border border-blue-500/10 cursor-default"
                                title={`Linked to ${linkInfo.type}: ${label}`}
                              >
                                <LinkIcon className="h-3 w-3" />
                                {label}
                              </span>
                            );
                          })()}
                          {savingPermission === folder.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
                          {canEdit && (
                            <button
                              onClick={() => { setUploadTargetFolderId(folder.id); fileInputRef.current?.click(); }}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                              title="Upload files"
                            >
                              <Upload className="h-4 w-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => { setUploadFolderTargetId(folder.id); subfolderInputRef.current?.click(); }}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                              title="Upload folder"
                            >
                              <FolderUp className="h-4 w-4" />
                            </button>
                          )}
                          {canEdit && !isRenaming && (
                            <button
                              onClick={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name); }}
                              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                              title="Rename"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => setConfirmDeleteFolder(folder.id)}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => openLinkModal([{ name: folder.name, storagePath: `folder:${folder.id}` }])}
                              className="p-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all"
                              title="Link to Unit Data"
                            >
                              <LinkIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }

                // File row
                const file = row.file;
                const isRenaming = renamingFileId === file.id;
                const filePerms = allFilePermissions.get(file.id);

                const isFileHighlighted = highlightedId === file.id;
                return (
                  <tr
                    key={`file-${file.id}`}
                    ref={isFileHighlighted ? highlightRowRef : undefined}
                    className={`border-b border-border/50 hover:bg-primary/5 group transition-all duration-300 ${isFileHighlighted ? 'bg-primary/10 ring-1 ring-primary/20' : ''}`}
                  >
                    {/* Empty collapse cell */}
                    <td className="border-r border-border/50" />

                    {/* File permission checkboxes */}
                    {showPermissions && permissionColumns.map((col) => (
                      <td key={col.key} className="text-center px-1 py-1 border-r border-border/50 bg-muted/5">
                        <input
                          type="checkbox"
                          checked={Boolean(filePerms?.[col.key])}
                          disabled={!canManagePermissions}
                          onChange={() => toggleFilePermission(file.id, col.key)}
                          className="rounded border-border h-3.5 w-3.5 text-primary focus:ring-primary/20"
                        />
                      </td>
                    ))}

                    {/* File name */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 24 + 12}px` }}>
                        <div className="p-1.5 rounded-lg bg-blue-500/10 shrink-0">
                          <FileText className="h-4 w-4 text-blue-500" />
                        </div>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleRenameFile}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameFile();
                              if (e.key === 'Escape') { setRenamingFileId(null); setRenameValue(''); }
                            }}
                            className="text-xs font-bold text-primary bg-background/50 border border-primary/20 rounded-lg px-2 py-1 w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                          />
                        ) : file.storage_path ? (
                          <button
                            onClick={() => handleDownloadFile(file)}
                            className="text-[13px] font-medium text-blue-500 hover:text-blue-400 hover:underline underline-offset-4 transition-all text-left wrap-break-word"
                          >
                            {file.name}
                          </button>
                        ) : (
                          <span className="text-[13px] font-medium text-foreground/80 wrap-break-word">{file.name}</span>
                        )}
                        {(() => {
                          const linkInfo = file.storage_path ? linkedMap.get(file.storage_path) : null;
                          if (!linkInfo) return null;
                          const label = linkInfo.type === 'field' && linkInfo.parentName
                            ? `${linkInfo.parentName} → ${linkInfo.name}`
                            : linkInfo.name;
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded-full border border-blue-500/10 cursor-default"
                              title={`Linked to ${linkInfo.type}: ${label}`}
                            >
                              <LinkIcon className="h-3 w-3" />
                              {label}
                            </span>
                          );
                        })()}
                        {savingPermission === file.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
                        {file.storage_path && (
                          <button
                            onClick={() => handleDownloadFile(file)}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && !isRenaming && (
                          <button
                            onClick={() => { setRenamingFileId(file.id); setRenameValue(file.name); }}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                            title="Rename"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => handleDeleteFile(file.id)}
                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && file.storage_path && (
                          <button
                            onClick={() => openLinkModal([{ name: file.name, storagePath: file.storage_path! }])}
                            className="p-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all"
                            title="Link to Unit Data"
                          >
                            <LinkIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals ── */}

      {confirmDeleteFolder && (
        <Modal
          isOpen={!!confirmDeleteFolder}
          onClose={() => setConfirmDeleteFolder(null)}
          title="Delete Folder?"
          description={
            <>
              This will permanently delete the folder and all files inside it. This action <span className="text-destructive font-bold uppercase tracking-tighter">cannot be undone</span>.
            </>
          }
          maxWidth="sm"
        >
          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleDeleteFolder(confirmDeleteFolder)}
              className="w-full px-4 py-3 bg-destructive text-destructive-foreground rounded-2xl text-sm font-bold shadow-lg shadow-destructive/20 hover:opacity-90 transition-all active:scale-[0.98]"
            >
              Delete Folder
            </button>
            <button
              onClick={() => setConfirmDeleteFolder(null)}
              className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={showAddCustomField}
        onClose={() => setShowAddCustomField(false)}
        title="Add Custom Field"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Field Name</label>
            <input
              type="text"
              autoFocus
              value={newCustomFieldName}
              onChange={(e) => setNewCustomFieldName(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Enter field name..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Target</label>
            <div className="relative">
              <select
                value={newCustomFieldTarget}
                onChange={(e) => setNewCustomFieldTarget(e.target.value as 'folder' | 'file')}
                className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium appearance-none"
              >
                <option value="file">File</option>
                <option value="folder">Folder</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Warning Message</label>
            <textarea
              value={newCustomFieldWarning}
              onChange={(e) => setNewCustomFieldWarning(e.target.value)}
              className="w-full min-h-[90px] px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Critical alert message..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Ignore Warning Days</label>
            <input
              type="number"
              min={0}
              value={newCustomFieldIgnoreDays}
              onChange={(e) => setNewCustomFieldIgnoreDays(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
            />
          </div>
          <label className="inline-flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-muted-foreground cursor-pointer select-none px-1">
            <input
              type="checkbox"
              checked={newCustomFieldRequired}
              onChange={(e) => setNewCustomFieldRequired(e.target.checked)}
              className="rounded border-border h-4 w-4 text-primary focus:ring-primary/20"
            />
            Required field
          </label>
          <div className="flex flex-col gap-3 mt-6">
            <button
              onClick={handleAddCustomField}
              disabled={!newCustomFieldName.trim()}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              Create Field
            </button>
            <button
              onClick={() => setShowAddCustomField(false)}
              className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showBackupRequest}
        onClose={() => setShowBackupRequest(false)}
        title="Request Backup"
        maxWidth="md"
        description="Request a manual backup from admins/developers when you need a full restore point."
      >
        <div className="space-y-6">
          <textarea
            value={backupReason}
            onChange={(e) => setBackupReason(e.target.value)}
            className="w-full min-h-[120px] px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
            placeholder="Reason for backup request..."
          />
          <div className="flex flex-col gap-3">
            <button
              onClick={handleRequestBackup}
              disabled={!backupReason.trim()}
              className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              Submit Request
            </button>
            <button
              onClick={() => setShowBackupRequest(false)}
              className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
            >
              Cancel
            </button>
          </div>
          {isAdmin && (
            <p className="text-[10px] text-center font-bold tracking-widest uppercase text-primary/60 px-2 leading-tight">
              Admin mode: Fulfill requests in the database management console.
            </p>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        title="Link to Unit Data"
        maxWidth="lg"
        description="Link files to a category or field in Unit Data. A link indicator will appear on the sidebar to highlight linked items."
      >
        <div className="space-y-4 mb-8">
          {unitCategories.length === 0 ? (
            <div className="text-center py-8 bg-muted/20 rounded-2xl border border-dashed border-border/50">
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">No categories found</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 uppercase tracking-tighter">Create categories and fields in Unit Data first.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingLinkFiles.map((item, idx) => {
                const sel = linkSelections.get(idx);
                const selectedValue = sel ? `${sel.type}:${sel.id}` : '';
                return (
                  <div key={idx} className="glass-card bg-muted/10 border border-border/50 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-sm font-bold tracking-tight truncate">{item.name}</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground ml-1">Select Target</label>
                      <div className="relative">
                        <select
                          value={selectedValue}
                          onChange={(e) => {
                            const next = new Map(linkSelections);
                            if (e.target.value) {
                              const [type, id] = e.target.value.split(':') as ['field' | 'category', string];
                              next.set(idx, { type, id });
                            } else {
                              next.delete(idx);
                            }
                            setLinkSelections(next);
                          }}
                          className="w-full px-4 py-2.5 bg-background/50 border border-primary/20 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-bold appearance-none"
                        >
                          <option value="">-- No Link --</option>
                          {unitCategories.map((cat) => (
                            <optgroup key={cat.id} label={cat.name} className="font-bold uppercase tracking-widest text-[10px]">
                              <option value={`category:${cat.id}`}>
                                {cat.name} (Category){cat.linked_file_name ? ` · ALREADY LINKED` : ''}
                              </option>
                              {cat.fields.map((f) => (
                                <option key={f.id} value={`field:${f.id}`}>
                                  ↳ {f.name}{f.linked_file_name ? ` · ALREADY LINKED` : ''}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 shrink-0">
          <button
            disabled={linkingInProgress || linkSelections.size === 0}
            onClick={handleLinkFiles}
            className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {linkingInProgress ? 'Linking...' : 'Link Selected'}
          </button>
          <button
            onClick={() => setShowLinkModal(false)}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold hover:bg-muted transition-all"
          >
            Skip / Cancel
          </button>
        </div>
      </Modal>
    </main>
  );
}
