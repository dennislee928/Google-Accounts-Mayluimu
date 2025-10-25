/**
 * Comprehensive monitoring and alerting service implementation
 */

// Global Node.js types
declare const process: any;
declare const setInterval: any;
declare const console: any;

import { IMonitoringService } from '../interfaces';
import { LogEntry, SystemMetrics, AlertRule, NotificationChannel } from '../types';
import { Logger } from '../utils';
// EventEmitter declaration
declare class EventEmitter {
  on(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
}

export class MonitoringService extends EventEmitter implements IMonitoringService {
  private logger: Logger;
  private metrics: SystemMetrics;
  private alertRules: Map<string, AlertRule>;
  private notificationChannels: Map<string, NotificationChannel>;
  private healthChecks: Map<string, () => Promise<boolean>>;
  private lastHealthCheck: Date;

  constructor() {
    super();
    this.logger = new Logger(undefined, 'monitoring');
    this.metrics = this.initializeMetrics();
    this.alertRules = new Map();
    this.notificationChannels = new Map();
    this.healthChecks = new Map();
    this.lastHealthCheck = new Date();
    
    this.setupDefaultHealthChecks();
    this.startPeriodicHealthChecks();
  }

  log(level: LogEntry['level'], message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      metadata
    };

    // Log to console (in production, would use proper logging service)
    const logMessage = `[${entry.timestamp.toISOString()}] ${level.toUpperCase()}: ${message}`;
    
    switch (level) {
      case 'debug':
        console.debug(logMessage, metadata);
        break;
      case 'info':
        console.info(logMessage, metadata);
        break;
      case 'warn':
        console.warn(logMessage, metadata);
        break;
      case 'error':
      case 'fatal':
        console.error(logMessage, metadata);
        break;
    }

    this.emit('logEntry', entry);
  }

