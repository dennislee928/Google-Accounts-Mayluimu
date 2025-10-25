/**
 * Phone Verification Bypass Mechanisms
 * Handles various strategies to bypass or handle phone verification during account creation
 */

import { Page } from 'puppeteer';
import { Logger } from '../utils';
import axios from 'axios';

export interface PhoneBypassConfig {
  tempEmailApiUrl?: string;
  virtualNumberApiUrl?: string;
  maxRetryAttempts: number;
  timeoutMs: number;
}

export interface VerificationStrategy {
  name: string;
  priority: number;
  execute(page: Page): Promise<boolean>;
}

export class PhoneVerificationBypass {
  private logger: Logger;
  private config: PhoneBypassConfig;
  private strategies: VerificationStrategy[];

  constructor(config: PhoneBypassConfig, workerId: string = 'default') {
    this.config = config;
    this.logger = new Logger(undefined, workerId);
    this.strategies = this.initializeStrategies();
  }

  /**
   * Attempt to bypass phone verification using multiple strategies
   */
  async bypassPhoneVerification(page: Page): Promise<boolean> {
    const logger = this.logger.withCorrelationId('phone_bypass');
    logger.info('Starting phone verification bypass');

    // Sort strategies by priority (higher priority first)
    const sortedStrategies = this.strategies.sort((a, b) => b.priority - a.priority);

    for (const strategy of sortedStrategies) {
      logger.info(`Attempting strategy: ${strategy.name}`);
      
      try {
        const success = await strategy.execute(page);
        if (success) {
          logger.info(`Successfully bypassed phone verification using: ${strategy.name}`);
          return true;
        }
        
        logger.info(`Strategy ${strategy.name} failed, trying next strategy`);
      } catch (error) {
        logger.warn(`Strategy ${strategy.name} threw error`, { 
          error: error instanceof Error ? error.message : error 
        });
      }
    }

    logger.warn('All phone verification bypass strategies failed');
    return false;
  }

  /**
   * Initialize verification bypass strategies
   */
  private initializeStrategies(): VerificationStrategy[] {
    return [
      {
        name: 'Skip Button Click',
        priority: 100,
        execute: this.skipButtonStrategy.bind(this)
      },
      {
        name: 'Skip Link Text',
        priority: 90,
        execute: this.skipLinkStrategy.bind(this)
      },
      {
        name: 'Recovery Email Alternative',
        priority: 80,
        execute: this.recoveryEmailStrategy.bind(this)
      },
      {
        name: 'Later Button',
        priority: 70,
        execute: this.laterButtonStrategy.bind(this)
      },
      {
        name: 'Not Now Option',
        priority: 60,
        execute: this.notNowStrategy.bind(this)
      },
      {
        name: 'Alternative Verification',
        priority: 50,
        execute: this.alternativeVerificationStrategy.bind(this)
      },
      {
        name: 'Form Field Skip',
        priority: 40,
        execute: this.formFieldSkipStrategy.bind(this)
      },
      {
        name: 'Virtual Number Fallback',
        priority: 30,
        execute: this.virtualNumberStrategy.bind(this)
      }
    ];
  }

