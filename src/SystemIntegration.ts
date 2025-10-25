/**
 * Final System Integration and Validation
 * Main system orchestrator that brings all components together
 */

import { TaskOrchestrator, TaskOrchestratorConfig } from './orchestration/TaskOrchestrator';
import { AccountCreator, AccountCreatorConfig } from './automation/AccountCreator';
import { CredentialStore, DatabaseConfig } from './storage/CredentialStore';
import { MonitoringService } from './monitoring/MonitoringService';
import { SystemConfig, WorkerStatus } from './types';
import { Logger, loadConfig } from './utils';
import { EventEmitter } from 'events';

export interface SystemIntegrationConfig {
  orchestrator: TaskOrchestratorConfig;
  accountCreator: AccountCreatorConfig;
  database: DatabaseConfig;
  system: SystemConfig;
}

export class GoogleAccountAutomationSystem extends EventEmitter {
  private config: SystemIntegrationConfig;
  private logger: Logger;
  private orchestrator!: TaskOrchestrator;
  private credentialStore!: CredentialStore;
  private monitoring!: MonitoringService;
  private workers: Map<string, AccountCreator>;
  private isRunning: boolean = false;

  constructor(config?: Partial<SystemIntegrationConfig>) {
    super();
    
    // Load system configuration
    const systemConfig = loadConfig();
    
    this.config = {
      orchestrator: {
        maxConcurrentTasks: 10,
        taskTimeoutMs: 300000, // 5 minutes
        workerHealthCheckIntervalMs: 30000, // 30 seconds
        retryDelayMs: 60000, // 1 minute
        maxRetryAttempts: 3
      },
      accountCreator: {
        puppeteerConfig: systemConfig.workers.puppeteerConfig,
        credentialGeneratorConfig: {
          usernameLength: 12,
          passwordLength: 16,
          includeNumbers: true,
          includeSymbols: true,
          avoidSimilarChars: true,
          enforceComplexity: true
        },
        workerProxyUrl: process.env.CLOUDFLARE_WORKER_URL,
        tempEmailApiUrl: process.env.TEMP_EMAIL_API_URL,
        credentialStorageUrl: process.env.CREDENTIAL_STORAGE_URL,
        maxRetries: 3,
        timeoutMs: 60000
      },
      database: {
        provider: 'sqlite',
        connectionString: systemConfig.storage.connectionString || 'sqlite:./accounts.db',
        encryptionKey: systemConfig.storage.encryptionKey
      },
      system: systemConfig,
      ...config
    };

    this.logger = new Logger(undefined, 'system');
    this.workers = new Map();
    
    this.initializeSystem();
  }

