/**
 * Logging utilities
 */

import { LogEntry, LogLevel } from '../types';

export class Logger {
  private correlationId?: string;
  private workerId?: string;

  constructor(correlationId?: string, workerId?: string) {
    this.correlationId = correlationId;
    this.workerId = workerId;
  }

  private createLogEntry(level: LogLevel, message: string, metadata?: Record<string, unknown>): LogEntry {
    return {
      timestamp: new Date(),
      level,
      message,
      correlationId: this.correlationId,
      workerId: this.workerId,
      metadata,
    };
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('error', message, metadata);
  }

  fatal(message: string, metadata?: Record<string, unknown>): void {
    this.log('fatal', message, metadata);
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(level, message, metadata);
    
    // For now, just console log - will be enhanced in monitoring implementation
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
  }

  withCorrelationId(correlationId: string): Logger {
    return new Logger(correlationId, this.workerId);
  }

  withWorkerId(workerId: string): Logger {
    return new Logger(this.correlationId, workerId);
  }
}