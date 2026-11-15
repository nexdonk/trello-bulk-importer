import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, CLIENT_DIST, CLIENT_ROOT, ROOT_DIR } from './config.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { initDatabase } from './database/db.js';
import { cleanupStaleUploads } from './services/upload-store.js';
import { recoverInterruptedImports } from './imports/import-engine.js';

async function main(): Promise<void> {
  initDatabase();
  recoverInterruptedImports();
  cleanupStaleUploads();

  const app = createApp();

  if (config.isProduction) {
    if (!fs.existsSync(CLIENT_DIST)) {
      logger.error('dist/client not found. Run "npm run build" first.');
      process.exit(1);
    }
    app.use(express.static(CLIENT_DIST, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(ROOT_DIR, 'vite.config.ts'),
      root: CLIENT_ROOT,
      server: { middlewareMode: true, hmr: { port: config.port + 10000 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const primary = app.listen(config.port, config.host);
  primary.once('error', (err: NodeJS.ErrnoException) => {
    logger.error(
      err.code === 'EADDRINUSE'
        ? `Port ${config.port} is already in use on ${config.host}. Stop the other process or set PORT in .env.`
        : err,
    );
    process.exit(1);
  });
  primary.once('listening', () => {
    if (config.host !== '127.0.0.1') {
      logger.info(`Trello Bulk Importer running at http://${config.host}:${config.port}`);
      return;
    }
    // Browsers often resolve "localhost" to IPv6 ::1 first, so listen on the IPv6 loopback too.
    const v6 = app.listen(config.port, '::1');
    v6.once('listening', () => logger.info(`Trello Bulk Importer running at http://localhost:${config.port}`));
    v6.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          `Another process is using [::1]:${config.port}, so "localhost" may open that app instead. ` +
            `Use http://127.0.0.1:${config.port} or set a different PORT in .env.`,
        );
      }
      logger.info(`Trello Bulk Importer running at http://127.0.0.1:${config.port}`);
    });
  });
}

main().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
