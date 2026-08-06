import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface DropdownOption {
  id: string;
  name: string;
  description?: string;
}

interface DropdownSelectProps {
  options: DropdownOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}

export const DropdownSelect: React.FC<DropdownSelectProps> = ({ options, value, onChange, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.id === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {label && <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mr-2">{label}</span>}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-between gap-2 px-3.5 py-1.5 bg-[var(--color-surface)] hover:bg-[var(--color-surface-strong)] border border-[var(--color-border)] rounded-xl text-sm font-serif-claude font-semibold text-[var(--color-text-primary)] transition-all cursor-pointer shadow-xs focus:outline-none focus:border-[var(--color-accent-primary)]"
      >
        <span>{selectedOption?.name || 'Выберите ассистента'}</span>
        <ChevronDown size={14} className={`text-[var(--color-text-tertiary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-56 rounded-2xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] shadow-xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-[10px] uppercase font-semibold text-[var(--color-text-tertiary)] border-b border-[var(--color-border)] mb-1">
            Доступные ассистенты
          </div>
          {options.map((opt) => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2 text-sm flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-[var(--color-surface-strong)] font-semibold text-[var(--color-accent-primary)]'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <div className="font-serif-claude">{opt.name}</div>
                {isSelected && <Check size={14} className="text-[var(--color-accent-primary)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
