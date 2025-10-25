/**
 * Worker Health Monitoring System
 * Monitors worker performance, health, and handles automatic recovery
 */

import { WorkerStatus, SystemMetrics } from '../types';
import { Logger } from '../utils';
import { EventEmitter } from 'events';

export interface WorkerHealthConfig {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  performanceWindowMs: number;
  minSuccessRate: number;
  maxFailureStreak: number;
  recoveryAttempts: number;
  recoveryDelayMs: number;
}

export interface WorkerPerformanceMetrics {
  workerId: string;
  successRate: number;
  averageTaskTime: number;
  failureStreak: number;
  lastFailureTime?: Date;
  resourceUsage?: {
    cpu: number;
    memory: number;
    network: number;
  };
  healthScore: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'recovering';
}

export interface HealthCheckResult {
  workerId: string;
  isHealthy: boolean;
  issues: string[];
  recommendations: string[];
  metrics: WorkerPerformanceMetrics;
}

export class WorkerHealthMonitor extends EventEmitter {
  private config: WorkerHealthConfig;
  private logger: Logger;
  private workers: Map<string, WorkerStatus>;
  private performanceHistory: Map<string, Array<{
    timestamp: Date;
    success: boolean;
    duration: number;
  }>>;
  private recoveryAttempts: Map<string, number>;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: WorkerHealthConfig) {
    super();
    this.config = config;
    this.logger = new Logger(undefined, 'health-monitor');
    this.workers = new Map();
    this.performanceHistory = new Map();
    this.recoveryAttempts = new Map();
    
    this.startMonitoring();
  }

  /**
   * Register worker for monitoring
   */
  registerWorker(worker: WorkerStatus): void {
    this.workers.set(worker.id, worker);
    this.performanceHistory.set(worker.id, []);
    this.recoveryAttempts.set(worker.id, 0);
    
    this.logger.info('Worker registered for health monitoring', { 
      workerId: worker.id 
    });
    
    this.emit('workerRegistered', { worker });
  }

  /**
   * Unregister worker from monitoring
   */
  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.performanceHistory.delete(workerId);
    this.recoveryAttempts.delete(workerId);
    
    this.logger.info('Worker unregistered from health monitoring', { 
      workerId 
    });
    
    this.emit('workerUnregistered', { workerId });
  }

  /**
   * Update worker status
   */
  updateWorkerStatus(workerId: string, status: Partial<WorkerStatus>): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.logger.warn('Attempted to update unknown worker', { workerId });
      return;
    }

    const updatedWorker = { ...worker, ...status };
    this.workers.set(workerId, updatedWorker);
    
    this.emit('workerStatusUpdated', { workerId, status: updatedWorker });
  }

  /**
   * Record task completion for performance tracking
   */
  recordTaskCompletion(workerId: string, success: boolean, duration: number): void {
    const history = this.performanceHistory.get(workerId);
    if (!history) {
      this.logger.warn('Attempted to record task for unknown worker', { workerId });
      return;
    }

    const record = {
      timestamp: new Date(),
      success,
      duration
    };

    history.push(record);

    // Keep only recent history within performance window
    const cutoff = new Date(Date.now() - this.config.performanceWindowMs);
    const filteredHistory = history.filter(h => h.timestamp > cutoff);
    this.performanceHistory.set(workerId, filteredHistory);

    // Update worker statistics
    const worker = this.workers.get(workerId);
    if (worker) {
      if (success) {
        worker.tasksSuccessful++;
        // Reset failure streak on success
        const metrics = this.calculatePerformanceMetrics(workerId);
        if (metrics) {
          metrics.failureStreak = 0;
        }
      } else {
        worker.tasksFailed++;
        // Increment failure streak
        const metrics = this.calculatePerformanceMetrics(workerId);
        if (metrics) {
          metrics.failureStreak++;
          metrics.lastFailureTime = new Date();
        }
      }
      
      worker.tasksCompleted++;
      worker.lastHeartbeat = new Date();
      this.workers.set(workerId, worker);
    }

    this.logger.debug('Task completion recorded', { 
      workerId, 
      success, 
      duration 
    });
  }

  /**
   * Process heartbeat from worker
   */
  processHeartbeat(workerId: string, metadata?: Record<string, unknown>): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.logger.warn('Heartbeat from unknown worker', { workerId });
      return;
    }

    worker.lastHeartbeat = new Date();
    
    // Update resource usage if provided
    if (metadata?.resourceUsage) {
      const metrics = this.calculatePerformanceMetrics(workerId);
      if (metrics) {
        metrics.resourceUsage = metadata.resourceUsage as any;
      }
    }

    this.workers.set(workerId, worker);
    
    this.emit('heartbeatReceived', { workerId, metadata });
  }

  /**
   * Perform health check on specific worker
   */
  async performHealthCheck(workerId: string): Promise<HealthCheckResult> {
    const logger = this.logger.withCorrelationId(`health_check_${workerId}`);
    
    try {
      const worker = this.workers.get(workerId);
      if (!worker) {
        throw new Error(`Worker ${workerId} not found`);
      }

      const metrics = this.calculatePerformanceMetrics(workerId);
      if (!metrics) {
        throw new Error(`No performance metrics available for worker ${workerId}`);
      }

      const issues: string[] = [];
      const recommendations: string[] = [];

      // Check heartbeat freshness
      const timeSinceHeartbeat = Date.now() - worker.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > this.config.heartbeatTimeoutMs) {
        issues.push(`Heartbeat timeout (${timeSinceHeartbeat}ms ago)`);
        recommendations.push('Check worker connectivity and restart if necessary');
      }

      // Check success rate
      if (metrics.successRate < this.config.minSuccessRate) {
        issues.push(`Low success rate (${(metrics.successRate * 100).toFixed(1)}%)`);
        recommendations.push('Investigate task failures and optimize worker configuration');
      }

      // Check failure streak
      if (metrics.failureStreak >= this.config.maxFailureStreak) {
        issues.push(`High failure streak (${metrics.failureStreak} consecutive failures)`);
        recommendations.push('Restart worker or check for systematic issues');
      }

      // Check resource usage
      if (metrics.resourceUsage) {
        if (metrics.resourceUsage.cpu > 90) {
          issues.push(`High CPU usage (${metrics.resourceUsage.cpu}%)`);
          recommendations.push('Consider scaling or optimizing worker processes');
        }
        
        if (metrics.resourceUsage.memory > 90) {
          issues.push(`High memory usage (${metrics.resourceUsage.memory}%)`);
          recommendations.push('Check for memory leaks or increase worker memory allocation');
        }
      }

      const isHealthy = issues.length === 0;
      
      logger.info('Health check completed', { 
        workerId, 
        isHealthy, 
        issueCount: issues.length,
        healthScore: metrics.healthScore 
      });

      return {
        workerId,
        isHealthy,
        issues,
        recommendations,
        metrics
      };

    } catch (error) {
      logger.error('Health check failed', { 
        error: error instanceof Error ? error.message : error,
        workerId 
      });
      
      throw error;
    }
  }

  /**
   * Perform health checks on all workers
   */
  async performAllHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    for (const workerId of this.workers.keys()) {
      try {
        const result = await this.performHealthCheck(workerId);
        results.push(result);
      } catch (error) {
        this.logger.error('Health check failed for worker', { 
          workerId,
          error: error instanceof Error ? error.message : error 
        });
      }
    }

    return results;
  }

  /**
   * Get performance metrics for worker
   */
  getWorkerMetrics(workerId: string): WorkerPerformanceMetrics | null {
    return this.calculatePerformanceMetrics(workerId);
  }

  /**
   * Get system-wide health metrics
   */
  getSystemHealthMetrics(): SystemMetrics & {
    healthyWorkers: number;
    degradedWorkers: number;
    unhealthyWorkers: number;
    averageHealthScore: number;
  } {
    const workers = Array.from(this.workers.values());
    const totalWorkers = workers.length;
    
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;
    let totalHealthScore = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalCompleted = 0;

    for (const worker of workers) {
      const metrics = this.calculatePerformanceMetrics(worker.id);
      if (metrics) {
        totalHealthScore += metrics.healthScore;
        
        switch (metrics.status) {
          case 'healthy':
            healthyCount++;
            break;
          case 'degraded':
            degradedCount++;
            break;
          case 'unhealthy':
          case 'recovering':
            unhealthyCount++;
            break;
        }
      }
      
      totalSuccessful += worker.tasksSuccessful;
      totalFailed += worker.tasksFailed;
      totalCompleted += worker.tasksCompleted;
    }

    const averageHealthScore = totalWorkers > 0 ? totalHealthScore / totalWorkers : 0;
    const successRate = totalCompleted > 0 ? totalSuccessful / totalCompleted : 0;

    return {
      totalAccountsCreated: totalCompleted,
      successRate,
      captchaEncounterRate: 0, // Would need additional tracking
      averageCreationTime: 0, // Would need additional tracking
      activeWorkers: workers.filter(w => w.status === 'busy' || w.status === 'idle').length,
      queuedTasks: 0, // Would be provided by orchestrator
      failedTasks: totalFailed,
      healthyWorkers: healthyCount,
      degradedWorkers: degradedCount,
      unhealthyWorkers: unhealthyCount,
      averageHealthScore
    };
  }

  /**
   * Attempt to recover unhealthy worker
   */
  async attemptWorkerRecovery(workerId: string): Promise<boolean> {
    const logger = this.logger.withCorrelationId(`recovery_${workerId}`);
    
    try {
      const currentAttempts = this.recoveryAttempts.get(workerId) || 0;
      
      if (currentAttempts >= this.config.recoveryAttempts) {
        logger.warn('Maximum recovery attempts reached', { 
          workerId, 
          attempts: currentAttempts 
        });
        return false;
      }

      logger.info('Attempting worker recovery', { 
        workerId, 
        attempt: currentAttempts + 1 
      });

      // Update recovery attempt count
      this.recoveryAttempts.set(workerId, currentAttempts + 1);

      // Mark worker as recovering
      const worker = this.workers.get(workerId);
      if (worker) {
        worker.status = 'offline'; // Will be updated when worker comes back online
        this.workers.set(workerId, worker);
      }

      // Emit recovery event (external system should handle actual recovery)
      this.emit('workerRecoveryRequested', { 
        workerId, 
        attempt: currentAttempts + 1 
      });

      // Wait for recovery delay
      await new Promise(resolve => setTimeout(resolve, this.config.recoveryDelayMs));

      // Check if recovery was successful
      const healthCheck = await this.performHealthCheck(workerId);
      const recovered = healthCheck.isHealthy;

      if (recovered) {
        logger.info('Worker recovery successful', { workerId });
        this.recoveryAttempts.set(workerId, 0); // Reset attempts on success
        this.emit('workerRecovered', { workerId });
      } else {
        logger.warn('Worker recovery failed', { workerId });
        this.emit('workerRecoveryFailed', { workerId, attempt: currentAttempts + 1 });
      }

      return recovered;

    } catch (error) {
      logger.error('Worker recovery attempt failed', { 
        error: error instanceof Error ? error.message : error,
        workerId 
      });
      
      return false;
    }
  }

  /**
   * Start monitoring loop
   */
  private startMonitoring(): void {
    this.logger.info('Starting worker health monitoring');
    
    this.monitoringInterval = setInterval(
      () => this.performMonitoringCycle(),
      this.config.heartbeatIntervalMs
    );
  }

  /**
   * Perform monitoring cycle
   */
  private async performMonitoringCycle(): Promise<void> {
    try {
      const healthChecks = await this.performAllHealthChecks();
      
      for (const check of healthChecks) {
        if (!check.isHealthy) {
          this.logger.warn('Unhealthy worker detected', { 
            workerId: check.workerId,
            issues: check.issues 
          });
          
          this.emit('workerUnhealthy', check);
          
          // Attempt recovery for severely unhealthy workers
          if (check.metrics.status === 'unhealthy') {
            await this.attemptWorkerRecovery(check.workerId);
          }
        }
      }

      // Emit system health update
      const systemMetrics = this.getSystemHealthMetrics();
      this.emit('systemHealthUpdate', systemMetrics);

    } catch (error) {
      this.logger.error('Monitoring cycle failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  /**
   * Calculate performance metrics for worker
   */
  private calculatePerformanceMetrics(workerId: string): WorkerPerformanceMetrics | null {
    const worker = this.workers.get(workerId);
    const history = this.performanceHistory.get(workerId);
    
    if (!worker || !history) {
      return null;
    }

    const recentHistory = history.filter(
      h => h.timestamp > new Date(Date.now() - this.config.performanceWindowMs)
    );

    const totalTasks = recentHistory.length;
    const successfulTasks = recentHistory.filter(h => h.success).length;
    const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 1.0;

    const totalDuration = recentHistory.reduce((sum, h) => sum + h.duration, 0);
    const averageTaskTime = totalTasks > 0 ? totalDuration / totalTasks : 0;

    // Calculate failure streak
    let failureStreak = 0;
    for (let i = recentHistory.length - 1; i >= 0; i--) {
      if (!recentHistory[i].success) {
        failureStreak++;
      } else {
        break;
      }
    }

    // Calculate health score (0-100)
    let healthScore = 100;
    
    // Deduct for low success rate
    if (successRate < this.config.minSuccessRate) {
      healthScore -= (this.config.minSuccessRate - successRate) * 100;
    }
    
    // Deduct for failure streak
    if (failureStreak > 0) {
      healthScore -= Math.min(failureStreak * 10, 50);
    }
    
    // Deduct for stale heartbeat
    const timeSinceHeartbeat = Date.now() - worker.lastHeartbeat.getTime();
    if (timeSinceHeartbeat > this.config.heartbeatTimeoutMs) {
      healthScore -= 30;
    }

    healthScore = Math.max(0, Math.min(100, healthScore));

    // Determine status based on health score
    let status: WorkerPerformanceMetrics['status'];
    if (healthScore >= 80) {
      status = 'healthy';
    } else if (healthScore >= 60) {
      status = 'degraded';
    } else if (this.recoveryAttempts.get(workerId) || 0 > 0) {
      status = 'recovering';
    } else {
      status = 'unhealthy';
    }

    return {
      workerId,
      successRate,
      averageTaskTime,
      failureStreak,
      lastFailureTime: recentHistory.find(h => !h.success)?.timestamp,
      healthScore,
      status
    };
  }

  /**
   * Shutdown monitoring
   */
  shutdown(): void {
    this.logger.info('Shutting down worker health monitor');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.emit('shutdown');
    this.logger.info('Worker health monitor shutdown complete');
  }
}