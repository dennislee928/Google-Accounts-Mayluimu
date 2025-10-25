/**
 * Core data models for the Google Account Automation System
 */

export interface AccountData {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  recoveryEmail?: string;
  birthDate: Date;
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say';
  createdAt: Date;
  workerId: string;
  ipAddress: string;
  status: 'pending' | 'created' | 'verified' | 'failed';
}

export interface CreationTask {
  id: string;
  batchId: string;
  accountData: AccountData;
  assignedWorker?: string;
  attempts: number;
  maxAttempts: number;
  status: 'queued' | 'in-progress' | 'completed' | 'failed';
  createdAt: Date;
  scheduledAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export interface PuppeteerConfig {
  headless: boolean;
  viewport: {
    width: number;
    height: number;
  };
  userAgent: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  args: string[];
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface SystemConfig {
  rateLimit: {
    accountsPerDay: number;
    accountsPerHour: number;
    delayBetweenAccounts: [number, number]; // min, max seconds
  };
  workers: {
    maxConcurrentWorkers: number;
    puppeteerConfig: PuppeteerConfig;
    retryPolicy: RetryConfig;
  };
  storage: {
    provider: 'cloudflare-kv' | 'database';
    encryptionKey: string;
    connectionString?: string;
  };
  monitoring: {
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    metricsEnabled: boolean;
    alertThresholds: {
      successRateThreshold: number;
      captchaRateThreshold: number;
    };
  };
}

export interface WorkerStatus {
  id: string;
  status: 'idle' | 'busy' | 'failed' | 'offline';
  currentTask?: string;
  lastHeartbeat: Date;
  tasksCompleted: number;
  tasksSuccessful: number;
  tasksFailed: number;
}

export interface SystemMetrics {
  totalAccountsCreated: number;
  successRate: number;
  captchaEncounterRate: number;
  averageCreationTime: number;
  activeWorkers: number;
  queuedTasks: number;
  failedTasks: number;
}

export interface CloudflareWorkerRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CloudflareWorkerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TempEmailResponse {
  email: string;
  token: string;
  expiresAt: Date;
}

export interface CredentialStoreEntry {
  id: string;
  encryptedData: string;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  correlationId?: string;
  workerId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  enabled: boolean;
  notificationChannels: string[];
}

export interface NotificationChannel {
  id: string;
  type: 'email' | 'slack' | 'webhook';
  config: Record<string, unknown>;
  enabled: boolean;
}