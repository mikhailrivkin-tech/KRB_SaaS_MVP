import React from 'react';

export interface ProgressBarProps {
  value: number; // 0 to 100
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  label,
  showPercentage = true,
  className = ''
}) => {
  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className={`w-full font-sans-claude ${className}`}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] mb-1.5">
          {label && <span>{label}</span>}
          {showPercentage && <span className="font-mono-claude">{clampedValue}%</span>}
        </div>
      )}
      <div className="w-full h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent-primary)] transition-all duration-300 rounded-full"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
};