  /**
   * Strategy 1: Look for and click skip button
   */
  private async skipButtonStrategy(page: Page): Promise<boolean> {
    const skipSelectors = [
      '#collectPhoneNumber_Skip',
      '[data-action="skip"]',
      '.skip-phone',
      '[aria-label*="Skip"]',
      'button[jsname*="skip" i]',
      '.phone-skip-button'
    ];

    for (const selector of skipSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: this.config.timeoutMs 
            });
            return true;
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    return false;
  }

  /**
   * Strategy 2: Look for skip text links
   */
  private async skipLinkStrategy(page: Page): Promise<boolean> {
    const skipTexts = [
      'Skip',
      'skip',
      'Skip this step',
      'Skip for now',
      'Skip phone verification'
    ];

    for (const text of skipTexts) {
      try {
        const elements = await page.$x(`//span[contains(text(), '${text}') or contains(text(), '${text.toLowerCase()}')]`);
        
        for (const element of elements) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: this.config.timeoutMs 
            });
            return true;
          }
        }
      } catch (error) {
        // Continue to next text
      }
    }

    return false;
  }

  /**
   * Strategy 3: Use recovery email as alternative
   */
  private async recoveryEmailStrategy(page: Page): Promise<boolean> {
    const recoverySelectors = [
      '#recovery-email',
      '[name="recoveryEmail"]',
      '[name="RecoveryEmail"]',
      '.recovery-email-input',
      '#recoveryEmailAddress'
    ];

    for (const selector of recoverySelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            // Generate temporary email
            const tempEmail = await this.generateTempEmail();
            if (tempEmail) {
              await element.type(tempEmail);
              
              // Look for continue/next button
              const continueButton = await page.$('#next, [type="submit"], .continue-button, .next-button');
              if (continueButton) {
                await continueButton.click();
                await page.waitForNavigation({ 
                  waitUntil: 'networkidle2', 
                  timeout: this.config.timeoutMs 
                });
                return true;
              }
            }
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    return false;
  }

  /**
   * Strategy 4: Look for "Later" button
   */
  private async laterButtonStrategy(page: Page): Promise<boolean> {
    const laterSelectors = [
      'button[aria-label*="Later"]',
      '[data-action="later"]',
      '.later-button'
    ];

    const laterTexts = [
      'Later',
      'Do this later',
      'Maybe later',
      'Not now'
    ];

    // Try button selectors
    for (const selector of laterSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: this.config.timeoutMs 
            });
            return true;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    // Try text-based elements
    for (const text of laterTexts) {
      try {
        const elements = await page.$x(`//button[contains(text(), '${text}') or contains(@aria-label, '${text}')]`);
        
        for (const element of elements) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: this.config.timeoutMs 
            });
            return true;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return false;
  }

  /**
   * Strategy 5: Look for "Not now" options
   */
  private async notNowStrategy(page: Page): Promise<boolean> {
    const notNowTexts = [
      'Not now',
      'No thanks',
      'Maybe later',
      'Ask me later'
    ];

    for (const text of notNowTexts) {
      try {
        const elements = await page.$x(`//button[contains(text(), '${text}') or contains(@aria-label, '${text}')]`);
        
        for (const element of elements) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForNavigation({ 
              waitUntil: 'networkidle2', 
              timeout: this.config.timeoutMs 
            });
            return true;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return false;
  }

  /**
   * Strategy 6: Look for alternative verification methods
   */
  private async alternativeVerificationStrategy(page: Page): Promise<boolean> {
    const alternativeSelectors = [
      '[data-action="alternative"]',
      '.alternative-verification',
      '#alternative-method',
      'button[aria-label*="alternative"]'
    ];

    const alternativeTexts = [
      'Try another way',
      'Use another method',
      'Alternative verification',
      'Different method'
    ];

    // Try selectors
    for (const selector of alternativeSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForTimeout(2000);
            
            // After clicking alternative, try recovery email
            const success = await this.recoveryEmailStrategy(page);
            if (success) return true;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    // Try text-based elements
    for (const text of alternativeTexts) {
      try {
        const elements = await page.$x(`//button[contains(text(), '${text}') or contains(@aria-label, '${text}')]`);
        
        for (const element of elements) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            await page.waitForTimeout(2000);
            
            // After clicking alternative, try recovery email
            const success = await this.recoveryEmailStrategy(page);
            if (success) return true;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return false;
  }

  /**
   * Strategy 7: Try to skip by leaving phone field empty and continuing
   */
  private async formFieldSkipStrategy(page: Page): Promise<boolean> {
    try {
      // Look for phone input field
      const phoneInput = await page.$('#phoneNumberId, [name="phoneNumber"], [name="PhoneNumber"], .phone-input');
      
      if (phoneInput) {
        // Clear any existing value
        await phoneInput.click({ clickCount: 3 });
        await phoneInput.press('Backspace');
        
        // Try to continue without entering phone
        const continueButton = await page.$('#next, [type="submit"], .continue-button, .next-button');
        if (continueButton) {
          await continueButton.click();
          
          // Wait a bit to see if it proceeds
          await page.waitForTimeout(3000);
          
          // Check if we moved to next step (no phone error)
          const phoneError = await page.$('.phone-error, .error-message, [role="alert"]');
          if (!phoneError) {
            return true;
          }
        }
      }
    } catch (error) {
      // Strategy failed
    }

    return false;
  }

  /**
   * Strategy 8: Use virtual number as last resort
   */
  private async virtualNumberStrategy(page: Page): Promise<boolean> {
    try {
      if (!this.config.virtualNumberApiUrl) {
        return false;
      }

      // Get virtual number
      const virtualNumber = await this.getVirtualNumber();
      if (!virtualNumber) {
        return false;
      }

      // Enter virtual number
      const phoneInput = await page.$('#phoneNumberId, [name="phoneNumber"], [name="PhoneNumber"], .phone-input');
      if (phoneInput) {
        await phoneInput.type(virtualNumber);
        
        const continueButton = await page.$('#next, [type="submit"], .continue-button');
        if (continueButton) {
          await continueButton.click();
          await page.waitForNavigation({ 
            waitUntil: 'networkidle2', 
            timeout: this.config.timeoutMs 
          });
          
          // Note: This would require SMS verification handling
          // which is beyond the scope of this basic implementation
          return true;
        }
      }
    } catch (error) {
      this.logger.warn('Virtual number strategy failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }

    return false;
  }

  /**
   * Generate temporary email for recovery
   */
  private async generateTempEmail(): Promise<string | null> {
    try {
      if (!this.config.tempEmailApiUrl) {
        // Generate a simple temporary email
        const randomId = Math.random().toString(36).substring(2, 15);
        const timestamp = Date.now();
        return `temp_${randomId}_${timestamp}@tempmail.org`;
      }

      const response = await axios.post(this.config.tempEmailApiUrl, {}, {
        timeout: this.config.timeoutMs
      });

      if (response.data && response.data.email) {
        return response.data.email;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to generate temp email', { 
        error: error instanceof Error ? error.message : error 
      });
      return null;
    }
  }

  /**
   * Get virtual phone number (placeholder implementation)
   */
  private async getVirtualNumber(): Promise<string | null> {
    try {
      if (!this.config.virtualNumberApiUrl) {
        return null;
      }

      // This would integrate with services like TextNow, SMS-Activate, etc.
      // For now, return null to indicate unavailable
      return null;
    } catch (error) {
      this.logger.warn('Failed to get virtual number', { 
        error: error instanceof Error ? error.message : error 
      });
      return null;
    }
  }

  /**
   * Check if phone verification is currently required
   */
  async isPhoneVerificationRequired(page: Page): Promise<boolean> {
    const phoneIndicators = [
      '#phoneNumberId',
      '[name="phoneNumber"]',
      '.phone-verification',
      'text*="phone number"',
      'text*="verify your phone"',
      'text*="mobile number"'
    ];

    for (const indicator of phoneIndicators) {
      try {
        const element = await page.$(indicator);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            return true;
          }
        }
      } catch (error) {
        // Continue checking
      }
    }

    return false;
  }

  /**
   * Get current verification step information
   */
  async getVerificationStepInfo(page: Page): Promise<{
    step: string;
    required: boolean;
    options: string[];
  }> {
    const pageContent = await page.content();
    const lowerContent = pageContent.toLowerCase();

    if (lowerContent.includes('phone') || lowerContent.includes('mobile')) {
      return {
        step: 'phone_verification',
        required: true,
        options: ['skip', 'recovery_email', 'virtual_number']
      };
    }

    if (lowerContent.includes('email') && lowerContent.includes('recovery')) {
      return {
        step: 'recovery_email',
        required: false,
        options: ['temp_email', 'skip']
      };
    }

    return {
      step: 'unknown',
      required: false,
      options: []
    };
  }
}