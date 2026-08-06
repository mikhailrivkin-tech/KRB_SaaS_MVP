import React, { useState } from 'react';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';
import { Card } from './primitives/Card';
import { Modal } from './primitives/Modal';
import { Badge } from './primitives/Badge';
import { ProgressBar } from './primitives/ProgressBar';
import { useTheme } from './theme-provider/ThemeProvider';
import { MessageSquare, Folder, CheckCircle, AlertTriangle, Moon, Sun, Sparkles } from 'lucide-react';

export const DemoPage: React.FC = () => {
  const { mode, toggleMode, tokens } = useTheme();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [progressVal, setProgressVal] = useState(42);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text-primary)] p-8 font-sans-claude transition-colors duration-200">
      <div className="max-w-4xl mx-auto space-y-10">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--color-border)]">
          <div>
            <h1 className="text-3xl font-serif-claude font-bold tracking-tight">
              Claude.ai Design System Demo
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Компоненты-примитивы, типографика и палитра тёплой бумаги (#F5F4ED)
            </p>
          </div>
          <Button
            variant="secondary"
            icon={mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            onClick={toggleMode}
            aria-label="Переключить тему"
          >
            {mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          </Button>
        </div>

        {/* Buttons Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-serif-claude font-semibold">1. Кнопки (Button)</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" icon={<Sparkles size={16} />}>Primary Terracotta</Button>
            <Button variant="secondary" icon={<MessageSquare size={16} />}>Secondary Paper</Button>
            <Button variant="ghost">Ghost Button</Button>
            <Button variant="danger">Danger Button</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="secondary" size="lg">Large</Button>
            <Button variant="secondary" icon={<Folder size={16} />} aria-label="Папка" />
            <Button variant="primary" disabled>Disabled</Button>
          </div>
        </section>

        {/* Inputs Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-serif-claude font-semibold">2. Поля ввода (Input)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Введите сообщение..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              icon={<MessageSquare size={16} />}
            />
            <Input
              placeholder="Ошибка ввода..."
              error="Обязательное поле не заполнено"
            />
          </div>
        </section>

        {/* Cards & Surfaces */}
        <section className="space-y-4">
          <h2 className="text-xl font-serif-claude font-semibold">3. Карточки (Card)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card interactive onClick={() => setIsModalOpen(true)}>
              <h3 className="text-lg font-serif-claude font-medium mb-1">Юридические вопросы</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                Закрытие юридических вопросов - подготовка, анализ договоров, составление претензий...
              </p>
              <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)]">
                <span>Jul 25, 2026</span>
                <span className="text-[var(--color-accent-primary)] font-medium">Открыть (Modal) →</span>
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-serif-claude font-medium mb-2">Операционный аудитор</h3>
              <ProgressBar value={progressVal} label="24% of project capacity used" showPercentage />
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setProgressVal((p) => Math.min(100, p + 15))}>
                  + Нагрузить (+15%)
                </Button>
              </div>
            </Card>
          </div>
        </section>

        {/* Badges & Statuses */}
        <section className="space-y-4">
          <h2 className="text-xl font-serif-claude font-semibold">4. Статусы и Бейджи (Badge)</h2>
          <div className="flex items-center gap-3">
            <Badge label="Готов к работе" status="success" icon={<CheckCircle size={12} />} />
            <Badge label="Индексация..." status="warning" icon={<AlertTriangle size={12} />} />
            <Badge label="Ошибка загрузки" status="error" />
            <Badge label="Все файлы" status="neutral" />
          </div>
        </section>

        {/* Color Tokens Preview */}
        <section className="space-y-4">
          <h2 className="text-xl font-serif-claude font-semibold">5. Цветовая палитра (Current CSS Variables)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono-claude">
            {Object.entries(tokens).map(([key, val]) => (
              <div key={key} className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg space-y-2">
                <div className="w-full h-8 rounded border border-[var(--color-border)]" style={{ backgroundColor: val }} />
                <div>
                  <div className="font-semibold text-[var(--color-text-primary)] truncate">{key}</div>
                  <div className="text-[var(--color-text-tertiary)]">{val}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Modal Window */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Подтверждение действия"
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Вы успешно открыли модальный диалог в стиле Claude.ai. Все кнопки, поля и поверхности соответствуют тёплому бумажному стилю.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                Отмена
              </Button>
              <Button variant="primary" onClick={() => setIsModalOpen(false)}>
                Понятно
              </Button>
            </div>
          </div>
        </Modal>

      </div>
    </div>
  );
};
