'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown, ChevronRight, Folder, Plus, Loader2, ShieldCheck, FileText, Pencil,
  Link as LinkIcon, RefreshCw, ExternalLink, Settings, Archive,
} from 'lucide-react';
import { ProjectPermission } from '@/lib/types/project';
import { useAuth } from '@/lib/auth-context';
import {
  createCustomField,
  getDriveConfig,
  createDriveFolder,
  renameDriveItem,
  archiveDriveItem,
  ensureArchiveFolder,
  updateDriveConfigArchiveId,
  getAllFilePermissions,
  getAllFolderPermissions,
  getCustomFields,
  getLinkedUnitDataMap,
  linkFileToUnitData,
  upsertFilePermissions,
  upsertFolderPermissions,
} from '@/lib/db/files';
import { getGoogleTokenStatus } from '@/lib/db/google-auth';
import { getCategories } from '@/lib/db/unit-data';
import type { CategoryWithFields } from '@/lib/types/unit-data';
import {
  ProjectFileCustomField,
  ProjectFileFolderPermissions,
  ProjectFileItemPermissions,
  ProjectDriveConfig,
  DriveItem,
  FileTreeNode,
} from '@/lib/types/files';
import { usePermission } from '@/lib/hooks/usePermission';
import { useUserLogger } from '@/lib/hooks/useUserLogger';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';
import DriveSetupModal from './DriveSetupModal';
import GoogleConnectBanner from './GoogleConnectBanner';
import { useFileTree } from './useFileTree';
import { FileTreePanel } from './FileTreePanel';
import { FileViewerPanel } from './FileViewerPanel';

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

