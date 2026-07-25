#!/usr/bin/env node
import { closeSmtp } from './smtp.js';
import { workerConfig } from './config.js';
import { startScheduler } from './scheduler.js';
import { startWorkerServer } from './server.js';
import { ProposalStore } from './store.js';

const store = new ProposalStore({
  path: workerConfig.OUTBOX_PATH,
  approvalTtlMinutes: workerConfig.APPROVAL_TTL_MINUTES
});
await store.initialize();

const scheduler = startScheduler(store);
const httpServer = startWorkerServer(store);

function shutdown(signal: string): void {
  console.error(`[mail-worker] received ${signal}, shutting down`);
  scheduler.stop();
  closeSmtp();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
