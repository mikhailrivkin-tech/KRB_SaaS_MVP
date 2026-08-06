import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  error,
  icon,
  className = '',
  disabled,
  ...props
}, ref) => {
  return (
    <div className="w-full font-sans-claude">
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-3 text-[var(--color-text-tertiary)] pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          disabled={disabled}
          className={`w-full bg-[var(--color-surface-strong)] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)] disabled:opacity-50 disabled:bg-[var(--color-bg)] ${
            icon ? 'pl-9' : ''
          } ${error ? 'border-[var(--color-error)]' : ''} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-[var(--color-error)] font-sans-claude">{error}</p>
      )}
    </div>
  );
});

Input.displayName = 'Input';
