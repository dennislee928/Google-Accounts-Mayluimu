import { CreationTask, WorkerStatus } from '../types';

/**
 * Interface for task orchestration and worker management
 */
export interface ITaskOrchestrator {
  /**
   * Schedule account creation tasks in batches
   */
  scheduleAccountCreation(batchSize: number): Promise<string[]>;

  /**
   * Distribute a task to available workers
   */
  distributeTask(task: CreationTask, availableWorkers: WorkerStatus[]): Promise<void>;

  /**
   * Monitor progress of all active tasks
   */
  monitorProgress(): Promise<void>;

  /**
   * Handle worker failure and reassign tasks
   */
  handleWorkerFailure(workerId: string): Promise<void>;

  /**
   * Get current system status
   */
  getSystemStatus(): Promise<{
    activeWorkers: number;
    queuedTasks: number;
    completedTasks: number;
    failedTasks: number;
  }>;

  /**
   * Pause all operations
   */
  pauseOperations(): Promise<void>;

  /**
   * Resume operations
   */
  resumeOperations(): Promise<void>;
}