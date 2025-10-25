/**
 * Puppeteer-based account creation automation
 * Handles browser automation for Google account signup process
 */

import puppeteer, { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer';
import { IAccountCreator } from '../interfaces';
import { AccountData, PuppeteerConfig } from '../types';
import { Logger } from '../utils';
import { CredentialGenerator, CredentialGeneratorConfig } from './CredentialGenerator';
import axios from 'axios';

export interface AccountCreatorConfig {
  puppeteerConfig: PuppeteerConfig;
  credentialGeneratorConfig: CredentialGeneratorConfig;
  workerProxyUrl?: string;
  tempEmailApiUrl?: string;
  credentialStorageUrl?: string;
  maxRetries: number;
  timeoutMs: number;
}

export class AccountCreator implements IAccountCreator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: AccountCreatorConfig;
  private logger: Logger;
  private workerId: string;
  private credentialGenerator: CredentialGenerator;

  constructor(config: AccountCreatorConfig, workerId: string = 'default') {
    this.config = config;
    this.workerId = workerId;
    this.logger = new Logger(undefined, workerId);
    this.credentialGenerator = new CredentialGenerator(config.credentialGeneratorConfig, workerId);
  }

  /**
   * Create a new Google account with the provided data
   */
  async createAccount(accountData: AccountData): Promise<AccountData> {
    const correlationId = `create_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const logger = this.logger.withCorrelationId(correlationId);
    
    logger.info('Starting account creation process', { 
      email: accountData.email,
      workerId: this.workerId 
    });

    try {
      // Validate credentials before proceeding
      if (!this.validateCredentials(accountData)) {
        throw new Error('Invalid account credentials provided');
      }

      // Initialize browser if not already done
      await this.initializeBrowser();
      
      // Navigate to Google signup page
      await this.navigateToSignup();
      
      // Fill account information
      await this.fillAccountForm(accountData);
      
      // Handle verification steps
      const verificationResult = await this.handleVerificationSteps();
      
      if (!verificationResult) {
        throw new Error('Account verification failed');
      }
      
      // Update account data with creation details
      const createdAccount: AccountData = {
        ...accountData,
        createdAt: new Date(),
        workerId: this.workerId,
        status: 'created'
      };
      
      logger.info('Account creation completed successfully', { 
        email: createdAccount.email,
        accountId: createdAccount.id 
      });
      
      return createdAccount;
      
    } catch (error) {
      logger.error('Account creation failed', { 
        error: error instanceof Error ? error.message : error,
        email: accountData.email 
      });
      
      // Update status to failed
      const failedAccount: AccountData = {
        ...accountData,
        status: 'failed',
        createdAt: new Date(),
        workerId: this.workerId
      };
      
      throw error;
    }
  }

  /**
   * Handle phone verification step if encountered
   */
  async handlePhoneVerification(): Promise<boolean> {
    const logger = this.logger.withCorrelationId('phone_verification');
    
    try {
      if (!this.page) {
        throw new Error('Browser page not initialized');
      }

      logger.info('Checking for phone verification prompt');
      
      // Import and use the phone verification bypass
      const { PhoneVerificationBypass } = await import('./PhoneVerificationBypass');
      const bypassConfig = {
        tempEmailApiUrl: this.config.tempEmailApiUrl,
        virtualNumberApiUrl: undefined, // Not implemented yet
        maxRetryAttempts: this.config.maxRetries,
        timeoutMs: this.config.timeoutMs
      };
      
      const phoneBypass = new PhoneVerificationBypass(bypassConfig, this.workerId);
      
      // Check if phone verification is required
      const isRequired = await phoneBypass.isPhoneVerificationRequired(this.page);
      if (!isRequired) {
        logger.info('Phone verification not required');
        return true;
      }
      
      // Get verification step info
      const stepInfo = await phoneBypass.getVerificationStepInfo(this.page);
      logger.info('Phone verification step detected', stepInfo);
      
      // Attempt to bypass phone verification
      const success = await phoneBypass.bypassPhoneVerification(this.page);
      
      if (success) {
        logger.info('Phone verification bypassed successfully');
        return true;
      } else {
        logger.warn('All phone verification bypass strategies failed');
        return false;
      }
      
    } catch (error) {
      logger.error('Phone verification handling failed', { 
        error: error instanceof Error ? error.message : error 
      });
      return false;
    }
  }

  /**
   * Solve CAPTCHA challenges
   */
  async solveCaptcha(captchaType: string): Promise<boolean> {
    const logger = this.logger.withCorrelationId('captcha_solving');
    
    try {
      if (!this.page) {
        throw new Error('Browser page not initialized');
      }

      logger.info('Attempting to solve CAPTCHA', { type: captchaType });
      
      // Check for reCAPTCHA
      const recaptchaFrame = await this.page.$('iframe[src*="recaptcha"]');
      if (recaptchaFrame) {
        logger.info('Found reCAPTCHA, attempting to solve');
        
        // Try to click the checkbox
        const frame = await recaptchaFrame.contentFrame();
        if (frame) {
          const checkbox = await frame.$('.recaptcha-checkbox-border');
          if (checkbox) {
            await checkbox.click();
            await this.page.waitForTimeout(2000);
            
            // Check if solved
            const solved = await frame.$('.recaptcha-checkbox-checked');
            if (solved) {
              logger.info('reCAPTCHA solved successfully');
              return true;
            }
          }
        }
      }
      
      // Check for audio CAPTCHA option
      const audioCaptcha = await this.page.$('#audio-captcha, .audio-captcha');
      if (audioCaptcha) {
        logger.info('Found audio CAPTCHA option');
        // Audio CAPTCHA solving would require additional implementation
        // For now, we'll return false to indicate manual intervention needed
        return false;
      }
      
      // Check for image CAPTCHA
      const imageCaptcha = await this.page.$('#image-captcha, .image-captcha');
      if (imageCaptcha) {
        logger.info('Found image CAPTCHA - requires manual intervention');
        return false;
      }
      
      logger.info('No CAPTCHA detected or already solved');
      return true;
      
    } catch (error) {
      logger.error('CAPTCHA solving failed', { 
        error: error instanceof Error ? error.message : error,
        type: captchaType 
      });
      return false;
    }
  }

  /**
   * Store account credentials securely
   */
  async storeCredentials(credentials: AccountData): Promise<void> {
    const logger = this.logger.withCorrelationId('store_credentials');
    
    try {
      if (!this.config.credentialStorageUrl) {
        logger.warn('No credential storage URL configured, skipping storage');
        return;
      }
      
      logger.info('Storing account credentials', { email: credentials.email });
      
      const response = await axios.post(this.config.credentialStorageUrl, credentials, {
        timeout: this.config.timeoutMs,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 200) {
        logger.info('Credentials stored successfully', { 
          accountId: response.data.accountId 
        });
      } else {
        throw new Error(`Storage failed with status: ${response.status}`);
      }
      
    } catch (error) {
      logger.error('Failed to store credentials', { 
        error: error instanceof Error ? error.message : error,
        email: credentials.email 
      });
      throw error;
    }
  }

  /**
   * Clean up browser resources
   */
  async cleanup(): Promise<void> {
    const logger = this.logger.withCorrelationId('cleanup');
    
    try {
      logger.info('Cleaning up browser resources');
      
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      logger.info('Browser cleanup completed');
      
    } catch (error) {
      logger.error('Browser cleanup failed', { 
        error: error instanceof Error ? error.message : error 
      });
    }
  }

  /**
   * Initialize browser with realistic fingerprints
   */
  private async initializeBrowser(): Promise<void> {
    if (this.browser && this.page) {
      return; // Already initialized
    }

    const logger = this.logger.withCorrelationId('browser_init');
    logger.info('Initializing browser');

    const launchOptions: PuppeteerLaunchOptions = {
      headless: this.config.puppeteerConfig.headless,
      args: [
        ...this.config.puppeteerConfig.args,
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: null
    };

    // Add proxy configuration if available
    if (this.config.puppeteerConfig.proxy) {
      launchOptions.args?.push(`--proxy-server=${this.config.puppeteerConfig.proxy.server}`);
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Set realistic viewport
    await this.page.setViewport(this.config.puppeteerConfig.viewport);

    // Set user agent
    await this.page.setUserAgent(this.config.puppeteerConfig.userAgent);

    // Remove automation indicators
    await this.page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock chrome runtime
      (window as any).chrome = {
        runtime: {}
      };

      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Cypress ? 'denied' : 'granted' } as PermissionStatus) :
          originalQuery(parameters)
      );
    });

    logger.info('Browser initialized successfully');
  }

  /**
   * Navigate to Google signup page
   */
  private async navigateToSignup(): Promise<void> {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }

    const logger = this.logger.withCorrelationId('navigate_signup');
    logger.info('Navigating to Google signup page');

    const signupUrl = this.config.workerProxyUrl 
      ? `${this.config.workerProxyUrl}/proxy/signup`
      : 'https://accounts.google.com/signup';

    await this.page.goto(signupUrl, { 
      waitUntil: 'networkidle2',
      timeout: this.config.timeoutMs 
    });

    // Wait for the form to load
    await this.page.waitForSelector('#firstName, [name="firstName"]', { 
      timeout: this.config.timeoutMs 
    });

    logger.info('Successfully navigated to signup page');
  }

  /**
   * Fill account creation form
   */
  private async fillAccountForm(accountData: AccountData): Promise<void> {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }

    const logger = this.logger.withCorrelationId('fill_form');
    logger.info('Filling account creation form');

    // Fill first name
    await this.page.waitForSelector('#firstName, [name="firstName"]');
    await this.page.type('#firstName, [name="firstName"]', accountData.firstName);

    // Fill last name
    await this.page.waitForSelector('#lastName, [name="lastName"]');
    await this.page.type('#lastName, [name="lastName"]', accountData.lastName);

    // Fill username/email
    await this.page.waitForSelector('#username, [name="Username"]');
    const username = accountData.email.split('@')[0];
    await this.page.type('#username, [name="Username"]', username);

    // Fill password
    await this.page.waitForSelector('#passwd, [name="Passwd"]');
    await this.page.type('#passwd, [name="Passwd"]', accountData.password);

    // Confirm password
    await this.page.waitForSelector('#confirm-passwd, [name="ConfirmPasswd"]');
    await this.page.type('#confirm-passwd, [name="ConfirmPasswd"]', accountData.password);

    // Fill birth date if provided
    if (accountData.birthDate) {
      const birthDate = new Date(accountData.birthDate);
      
      // Month
      const monthSelector = '#month, [name="Month"]';
      if (await this.page.$(monthSelector)) {
        await this.page.select(monthSelector, (birthDate.getMonth() + 1).toString());
      }
      
      // Day
      const daySelector = '#day, [name="Day"]';
      if (await this.page.$(daySelector)) {
        await this.page.type(daySelector, birthDate.getDate().toString());
      }
      
      // Year
      const yearSelector = '#year, [name="Year"]';
      if (await this.page.$(yearSelector)) {
        await this.page.type(yearSelector, birthDate.getFullYear().toString());
      }
    }

    // Select gender if provided
    if (accountData.gender) {
      const genderSelector = '#gender, [name="Gender"]';
      if (await this.page.$(genderSelector)) {
        const genderValue = this.mapGenderValue(accountData.gender);
        await this.page.select(genderSelector, genderValue);
      }
    }

    logger.info('Form filled successfully');
  }

  /**
   * Handle verification steps (phone, CAPTCHA, etc.)
   */
  private async handleVerificationSteps(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }

    const logger = this.logger.withCorrelationId('verification');
    logger.info('Handling verification steps');

    // Click next/continue button
    const nextButton = await this.page.$('#accountDetailsNext, [type="submit"], .next-button');
    if (nextButton) {
      await nextButton.click();
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
    }

    // Handle CAPTCHA if present
    const captchaPresent = await this.page.$('iframe[src*="recaptcha"], #captcha, .captcha');
    if (captchaPresent) {
      const captchaSolved = await this.solveCaptcha('recaptcha');
      if (!captchaSolved) {
        logger.warn('CAPTCHA solving failed');
        return false;
      }
    }

    // Handle phone verification
    const phoneVerificationSkipped = await this.handlePhoneVerification();
    if (!phoneVerificationSkipped) {
      logger.warn('Phone verification could not be skipped');
      return false;
    }

    // Accept terms and conditions
    const termsCheckbox = await this.page.$('#termsofserviceNext, [name="tos"], .terms-checkbox');
    if (termsCheckbox) {
      await termsCheckbox.click();
    }

    // Final submit
    const submitButton = await this.page.$('#submit, [type="submit"], .create-account');
    if (submitButton) {
      await submitButton.click();
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    }

    // Check for success indicators
    const successIndicators = [
      'Welcome',
      'account created',
      'gmail.com',
      'Google Account'
    ];

    const pageContent = await this.page.content();
    const isSuccess = successIndicators.some(indicator => 
      pageContent.toLowerCase().includes(indicator.toLowerCase())
    );

    logger.info('Verification steps completed', { success: isSuccess });
    return isSuccess;
  }

  /**
   * Generate temporary email for recovery
   */
  private async generateTempEmail(): Promise<string | null> {
    try {
      if (!this.config.tempEmailApiUrl) {
        return null;
      }

      const response = await axios.post(this.config.tempEmailApiUrl, {}, {
        timeout: this.config.timeoutMs
      });

      if (response.data && response.data.email) {
        return response.data.email;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to generate temp email', { 
        error: error instanceof Error ? error.message : error 
      });
      return null;
    }
  }

  /**
   * Map gender values to Google's expected format
   */
  private mapGenderValue(gender: string): string {
    const genderMap: Record<string, string> = {
      'male': '1',
      'female': '2',
      'other': '3',
      'prefer-not-to-say': '4'
    };

    return genderMap[gender] || '4';
  }

  /**
   * Get random delay between actions
   */
  private getRandomDelay(min: number = 500, max: number = 2000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Add human-like delays between actions
   */
  private async humanDelay(): Promise<void> {
    const delay = this.getRandomDelay();
    await this.page?.waitForTimeout(delay);
  }

  /**
   * Generate new account credentials
   */
  generateCredentials(partialData?: Partial<AccountData>): AccountData {
    const logger = this.logger.withCorrelationId('generate_credentials');
    logger.info('Generating new account credentials');

    const accountData = this.credentialGenerator.generateAccountData({
      ...partialData,
      workerId: this.workerId
    });

    // Validate generated data
    const validation = this.credentialGenerator.validateAccountData(accountData);
    
    if (!validation.isValid) {
      logger.error('Generated credentials are invalid', { errors: validation.errors });
      throw new Error(`Invalid credentials generated: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      logger.warn('Generated credentials have warnings', { warnings: validation.warnings });
    }

    logger.info('Credentials generated and validated successfully', { 
      email: accountData.email,
      hasWarnings: validation.warnings.length > 0 
    });

    return accountData;
  }

  /**
   * Validate account data before creation
   */
  validateCredentials(accountData: AccountData): boolean {
    const logger = this.logger.withCorrelationId('validate_credentials');
    logger.info('Validating account credentials', { email: accountData.email });

    const validation = this.credentialGenerator.validateAccountData(accountData);
    
    if (!validation.isValid) {
      logger.error('Credential validation failed', { 
        errors: validation.errors,
        email: accountData.email 
      });
      return false;
    }

    if (validation.warnings.length > 0) {
      logger.warn('Credential validation has warnings', { 
        warnings: validation.warnings,
        email: accountData.email 
      });
    }

    logger.info('Credentials validated successfully', { email: accountData.email });
    return true;
  }

  /**
   * Check username availability
   */
  async checkUsernameAvailability(username: string): Promise<boolean> {
    const logger = this.logger.withCorrelationId('check_username');
    logger.info('Checking username availability', { username });

    try {
      const result = await this.credentialGenerator.checkUsernameAvailability(username);
      
      if (!result.available) {
        logger.info('Username not available', { 
          username,
          suggestions: result.suggestions 
        });
      }

      return result.available;
    } catch (error) {
      logger.error('Username availability check failed', { 
        error: error instanceof Error ? error.message : error,
        username 
      });
      return false;
    }
  }

  /**
   * Generate batch of account credentials
   */
  generateCredentialsBatch(count: number, template?: Partial<AccountData>): AccountData[] {
    const logger = this.logger.withCorrelationId('generate_batch');
    logger.info(`Generating batch of ${count} credentials`);

    try {
      const accounts = this.credentialGenerator.generateAccountBatch(count, {
        ...template,
        workerId: this.workerId
      });

      // Validate all generated accounts
      const validAccounts = accounts.filter(account => {
        const validation = this.credentialGenerator.validateAccountData(account);
        if (!validation.isValid) {
          logger.warn('Skipping invalid account in batch', { 
            email: account.email,
            errors: validation.errors 
          });
          return false;
        }
        return true;
      });

      logger.info(`Generated ${validAccounts.length}/${count} valid credentials`);
      return validAccounts;
    } catch (error) {
      logger.error('Batch credential generation failed', { 
        error: error instanceof Error ? error.message : error,
        count 
      });
      throw error;
    }
  }

  /**
   * Get credential generation statistics
   */
  getCredentialStats(): {
    usedUsernamesCount: number;
    configSettings: CredentialGeneratorConfig;
  } {
    return this.credentialGenerator.getGenerationStats();
  }

  /**
   * Reset credential generator cache
   */
  resetCredentialCache(): void {
    this.credentialGenerator.resetUsernameCache();
    this.logger.info('Credential generator cache reset');
  }
}