#!/usr/bin/env node
import 'dotenv/config';
import { startQueueProcessor } from './runtime/queue-runtime';
export { processMessageForTest } from './runtime/process-message';
export { startQueueProcessor } from './runtime/queue-runtime';

if (require.main === module) startQueueProcessor();