export default function FilesPage({ selectedProjectId, userPermission }: FilesPageProps) {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const { canEdit } = usePermission(userPermission, 'perm_files');
  const canManagePermissions = !userPermission || (userPermission.project_role?.includes('Project Manager') ?? false);

  const hasFileAccess = useCallback(
    (permEntry: ProjectFileFolderPermissions | ProjectFileItemPermissions | undefined): boolean => {
      if (!userPermission) return true;
      if (!permEntry) return true;
      if (permEntry.allow_all_users) return true;
      const role = userPermission.project_role || '';
      if (permEntry.allow_project_manager && role.includes('Project Manager')) return true;
      if (permEntry.allow_property_manager && role.includes('Property Manager')) return true;
      if (permEntry.allow_accountant && role.includes('Accountant')) return true;
      return false;
    },
    [userPermission],
  );

  const { log } = useUserLogger(selectedProjectId);

  const [loading, setLoading] = useState(false);

  // Drive state
  const [driveConfig, setDriveConfig] = useState<ProjectDriveConfig | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);

  // File tree (lazy-loading)
  const { tree, loading: treeLoading, error: treeError, loadRoot, toggleFolder, refresh } = useFileTree(selectedProjectId);

  // Selected file for viewer
  const [selectedFile, setSelectedFile] = useState<DriveItem | null>(null);
  const [loadingFolderId, setLoadingFolderId] = useState<string | undefined>();

  // Sidebar panel width + resize
  const [treeWidth, setTreeWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);

  // Permissions
  const [showPermissions, setShowPermissions] = useState(false);
  const [allPermissions, setAllPermissions] = useState<Map<string, ProjectFileFolderPermissions>>(new Map());
  const [allFilePermissions, setAllFilePermissions] = useState<Map<string, ProjectFileItemPermissions>>(new Map());
  const [savingPermission, setSavingPermission] = useState<string | null>(null);

  // Custom fields
  const [customFields, setCustomFields] = useState<ProjectFileCustomField[]>([]);
  const [showAddCustomField, setShowAddCustomField] = useState(false);
  const [newCustomFieldName, setNewCustomFieldName] = useState('');
  const [newCustomFieldTarget, setNewCustomFieldTarget] = useState<'folder' | 'file'>('file');
  const [newCustomFieldWarning, setNewCustomFieldWarning] = useState('Missing! This is a critical document!');
  const [newCustomFieldIgnoreDays, setNewCustomFieldIgnoreDays] = useState('90');
  const [newCustomFieldRequired, setNewCustomFieldRequired] = useState(true);

  const [notice, setNotice] = useState<string | null>(null);

  // Rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Archive / folder creation
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Unit linking state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [pendingLinkFiles, setPendingLinkFiles] = useState<Array<{ name: string; driveId: string }>>([]);
  const [unitCategories, setUnitCategories] = useState<CategoryWithFields[]>([]);
  const [unitDataLoaded, setUnitDataLoaded] = useState(false);
  const [linkSelections, setLinkSelections] = useState<Map<number, { type: 'field' | 'category'; id: string }>>(new Map());
  const [linkingInProgress, setLinkingInProgress] = useState(false);
  const [linkedMap, setLinkedMap] = useState<Map<string, { type: 'field' | 'category'; name: string; parentName?: string }>>(new Map());

  // ── Unit linking handlers ─────────────────────────────────────────

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
      const ok = await linkFileToUnitData(target.type, target.id, item.name, item.driveId);
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

  const openLinkModal = (items: Array<{ name: string; driveId: string }>) => {
    setPendingLinkFiles(items);
    setLinkSelections(new Map());
    setShowLinkModal(true);
    loadUnitDataForLinking();
  };

  // ── Google connection ─────────────────────────────────────────────

  const checkGoogleStatus = useCallback(async () => {
    const status = await getGoogleTokenStatus();
    setGoogleConnected(status.connected);
    setGoogleEmail(status.google_email);
  }, []);

  useEffect(() => { checkGoogleStatus(); }, [checkGoogleStatus]);

  useEffect(() => {
    const authStatus = searchParams.get('google_auth');
    if (authStatus === 'success') {
      setNotice('Google Drive connected successfully!');
      checkGoogleStatus();
    } else if (authStatus === 'finalize') {
      const data = searchParams.get('data');
      if (data) {
        (async () => {
          const { finalizeGoogleAuth } = await import('@/lib/db/google-auth');
          const ok = await finalizeGoogleAuth(data);
          if (ok) {
            setNotice('Google Drive connected successfully!');
            checkGoogleStatus();
          } else {
            setNotice('Google Drive connection failed: could not finalize authentication.');
          }
        })();
      }
    } else if (authStatus === 'error') {
      const reason = searchParams.get('reason') || 'unknown';
      setNotice(`Google Drive connection failed: ${reason}`);
    }
  }, [searchParams, checkGoogleStatus]);

  // ── Load config + permissions + tree ──────────────────────────────

  useEffect(() => {
    if (!selectedProjectId) {
      setDriveConfig(null);
      return;
    }

    setUnitDataLoaded(false);
    setUnitCategories([]);
    setSelectedFile(null);

    const load = async () => {
      setLoading(true);
      const [config, fieldData, permData, filePermData] = await Promise.all([
        getDriveConfig(selectedProjectId),
        getCustomFields(selectedProjectId),
        getAllFolderPermissions(selectedProjectId),
        getAllFilePermissions(selectedProjectId),
      ]);

      setDriveConfig(config);
      setCustomFields(fieldData);

      const permMap = new Map<string, ProjectFileFolderPermissions>();
      permData.forEach((p) => permMap.set(p.folder_id, p));
      setAllPermissions(permMap);

      const filePermMap = new Map<string, ProjectFileItemPermissions>();
      filePermData.forEach((p) => filePermMap.set(p.file_id, p));
      setAllFilePermissions(filePermMap);

      getLinkedUnitDataMap(selectedProjectId).then(setLinkedMap);

      // Load file tree (lazy — only root level)
      if (config && googleConnected) {
        await loadRoot(config.root_folder_id);
      }

      setLoading(false);
    };

    load();
  }, [selectedProjectId, googleConnected, loadRoot]);

  // ── Refresh ───────────────────────────────────────────────────────

  const handleRefresh = async () => {
    if (!selectedProjectId || !driveConfig || !googleConnected) return;
    setNotice(null);
    try {
      await refresh(driveConfig.root_folder_id);
      setNotice('Refreshed file tree from Google Drive.');
      log('Refreshed file tree from Google Drive');
    } catch {
      setNotice('Failed to sync from Google Drive.');
    }
  };

  // ── Tree interaction handlers ─────────────────────────────────────

  const handleToggleFolder = useCallback(async (nodeId: string) => {
    setLoadingFolderId(nodeId);
    await toggleFolder(nodeId);
    setLoadingFolderId(undefined);
  }, [toggleFolder]);

  const handleSelectFile = useCallback((node: FileTreeNode) => {
    if (node.item.isFolder) return;
    setSelectedFile(node.item);
    log(`Opened "${node.item.name}" preview`);
  }, [log]);

  // ── Permission toggles ────────────────────────────────────────────

  const togglePermission = async (folderId: string, key: PermissionKey) => {
    if (!canManagePermissions || !selectedProjectId || !user) return;

    const existing = allPermissions.get(folderId);
    const current = existing ?? {
      id: '', project_id: selectedProjectId, folder_id: folderId,
      allow_all_users: false, allow_project_manager: false, allow_property_manager: false,
      allow_accountant: false, allow_anyone_with_link: false, link_enabled: false,
      updated_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };

    const next = { ...current, [key]: !current[key] };
    setAllPermissions((prev) => { const map = new Map(prev); map.set(folderId, next); return map; });
    setSavingPermission(folderId);

    const saved = await upsertFolderPermissions({
      projectId: selectedProjectId, folderId, userId: user.id,
      allow_all_users: next.allow_all_users, allow_project_manager: next.allow_project_manager,
      allow_property_manager: next.allow_property_manager, allow_accountant: next.allow_accountant,
      allow_anyone_with_link: next.allow_anyone_with_link, link_enabled: next.link_enabled,
    });

    if (saved) {
      setAllPermissions((prev) => { const map = new Map(prev); map.set(folderId, saved); return map; });
    }
    setSavingPermission(null);
  };

  const toggleFilePermission = async (fileId: string, key: PermissionKey) => {
    if (!canManagePermissions || !selectedProjectId || !user) return;

    const existing = allFilePermissions.get(fileId);
    const current = existing ?? {
      id: '', project_id: selectedProjectId, file_id: fileId,
      allow_all_users: false, allow_project_manager: false, allow_property_manager: false,
      allow_accountant: false, allow_anyone_with_link: false, link_enabled: false,
      updated_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };

    const next = { ...current, [key]: !current[key] };
    setAllFilePermissions((prev) => { const map = new Map(prev); map.set(fileId, next); return map; });
    setSavingPermission(fileId);

    const saved = await upsertFilePermissions({
      projectId: selectedProjectId, fileId, userId: user.id,
      allow_all_users: next.allow_all_users, allow_project_manager: next.allow_project_manager,
      allow_property_manager: next.allow_property_manager, allow_accountant: next.allow_accountant,
      allow_anyone_with_link: next.allow_anyone_with_link, link_enabled: next.link_enabled,
    });

    if (saved) {
      setAllFilePermissions((prev) => { const map = new Map(prev); map.set(fileId, saved); return map; });
    }
    setSavingPermission(null);
  };

  // ── Folder / file actions ─────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!selectedProjectId || !user || !newFolderName.trim() || !driveConfig) return;

    const targetParentId = driveConfig.root_folder_id;
    const result = await createDriveFolder(selectedProjectId, newFolderName.trim(), targetParentId);
    if (result.ok) {
      log(`Created folder "${newFolderName.trim()}" on Google Drive`);
      setNotice(`Folder "${newFolderName.trim()}" created.`);
      await refresh(driveConfig.root_folder_id);
    } else {
      setNotice(`Failed to create folder: ${result.error || 'unknown error'}`);
    }
    setNewFolderName('');
    setShowNewFolderInput(false);
  };

  const handleRename = async () => {
    if (!renamingId || !renameValue.trim() || !selectedProjectId || !driveConfig) return;
    const ok = await renameDriveItem(selectedProjectId, renamingId, renameValue.trim());
    if (ok) {
      log(`Renamed item to "${renameValue.trim()}" on Google Drive`);
      await refresh(driveConfig.root_folder_id);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleArchiveItem = async (itemId: string) => {
    if (!canEdit || !selectedProjectId || !driveConfig) return;

    // Find the item in the tree
    const findItem = (nodes: FileTreeNode[]): DriveItem | null => {
      for (const n of nodes) {
        if (n.item.id === itemId) return n.item;
        const found = findItem(n.children);
        if (found) return found;
      }
      return null;
    };
    const item = findItem(tree);
    if (!item || !item.parentId) return;

    let archiveId = driveConfig.archive_folder_id;
    if (!archiveId) {
      archiveId = await ensureArchiveFolder(selectedProjectId, driveConfig.root_folder_id);
      if (archiveId) {
        await updateDriveConfigArchiveId(selectedProjectId, archiveId);
        setDriveConfig((prev) => prev ? { ...prev, archive_folder_id: archiveId } : prev);
      }
    }

    if (!archiveId) {
      setNotice('Failed to create ARCHIVE folder.');
      return;
    }

    const ok = await archiveDriveItem(selectedProjectId, itemId, item.parentId, archiveId);
    if (ok) {
      log(`Archived "${item.name}" on Google Drive`);
      setNotice(`"${item.name}" moved to ARCHIVE.`);
      if (selectedFile?.id === itemId) setSelectedFile(null);
      await refresh(driveConfig.root_folder_id);
    } else {
      setNotice(`Failed to archive "${item.name}".`);
    }
    setConfirmArchiveId(null);
  };

  const handleOpenInDrive = (item: DriveItem) => {
    if (item.webViewLink) {
      window.open(item.webViewLink, '_blank', 'noopener,noreferrer');
      log(`Opened "${item.name}" in Google Drive`);
    }
  };

  const handleAddCustomField = async () => {
    if (!selectedProjectId || !user || !newCustomFieldName.trim() || !canEdit) return;
    const created = await createCustomField({
      projectId: selectedProjectId, name: newCustomFieldName.trim(),
      targetType: newCustomFieldTarget, warningMessage: newCustomFieldWarning.trim() || null,
      ignoreWarningDays: newCustomFieldIgnoreDays.trim() ? Number(newCustomFieldIgnoreDays) : null,
      required: newCustomFieldRequired, userId: user.id,
    });
    if (!created) return;
    setCustomFields((prev) => [...prev, created]);
    setNewCustomFieldName('');
    setShowAddCustomField(false);
    log(`Created custom field "${created.name}"`);
  };

  // ── Resize handler ────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      setTreeWidth(Math.max(240, Math.min(600, startWidth + delta)));
    }

    function onMouseUp() {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [treeWidth]);

  // ── Selected item details for permission panel ────────────────────

  const selectedItemPerms = useMemo(() => {
    if (!selectedFile) return null;
    if (selectedFile.isFolder) {
      return { type: 'folder' as const, perms: allPermissions.get(selectedFile.id) };
    }
    return { type: 'file' as const, perms: allFilePermissions.get(selectedFile.id) };
  }, [selectedFile, allPermissions, allFilePermissions]);

  const linkedInfo = useMemo(() => {
    if (!selectedFile) return null;
    return linkedMap.get(selectedFile.isFolder ? `folder:${selectedFile.id}` : selectedFile.id) || linkedMap.get(selectedFile.id) || null;
  }, [selectedFile, linkedMap]);

  // ── Render ────────────────────────────────────────────────────────

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
      <div className="max-w-[1800px] mx-auto space-y-4">
        {/* Google Connect Banner */}
        <GoogleConnectBanner
          connected={googleConnected}
          googleEmail={googleEmail}
          onStatusChange={checkGoogleStatus}
        />

        {/* Setup prompt if not configured */}
        {!driveConfig && (
          <div className="text-center py-16 space-y-4">
            <div className="p-4 rounded-full bg-muted/30 inline-block">
              <Folder className="h-10 w-10 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-widest uppercase text-muted-foreground mb-1">Google Drive not connected</p>
              <p className="text-xs text-muted-foreground/60">Connect a Google Drive folder to manage files for this project.</p>
            </div>
            {canEdit && (
              <Button variant="primary" onClick={() => setShowSetupModal(true)}>
                <Settings className="h-4 w-4 mr-1" />
                Configure Google Drive
              </Button>
            )}
          </div>
        )}

        {/* Main content when configured */}
        {driveConfig && (
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
            {/* ── Left Sidebar ── */}
            <aside className="space-y-4 p-4 glass-card backdrop-blur-md bg-background/80 border border-white/10 rounded-2xl shadow-xl self-start sticky top-20">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 text-blue-500">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-[11px] font-medium leading-relaxed">
                  Files are managed via Google Drive. Changes sync automatically.
                </p>
              </div>

              {/* Permissions toggle */}
              <Button
                variant="ghost" size="sm"
                onClick={() => setShowPermissions((p) => !p)}
                className="text-[10px] font-bold tracking-widest uppercase text-primary hover:text-primary transition-all flex items-center gap-1.5 px-1 h-auto py-1 shadow-none"
              >
                {showPermissions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showPermissions ? 'Hide Permissions' : 'Show Permissions'}
              </Button>

              {/* Actions */}
              <div className="space-y-3 pt-2">
                <Button
                  variant="ghost" size="sm"
                  onClick={handleRefresh}
                  disabled={treeLoading || !googleConnected}
                  className="w-full justify-start items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary transition-all disabled:opacity-50 px-1 h-auto py-1 shadow-none"
                  leftIcon={treeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                >
                  Refresh from Drive
                </Button>

                <Button
                  variant="ghost" size="sm"
                  onClick={() => setShowAddCustomField(true)}
                  disabled={!canEdit}
                  className="w-full justify-start items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary transition-all disabled:opacity-50 px-1 h-auto py-1 shadow-none"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Add Custom Field
                </Button>

                <Button
                  variant="ghost" size="sm"
                  onClick={() => { if (canEdit) setShowNewFolderInput((v) => !v); }}
                  disabled={!canEdit || !googleConnected}
                  className="w-full justify-start items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary transition-all disabled:opacity-50 px-1 h-auto py-1 shadow-none"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Add New Folder
                </Button>
                {showNewFolderInput && (
                  <div className="flex flex-col gap-2 px-1">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateFolder();
                        if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName(''); }
                      }}
                      placeholder="Folder name..."
                      className="w-full px-3 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName.trim()}
                      className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase bg-primary text-primary-foreground rounded-xl disabled:opacity-50 transition-all"
                    >
                      Create on Drive
                    </button>
                  </div>
                )}

                <Button
                  variant="ghost" size="sm"
                  onClick={() => setShowSetupModal(true)}
                  className="w-full justify-start items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary transition-all px-1 h-auto py-1 shadow-none"
                  leftIcon={<Settings className="h-3.5 w-3.5" />}
                >
                  Drive Settings
                </Button>
              </div>

              <div className="h-px bg-white/5 mx-1" />

              {/* Drive folder link */}
              <div className="glass-card bg-muted/20 border border-border/50 rounded-xl p-3 space-y-2">
                <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1.5 px-1">
                  <Folder className="h-3.5 w-3.5 text-amber-500" /> Drive Folder
                </p>
                <a
                  href={driveConfig.root_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-500 hover:text-blue-400 underline underline-offset-4 px-1 flex items-center gap-1"
                >
                  Open in Google Drive <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {notice && (
                <div className="p-2.5 rounded-xl bg-green-500/5 border border-green-500/20 text-green-600 dark:text-green-500 text-[10px] font-bold tracking-wide uppercase px-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {notice}
                </div>
              )}

              {treeLoading && (
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-primary px-3">
                  <Loader2 className="h-3 w-3 animate-spin" /> Syncing...
                </div>
              )}

              {/* ── Selected item details panel ── */}
              {selectedFile && (
                <>
                  <div className="h-px bg-white/5 mx-1" />
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground px-1">Selected Item</p>
                    <div className="flex items-center gap-2 px-1">
                      <div className={`p-1.5 rounded-lg shrink-0 ${selectedFile.isFolder ? 'bg-amber-500/10' : 'bg-blue-500/10'}`}>
                        {selectedFile.isFolder ? <Folder className="h-4 w-4 text-amber-500" /> : <FileText className="h-4 w-4 text-blue-500" />}
                      </div>
                      <span className="text-xs font-bold truncate">{selectedFile.name}</span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {selectedFile.webViewLink && (
                        <button
                          onClick={() => handleOpenInDrive(selectedFile)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-primary/10 text-[10px] font-bold tracking-wider uppercase transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => { setRenamingId(selectedFile.id); setRenameValue(selectedFile.name); }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-primary/10 text-[10px] font-bold tracking-wider uppercase transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Rename
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => setConfirmArchiveId(selectedFile.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-destructive/10 text-[10px] font-bold tracking-wider uppercase text-destructive transition-colors"
                        >
                          <Archive className="h-3 w-3" /> Archive
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => openLinkModal([{
                            name: selectedFile.name,
                            driveId: selectedFile.isFolder ? `folder:${selectedFile.id}` : selectedFile.id,
                          }])}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 hover:bg-blue-500/10 text-[10px] font-bold tracking-wider uppercase text-blue-500 transition-colors"
                        >
                          <LinkIcon className="h-3 w-3" /> Link
                        </button>
                      )}
                    </div>

                    {/* Linked info */}
                    {linkedInfo && (
                      <div className="px-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded-full border border-blue-500/10">
                          <LinkIcon className="h-3 w-3" />
                          {linkedInfo.type === 'field' && linkedInfo.parentName ? `${linkedInfo.parentName} → ${linkedInfo.name}` : linkedInfo.name}
                        </span>
                      </div>
                    )}

                    {/* Rename input */}
                    {renamingId === selectedFile.id && (
                      <div className="flex flex-col gap-2 px-1">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename();
                            if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                          }}
                          className="w-full px-3 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                        />
                        <button onClick={handleRename} className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase bg-primary text-primary-foreground rounded-xl transition-all">
                          Save
                        </button>
                      </div>
                    )}

                    {/* Permission checkboxes */}
                    {showPermissions && canManagePermissions && (
                      <div className="space-y-2 px-1">
                        <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground flex items-center gap-1">
                          Permissions {savingPermission === selectedFile.id && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                        </p>
                        {permissionColumns.map((col) => {
                          const isFolder = selectedFile.isFolder;
                          const perms = isFolder
                            ? allPermissions.get(selectedFile.id)
                            : allFilePermissions.get(selectedFile.id);
                          const checked = Boolean(perms?.[col.key as keyof typeof perms]);
                          return (
                            <label key={col.key} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => isFolder
                                  ? togglePermission(selectedFile.id, col.key)
                                  : toggleFilePermission(selectedFile.id, col.key)
                                }
                                className="rounded border-border h-3.5 w-3.5 text-primary focus:ring-primary/20"
                              />
                              <span className="font-medium text-foreground/80">{col.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>

            {/* ── Right: Split Panel (Tree + Viewer) ── */}
            <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm" style={{ height: 'calc(100vh - 180px)' }}>
              <div className="flex h-full">
                {/* File Tree */}
                <div className="flex-shrink-0 border-r border-border/40" style={{ width: `${treeWidth}px` }}>
                  <FileTreePanel
                    tree={tree}
                    loading={treeLoading}
                    error={treeError}
                    selectedId={selectedFile?.id}
                    loadingId={loadingFolderId}
                    onToggleFolder={handleToggleFolder}
                    onSelectFile={handleSelectFile}
                    showPermissions={showPermissions}
                    canManagePermissions={canManagePermissions}
                    folderPermissions={allPermissions}
                    filePermissions={allFilePermissions}
                    onToggleFolderPermission={togglePermission}
                    onToggleFilePermission={toggleFilePermission}
                  />
                </div>

                {/* Resize handle */}
                <div
                  className={`w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/20 ${isResizing ? 'bg-primary/30' : ''}`}
                  onMouseDown={handleMouseDown}
                />

                {/* File Viewer */}
                <div className="flex-1 overflow-hidden">
                  <FileViewerPanel file={selectedFile} projectId={selectedProjectId} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      <DriveSetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        projectId={selectedProjectId}
        userId={user?.id ?? null}
        onConfigured={async () => {
          const config = await getDriveConfig(selectedProjectId);
          setDriveConfig(config);
          if (config && googleConnected) {
            handleRefresh();
          }
        }}
      />

      {confirmArchiveId && (
        <Modal
          isOpen={!!confirmArchiveId}
          onClose={() => setConfirmArchiveId(null)}
          title="Archive Item?"
          description={
            <>
              This will move the item to the <span className="text-amber-500 font-bold">ARCHIVE</span> folder in Google Drive. You can restore it later from the ARCHIVE folder.
            </>
          }
          maxWidth="sm"
        >
          <div className="flex flex-col gap-3">
            <Button variant="danger" onClick={() => handleArchiveItem(confirmArchiveId)} className="w-full">
              Move to Archive
            </Button>
            <Button variant="outline" onClick={() => setConfirmArchiveId(null)} className="w-full">
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      <Modal isOpen={showAddCustomField} onClose={() => setShowAddCustomField(false)} title="Add Custom Field" maxWidth="md">
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Field Name</label>
            <input
              type="text" autoFocus value={newCustomFieldName} onChange={(e) => setNewCustomFieldName(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Enter field name..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Target</label>
            <div className="relative">
              <select
                value={newCustomFieldTarget} onChange={(e) => setNewCustomFieldTarget(e.target.value as 'folder' | 'file')}
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
              value={newCustomFieldWarning} onChange={(e) => setNewCustomFieldWarning(e.target.value)}
              className="w-full min-h-[90px] px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              placeholder="Critical alert message..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2 ml-1">Ignore Warning Days</label>
            <input
              type="number" min={0} value={newCustomFieldIgnoreDays} onChange={(e) => setNewCustomFieldIgnoreDays(e.target.value)}
              className="w-full px-4 py-3 bg-background/50 border border-primary/20 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
            />
          </div>
          <label className="inline-flex items-center gap-3 text-xs font-bold tracking-wide uppercase text-muted-foreground cursor-pointer select-none px-1">
            <input type="checkbox" checked={newCustomFieldRequired} onChange={(e) => setNewCustomFieldRequired(e.target.checked)}
              className="rounded border-border h-4 w-4 text-primary focus:ring-primary/20" />
            Required field
          </label>
          <div className="flex flex-col gap-3 mt-6">
            <Button onClick={handleAddCustomField} disabled={!newCustomFieldName.trim()} className="w-full">Create Field</Button>
            <Button variant="outline" onClick={() => setShowAddCustomField(false)} className="w-full">Cancel</Button>
          </div>
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
          <Button isLoading={linkingInProgress} disabled={linkSelections.size === 0} onClick={handleLinkFiles} className="w-full">
            Link Selected
          </Button>
          <Button variant="outline" onClick={() => setShowLinkModal(false)} className="w-full">
            Skip / Cancel
          </Button>
        </div>
      </Modal>
    </main>
  );
}
