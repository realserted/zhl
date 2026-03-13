'use client';

import { useState, useRef, useCallback } from 'react';

/**
 * Hook for resizable table columns via mouse drag on header handles.
 *
 * @param defaultWidth - Fallback width for columns without a stored width (default: 120)
 * @returns columnWidths map, getWidth helper, and onResizeStart handler
 */
export function useColumnResize(defaultWidth = 120) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const getWidth = useCallback(
    (col: string, override?: number) => columnWidths[col] ?? override ?? defaultWidth,
    [columnWidths, defaultWidth]
  );

  const onResizeStart = useCallback(
    (col: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = columnWidths[col] ?? defaultWidth;
      resizingRef.current = { col, startX, startW };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(60, startW + delta);
        setColumnWidths((prev) => ({ ...prev, [col]: newWidth }));
      };

      const onMouseUp = () => {
        resizingRef.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [columnWidths, defaultWidth]
  );

  return { columnWidths, getWidth, onResizeStart };
}
