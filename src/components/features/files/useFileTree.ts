'use client';

import { useState, useCallback, useRef } from 'react';
import { listDriveFolderDirect } from '@/lib/db/files';
import type { DriveItem, FileTreeNode } from '@/lib/types/files';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** localStorage key for custom sort orders per folder */
function sortKey(projectId: string, folderId: string) {
  return `file-order:${projectId}:${folderId}`;
}

function applySortOrder(nodes: FileTreeNode[], projectId: string, folderId: string): FileTreeNode[] {
  try {
    const raw = localStorage.getItem(sortKey(projectId, folderId));
    if (!raw) return nodes;
    const order: string[] = JSON.parse(raw);
    const indexMap = new Map(order.map((id, i) => [id, i]));
    // Sort known items by stored order, unknown items go to the end in original order
    return [...nodes].sort((a, b) => {
      const ai = indexMap.get(a.item.id);
      const bi = indexMap.get(b.item.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
  } catch {
    return nodes;
  }
}

function saveSortOrder(nodes: FileTreeNode[], projectId: string, folderId: string) {
  const ids = nodes.map((n) => n.item.id);
  localStorage.setItem(sortKey(projectId, folderId), JSON.stringify(ids));
}

function itemsToNodes(items: DriveItem[]): FileTreeNode[] {
  return items
    .filter((i) => i.name !== 'ARCHIVE')
    .map((item) => ({
      item,
      children: [],
      isLoaded: false,
      isExpanded: false,
    }));
}

export function useFileTree(projectId: string | null) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const rootFolderIdRef = useRef<string | null>(null);

  /** Load the root-level children for a given Drive folder. */
  const loadRoot = useCallback(async (rootFolderId: string) => {
    if (!projectId) return;
    rootFolderIdRef.current = rootFolderId;
    setLoading(true);
    setError(null);
    try {
      const { items, ownerEmail: email } = await listDriveFolderDirect(projectId, rootFolderId);
      const nodes = itemsToNodes(items);
      setTree(applySortOrder(nodes, projectId, rootFolderId));
      if (email) setOwnerEmail(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** Toggle a folder open/closed; lazy-loads children on first expand. */
  const toggleFolder = useCallback(async (nodeId: string) => {
    if (!projectId) return;

    const updateNodes = async (nodes: FileTreeNode[]): Promise<FileTreeNode[]> => {
      const result: FileTreeNode[] = [];
      for (const node of nodes) {
        if (node.item.id === nodeId) {
          if (!node.isLoaded && node.item.mimeType === FOLDER_MIME) {
            const { items } = await listDriveFolderDirect(projectId, node.item.id);
            const children = itemsToNodes(items);
            result.push({
              ...node,
              children: applySortOrder(children, projectId, node.item.id),
              isLoaded: true,
              isExpanded: true,
            });
          } else {
            result.push({ ...node, isExpanded: !node.isExpanded });
          }
        } else {
          result.push({
            ...node,
            children: await updateNodes(node.children),
          });
        }
      }
      return result;
    };

    const updated = await updateNodes(tree);
    setTree(updated);
  }, [projectId, tree]);

  /** Reorder a node within its sibling list. */
  const reorderNode = useCallback((dragId: string, targetId: string, position: 'before' | 'after', parentFolderId: string) => {
    if (!projectId) return;

    const reorderChildren = (nodes: FileTreeNode[]): FileTreeNode[] => {
      // Check if both drag and target are in this list
      const dragIdx = nodes.findIndex((n) => n.item.id === dragId);
      const targetIdx = nodes.findIndex((n) => n.item.id === targetId);

      if (dragIdx !== -1 && targetIdx !== -1) {
        const updated = [...nodes];
        const [dragged] = updated.splice(dragIdx, 1);
        const newTargetIdx = updated.findIndex((n) => n.item.id === targetId);
        const insertIdx = position === 'before' ? newTargetIdx : newTargetIdx + 1;
        updated.splice(insertIdx, 0, dragged);
        // Persist the new order
        saveSortOrder(updated, projectId, parentFolderId);
        return updated;
      }

      // Otherwise recurse into children
      return nodes.map((node) => ({
        ...node,
        children: reorderChildren(node.children),
      }));
    };

    setTree((prev) => reorderChildren(prev));
  }, [projectId]);

  /** Refresh: reload the root. */
  const refresh = useCallback(async (rootFolderId: string) => {
    await loadRoot(rootFolderId);
  }, [loadRoot]);

  /** Collect all DriveItems from the tree (for permission lookups, etc.). */
  const flattenTree = useCallback((nodes: FileTreeNode[] = tree): DriveItem[] => {
    const result: DriveItem[] = [];
    for (const node of nodes) {
      result.push(node.item);
      if (node.children.length > 0) {
        result.push(...flattenTree(node.children));
      }
    }
    return result;
  }, [tree]);

  return { tree, loading, error, loadRoot, toggleFolder, reorderNode, refresh, flattenTree, setTree, ownerEmail };
}
