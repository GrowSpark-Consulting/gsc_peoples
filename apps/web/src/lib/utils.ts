import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge must know the design system's custom type scale (globals.css `--text-*`). Without this
 * it reads `text-body` / `text-label` as a text *colour* and drops a real colour class next to it
 * (e.g. `text-on-primary` on primary buttons), so text fell back to the body ink colour in both themes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'h3', 'body', 'label', 'small', 'caption'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
