import { Router } from 'express';
import { healthController, readinessController } from './health.controller';

export const healthRouter: Router = Router();

// Public: no authentication, used by load balancers and local checks.
healthRouter.get('/health', healthController);
// Readiness: 503 while the database is unreachable. `/health` stays 200 ("degraded") so a platform health check
// does not restart-loop the service during a database outage; this one is for operators and smoke tests.
healthRouter.get('/health/ready', readinessController);
