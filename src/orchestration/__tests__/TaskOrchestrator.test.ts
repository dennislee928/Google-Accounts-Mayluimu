/**
 * Unit tests for TaskOrchestrator
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TaskOrchestrator, TaskOrchestratorConfig } from '../TaskOrchestrator';
import { SystemConfig } from '../../types';

describe('TaskOrchestrator', () => {
  let orchestrator: TaskOrchestrator;
  let config: TaskOrchestratorConfig;
  let systemConfig: SystemConfig;

  beforeEach(() => {
    config = {
      maxConcurrentTasks: 5,
      taskTimeoutMs: 30000,
      workerHealthCheckIntervalMs: 10000,
      retryDelayMs: 5000,
      maxRetryAttempts: 3
    };

    systemConfig = {
      rateLimit: {
        accountsPerDay: 100,
        accountsPerHour: 10,
        delayBetweenAccounts: [120, 600]
      },
      workers: {
        maxConcurrentWorkers: 5,
        puppeteerConfig: {
          headless: true,
          viewport: { width: 1366, height: 768 },
          userAgent: 'test-agent',
          args: []
        },
        retryPolicy: {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 16000,
          backoffMultiplier: 2
        }
      },
      storage: {
        provider: 'database',
        encryptionKey: 'test-key'
      },
      monitoring: {
        enableLogging: true,
        logLevel: 'info',
        metricsEnabled: true,
        alertThresholds: {
          successRateThreshold: 0.7,
          captchaRateThreshold: 0.3
        }
      }
    };

    orchestrator = new TaskOrchestrator(config, systemConfig);
  });

  afterEach(async () => {
    await orchestrator.shutdown();
  });

  describe('Worker Management', () => {
    it('should register workers successfully', () => {
      const workerId = 'test-worker-1';
      
      orchestrator.registerWorker(workerId);
      
      const status = orchestrator.getSystemStatus();
      expect(status).resolves.toMatchObject({
        activeWorkers: 1
      });
    });

    it('should update worker heartbeat', () => {
      const workerId = 'test-worker-1';
      orchestrator.registerWorker(workerId);
      
      const metadata = { cpu: 50, memory: 60 };
      orchestrator.updateWorkerHeartbeat(workerId, metadata);
      
      // Should not throw and worker should remain registered
      expect(() => orchestrator.updateWorkerHeartbeat(workerId, metadata)).not.toThrow();
    });

    it('should unregister workers', () => {
      const workerId = 'test-worker-1';
      orchestrator.registerWorker(workerId);
      
      orchestrator.unregisterWorker(workerId);
      
      const status = orchestrator.getSystemStatus();
      expect(status).resolves.toMatchObject({
        activeWorkers: 0
      });
    });
  });

  describe('Task Scheduling', () => {
    it('should schedule account creation batch', async () => {
      const batchSize = 3;
      
      const taskIds = await orchestrator.scheduleAccountCreation(batchSize);
      
      expect(taskIds).toHaveLength(batchSize);
      expect(taskIds.every(id => typeof id === 'string')).toBe(true);
      
      const status = await orchestrator.getSystemStatus();
      expect(status.queuedTasks).toBe(batchSize);
    });

    it('should handle empty batch scheduling', async () => {
      const taskIds = await orchestrator.scheduleAccountCreation(0);
      
      expect(taskIds).toHaveLength(0);
    });

    it('should emit batch scheduled event', async () => {
      const eventSpy = jest.fn();
      orchestrator.on('batchScheduled', eventSpy);
      
      await orchestrator.scheduleAccountCreation(2);
      
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSize: 2,
          taskIds: expect.any(Array)
        })
      );
    });
  });

  describe('Task Distribution', () => {
    it('should distribute tasks to available workers', async () => {
      // Register workers
      orchestrator.registerWorker('worker-1');
      orchestrator.registerWorker('worker-2');
      
      // Schedule tasks
      await orchestrator.scheduleAccountCreation(2);
      
      // Allow some time for task processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const status = await orchestrator.getSystemStatus();
      expect(status.activeWorkers).toBe(2);
    });

    it('should handle task distribution with no available workers', async () => {
      // Schedule tasks without registering workers
      const taskIds = await orchestrator.scheduleAccountCreation(1);
      
      expect(taskIds).toHaveLength(1);
      
      const status = await orchestrator.getSystemStatus();
      expect(status.queuedTasks).toBe(1);
      expect(status.activeWorkers).toBe(0);
    });
  });

  describe('System Status', () => {
    it('should return correct system status', async () => {
      orchestrator.registerWorker('worker-1');
      await orchestrator.scheduleAccountCreation(3);
      
      const status = await orchestrator.getSystemStatus();
      
      expect(status).toMatchObject({
        activeWorkers: 1,
        queuedTasks: 3,
        completedTasks: 0,
        failedTasks: 0
      });
    });

    it('should track completed and failed tasks', async () => {
      const initialStatus = await orchestrator.getSystemStatus();
      
      expect(initialStatus.completedTasks).toBe(0);
      expect(initialStatus.failedTasks).toBe(0);
    });
  });

  describe('Operations Control', () => {
    it('should pause operations', async () => {
      const pauseSpy = jest.fn();
      orchestrator.on('operationsPaused', pauseSpy);
      
      await orchestrator.pauseOperations();
      
      expect(pauseSpy).toHaveBeenCalled();
    });

    it('should resume operations', async () => {
      await orchestrator.pauseOperations();
      
      const resumeSpy = jest.fn();
      orchestrator.on('operationsResumed', resumeSpy);
      
      await orchestrator.resumeOperations();
      
      expect(resumeSpy).toHaveBeenCalled();
    });

    it('should not process tasks when paused', async () => {
      await orchestrator.pauseOperations();
      
      const taskIds = await orchestrator.scheduleAccountCreation(1);
      
      // Allow time for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const status = await orchestrator.getSystemStatus();
      expect(status.queuedTasks).toBe(1); // Should remain queued
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should respect rate limits', async () => {
      const rateLimitStatus = orchestrator.getRateLimitStatus();
      
      expect(rateLimitStatus).toHaveProperty('dailyUsage');
      expect(rateLimitStatus).toHaveProperty('hourlyUsage');
      expect(rateLimitStatus).toHaveProperty('currentDelay');
    });

    it('should trigger rate limit cooldown', async () => {
      await orchestrator.triggerRateLimitCooldown(5000);
      
      const status = orchestrator.getRateLimitStatus();
      expect(status.isInCooldown).toBe(true);
    });

    it('should reset rate limits', () => {
      orchestrator.resetRateLimits();
      
      const status = orchestrator.getRateLimitStatus();
      expect(status.dailyUsage.used).toBe(0);
      expect(status.hourlyUsage.used).toBe(0);
    });
  });

  describe('Health Monitoring Integration', () => {
    it('should get worker health metrics', () => {
      const workerId = 'test-worker';
      orchestrator.registerWorker(workerId);
      
      const health = orchestrator.getWorkerHealth(workerId);
      
      // Should return metrics or null for new worker
      expect(health === null || typeof health === 'object').toBe(true);
    });

    it('should get system health metrics', () => {
      orchestrator.registerWorker('worker-1');
      orchestrator.registerWorker('worker-2');
      
      const systemHealth = orchestrator.getSystemHealthMetrics();
      
      expect(systemHealth).toHaveProperty('healthyWorkers');
      expect(systemHealth).toHaveProperty('degradedWorkers');
      expect(systemHealth).toHaveProperty('unhealthyWorkers');
      expect(systemHealth).toHaveProperty('averageHealthScore');
    });

    it('should perform worker health check', async () => {
      const workerId = 'test-worker';
      orchestrator.registerWorker(workerId);
      
      const healthCheck = await orchestrator.performWorkerHealthCheck(workerId);
      
      expect(healthCheck).toHaveProperty('workerId', workerId);
      expect(healthCheck).toHaveProperty('isHealthy');
      expect(healthCheck).toHaveProperty('issues');
      expect(healthCheck).toHaveProperty('recommendations');
      expect(healthCheck).toHaveProperty('metrics');
    });
  });

  describe('Error Handling', () => {
    it('should handle worker failure gracefully', async () => {
      const workerId = 'failing-worker';
      orchestrator.registerWorker(workerId);
      
      await expect(orchestrator.handleWorkerFailure(workerId)).resolves.not.toThrow();
    });

    it('should handle unknown worker failure', async () => {
      await expect(orchestrator.handleWorkerFailure('unknown-worker')).resolves.not.toThrow();
    });

    it('should emit worker failure events', async () => {
      const workerId = 'test-worker';
      orchestrator.registerWorker(workerId);
      
      const failureSpy = jest.fn();
      orchestrator.on('workerFailed', failureSpy);
      
      await orchestrator.handleWorkerFailure(workerId);
      
      expect(failureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workerId,
          reassignedTasks: expect.any(Number)
        })
      );
    });
  });

  describe('Event Emission', () => {
    it('should emit system health updates', (done: () => void) => {
      orchestrator.on('systemHealthUpdate', (metrics) => {
        expect(metrics).toHaveProperty('healthyWorkers');
        done();
      });
      
      // Trigger health update by registering a worker
      orchestrator.registerWorker('test-worker');
    });

    it('should emit worker registration events', (done: () => void) => {
      orchestrator.on('workerRegistered', ({ worker }) => {
        expect(worker.id).toBe('test-worker');
        done();
      });
      
      orchestrator.registerWorker('test-worker');
    });

    it('should emit shutdown events', (done: () => void) => {
      orchestrator.on('shutdown', () => {
        done();
      });
      
      orchestrator.shutdown();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      orchestrator.registerWorker('test-worker');
      await orchestrator.scheduleAccountCreation(1);
      
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });

    it('should stop processing after shutdown', async () => {
      await orchestrator.shutdown();
      
      // Should not throw but also should not process
      await expect(orchestrator.scheduleAccountCreation(1)).resolves.toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should use provided configuration', () => {
      expect(orchestrator['config']).toEqual(config);
      expect(orchestrator['systemConfig']).toEqual(systemConfig);
    });

    it('should initialize with correct defaults', () => {
      expect(orchestrator['isRunning']).toBe(false);
      expect(orchestrator['isPaused']).toBe(false);
      expect(orchestrator['workers'].size).toBe(0);
    });
  });
});