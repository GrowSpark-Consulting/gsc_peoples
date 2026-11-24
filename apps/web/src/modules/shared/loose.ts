/** Safe readers for API fields typed as `Record<string, unknown>` in the contracts. Nothing is invented. */
export type Loose = Record<string, unknown>;
export const str = (r: Loose, k: string): string | undefined =>
  typeof r[k] === 'string' ? (r[k] as string) : undefined;
export const num = (r: Loose, k: string): number | undefined =>
  typeof r[k] === 'number' ? (r[k] as number) : undefined;
export const bool = (r: Loose, k: string): boolean | undefined =>
  typeof r[k] === 'boolean' ? (r[k] as boolean) : undefined;
export const obj = (r: Loose, k: string): Loose | undefined =>
  typeof r[k] === 'object' && r[k] !== null && !Array.isArray(r[k]) ? (r[k] as Loose) : undefined;
