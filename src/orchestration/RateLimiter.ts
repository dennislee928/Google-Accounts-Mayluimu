/**
 * Rate Limiting and Timing Controls
 * Implements configurable rate limiting to avoid anti-abuse detection
 */

import * as timers from 'node:timers';
import { Logger } from '../utils';
import { SystemConfig } from '../types';

export interface RateLimitConfig {
  accountsPerDay: number;
  accountsPerHour: number;
  delayBetweenAccounts: [number, number]; // min, max seconds
  burstLimit: number;
  cooldownPeriodMs: number;
  adaptiveRateAdjustment: boolean;
}

export interface RateLimitState {
  accountsCreatedToday: number;
  accountsCreatedThisHour: number;
  lastAccountCreation: Date;
  currentDelay: number;
  isInCooldown: boolean;
  cooldownUntil?: Date;
  successRate: number;
  recentAttempts: Array<{ timestamp: Date; success: boolean }>;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private state: RateLimitState;
  private logger: Logger;
  private dailyResetTimeout?: NodeJS.Timeout;
  private hourlyResetTimeout?: NodeJS.Timeout;

  constructor(systemConfig: SystemConfig) {
    this.config = {
      accountsPerDay: systemConfig.rateLimit.accountsPerDay,
      accountsPerHour: systemConfig.rateLimit.accountsPerHour,
      delayBetweenAccounts: systemConfig.rateLimit.delayBetweenAccounts,
      burstLimit: Math.min(10, systemConfig.rateLimit.accountsPerHour / 4), // 25% of hourly limit
      cooldownPeriodMs: 30 * 60 * 1000, // 30 minutes
      adaptiveRateAdjustment: true
    };

    this.state = {
      accountsCreatedToday: 0,
      accountsCreatedThisHour: 0,
      lastAccountCreation: new Date(0),
      currentDelay: this.config.delayBetweenAccounts[0] * 1000,
      isInCooldown: false,
      successRate: 1.0,
      recentAttempts: []
    };

    this.logger = new Logger(undefined, 'rate-limiter');
    this.initializeTimers();
  }

