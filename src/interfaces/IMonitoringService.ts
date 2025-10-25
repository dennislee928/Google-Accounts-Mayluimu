import { LogEntry, SystemMetrics, AlertRule } from '../types';

/**
 * Interface for monitoring and alerting system
 */
export interface IMonitoringService {
  /**
   * Log an event with specified level
   */
  log(level: LogEntry['level'], message: string, metadata?: Record<string, unknown>): void;

  /**
   * Record system metrics
   */
  recordMetrics(metrics: Partial<SystemMetrics>): Promise<void>;

  /**
   * Get current system metrics
   */
  getMetrics(): Promise<SystemMetrics>;

  /**
   * Create or update alert rule
   */
  setAlertRule(rule: AlertRule): Promise<void>;

  /**
   * Check alert conditions and trigger notifications
   */
  checkAlerts(): Promise<void>;

  /**
   * Send notification through configured channels
   */
  sendNotification(message: string, severity: 'info' | 'warning' | 'critical'): Promise<void>;

  /**
   * Get system health status
   */
  getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    lastCheck: Date;
  }>;
}