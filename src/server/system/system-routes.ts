import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import { getHrQueue, HR_QUEUE_NAME, hasDatabaseConfig } from '../../lib/hr-background';

export function registerSystemRoutes(app: express.Express) {
  app.get('/api/system/health', async (_req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.json({ success: true });
    }

    try {
      const queue = getHrQueue();
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      res.json({
        success: true,
        queue: { name: HR_QUEUE_NAME, waiting, active, completed, failed, delayed },
        database: { configured: hasDatabaseConfig() },
      });
    } catch (error) {
      logServerError('[System Health] Failed:', error);
      res.status(500).json({ success: false, error: 'Unable to read system health' });
    }
  });
}
