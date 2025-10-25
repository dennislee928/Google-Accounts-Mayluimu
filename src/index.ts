/**
 * Main entry point for the Google Account Automation System
 */

import { Logger } from './utils';
import { createGoogleAccountAutomationSystem } from './SystemIntegration';

export * from './types';
export * from './interfaces';
export * from './automation/AccountCreator';
export * from './orchestration/TaskOrchestrator';
export * from './storage/CredentialStore';
export * from './monitoring/MonitoringService';
export * from './utils';
export * from './SystemIntegration';

const logger = new Logger();

async function main(): Promise<void> {
  let system: ReturnType<typeof createGoogleAccountAutomationSystem> | null = null;

  try {
    logger.info('Starting Google Account Automation System');
    
    // Create and initialize the integrated system
    system = createGoogleAccountAutomationSystem();
    
    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      if (system) {
        await system.shutdown();
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      if (system) {
        await system.shutdown();
      }
      process.exit(0);
    });

    // Validate system before starting
    const validation = await system.validateSystem();
    if (!validation.isValid) {
      logger.error('System validation failed', { 
        issues: validation.issues,
        recommendations: validation.recommendations 
      });
      throw new Error('System validation failed');
    }

    // Start the system
    await system.start();
    
    // Log system status
    const status = await system.getSystemStatus();
    logger.info('System started successfully', {
      workers: status.workers,
      health: status.health.status,
      rateLimits: {
        dailyUsage: status.rateLimits.dailyUsage.percentage,
        hourlyUsage: status.rateLimits.hourlyUsage.percentage
      }
    });

    // Example: Create a small batch of accounts for demonstration
    if (process.env.NODE_ENV !== 'production') {
      logger.info('Creating demonstration batch of 2 accounts');
      const taskIds = await system.createAccountBatch(2);
      logger.info('Demonstration batch scheduled', { taskIds });
    }

    logger.info('Google Account Automation System is running. Press Ctrl+C to stop.');
    
  } catch (error) {
    logger.error('Failed to start system', { 
      error: error instanceof Error ? error.message : error 
    });
    
    if (system) {
      try {
        await system.shutdown();
      } catch (shutdownError) {
        logger.error('Failed to shutdown system', { 
          error: shutdownError instanceof Error ? shutdownError.message : shutdownError 
        });
      }
    }
    
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