/**
 * Task orchestration and worker management
 * Handles task distribution, worker coordination, and system monitoring
 */

import { ITaskOrchestrator } from '../interfaces';
import { CreationTask, WorkerStatus, AccountData, SystemConfig } from '../types';
import { Logger } from '../utils';
import { RateLimiter } from './RateLimiter';
import { WorkerHealthMonitor } from './WorkerHealthMonitor';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'node:events';

export interface TaskOrchestratorConfig {
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  workerHealthCheckIntervalMs: number;
  retryDelayMs: number;
  maxRetryAttempts: number;
}

export interface TaskQueue {
  pending: CreationTask[];
  inProgress: Map<string, CreationTask>;
  completed: CreationTask[];
  failed: CreationTask[];
}

export class TaskOrchestrator extends EventEmitter implements ITaskOrchestrator {
  private config: TaskOrchestratorConfig;
  private systemConfig: SystemConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private healthMonitor: WorkerHealthMonitor;
  private taskQueue: TaskQueue;
  private workers: Map<string, WorkerStatus>;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private healthCheckInterval?: NodeJS.Timeout;
  private taskProcessingInterval?: NodeJS.Timeout;

  constructor(config: TaskOrchestratorConfig, systemConfig: SystemConfig) {
    super();
    this.config = config;
    this.systemConfig = systemConfig;
    this.logger = new Logger(undefined, 'orchestrator');
    this.rateLimiter = new RateLimiter(systemConfig);
    
    // Initialize health monitor
    this.healthMonitor = new WorkerHealthMonitor({
      heartbeatIntervalMs: this.config.workerHealthCheckIntervalMs,
      heartbeatTimeoutMs: 60000, // 1 minute
      performanceWindowMs: 30 * 60 * 1000, // 30 minutes
      minSuccessRate: 0.7, // 70%
      maxFailureStreak: 5,
      recoveryAttempts: 3,
      recoveryDelayMs: 30000 // 30 seconds
    });
    
    this.taskQueue = {
      pending: [],
      inProgress: new Map(),
      completed: [],
      failed: []
    };
    
    this.workers = new Map();
    this.setupHealthMonitorEvents();
    this.initializeOrchestrator();
  }

  /**
   * Schedule account creation tasks in batches
   */
  async scheduleAccountCreation(batchSize: number): Promise<string[]> {
    const correlationId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const logger = this.logger.withCorrelationId(correlationId);
    
    logger.info('Scheduling account creation batch', { batchSize });

    try {
      const taskIds: string[] = [];
      const batchId = uuidv4();

      for (let i = 0; i < batchSize; i++) {
        const task: CreationTask = {
          id: uuidv4(),
          batchId,
          accountData: this.generateAccountData(),
          attempts: 0,
          maxAttempts: this.config.maxRetryAttempts,
          status: 'queued',
          createdAt: new Date(),
          scheduledAt: new Date()
        };

        this.taskQueue.pending.push(task);
        taskIds.push(task.id);
      }

      logger.info('Batch scheduled successfully', { 
        batchId, 
        taskCount: taskIds.length,
        queueSize: this.taskQueue.pending.length 
      });

      // Emit event for monitoring
      this.emit('batchScheduled', { batchId, taskIds, batchSize });

      // Start processing if not already running
      if (!this.isRunning && !this.isPaused) {
        await this.startProcessing();
      }

      return taskIds;
    } catch (error) {
      logger.error('Failed to schedule batch', { 
        error: error instanceof Error ? error.message : error,
        batchSize 
      });
      throw error;
    }
  }

  /**
   * Distribute a task to available workers
   */
  async distributeTask(task: CreationTask, availableWorkers: WorkerStatus[]): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      if (availableWorkers.length === 0) {
        logger.warn('No available workers for task distribution');
        return;
      }

      // Select best worker using load balancing
      const selectedWorker = this.selectOptimalWorker(availableWorkers);
      
      if (!selectedWorker) {
        logger.warn('No suitable worker found for task');
        return;
      }

      // Update task status
      task.assignedWorker = selectedWorker.id;
      task.status = 'in-progress';
      
      // Move task from pending to in-progress
      const pendingIndex = this.taskQueue.pending.findIndex(t => t.id === task.id);
      if (pendingIndex !== -1) {
        this.taskQueue.pending.splice(pendingIndex, 1);
      }
      this.taskQueue.inProgress.set(task.id, task);

      // Update worker status
      selectedWorker.status = 'busy';
      selectedWorker.currentTask = task.id;
      this.workers.set(selectedWorker.id, selectedWorker);