  async recordMetrics(metrics: Partial<SystemMetrics>): Promise<void> {
    try {
      this.metrics = { ...this.metrics, ...metrics };
      this.emit('metricsUpdated', this.metrics);
      
      // Check alerts after metrics update
      await this.checkAlerts();
      
    } catch (error) {
      this.logger.error('Failed to record metrics', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  async getMetrics(): Promise<SystemMetrics> {
    return { ...this.metrics };
  }

  async setAlertRule(rule: AlertRule): Promise<void> {
    try {
      this.alertRules.set(rule.id, rule);
      this.logger.info('Alert rule configured', { ruleId: rule.id, name: rule.name });
      
    } catch (error) {
      this.logger.error('Failed to set alert rule', { 
        error: error instanceof Error ? error.message : error,
        ruleId: rule.id 
      });
      throw error;
    }
  }

  async checkAlerts(): Promise<void> {
    try {
      for (const [ruleId, rule] of this.alertRules) {
        if (!rule.enabled) continue;

        const shouldAlert = await this.evaluateAlertCondition(rule);
        
        if (shouldAlert) {
          await this.triggerAlert(rule);
        }
      }
      
    } catch (error) {
      this.logger.error('Alert checking failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  async sendNotification(message: string, severity: 'info' | 'warning' | 'critical'): Promise<void> {
    try {
      const notification = {
        message,
        severity,
        timestamp: new Date(),
        id: Math.random().toString(36).substring(2, 15)
      };

      // Send to all enabled notification channels
      for (const [channelId, channel] of this.notificationChannels) {
        if (channel.enabled) {
          await this.sendToChannel(channel, notification);
        }
      }

      this.emit('notificationSent', notification);
      
    } catch (error) {
      this.logger.error('Failed to send notification', { 
        error: error instanceof Error ? error.message : error,
        message,
        severity 
      });
    }
  }

  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    lastCheck: Date;
  }> {
    try {
      const checks: Record<string, boolean> = {};
      let healthyCount = 0;
      let totalChecks = 0;

      for (const [checkName, checkFn] of this.healthChecks) {
        try {
          const result = await checkFn();
          checks[checkName] = result;
          if (result) healthyCount++;
          totalChecks++;
        } catch (error) {
          checks[checkName] = false;
          totalChecks++;
        }
      }

      let status: 'healthy' | 'degraded' | 'unhealthy';
      const healthPercentage = totalChecks > 0 ? healthyCount / totalChecks : 1;

      if (healthPercentage >= 0.9) {
        status = 'healthy';
      } else if (healthPercentage >= 0.7) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      this.lastHealthCheck = new Date();

      return {
        status,
        checks,
        lastCheck: this.lastHealthCheck
      };

    } catch (error) {
      this.logger.error('Health status check failed', { 
        error: error instanceof Error ? error.message : error 
      });
      
      return {
        status: 'unhealthy',
        checks: {},
        lastCheck: this.lastHealthCheck
      };
    }
  }

  // Additional monitoring methods
  
  addNotificationChannel(channel: NotificationChannel): void {
    this.notificationChannels.set(channel.id, channel);
    this.logger.info('Notification channel added', { channelId: channel.id, type: channel.type });
  }

  addHealthCheck(name: string, checkFn: () => Promise<boolean>): void {
    this.healthChecks.set(name, checkFn);
    this.logger.info('Health check added', { checkName: name });
  }

  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    this.logger.info('Alert rule removed', { ruleId });
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  private initializeMetrics(): SystemMetrics {
    return {
      totalAccountsCreated: 0,
      successRate: 0,
      captchaEncounterRate: 0,
      averageCreationTime: 0,
      activeWorkers: 0,
      queuedTasks: 0,
      failedTasks: 0
    };
  }

  private setupDefaultHealthChecks(): void {
    // System memory check
    this.addHealthCheck('memory', async () => {
      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      return heapUsedMB < 500; // Less than 500MB
    });

    // System uptime check
    this.addHealthCheck('uptime', async () => {
      return process.uptime() > 0;
    });

    // Metrics freshness check
    this.addHealthCheck('metrics', async () => {
      return this.metrics !== null;
    });
  }

  private async evaluateAlertCondition(rule: AlertRule): Promise<boolean> {
    try {
      switch (rule.condition) {
        case 'success_rate_low':
          return this.metrics.successRate < rule.threshold;
        
        case 'captcha_rate_high':
          return this.metrics.captchaEncounterRate > rule.threshold;
        
        case 'failed_tasks_high':
          return this.metrics.failedTasks > rule.threshold;
        
        case 'no_active_workers':
          return this.metrics.activeWorkers === 0;
        
        default:
          return false;
      }
    } catch (error) {
      this.logger.error('Alert condition evaluation failed', { 
        error: error instanceof Error ? error.message : error,
        ruleId: rule.id 
      });
      return false;
    }
  }

  private async triggerAlert(rule: AlertRule): Promise<void> {
    const alertMessage = `Alert: ${rule.name} - Threshold: ${rule.threshold}, Current: ${this.getMetricValue(rule.condition)}`;
    
    this.logger.warn('Alert triggered', { 
      ruleId: rule.id,
      ruleName: rule.name,
      condition: rule.condition,
      threshold: rule.threshold 
    });

    // Send notifications to specified channels
    for (const channelId of rule.notificationChannels) {
      const channel = this.notificationChannels.get(channelId);
      if (channel && channel.enabled) {
        await this.sendToChannel(channel, {
          message: alertMessage,
          severity: 'critical',
          timestamp: new Date(),
          id: `alert_${rule.id}_${Date.now()}`
        });
      }
    }

    this.emit('alertTriggered', { rule, metrics: this.metrics });
  }

  private getMetricValue(condition: string): number {
    switch (condition) {
      case 'success_rate_low':
        return this.metrics.successRate;
      case 'captcha_rate_high':
        return this.metrics.captchaEncounterRate;
      case 'failed_tasks_high':
        return this.metrics.failedTasks;
      case 'no_active_workers':
        return this.metrics.activeWorkers;
      default:
        return 0;
    }
  }

  private async sendToChannel(channel: NotificationChannel, notification: any): Promise<void> {
    try {
      switch (channel.type) {
        case 'email':
          // In production, would integrate with email service
          console.log(`EMAIL NOTIFICATION [${channel.id}]: ${notification.message}`);
          break;
        
        case 'slack':
          // In production, would integrate with Slack API
          console.log(`SLACK NOTIFICATION [${channel.id}]: ${notification.message}`);
          break;
        
        case 'webhook':
          // In production, would make HTTP request to webhook URL
          console.log(`WEBHOOK NOTIFICATION [${channel.id}]: ${notification.message}`);
          break;
        
        default:
          console.log(`NOTIFICATION [${channel.id}]: ${notification.message}`);
      }
    } catch (error) {
      this.logger.error('Failed to send to notification channel', { 
        error: error instanceof Error ? error.message : error,
        channelId: channel.id 
      });
    }
  }

  private startPeriodicHealthChecks(): void {
    // Run health checks every 30 seconds
    setInterval(async () => {
      try {
        const healthStatus = await this.getHealthStatus();
        this.emit('healthStatusUpdate', healthStatus);
        
        if (healthStatus.status === 'unhealthy') {
          await this.sendNotification(
            `System health is unhealthy. Failed checks: ${Object.entries(healthStatus.checks)
              .filter(([_, passed]) => !passed)
              .map(([name]) => name)
              .join(', ')}`,
            'critical'
          );
        }
      } catch (error) {
        this.logger.error('Periodic health check failed', { 
          error: error instanceof Error ? error.message : error 
        });
      }
    }, 30000);
  }

  shutdown(): void {
    this.logger.info('Shutting down monitoring service');
    this.emit('shutdown');
  }
}