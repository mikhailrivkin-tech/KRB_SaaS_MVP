import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  'aria-label': ariaLabel,
  ...props
}) => {
  // If icon-only button, fallback aria-label to prevent accessibility issues
  const effectiveAriaLabel = ariaLabel || (typeof children === 'string' ? children : undefined);

  let variantStyles = '';
  switch (variant) {
    case 'primary':
      variantStyles = 'bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-secondary)] text-white font-medium border-transparent shadow-none';
      break;
    case 'secondary':
      variantStyles = 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-primary)] border-[var(--color-border)]';
      break;
    case 'ghost':
      variantStyles = 'bg-transparent hover:bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border-transparent';
      break;
    case 'danger':
      variantStyles = 'bg-[var(--color-error)] hover:opacity-90 text-white border-transparent';
      break;
  }

  let sizeStyles = '';
  switch (size) {
    case 'sm':
      sizeStyles = children ? 'px-2.5 py-1 text-xs gap-1.5 rounded-md' : 'p-1 text-xs rounded-md';
      break;
    case 'md':
      sizeStyles = children ? 'px-3.5 py-1.5 text-sm gap-2 rounded-lg' : 'p-2 text-sm rounded-lg';
      break;
    case 'lg':
      sizeStyles = children ? 'px-4 py-2 text-base gap-2.5 rounded-lg' : 'p-2.5 text-base rounded-lg';
      break;
  }

  return (
    <button
      aria-label={effectiveAriaLabel}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-sans-claude border transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles} ${sizeStyles} ${className}`}
      {...props}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
};
