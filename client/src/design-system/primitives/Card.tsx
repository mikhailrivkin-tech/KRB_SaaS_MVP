import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  padding = 'md',
  interactive = false,
  className = '',
  ...props
}) => {
  let paddingStyles = '';
  switch (padding) {
    case 'none': paddingStyles = 'p-0'; break;
    case 'sm': paddingStyles = 'p-3'; break;
    case 'md': paddingStyles = 'p-5'; break;
    case 'lg': paddingStyles = 'p-7'; break;
  }

  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl transition-all duration-150 ${paddingStyles} ${
        interactive
          ? 'cursor-pointer hover:border-[var(--color-accent-primary)] hover:bg-[var(--color-surface-strong)]'
          : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
