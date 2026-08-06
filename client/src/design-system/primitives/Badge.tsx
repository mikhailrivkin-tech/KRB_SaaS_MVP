import React from 'react';

export interface BadgeProps {
  label: string;
  status?: 'success' | 'error' | 'warning' | 'neutral';
  icon?: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  status = 'neutral',
  icon,
  className = ''
}) => {
  let statusStyles = '';
  switch (status) {
    case 'success':
      statusStyles = 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20';
      break;
    case 'error':
      statusStyles = 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/20';
      break;
    case 'warning':
      statusStyles = 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20';
      break;
    case 'neutral':
      statusStyles = 'bg-[var(--color-surface-strong)] text-[var(--color-text-secondary)] border-[var(--color-border)]';
      break;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium font-sans-claude border rounded-full ${statusStyles} ${className}`}>
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{label}</span>
    </span>
  );
};
