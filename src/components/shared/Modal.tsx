import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/shared/Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string | ReactNode;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'fit';
  className?: string;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  fit: 'max-w-fit'
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  className = ''
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalStyle;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-background/40 backdrop-blur-md" 
        onClick={onClose} 
      />
      
      {/* Modal Content */}
      <div 
        className={`glass-card bg-background/90 border border-white/10 rounded-xl p-6 sm:p-8 w-full ${maxWidthClasses[maxWidth]} shadow-2xl relative animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh] overflow-hidden ${className}`}
      >
        <div className="flex items-center justify-between mb-6 shrink-0">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="rounded-full shrink-0"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        {description && (
          <div className="text-sm text-muted-foreground mb-6 leading-relaxed shrink-0">
            {description}
          </div>
        )}
        
        <div className="overflow-y-auto custom-scrollbar -mx-2 px-2 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
