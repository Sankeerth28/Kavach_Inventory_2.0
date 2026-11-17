import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names; the helper every shadcn/ui component imports. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
