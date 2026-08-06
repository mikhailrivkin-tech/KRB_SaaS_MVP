import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md'
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  let sizeStyles = 'max-w-md';
  if (size === 'sm') sizeStyles = 'max-w-sm';
  if (size === 'lg') sizeStyles = 'max-w-2xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Flat backdrop (no heavy blur per Claude design system spec) */}
      <div
        className="fixed inset-0 bg-black/40 transition-opacity"
        onClick={onClose}
      />

      <div
        className={`relative w-full ${sizeStyles} bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 shadow-2xl transition-all transform scale-100 z-10 font-sans-claude`}
      >
        {title && (
          <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)] mb-4">
            <h3 className="text-xl font-serif-claude font-semibold text-[var(--color-text-primary)]">
              {title}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={18} />}
              onClick={onClose}
              aria-label="Закрыть модальное окно"
            />
          </div>
        )}
        <div>{children}</div>
      </div>
    </div>
  );
};
