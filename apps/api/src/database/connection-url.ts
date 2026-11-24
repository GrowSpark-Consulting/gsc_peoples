/**
 * Prisma's CLI understands `?schema=hr` in DATABASE_URL, but the `pg` driver does not.
 * Split it out so the runtime adapter can receive it as the `schema` option instead.
 */
export function parseDatabaseUrl(url: string): { connectionString: string; schema?: string } {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');
  return { connectionString: parsed.toString(), schema };
}
