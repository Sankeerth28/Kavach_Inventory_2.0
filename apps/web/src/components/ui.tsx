'use client';

import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
} from 'react';
import { cn } from '@/lib/utils';

/** Small set of building blocks. Large controls and plain language (PRD §25.4). */

const control =
  'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors ' +
  'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-60';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-xs',
        variant === 'primary' &&
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        variant === 'secondary' &&
          'border border-primary/30 bg-surface text-primary hover:bg-primary-soft',
        variant === 'danger' && 'bg-danger text-white shadow-sm hover:opacity-90',
        variant === 'ghost' && 'hover:bg-primary-soft hover:text-primary',
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props} className={cn(control, 'h-auto py-2', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, className)} />;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
        tone === 'success' && 'border-success/40 bg-success/10 text-success',
        tone === 'warning' && 'border-warning/50 bg-warning/15 text-foreground',
        tone === 'danger' && 'border-danger/40 bg-danger/10 text-danger',
        tone === 'info' && 'border-primary/30 bg-primary-soft text-primary-hover',
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'danger',
  title,
  children,
}: {
  tone?: 'danger' | 'warning' | 'info' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'danger' && 'border-danger/40 bg-danger/10',
        tone === 'warning' && 'border-warning/50 bg-warning/15',
        tone === 'info' && 'border-primary/30 bg-primary-soft',
        tone === 'success' && 'border-success/40 bg-success/10',
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-sidebar/40 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'w-full overflow-hidden rounded-xl border border-border bg-surface shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-primary/20 bg-primary-soft/60 px-5 py-3">
          <h2 className="text-base font-semibold text-primary-hover">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Table shell: horizontal scroll inside the card, never the page. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-primary/15 bg-primary-soft/60 text-xs text-primary-hover uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr]:transition-colors [&>tr:hover]:bg-muted/60">
          {children}
        </tbody>
      </table>
    </Card>
  );
}

export function Td({ className, children }: { className?: string; children?: ReactNode }) {
  return <td className={cn('px-4 py-2.5 align-middle', className)}>{children}</td>;
}

/** Loading, error and empty states for a list, so every page shows the same thing. */
export function ListState({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (error) return <Alert>{error}</Alert>;
  if (empty) return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return null;
}
