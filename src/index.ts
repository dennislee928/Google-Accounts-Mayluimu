/**
 * Main entry point for the Google Account Automation System
 */

import { Logger, loadConfig } from './utils';

export * from './types';
export * from './interfaces';
export * from './automation/AccountCreator';
export * from './orchestration/TaskOrchestrator';
export * from './storage/CredentialStore';
export * from './monitoring/MonitoringService';
export * from './utils';

const logger = new Logger();

async function main(): Promise<void> {
  try {
    logger.info('Starting Google Account Automation System');
    
    const config = loadConfig();
    logger.info('Configuration loaded', { 
      maxWorkers: config.workers.maxConcurrentWorkers,
      storageProvider: config.storage.provider,
      rateLimit: config.rateLimit 
    });

    // System initialization will be implemented in subsequent tasks
    logger.info('System initialization placeholder - to be implemented in orchestration tasks');
    
  } catch (error) {
    logger.error('Failed to start system', { error: error instanceof Error ? error.message : error });
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}