      logger.info('Task distributed to worker', { 
        taskId: task.id,
        workerId: selectedWorker.id,
        workerLoad: selectedWorker.tasksCompleted 
      });

      // Emit event for monitoring
      this.emit('taskDistributed', { task, worker: selectedWorker });

      // Start task execution (this would trigger the actual worker)
      await this.executeTask(task, selectedWorker);

    } catch (error) {
      logger.error('Failed to distribute task', { 
        error: error instanceof Error ? error.message : error,
        taskId: task.id 
      });
      
      // Reset task status on failure
      task.status = 'queued';
      task.assignedWorker = undefined;
    }
  }

  /**
   * Monitor progress of all active tasks
   */
  async monitorProgress(): Promise<void> {
    const logger = this.logger.withCorrelationId('monitor');
    
    try {
      const now = new Date();
      const timeoutTasks: CreationTask[] = [];

      // Check for timed out tasks
      for (const [taskId, task] of this.taskQueue.inProgress) {
        const taskAge = now.getTime() - task.scheduledAt.getTime();
        
        if (taskAge > this.config.taskTimeoutMs) {
          timeoutTasks.push(task);
        }
      }

      // Handle timed out tasks
      for (const task of timeoutTasks) {
        logger.warn('Task timeout detected', { 
          taskId: task.id,
          workerId: task.assignedWorker,
          age: now.getTime() - task.scheduledAt.getTime() 
        });

        await this.handleTaskTimeout(task);
      }

      // Check worker health
      await this.checkWorkerHealth();

      // Log current status
      const status = await this.getSystemStatus();
      logger.info('System status update', status);

      // Emit monitoring event
      this.emit('progressUpdate', status);

    } catch (error) {
      logger.error('Progress monitoring failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  /**
   * Handle worker failure and reassign tasks
   */
  async handleWorkerFailure(workerId: string): Promise<void> {
    const logger = this.logger.withCorrelationId('worker_failure');
    
    try {
      logger.warn('Handling worker failure', { workerId });

      const worker = this.workers.get(workerId);
      if (!worker) {
        logger.warn('Worker not found', { workerId });
        return;
      }

      // Update worker status
      worker.status = 'failed';
      worker.lastHeartbeat = new Date();
      this.workers.set(workerId, worker);

      // Find and reassign tasks assigned to failed worker
      const tasksToReassign: CreationTask[] = [];
      
      for (const [taskId, task] of this.taskQueue.inProgress) {
        if (task.assignedWorker === workerId) {
          tasksToReassign.push(task);
        }
      }

      logger.info('Reassigning tasks from failed worker', { 
        workerId,
        taskCount: tasksToReassign.length 
      });

      // Reassign tasks
      for (const task of tasksToReassign) {
        await this.reassignTask(task);
      }

      // Emit worker failure event
      this.emit('workerFailed', { workerId, reassignedTasks: tasksToReassign.length });

      // Try to restart worker or mark as offline
      await this.attemptWorkerRecovery(workerId);

    } catch (error) {
      logger.error('Worker failure handling failed', { 
        error: error instanceof Error ? error.message : error,
        workerId 
      });
    }
  }

  /**
   * Get current system status
   */
  async getSystemStatus(): Promise<{
    activeWorkers: number;
    queuedTasks: number;
    completedTasks: number;
    failedTasks: number;
  }> {
    const activeWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'idle' || w.status === 'busy').length;

    return {
      activeWorkers,
      queuedTasks: this.taskQueue.pending.length + this.taskQueue.inProgress.size,
      completedTasks: this.taskQueue.completed.length,
      failedTasks: this.taskQueue.failed.length
    };
  }

  /**
   * Pause all operations
   */
  async pauseOperations(): Promise<void> {
    const logger = this.logger.withCorrelationId('pause');
    
    try {
      logger.info('Pausing orchestrator operations');
      
      this.isPaused = true;
      
      // Stop processing new tasks
      if (this.taskProcessingInterval) {
        clearInterval(this.taskProcessingInterval);
        this.taskProcessingInterval = undefined;
      }

      // Emit pause event
      this.emit('operationsPaused');
      
      logger.info('Operations paused successfully');
      
    } catch (error) {
      logger.error('Failed to pause operations', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Resume operations
   */
  async resumeOperations(): Promise<void> {
    const logger = this.logger.withCorrelationId('resume');
    
    try {
      logger.info('Resuming orchestrator operations');
      
      this.isPaused = false;
      
      // Restart task processing
      await this.startProcessing();

      // Emit resume event
      this.emit('operationsResumed');
      
      logger.info('Operations resumed successfully');
      
    } catch (error) {
      logger.error('Failed to resume operations', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  /**
   * Initialize orchestrator
   */
  private initializeOrchestrator(): void {
    this.logger.info('Initializing task orchestrator');

    // Start health check monitoring
    this.healthCheckInterval = setInterval(
      () => this.monitorProgress(),
      this.config.workerHealthCheckIntervalMs
    );

    this.logger.info('Task orchestrator initialized');
  }

  /**
   * Start task processing
   */
  private async startProcessing(): Promise<void> {
    if (this.isRunning || this.isPaused) {
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting task processing');

    // Process tasks at regular intervals
    this.taskProcessingInterval = setInterval(
      () => this.processPendingTasks(),
      1000 // Process every second
    );
  }

  /**
   * Process pending tasks
   */
  private async processPendingTasks(): Promise<void> {
    if (this.isPaused || this.taskQueue.pending.length === 0) {
      return;
    }

    try {
      // Check rate limiting before processing
      const rateLimitCheck = await this.rateLimiter.canCreateAccount();
      if (!rateLimitCheck.allowed) {
        this.logger.info('Rate limit preventing task processing', {
          reason: rateLimitCheck.reason,
          waitTimeMs: rateLimitCheck.waitTimeMs
        });
        return;
      }

      const availableWorkers = this.getAvailableWorkers();
      
      if (availableWorkers.length === 0) {
        return;
      }

      // Process tasks up to available worker capacity and rate limits
      const tasksToProcess = Math.min(
        this.taskQueue.pending.length,
        availableWorkers.length,
        this.config.maxConcurrentTasks - this.taskQueue.inProgress.size,
        1 // Process one task at a time to respect rate limiting
      );

      for (let i = 0; i < tasksToProcess; i++) {
        const task = this.taskQueue.pending[0];
        if (task) {
          await this.distributeTask(task, availableWorkers);
        }
      }

    } catch (error) {
      this.logger.error('Task processing failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  /**
   * Get available workers
   */
  private getAvailableWorkers(): WorkerStatus[] {
    return Array.from(this.workers.values())
      .filter(worker => worker.status === 'idle');
  }

  /**
   * Select optimal worker for task assignment
   */
  private selectOptimalWorker(availableWorkers: WorkerStatus[]): WorkerStatus | null {
    if (availableWorkers.length === 0) {
      return null;
    }

    // Select worker with lowest task count (load balancing)
    return availableWorkers.reduce((best, current) => 
      current.tasksCompleted < best.tasksCompleted ? current : best
    );
  }

  /**
   * Execute task on assigned worker
   */
  private async executeTask(task: CreationTask, worker: WorkerStatus): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      logger.info('Starting task execution', { 
        taskId: task.id,
        workerId: worker.id 
      });

      // This would integrate with the actual AccountCreator
      // For now, simulate task execution
      await this.simulateTaskExecution(task);

      // Update task completion
      await this.completeTask(task, worker);

    } catch (error) {
      logger.error('Task execution failed', { 
        error: error instanceof Error ? error.message : error,
        taskId: task.id,
        workerId: worker.id 
      });

      await this.failTask(task, worker, error as Error);
    }
  }

  /**
   * Simulate task execution (placeholder)
   */
  private async simulateTaskExecution(task: CreationTask): Promise<void> {
    // Simulate variable execution time
    const executionTime = Math.random() * 30000 + 10000; // 10-40 seconds
    await new Promise(resolve => setTimeout(resolve, executionTime));
    
    // Simulate success/failure rate
    const successRate = 0.8; // 80% success rate
    if (Math.random() > successRate) {
      throw new Error('Simulated task failure');
    }
  }

  /**
   * Complete task successfully
   */
  private async completeTask(task: CreationTask, worker: WorkerStatus): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      // Record successful account creation for rate limiting
      await this.rateLimiter.recordAccountCreation(true);

      // Update task status
      task.status = 'completed';
      task.completedAt = new Date();
      
      // Calculate task duration
      const duration = task.completedAt.getTime() - task.scheduledAt.getTime();
      
      // Record task completion for health monitoring
      this.healthMonitor.recordTaskCompletion(worker.id, true, duration);
      
      // Move task to completed queue
      this.taskQueue.inProgress.delete(task.id);
      this.taskQueue.completed.push(task);

      // Update worker status
      worker.status = 'idle';
      worker.currentTask = undefined;
      worker.tasksCompleted++;
      worker.tasksSuccessful++;
      worker.lastHeartbeat = new Date();
      this.workers.set(worker.id, worker);
      this.healthMonitor.updateWorkerStatus(worker.id, worker);

      logger.info('Task completed successfully', { 
        taskId: task.id,
        workerId: worker.id,
        duration 
      });

      // Emit completion event
      this.emit('taskCompleted', { task, worker });

    } catch (error) {
      logger.error('Task completion handling failed', { 
        error: error instanceof Error ? error.message : error,
        taskId: task.id 
      });
    }
  }

  /**
   * Fail task and handle retry logic
   */
  private async failTask(task: CreationTask, worker: WorkerStatus, error: Error): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      // Record failed account creation for rate limiting
      await this.rateLimiter.recordAccountCreation(false);

      task.attempts++;
      task.errorMessage = error.message;

      // Calculate task duration (even for failed tasks)
      const duration = Date.now() - task.scheduledAt.getTime();
      
      // Record task failure for health monitoring
      this.healthMonitor.recordTaskCompletion(worker.id, false, duration);

      // Update worker status
      worker.status = 'idle';
      worker.currentTask = undefined;
      worker.tasksFailed++;
      worker.lastHeartbeat = new Date();
      this.workers.set(worker.id, worker);
      this.healthMonitor.updateWorkerStatus(worker.id, worker);

      // Check if task should be retried
      if (task.attempts < task.maxAttempts) {
        logger.info('Task failed, scheduling retry', { 
          taskId: task.id,
          attempt: task.attempts,
          maxAttempts: task.maxAttempts 
        });

        // Move back to pending queue for retry
        task.status = 'queued';
        task.assignedWorker = undefined;
        this.taskQueue.inProgress.delete(task.id);
        
        // Add delay before retry (use rate limiter delay)
        const nextSlot = await this.rateLimiter.getNextAvailableSlot();
        const delayMs = Math.max(this.config.retryDelayMs, nextSlot.getTime() - Date.now());
        
        setTimeout(() => {
          this.taskQueue.pending.push(task);
        }, delayMs);

      } else {
        logger.error('Task failed permanently', { 
          taskId: task.id,
          attempts: task.attempts,
          error: error.message 
        });

        // Move to failed queue
        task.status = 'failed';
        this.taskQueue.inProgress.delete(task.id);
        this.taskQueue.failed.push(task);

        // Emit failure event
        this.emit('taskFailed', { task, worker, error });
      }

    } catch (handlingError) {
      logger.error('Task failure handling failed', { 
        error: handlingError instanceof Error ? handlingError.message : handlingError,
        taskId: task.id 
      });
    }
  }

  /**
   * Handle task timeout
   */
  private async handleTaskTimeout(task: CreationTask): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      logger.warn('Handling task timeout', { taskId: task.id });

      const worker = task.assignedWorker ? this.workers.get(task.assignedWorker) : null;
      
      if (worker) {
        // Mark worker as potentially failed
        await this.handleWorkerFailure(worker.id);
      }

      // Fail the task due to timeout
      await this.failTask(task, worker || {} as WorkerStatus, new Error('Task timeout'));

    } catch (error) {
      logger.error('Task timeout handling failed', { 
        error: error instanceof Error ? error.message : error,
        taskId: task.id 
      });
    }
  }

  /**
   * Reassign task to different worker
   */
  private async reassignTask(task: CreationTask): Promise<void> {
    const logger = this.logger.withCorrelationId(task.id);
    
    try {
      // Reset task assignment
      task.assignedWorker = undefined;
      task.status = 'queued';
      
      // Move back to pending queue
      this.taskQueue.inProgress.delete(task.id);
      this.taskQueue.pending.unshift(task); // Add to front for priority

      logger.info('Task reassigned to queue', { taskId: task.id });

    } catch (error) {
      logger.error('Task reassignment failed', { 
        error: error instanceof Error ? error.message : error,
        taskId: task.id 
      });
    }
  }

  /**
   * Check worker health
   */
  private async checkWorkerHealth(): Promise<void> {
    const now = new Date();
    const healthCheckTimeout = 60000; // 1 minute

    for (const [workerId, worker] of this.workers) {
      const timeSinceHeartbeat = now.getTime() - worker.lastHeartbeat.getTime();
      
      if (timeSinceHeartbeat > healthCheckTimeout && worker.status !== 'offline') {
        this.logger.warn('Worker health check failed', { 
          workerId,
          timeSinceHeartbeat 
        });
        
        await this.handleWorkerFailure(workerId);
      }
    }
  }

  /**
   * Attempt worker recovery
   */
  private async attemptWorkerRecovery(workerId: string): Promise<void> {
    const logger = this.logger.withCorrelationId('recovery');
    
    try {
      logger.info('Attempting worker recovery', { workerId });

      // In a real implementation, this would try to restart the worker
      // For now, mark as offline
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.status = 'offline';
        this.workers.set(workerId, worker);
      }

      // Emit recovery attempt event
      this.emit('workerRecoveryAttempted', { workerId });

    } catch (error) {
      logger.error('Worker recovery failed', { 
        error: error instanceof Error ? error.message : error,
        workerId 
      });
    }
  }

  /**
   * Generate account data for task
   */
  private generateAccountData(): AccountData {
    // This would integrate with CredentialGenerator
    // For now, return basic account data
    return {
      id: uuidv4(),
      email: `user${Date.now()}@gmail.com`,
      password: 'TempPassword123!',
      firstName: 'Generated',
      lastName: 'User',
      birthDate: new Date('1990-01-01'),
      createdAt: new Date(),
      workerId: 'orchestrator',
      ipAddress: '127.0.0.1',
      status: 'pending'
    };
  }

  /**
   * Register a new worker
   */
  registerWorker(workerId: string): void {
    const worker: WorkerStatus = {
      id: workerId,
      status: 'idle',
      lastHeartbeat: new Date(),
      tasksCompleted: 0,
      tasksSuccessful: 0,
      tasksFailed: 0
    };

    this.workers.set(workerId, worker);
    this.healthMonitor.registerWorker(worker);
    this.logger.info('Worker registered', { workerId });
    
    this.emit('workerRegistered', { worker });
  }

  /**
   * Update worker heartbeat
   */
  updateWorkerHeartbeat(workerId: string, metadata?: Record<string, unknown>): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.lastHeartbeat = new Date();
      this.workers.set(workerId, worker);
      this.healthMonitor.processHeartbeat(workerId, metadata);
    }
  }

  /**
   * Unregister worker
   */
  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.healthMonitor.unregisterWorker(workerId);
    this.logger.info('Worker unregistered', { workerId });
    
    this.emit('workerUnregistered', { workerId });
  }

  /**
   * Get worker health metrics
   */
  getWorkerHealth(workerId: string): ReturnType<WorkerHealthMonitor['getWorkerMetrics']> {
    return this.healthMonitor.getWorkerMetrics(workerId);
  }

  /**
   * Get system health metrics
   */
  getSystemHealthMetrics(): ReturnType<WorkerHealthMonitor['getSystemHealthMetrics']> {
    return this.healthMonitor.getSystemHealthMetrics();
  }

  /**
   * Perform health check on worker
   */
  async performWorkerHealthCheck(workerId: string): Promise<ReturnType<WorkerHealthMonitor['performHealthCheck']>> {
    return this.healthMonitor.performHealthCheck(workerId);
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus(): ReturnType<RateLimiter['getRateLimitStatus']> {
    return this.rateLimiter.getRateLimitStatus();
  }

  /**
   * Manually trigger rate limit cooldown
   */
  async triggerRateLimitCooldown(durationMs?: number): Promise<void> {
    await this.rateLimiter.triggerCooldown(durationMs);
    this.logger.info('Rate limit cooldown triggered manually', { durationMs });
  }

  /**
   * Reset rate limits
   */
  resetRateLimits(): void {
    this.rateLimiter.resetLimits();
    this.logger.info('Rate limits reset manually');
  }

  /**
   * Setup health monitor event handlers
   */
  private setupHealthMonitorEvents(): void {
    this.healthMonitor.on('workerUnhealthy', (healthCheck: any) => {
      this.logger.warn('Worker health issue detected', { 
        workerId: healthCheck.workerId,
        issues: healthCheck.issues 
      });
      
      // Forward event to orchestrator listeners
      this.emit('workerHealthIssue', healthCheck);
    });

    this.healthMonitor.on('workerRecoveryRequested', ({ workerId, attempt }: any) => {
      this.logger.info('Worker recovery requested', { workerId, attempt });
      
      // Handle worker failure through existing mechanism
      this.handleWorkerFailure(workerId);
    });

    this.healthMonitor.on('workerRecovered', ({ workerId }: any) => {
      this.logger.info('Worker recovered successfully', { workerId });
      
      // Reset worker status
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.status = 'idle';
        this.workers.set(workerId, worker);
      }
    });

    this.healthMonitor.on('systemHealthUpdate', (metrics: any) => {
      // Forward system health updates
      this.emit('systemHealthUpdate', metrics);
    });
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down task orchestrator');
    
    this.isRunning = false;
    this.isPaused = true;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.taskProcessingInterval) {
      clearInterval(this.taskProcessingInterval);
    }

    // Shutdown components
    this.rateLimiter.shutdown();
    this.healthMonitor.shutdown();

    // Emit shutdown event
    this.emit('shutdown');
    
    this.logger.info('Task orchestrator shutdown complete');
  }
}