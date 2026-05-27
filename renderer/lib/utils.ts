import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine class names with proper tailwind conflict resolution.
 * Example: cn('p-2', someCondition && 'p-4') → 'p-4' (later one wins)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
