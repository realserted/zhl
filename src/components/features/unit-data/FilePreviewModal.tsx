'use client';

import { lazy, Suspense } from 'react';
import { X, FileText } from 'lucide-react';

const PdfViewer = lazy(() => import('@/components/shared/PdfViewer'));

export interface FilePreviewData {
  url: string;
  name: string;
  htmlContent?: string;
  downloadUrl?: string;
  pdfData?: ArrayBuffer;
}

interface FilePreviewModalProps {
  preview: FilePreviewData | null;
  onClose: () => void;
}

export function FilePreviewModal({ preview, onClose }: FilePreviewModalProps) {
  if (!preview) return null;

  const isDrive = preview.url.includes('drive.google.com');

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-background/95 border border-white/10 rounded-xl shadow-2xl flex flex-col w-full max-w-5xl animate-in fade-in zoom-in duration-200" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <h3 className="text-sm font-bold tracking-tight truncate">{preview.name}</h3>
          <div className="flex items-center gap-2">
            <a
              href={preview.downloadUrl || preview.url}
              download={isDrive ? undefined : preview.name}
              target={isDrive ? '_blank' : undefined}
              rel={isDrive ? 'noopener noreferrer' : undefined}
              className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground hover:text-foreground border border-border/50 rounded-xl transition-all"
            >
              {isDrive ? 'Open in Drive' : 'Download'}
            </a>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Preview content */}
        <div className="flex-1 overflow-hidden p-1">
          {isDrive ? (
            <iframe src={preview.url} className="w-full h-full rounded-lg border-0" title={preview.name} allow="autoplay" sandbox="allow-scripts allow-same-origin allow-popups" />
          ) : preview.htmlContent ? (
            <div className="w-full h-full overflow-auto bg-white rounded-lg p-8" dangerouslySetInnerHTML={{ __html: preview.htmlContent }} style={{ color: '#222', fontSize: '14px', lineHeight: '1.6' }} />
          ) : /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(preview.name) ? (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-4">
              <img src={preview.url} alt={preview.name} className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          ) : /\.(mp4|webm|ogg|mov)$/i.test(preview.name) ? (
            <video src={preview.url} controls className="w-full h-full object-contain rounded-lg" />
          ) : /\.(mp3|wav|aac|flac|ogg)$/i.test(preview.name) ? (
            <div className="w-full h-full flex items-center justify-center">
              <audio src={preview.url} controls className="w-full max-w-md" />
            </div>
          ) : preview.pdfData ? (
            <Suspense fallback={<div className="w-full h-full flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" /></div>}>
              <PdfViewer data={preview.pdfData} />
            </Suspense>
          ) : /\.(txt|html?|csv)$/i.test(preview.name) ? (
            <iframe src={preview.url} className="w-full h-full rounded-lg border-0" title={preview.name} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <FileText className="h-16 w-16 opacity-30" />
              <p className="text-sm font-medium">Preview not available for this file type</p>
              <a href={preview.url} download={preview.name} className="px-4 py-2 text-xs font-bold tracking-wider uppercase bg-primary text-primary-foreground rounded-xl transition-all hover:opacity-90">
                Download to view
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
