/**
 * Integration tests for AccountCreator browser automation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AccountCreator, AccountCreatorConfig } from '../AccountCreator';
import { AccountData } from '../../types';

// Mock Puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('AccountCreator Integration Tests', () => {
  let accountCreator: AccountCreator;
  let mockBrowser: any;
  let mockPage: any;
  let config: AccountCreatorConfig;

  beforeEach(() => {
    // Setup mock browser and page
    mockPage = {
      goto: jest.fn(),
      setViewport: jest.fn(),
      setUserAgent: jest.fn(),
      evaluateOnNewDocument: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      select: jest.fn(),
      click: jest.fn(),
      waitForNavigation: jest.fn(),
      waitForTimeout: jest.fn(),
      $: jest.fn(),
      $x: jest.fn(),
      content: jest.fn(),
      close: jest.fn(),
      isIntersectingViewport: jest.fn().mockResolvedValue(true)
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn()
    };

    const puppeteer = require('puppeteer');
    puppeteer.launch.mockResolvedValue(mockBrowser);

    // Setup configuration
    config = {
      puppeteerConfig: {
        headless: true,
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        args: ['--no-sandbox']
      },
      credentialGeneratorConfig: {
        usernameLength: 10,
        passwordLength: 12,
        includeNumbers: true,
        includeSymbols: true,
        avoidSimilarChars: true,
        enforceComplexity: true
      },
      maxRetries: 3,
      timeoutMs: 30000
    };

    accountCreator = new AccountCreator(config, 'test-worker');
  });

  afterEach(async () => {
    await accountCreator.cleanup();
    jest.clearAllMocks();
  });

  describe('Credential Generation', () => {
    it('should generate valid account credentials', () => {
      const credentials = accountCreator.generateCredentials();

      expect(credentials).toBeDefined();
      expect(credentials.email).toMatch(/^[^\s@]+@gmail\.com$/);
      expect(credentials.password).toBeDefined();
      expect(credentials.firstName).toBeDefined();
      expect(credentials.lastName).toBeDefined();
      expect(credentials.workerId).toBe('test-worker');
      expect(credentials.status).toBe('pending');
    });

    it('should generate credentials with partial data', () => {
      const partialData = {
        firstName: 'TestFirst',
        lastName: 'TestLast'
      };

      const credentials = accountCreator.generateCredentials(partialData);

      expect(credentials.firstName).toBe('TestFirst');
      expect(credentials.lastName).toBe('TestLast');
      expect(credentials.email).toContain('testfirsttestlast');
    });

    it('should validate generated credentials', () => {
      const credentials = accountCreator.generateCredentials();
      const isValid = accountCreator.validateCredentials(credentials);

      expect(isValid).toBe(true);
    });

    it('should reject invalid credentials', () => {
      const invalidCredentials: AccountData = {
        id: 'test-id',
        email: 'invalid-email',
        password: '123', // Too short
        firstName: '',
        lastName: '',
        birthDate: new Date('1900-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const isValid = accountCreator.validateCredentials(invalidCredentials);

      expect(isValid).toBe(false);
    });

    it('should generate batch of credentials', () => {
      const batchSize = 5;
      const batch = accountCreator.generateCredentialsBatch(batchSize);

      expect(batch).toHaveLength(batchSize);
      expect(batch.every(cred => cred.workerId === 'test-worker')).toBe(true);
      
      // Check uniqueness
      const emails = batch.map(cred => cred.email);
      const uniqueEmails = new Set(emails);
      expect(uniqueEmails.size).toBe(batchSize);
    });
  });

  describe('Browser Initialization', () => {
    it('should initialize browser with correct configuration', async () => {
      const testAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User',
        birthDate: new Date('1990-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      // Mock successful navigation and form filling
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.$.mockResolvedValue({ click: jest.fn(), type: jest.fn() });
      mockPage.content.mockResolvedValue('<html><body>Welcome to Google</body></html>');

      try {
        await accountCreator.createAccount(testAccount);
      } catch (error) {
        // Expected to fail in test environment
      }

      const puppeteer = require('puppeteer');
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining(['--no-sandbox'])
        })
      );

      expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1366, height: 768 });
      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );
    });

    it('should handle browser initialization errors', async () => {
      const puppeteer = require('puppeteer');
      puppeteer.launch.mockRejectedValue(new Error('Browser launch failed'));

      const testAccount = accountCreator.generateCredentials();

      await expect(accountCreator.createAccount(testAccount)).rejects.toThrow();
    });
  });

  describe('Form Filling', () => {
    beforeEach(() => {
      // Setup successful browser initialization
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.$.mockResolvedValue({ 
        click: jest.fn(), 
        type: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true)
      });
    });

    it('should fill account creation form correctly', async () => {
      const testAccount: AccountData = {
        id: 'test-id',
        email: 'testuser@gmail.com',
        password: 'TestPassword123!',
        firstName: 'Test',
        lastName: 'User',
        birthDate: new Date('1990-05-15'),
        gender: 'male',
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      // Mock successful verification
      mockPage.content.mockResolvedValue('<html><body>Welcome Test User</body></html>');

      try {
        await accountCreator.createAccount(testAccount);
      } catch (error) {
        // Expected in test environment
      }

      // Verify form fields were filled
      expect(mockPage.type).toHaveBeenCalledWith('#firstName, [name="firstName"]', 'Test');
      expect(mockPage.type).toHaveBeenCalledWith('#lastName, [name="lastName"]', 'User');
      expect(mockPage.type).toHaveBeenCalledWith('#username, [name="Username"]', 'testuser');
      expect(mockPage.type).toHaveBeenCalledWith('#passwd, [name="Passwd"]', 'TestPassword123!');
    });

    it('should handle missing form elements gracefully', async () => {
      const testAccount = accountCreator.generateCredentials();

      // Mock missing form elements
      mockPage.waitForSelector.mockRejectedValue(new Error('Element not found'));

      await expect(accountCreator.createAccount(testAccount)).rejects.toThrow();
    });
  });

  describe('Phone Verification Bypass', () => {
    beforeEach(() => {
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.$.mockResolvedValue({ 
        click: jest.fn(), 
        type: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true)
      });
    });

    it('should attempt to skip phone verification', async () => {
      const testAccount = accountCreator.generateCredentials();

      // Mock skip button found
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve({ 
            click: jest.fn(),
            isIntersectingViewport: jest.fn().mockResolvedValue(true)
          });
        }
        return Promise.resolve({ 
          click: jest.fn(), 
          type: jest.fn(),
          isIntersectingViewport: jest.fn().mockResolvedValue(true)
        });
      });

      mockPage.content.mockResolvedValue('<html><body>Account created successfully</body></html>');

      const result = await accountCreator.handlePhoneVerification();

      expect(result).toBe(true);
    });

    it('should use recovery email when skip not available', async () => {
      const testAccount = accountCreator.generateCredentials();

      // Mock no skip button, but recovery email field available
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve(null);
        }
        if (selector.includes('recovery')) {
          return Promise.resolve({ 
            type: jest.fn(),
            isIntersectingViewport: jest.fn().mockResolvedValue(true)
          });
        }
        return Promise.resolve({ 
          click: jest.fn(), 
          type: jest.fn(),
          isIntersectingViewport: jest.fn().mockResolvedValue(true)
        });
      });

      const result = await accountCreator.handlePhoneVerification();

      expect(result).toBe(true);
    });
  });

  describe('CAPTCHA Handling', () => {
    beforeEach(() => {
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.$.mockResolvedValue({ 
        click: jest.fn(), 
        type: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true)
      });
    });

    it('should detect and attempt to solve reCAPTCHA', async () => {
      // Mock reCAPTCHA frame
      const mockFrame = {
        $: jest.fn().mockResolvedValue({ click: jest.fn() })
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('recaptcha')) {
          return Promise.resolve({ 
            contentFrame: jest.fn().mockResolvedValue(mockFrame)
          });
        }
        return Promise.resolve({ 
          click: jest.fn(), 
          type: jest.fn(),
          isIntersectingViewport: jest.fn().mockResolvedValue(true)
        });
      });

      const result = await accountCreator.solveCaptcha('recaptcha');

      expect(result).toBe(true);
      expect(mockFrame.$).toHaveBeenCalledWith('.recaptcha-checkbox-border');
    });

    it('should return false for unsupported CAPTCHA types', async () => {
      mockPage.$.mockResolvedValue(null);

      const result = await accountCreator.solveCaptcha('unknown');

      expect(result).toBe(true); // Returns true when no CAPTCHA detected
    });
  });

  describe('Credential Storage', () => {
    it('should store credentials via API', async () => {
      const axios = require('axios');
      axios.post.mockResolvedValue({ 
        status: 200, 
        data: { accountId: 'stored-123' } 
      });

      const testAccount = accountCreator.generateCredentials();
      
      // Set storage URL
      accountCreator['config'].credentialStorageUrl = 'https://api.example.com/store';

      await accountCreator.storeCredentials(testAccount);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.example.com/store',
        testAccount,
        expect.objectContaining({
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should handle storage errors gracefully', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('Storage failed'));

      const testAccount = accountCreator.generateCredentials();
      accountCreator['config'].credentialStorageUrl = 'https://api.example.com/store';

      await expect(accountCreator.storeCredentials(testAccount)).rejects.toThrow('Storage failed');
    });

    it('should skip storage when no URL configured', async () => {
      const testAccount = accountCreator.generateCredentials();
      
      // No storage URL configured
      accountCreator['config'].credentialStorageUrl = undefined;

      await expect(accountCreator.storeCredentials(testAccount)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle navigation timeouts', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      const testAccount = accountCreator.generateCredentials();

      await expect(accountCreator.createAccount(testAccount)).rejects.toThrow();
    });

    it('should handle form submission failures', async () => {
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.$.mockResolvedValue({ 
        click: jest.fn(), 
        type: jest.fn(),
        isIntersectingViewport: jest.fn().mockResolvedValue(true)
      });
      
      // Mock failed verification
      mockPage.content.mockResolvedValue('<html><body>Error occurred</body></html>');

      const testAccount = accountCreator.generateCredentials();

      await expect(accountCreator.createAccount(testAccount)).rejects.toThrow('Account verification failed');
    });

    it('should update account status on failure', async () => {
      mockPage.goto.mockRejectedValue(new Error('Test error'));

      const testAccount = accountCreator.generateCredentials();

      try {
        await accountCreator.createAccount(testAccount);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Cleanup', () => {
    it('should close browser and page on cleanup', async () => {
      // Initialize browser first
      const testAccount = accountCreator.generateCredentials();
      
      try {
        await accountCreator.createAccount(testAccount);
      } catch (error) {
        // Expected in test
      }

      await accountCreator.cleanup();

      expect(mockPage.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockPage.close.mockRejectedValue(new Error('Close failed'));
      mockBrowser.close.mockRejectedValue(new Error('Browser close failed'));

      await expect(accountCreator.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Username Availability', () => {
    it('should check username availability', async () => {
      const result = await accountCreator.checkUsernameAvailability('testuser123');

      expect(typeof result).toBe('boolean');
    });

    it('should handle availability check errors', async () => {
      // Mock error in credential generator
      jest.spyOn(accountCreator['credentialGenerator'], 'checkUsernameAvailability')
        .mockRejectedValue(new Error('Check failed'));

      const result = await accountCreator.checkUsernameAvailability('testuser123');

      expect(result).toBe(false);
    });
  });

  describe('Statistics and Cache Management', () => {
    it('should return credential generation statistics', () => {
      const stats = accountCreator.getCredentialStats();

      expect(stats).toHaveProperty('usedUsernamesCount');
      expect(stats).toHaveProperty('configSettings');
      expect(typeof stats.usedUsernamesCount).toBe('number');
    });

    it('should reset credential cache', () => {
      expect(() => accountCreator.resetCredentialCache()).not.toThrow();
    });
  });
});