  /**
   * Check if account creation is allowed
   */
  async canCreateAccount(): Promise<{
    allowed: boolean;
    reason?: string;
    waitTimeMs?: number;
    nextAvailableSlot?: Date;
  }> {
    const logger = this.logger.withCorrelationId('rate_check');

    try {
      // Check if in cooldown period
      if (this.state.isInCooldown && this.state.cooldownUntil) {
        const remainingCooldown = this.state.cooldownUntil.getTime() - Date.now();
        if (remainingCooldown > 0) {
          return {
            allowed: false,
            reason: 'System in cooldown period',
            waitTimeMs: remainingCooldown,
            nextAvailableSlot: this.state.cooldownUntil
          };
        } else {
          // Cooldown expired
          this.state.isInCooldown = false;
          this.state.cooldownUntil = undefined;
          logger.info('Cooldown period expired');
        }
      }

      // Check daily limit
      if (this.state.accountsCreatedToday >= this.config.accountsPerDay) {
        const nextDay = this.getNextDayReset();
        return {
          allowed: false,
          reason: 'Daily limit reached',
          waitTimeMs: nextDay.getTime() - Date.now(),
          nextAvailableSlot: nextDay
        };
      }

      // Check hourly limit
      if (this.state.accountsCreatedThisHour >= this.config.accountsPerHour) {
        const nextHour = this.getNextHourReset();
        return {
          allowed: false,
          reason: 'Hourly limit reached',
          waitTimeMs: nextHour.getTime() - Date.now(),
          nextAvailableSlot: nextHour
        };
      }

      // Check minimum delay between accounts
      const timeSinceLastCreation = Date.now() - this.state.lastAccountCreation.getTime();
      if (timeSinceLastCreation < this.state.currentDelay) {
        const waitTime = this.state.currentDelay - timeSinceLastCreation;
        const nextSlot = new Date(Date.now() + waitTime);
        
        return {
          allowed: false,
          reason: 'Minimum delay not met',
          waitTimeMs: waitTime,
          nextAvailableSlot: nextSlot
        };
      }

      // Check burst protection
      const recentCreations = this.getRecentCreations(5 * 60 * 1000); // Last 5 minutes
      if (recentCreations >= this.config.burstLimit) {
        const waitTime = 5 * 60 * 1000; // Wait 5 minutes
        const nextSlot = new Date(Date.now() + waitTime);
        
        return {
          allowed: false,
          reason: 'Burst limit exceeded',
          waitTimeMs: waitTime,
          nextAvailableSlot: nextSlot
        };
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Rate limit check failed', { 
        error: error instanceof Error ? error.message : error 
      });
      
      // Fail safe - deny on error
      return {
        allowed: false,
        reason: 'Rate limiter error',
        waitTimeMs: 60000 // Wait 1 minute
      };
    }
  }

  /**
   * Record account creation attempt
   */
  async recordAccountCreation(success: boolean): Promise<void> {
    const logger = this.logger.withCorrelationId('record_creation');

    try {
      const now = new Date();

      // Update counters
      this.state.accountsCreatedToday++;
      this.state.accountsCreatedThisHour++;
      this.state.lastAccountCreation = now;

      // Record attempt for success rate calculation
      this.state.recentAttempts.push({ timestamp: now, success });
      
      // Keep only recent attempts (last hour)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      this.state.recentAttempts = this.state.recentAttempts.filter(
        attempt => attempt.timestamp > oneHourAgo
      );

      // Update success rate
      this.updateSuccessRate();

      // Adjust delay based on success rate if adaptive adjustment is enabled
      if (this.config.adaptiveRateAdjustment) {
        this.adjustDelayBasedOnSuccessRate();
      } else {
        // Use random delay within configured range
        this.state.currentDelay = this.getRandomDelay();
      }

      logger.info('Account creation recorded', {
        success,
        dailyCount: this.state.accountsCreatedToday,
        hourlyCount: this.state.accountsCreatedThisHour,
        successRate: this.state.successRate,
        currentDelay: this.state.currentDelay
      });

      // Check if cooldown should be triggered
      await this.checkCooldownTrigger();

    } catch (error) {
      logger.error('Failed to record account creation', { 
        error: error instanceof Error ? error.message : error,
        success 
      });
    }
  }

  /**
   * Get next available slot for account creation
   */
  async getNextAvailableSlot(): Promise<Date> {
    const checkResult = await this.canCreateAccount();
    
    if (checkResult.allowed) {
      return new Date();
    }

    return checkResult.nextAvailableSlot || new Date(Date.now() + 60000);
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    dailyUsage: { used: number; limit: number; percentage: number };
    hourlyUsage: { used: number; limit: number; percentage: number };
    currentDelay: number;
    successRate: number;
    isInCooldown: boolean;
    cooldownUntil?: Date;
    nextResets: { daily: Date; hourly: Date };
  } {
    return {
      dailyUsage: {
        used: this.state.accountsCreatedToday,
        limit: this.config.accountsPerDay,
        percentage: (this.state.accountsCreatedToday / this.config.accountsPerDay) * 100
      },
      hourlyUsage: {
        used: this.state.accountsCreatedThisHour,
        limit: this.config.accountsPerHour,
        percentage: (this.state.accountsCreatedThisHour / this.config.accountsPerHour) * 100
      },
      currentDelay: this.state.currentDelay,
      successRate: this.state.successRate,
      isInCooldown: this.state.isInCooldown,
      cooldownUntil: this.state.cooldownUntil,
      nextResets: {
        daily: this.getNextDayReset(),
        hourly: this.getNextHourReset()
      }
    };
  }

  /**
   * Manually trigger cooldown period
   */
  async triggerCooldown(durationMs?: number): Promise<void> {
    const logger = this.logger.withCorrelationId('manual_cooldown');
    
    const cooldownDuration = durationMs || this.config.cooldownPeriodMs;
    this.state.isInCooldown = true;
    this.state.cooldownUntil = new Date(Date.now() + cooldownDuration);

    logger.warn('Manual cooldown triggered', { 
      durationMs: cooldownDuration,
      cooldownUntil: this.state.cooldownUntil 
    });
  }

  /**
   * Reset rate limits (for testing or manual intervention)
   */
  resetLimits(): void {
    this.logger.info('Resetting rate limits');
    
    this.state.accountsCreatedToday = 0;
    this.state.accountsCreatedThisHour = 0;
    this.state.isInCooldown = false;
    this.state.cooldownUntil = undefined;
    this.state.recentAttempts = [];
    this.state.successRate = 1.0;
    this.state.currentDelay = this.config.delayBetweenAccounts[0] * 1000;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Rate limit configuration updated', { newConfig });
  }

  /**
   * Initialize reset timers
   */
  private initializeTimers(): void {
    // Set up daily reset timer
    const now = new Date();
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    
    const msUntilNextDay = nextDay.getTime() - now.getTime();
    this.dailyResetTimeout = setTimeout(() => {
      this.resetDailyCounter();
      // Set up recurring daily reset
      setInterval(() => this.resetDailyCounter(), 24 * 60 * 60 * 1000);
    }, msUntilNextDay);

    // Set up hourly reset timer
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    
    const msUntilNextHour = nextHour.getTime() - now.getTime();
    this.hourlyResetTimeout = setTimeout(() => {
      this.resetHourlyCounter();
      // Set up recurring hourly reset
      setInterval(() => this.resetHourlyCounter(), 60 * 60 * 1000);
    }, msUntilNextHour);

    this.logger.info('Rate limit timers initialized', {
      nextDailyReset: nextDay,
      nextHourlyReset: nextHour
    });
  }

  /**
   * Reset daily counter
   */
  private resetDailyCounter(): void {
    this.state.accountsCreatedToday = 0;
    this.logger.info('Daily rate limit counter reset');
  }

  /**
   * Reset hourly counter
   */
  private resetHourlyCounter(): void {
    this.state.accountsCreatedThisHour = 0;
    this.logger.info('Hourly rate limit counter reset');
  }

  /**
   * Get next day reset time
   */
  private getNextDayReset(): Date {
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    return nextDay;
  }

  /**
   * Get next hour reset time
   */
  private getNextHourReset(): Date {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  }

  /**
   * Get number of recent creations within time window
   */
  private getRecentCreations(timeWindowMs: number): number {
    const cutoff = new Date(Date.now() - timeWindowMs);
    return this.state.recentAttempts.filter(
      attempt => attempt.timestamp > cutoff
    ).length;
  }

  /**
   * Update success rate based on recent attempts
   */
  private updateSuccessRate(): void {
    if (this.state.recentAttempts.length === 0) {
      this.state.successRate = 1.0;
      return;
    }

    const successfulAttempts = this.state.recentAttempts.filter(
      attempt => attempt.success
    ).length;

    this.state.successRate = successfulAttempts / this.state.recentAttempts.length;
  }

  /**
   * Adjust delay based on success rate
   */
  private adjustDelayBasedOnSuccessRate(): void {
    const [minDelay, maxDelay] = this.config.delayBetweenAccounts;
    const minDelayMs = minDelay * 1000;
    const maxDelayMs = maxDelay * 1000;

    if (this.state.successRate >= 0.9) {
      // High success rate - use shorter delays
      this.state.currentDelay = minDelayMs + (maxDelayMs - minDelayMs) * 0.2;
    } else if (this.state.successRate >= 0.7) {
      // Medium success rate - use medium delays
      this.state.currentDelay = minDelayMs + (maxDelayMs - minDelayMs) * 0.5;
    } else {
      // Low success rate - use longer delays
      this.state.currentDelay = minDelayMs + (maxDelayMs - minDelayMs) * 0.8;
    }

    // Add some randomness
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
    this.state.currentDelay *= randomFactor;

    // Ensure within bounds
    this.state.currentDelay = Math.max(minDelayMs, Math.min(maxDelayMs, this.state.currentDelay));
  }

  /**
   * Get random delay within configured range
   */
  private getRandomDelay(): number {
    const [minDelay, maxDelay] = this.config.delayBetweenAccounts;
    const minMs = minDelay * 1000;
    const maxMs = maxDelay * 1000;
    
    return minMs + Math.random() * (maxMs - minMs);
  }

  /**
   * Check if cooldown should be triggered based on success rate
   */
  private async checkCooldownTrigger(): Promise<void> {
    // Trigger cooldown if success rate drops below 30% with sufficient attempts
    if (this.state.successRate < 0.3 && this.state.recentAttempts.length >= 10) {
      this.logger.warn('Low success rate detected, triggering cooldown', {
        successRate: this.state.successRate,
        attempts: this.state.recentAttempts.length
      });
      
      await this.triggerCooldown();
    }
  }

  /**
   * Cleanup timers on shutdown
   */
  shutdown(): void {
    if (this.dailyResetTimeout) {
      clearTimeout(this.dailyResetTimeout);
    }
    
    if (this.hourlyResetTimeout) {
      clearTimeout(this.hourlyResetTimeout);
    }

    this.logger.info('Rate limiter shutdown complete');
  }
}