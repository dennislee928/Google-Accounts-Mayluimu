/**
 * Configuration management utilities
 */

import { SystemConfig } from '../types';
import * as dotenv from 'dotenv';

dotenv.config();

export const defaultConfig: SystemConfig = {
  rateLimit: {
    accountsPerDay: 100,
    accountsPerHour: 10,
    delayBetweenAccounts: [120, 600], // 2-10 minutes
  },
  workers: {
    maxConcurrentWorkers: 5,
    puppeteerConfig: {
      headless: true,
      viewport: {
        width: 1366,
        height: 768,
      },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
    retryPolicy: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 16000,
      backoffMultiplier: 2,
    },
  },
  storage: {
    provider: 'database',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default-key-change-in-production',
    connectionString: process.env.DATABASE_URL || 'sqlite:./accounts.db',
  },
  monitoring: {
    enableLogging: true,
    logLevel: 'info',
    metricsEnabled: true,
    alertThresholds: {
      successRateThreshold: 0.7,
      captchaRateThreshold: 0.3,
    },
  },
};

export function loadConfig(): SystemConfig {
  return {
    ...defaultConfig,
    rateLimit: {
      ...defaultConfig.rateLimit,
      accountsPerDay: parseInt(process.env.ACCOUNTS_PER_DAY || '100'),
      accountsPerHour: parseInt(process.env.ACCOUNTS_PER_HOUR || '10'),
    },
    workers: {
      ...defaultConfig.workers,
      maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '5'),
    },
    storage: {
      ...defaultConfig.storage,
      provider: (process.env.STORAGE_PROVIDER as 'cloudflare-kv' | 'database') || 'database',
      encryptionKey: process.env.ENCRYPTION_KEY || defaultConfig.storage.encryptionKey,
      connectionString: process.env.DATABASE_URL || defaultConfig.storage.connectionString,
    },
  };
}