import { Router } from 'express';
import { getStats } from '../database/import-repository.js';
import type { DashboardStats } from '../../shared/types.js';

export const statsRouter = Router();

// GET /api/stats -> DashboardStats
statsRouter.get('/', (_req, res) => {
  const body: DashboardStats = getStats();
  res.json(body);
});
