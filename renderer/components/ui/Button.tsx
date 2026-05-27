'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'ghost' | 'danger' | 'primary';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  default:
    'border border-edge/10 bg-surface text-ink hover:border-accent/60 hover:bg-surface',
  ghost: 'border border-transparent bg-transparent text-ink hover:bg-surface',
  primary:
    'border border-accent/60 bg-accent/15 text-accent hover:bg-accent/25',
  danger:
    'border border-danger/40 bg-transparent text-danger hover:bg-danger/10',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-8 px-3 text-sm rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 transition-colors duration-150',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  );
});
