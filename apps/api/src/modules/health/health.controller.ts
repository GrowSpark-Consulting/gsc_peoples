import type { RequestHandler } from 'express';
import { getHealth } from './health.service';

export const readinessController: RequestHandler = async (_req, res) => {
  const health = await getHealth();
  const ready = health.dependencies.database === 'up';
  res.status(ready ? 200 : 503).json({ ...health, status: ready ? 'ok' : 'degraded' });
};

export const healthController: RequestHandler = async (_req, res) => {
  res.json(await getHealth());
};