  /**
   * Initialize all system components
   */
  private async initializeSystem(): Promise<void> {
    try {
      this.logger.info('Initializing Google Account Automation System');

      // Initialize monitoring first
      this.monitoring = new MonitoringService();
      this.setupMonitoringAlerts();

      // Initialize credential storage
      this.credentialStore = new CredentialStore(this.config.database);

      // Initialize task orchestrator
      this.orchestrator = new TaskOrchestrator(
        this.config.orchestrator,
        this.config.system
      );

      // Setup event handlers
      this.setupEventHandlers();

      // Initialize default workers
      await this.initializeWorkers();

      this.logger.info('System initialization completed successfully');
      this.emit('systemInitialized');

    } catch (error) {
      this.logger.error('System initialization failed', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Start the automation system
   */
  async start(): Promise<void> {
    try {
      if (this.isRunning) {
        this.logger.warn('System is already running');
        return;
      }

      this.logger.info('Starting Google Account Automation System');

      // Perform system health check
      const healthStatus = await this.monitoring.getHealthStatus();
      if (healthStatus.status === 'unhealthy') {
        throw new Error('System health check failed - cannot start');
      }

      // Resume orchestrator operations
      await this.orchestrator.resumeOperations();

      this.isRunning = true;
      this.logger.info('System started successfully');
      this.emit('systemStarted');

    } catch (error) {
      this.logger.error('Failed to start system', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Stop the automation system
   */
  async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        this.logger.warn('System is not running');
        return;
      }

      this.logger.info('Stopping Google Account Automation System');

      // Pause orchestrator operations
      await this.orchestrator.pauseOperations();

      // Cleanup workers
      await this.cleanupWorkers();

      this.isRunning = false;
      this.logger.info('System stopped successfully');
      this.emit('systemStopped');

    } catch (error) {
      this.logger.error('Failed to stop system', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Shutdown the entire system
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down Google Account Automation System');

      // Stop system if running
      if (this.isRunning) {
        await this.stop();
      }

      // Shutdown all components
      await this.orchestrator.shutdown();
      await this.credentialStore.close();
      this.monitoring.shutdown();

      // Cleanup all workers
      await this.cleanupWorkers();

      this.logger.info('System shutdown completed');
      this.emit('systemShutdown');

    } catch (error) {
      this.logger.error('System shutdown failed', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Create batch of Google accounts
   */
  async createAccountBatch(batchSize: number): Promise<string[]> {
    try {
      if (!this.isRunning) {
        throw new Error('System is not running');
      }

      this.logger.info('Creating account batch', { batchSize });

      const taskIds = await this.orchestrator.scheduleAccountCreation(batchSize);
      
      this.logger.info('Account batch scheduled', { 
        batchSize, 
        taskIds: taskIds.length 
      });

      return taskIds;

    } catch (error) {
      this.logger.error('Failed to create account batch', { 
        error: error instanceof Error ? error.message : error,
        batchSize 
      });
      throw error;
    }
  }

  /**
   * Get system status and metrics
   */
  async getSystemStatus(): Promise<{
    isRunning: boolean;
    orchestrator: Awaited<ReturnType<TaskOrchestrator['getSystemStatus']>>;
    rateLimits: ReturnType<TaskOrchestrator['getRateLimitStatus']>;
    health: Awaited<ReturnType<MonitoringService['getHealthStatus']>>;
    metrics: Awaited<ReturnType<MonitoringService['getMetrics']>>;
    storage: Awaited<ReturnType<CredentialStore['getStats']>>;
    workers: { total: number; active: number; idle: number; failed: number };
  }> {
    try {
      const [orchestratorStatus, rateLimits, health, metrics, storageStats] = await Promise.all([
        this.orchestrator.getSystemStatus(),
        this.orchestrator.getRateLimitStatus(),
        this.monitoring.getHealthStatus(),
        this.monitoring.getMetrics(),
        this.credentialStore.getStats()
      ]);

      const workerStats = {
        total: this.workers.size,
        active: 0,
        idle: 0,
        failed: 0
      };

      // Count worker statuses (would need to track this in real implementation)
      
      return {
        isRunning: this.isRunning,
        orchestrator: orchestratorStatus,
        rateLimits,
        health,
        metrics,
        storage: storageStats,
        workers: workerStats
      };

    } catch (error) {
      this.logger.error('Failed to get system status', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Export created accounts
   */
  async exportAccounts(filePath: string): Promise<void> {
    try {
      await this.credentialStore.exportToCSV(filePath);
      this.logger.info('Accounts exported successfully', { filePath });

    } catch (error) {
      this.logger.error('Failed to export accounts', { 
        error: error instanceof Error ? error.message : error,
        filePath 
      });
      throw error;
    }
  }

  /**
   * Initialize worker instances
   */
  private async initializeWorkers(): Promise<void> {
    const workerCount = this.config.system.workers.maxConcurrentWorkers;
    
    this.logger.info('Initializing workers', { count: workerCount });

    for (let i = 0; i < workerCount; i++) {
      const workerId = `worker_${i + 1}`;
      
      try {
        const worker = new AccountCreator(this.config.accountCreator, workerId);
        this.workers.set(workerId, worker);
        
        // Register worker with orchestrator
        this.orchestrator.registerWorker(workerId);
        
        this.logger.info('Worker initialized', { workerId });

      } catch (error) {
        this.logger.error('Failed to initialize worker', { 
          error: error instanceof Error ? error.message : error,
          workerId 
        });
      }
    }

    this.logger.info('Worker initialization completed', { 
      total: this.workers.size 
    });
  }

  /**
   * Cleanup all workers
   */
  private async cleanupWorkers(): Promise<void> {
    this.logger.info('Cleaning up workers');

    const cleanupPromises = Array.from(this.workers.entries()).map(
      async ([workerId, worker]) => {
        try {
          await worker.cleanup();
          this.orchestrator.unregisterWorker(workerId);
        } catch (error) {
          this.logger.error('Worker cleanup failed', { 
            error: error instanceof Error ? error.message : error,
            workerId 
          });
        }
      }
    );

    await Promise.all(cleanupPromises);
    this.workers.clear();

    this.logger.info('Worker cleanup completed');
  }

  /**
   * Setup event handlers between components
   */
  private setupEventHandlers(): void {
    // Orchestrator events
    this.orchestrator.on('taskCompleted', ({ task, worker }: any) => {
      this.monitoring.recordMetrics({
        totalAccountsCreated: this.monitoring['metrics'].totalAccountsCreated + 1
      });
      this.emit('accountCreated', { task, worker });
    });

    this.orchestrator.on('taskFailed', ({ task, worker, error }: any) => {
      this.monitoring.recordMetrics({
        failedTasks: this.monitoring['metrics'].failedTasks + 1
      });
      this.emit('accountCreationFailed', { task, worker, error });
    });

    this.orchestrator.on('systemHealthUpdate', (metrics: any) => {
      this.monitoring.recordMetrics(metrics);
    });

    // Monitoring events
    this.monitoring.on('alertTriggered', (alert: any) => {
      this.logger.warn('System alert triggered', alert);
      this.emit('systemAlert', alert);
    });

    this.monitoring.on('healthStatusUpdate', (status: any) => {
      if (status.status === 'unhealthy' && this.isRunning) {
        this.logger.error('System health degraded', status);
        this.emit('systemHealthDegraded', status);
      }
    });
  }

  /**
   * Setup monitoring alerts
   */
  private setupMonitoringAlerts(): void {
    // Low success rate alert
    this.monitoring.setAlertRule({
      id: 'low_success_rate',
      name: 'Low Success Rate',
      condition: 'success_rate_low',
      threshold: 0.7, // 70%
      enabled: true,
      notificationChannels: ['default']
    });

    // High CAPTCHA rate alert
    this.monitoring.setAlertRule({
      id: 'high_captcha_rate',
      name: 'High CAPTCHA Encounter Rate',
      condition: 'captcha_rate_high',
      threshold: 0.3, // 30%
      enabled: true,
      notificationChannels: ['default']
    });

    // No active workers alert
    this.monitoring.setAlertRule({
      id: 'no_workers',
      name: 'No Active Workers',
      condition: 'no_active_workers',
      threshold: 0,
      enabled: true,
      notificationChannels: ['default']
    });

    // Add default notification channel
    this.monitoring.addNotificationChannel({
      id: 'default',
      type: 'email',
      config: { email: 'admin@example.com' },
      enabled: true
    });
  }

  /**
   * Perform system validation
   */
  async validateSystem(): Promise<{
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check system health
      const health = await this.monitoring.getHealthStatus();
      if (health.status !== 'healthy') {
        issues.push(`System health is ${health.status}`);
        recommendations.push('Check failed health checks and resolve issues');
      }

      // Check worker availability
      if (this.workers.size === 0) {
        issues.push('No workers available');
        recommendations.push('Initialize workers before starting system');
      }

      // Check database connection
      try {
        await this.credentialStore.getStats();
      } catch (error) {
        issues.push('Database connection failed');
        recommendations.push('Check database configuration and connectivity');
      }

      // Check rate limits
      const rateLimits = this.orchestrator.getRateLimitStatus();
      if (rateLimits.isInCooldown) {
        issues.push('System is in rate limit cooldown');
        recommendations.push('Wait for cooldown period to expire or reset rate limits');
      }

      return {
        isValid: issues.length === 0,
        issues,
        recommendations
      };

    } catch (error) {
      return {
        isValid: false,
        issues: ['System validation failed'],
        recommendations: ['Check system logs for detailed error information']
      };
    }
  }
}

// Export factory function for easy system creation
export function createGoogleAccountAutomationSystem(
  config?: Partial<SystemIntegrationConfig>
): GoogleAccountAutomationSystem {
  return new GoogleAccountAutomationSystem(config);
}