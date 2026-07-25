#!/usr/bin/env node
import { closeSmtp, verifySmtp } from './smtp.js';

try {
  await verifySmtp();
  console.log(JSON.stringify({ status: 'ok', service: 'smtp' }));
} finally {
  closeSmtp();
}
