import type { TenantDb } from '../../database/tenant';

/**
 * Team scope (PRD section 5): the caller's direct AND indirect reports, resolved on the server from
 * `employees.managerId` inside the caller's company. The result never includes the manager.
 *
 * Breadth-first, one query per level, bounded by `MAX_DEPTH` as a guard (the database already blocks
 * reporting cycles, so this is defence in depth against pathological data). Inactive employees are
 * included: team scope is about the reporting line, status filters are applied by callers.
 */
export const MAX_DEPTH = 25;

export async function resolveTeamEmployeeIds(db: TenantDb, managerEmployeeId: string | null): Promise<string[]> {
  if (!managerEmployeeId) return [];
  const seen = new Set<string>([managerEmployeeId]);
  const team: string[] = [];
  let frontier = [managerEmployeeId];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const reports = await db.employee.findMany({
      where: { managerId: { in: frontier } },
      select: { id: true },
    });
    frontier = [];
    for (const { id } of reports) {
      if (seen.has(id)) continue;
      seen.add(id);
      team.push(id);
      frontier.push(id);
    }
  }
  return team;
}
