'use client';

import { useState, useCallback } from 'react';
import { listDriveFolderDirect } from '@/lib/db/files';
import type { DriveItem, FileTreeNode } from '@/lib/types/files';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

  /** Load the root-level children for a given Drive folder. */
  const loadRoot = useCallback(async (rootFolderId: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const items = await listDriveFolderDirect(projectId, rootFolderId);
      setTree(itemsToNodes(items));
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
            const items = await listDriveFolderDirect(projectId, node.item.id);
            result.push({
              ...node,
              children: itemsToNodes(items),
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

  return { tree, loading, error, loadRoot, toggleFolder, refresh, flattenTree, setTree };
}
