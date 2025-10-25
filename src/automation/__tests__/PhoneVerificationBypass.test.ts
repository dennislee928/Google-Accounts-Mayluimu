/**
 * Integration tests for Phone Verification Bypass
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PhoneVerificationBypass, PhoneBypassConfig } from '../PhoneVerificationBypass';

// Mock axios
jest.mock('axios');

describe('PhoneVerificationBypass Integration Tests', () => {
  let phoneBypass: PhoneVerificationBypass;
  let mockPage: any;
  let config: PhoneBypassConfig;

  beforeEach(() => {
    // Setup mock page
    mockPage = {
      $: jest.fn(),
      $x: jest.fn(),
      content: jest.fn(),
      waitForNavigation: jest.fn(),
      waitForTimeout: jest.fn(),
      type: jest.fn(),
      click: jest.fn(),
      press: jest.fn()
    };

    // Setup configuration
    config = {
      tempEmailApiUrl: 'https://api.tempmail.com/generate',
      maxRetryAttempts: 3,
      timeoutMs: 10000
    };

    phoneBypass = new PhoneVerificationBypass(config, 'test-worker');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Phone Verification Detection', () => {
    it('should detect phone verification requirement', async () => {
      // Mock phone verification elements present
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('phoneNumber')) {
          return Promise.resolve({ 
            isIntersectingViewport: jest.fn().mockResolvedValue(true) 
          });
        }
        return Promise.resolve(null);
      });

      const isRequired = await phoneBypass.isPhoneVerificationRequired(mockPage);

      expect(isRequired).toBe(true);
    });

    it('should detect when phone verification is not required', async () => {
      // Mock no phone verification elements
      mockPage.$.mockResolvedValue(null);

      const isRequired = await phoneBypass.isPhoneVerificationRequired(mockPage);

      expect(isRequired).toBe(false);
    });

    it('should get verification step information', async () => {
      mockPage.content.mockResolvedValue('<html><body>Please verify your phone number</body></html>');

      const stepInfo = await phoneBypass.getVerificationStepInfo(mockPage);

      expect(stepInfo.step).toBe('phone_verification');
      expect(stepInfo.required).toBe(true);
      expect(stepInfo.options).toContain('skip');
    });
  });

  describe('Skip Button Strategy', () => {
    it('should successfully click skip button', async () => {
      const mockSkipButton = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        click: jest.fn()
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve(mockSkipButton);
        }
        return Promise.resolve(null);
      });

      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockSkipButton.click).toHaveBeenCalled();
      expect(mockPage.waitForNavigation).toHaveBeenCalled();
    });

    it('should try multiple skip button selectors', async () => {
      // Mock first selector fails, second succeeds
      let callCount = 0;
      mockPage.$.mockImplementation((selector) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(null);
        }
        if (selector.includes('Skip') || selector.includes('skip')) {
          return Promise.resolve({
            isIntersectingViewport: jest.fn().mockResolvedValue(true),
            click: jest.fn()
          });
        }
        return Promise.resolve(null);
      });

      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockPage.$).toHaveBeenCalledTimes(2);
    });
  });

  describe('Skip Link Strategy', () => {
    it('should find and click skip text links', async () => {
      const mockSkipLink = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        click: jest.fn()
      };

      // Mock skip button not found, but skip link found
      mockPage.$.mockResolvedValue(null);
      mockPage.$x.mockResolvedValue([mockSkipLink]);
      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockSkipLink.click).toHaveBeenCalled();
    });

    it('should handle invisible skip links', async () => {
      const mockInvisibleLink = {
        isIntersectingViewport: jest.fn().mockResolvedValue(false),
        click: jest.fn()
      };

      mockPage.$.mockResolvedValue(null);
      mockPage.$x.mockResolvedValue([mockInvisibleLink]);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(false);
      expect(mockInvisibleLink.click).not.toHaveBeenCalled();
    });
  });

  describe('Recovery Email Strategy', () => {
    it('should use recovery email when available', async () => {
      const axios = require('axios');
      axios.post.mockResolvedValue({
        data: { email: 'temp123@tempmail.org' }
      });

      const mockRecoveryField = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        type: jest.fn()
      };

      const mockContinueButton = {
        click: jest.fn()
      };

      // Mock skip button not found, recovery email found
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve(null);
        }
        if (selector.includes('recovery')) {
          return Promise.resolve(mockRecoveryField);
        }
        if (selector.includes('continue') || selector.includes('next')) {
          return Promise.resolve(mockContinueButton);
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);
      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockRecoveryField.type).toHaveBeenCalledWith('temp123@tempmail.org');
      expect(mockContinueButton.click).toHaveBeenCalled();
    });

    it('should handle temp email generation failure', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('API failed'));

      const mockRecoveryField = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        type: jest.fn()
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('recovery')) {
          return Promise.resolve(mockRecoveryField);
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(false);
    });
  });

  describe('Later Button Strategy', () => {
    it('should click later button when available', async () => {
      const mockLaterButton = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        click: jest.fn()
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve(null);
        }
        if (selector.includes('Later')) {
          return Promise.resolve(mockLaterButton);
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);
      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockLaterButton.click).toHaveBeenCalled();
    });

    it('should find later button by text content', async () => {
      const mockLaterButton = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        click: jest.fn()
      };

      // Mock selector-based search fails, text-based succeeds
      mockPage.$.mockResolvedValue(null);
      mockPage.$x.mockImplementation((xpath) => {
        if (xpath.includes('Later')) {
          return Promise.resolve([mockLaterButton]);
        }
        return Promise.resolve([]);
      });

      mockPage.waitForNavigation.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockLaterButton.click).toHaveBeenCalled();
    });
  });

  describe('Form Field Skip Strategy', () => {
    it('should try to continue with empty phone field', async () => {
      const mockPhoneInput = {
        click: jest.fn(),
        press: jest.fn()
      };

      const mockContinueButton = {
        click: jest.fn()
      };

      // Mock all other strategies fail
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('phoneNumber') || selector.includes('phone-input')) {
          return Promise.resolve(mockPhoneInput);
        }
        if (selector.includes('continue') || selector.includes('next')) {
          return Promise.resolve(mockContinueButton);
        }
        if (selector.includes('error')) {
          return Promise.resolve(null); // No error message
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);
      mockPage.waitForTimeout.mockResolvedValue(true);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(true);
      expect(mockPhoneInput.click).toHaveBeenCalledWith({ clickCount: 3 });
      expect(mockPhoneInput.press).toHaveBeenCalledWith('Backspace');
      expect(mockContinueButton.click).toHaveBeenCalled();
    });

    it('should detect phone validation errors', async () => {
      const mockPhoneInput = {
        click: jest.fn(),
        press: jest.fn()
      };

      const mockContinueButton = {
        click: jest.fn()
      };

      const mockErrorElement = {
        // Error element exists
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('phoneNumber')) {
          return Promise.resolve(mockPhoneInput);
        }
        if (selector.includes('continue')) {
          return Promise.resolve(mockContinueButton);
        }
        if (selector.includes('error')) {
          return Promise.resolve(mockErrorElement); // Error present
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(false);
    });
  });

  describe('Strategy Priority and Fallback', () => {
    it('should try strategies in priority order', async () => {
      const callOrder: string[] = [];

      // Mock all strategies to fail except the last one
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          callOrder.push('skip-button');
          return Promise.resolve(null);
        }
        if (selector.includes('phoneNumber')) {
          callOrder.push('form-field');
          return Promise.resolve({
            click: jest.fn(),
            press: jest.fn()
          });
        }
        if (selector.includes('continue')) {
          return Promise.resolve({ click: jest.fn() });
        }
        if (selector.includes('error')) {
          return Promise.resolve(null); // No error
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockImplementation((xpath) => {
        if (xpath.includes('Skip')) {
          callOrder.push('skip-link');
        }
        return Promise.resolve([]);
      });

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(callOrder).toContain('skip-button');
      expect(callOrder).toContain('skip-link');
      expect(callOrder).toContain('form-field');
      expect(result).toBe(true);
    });

    it('should return false when all strategies fail', async () => {
      // Mock all strategies to fail
      mockPage.$.mockResolvedValue(null);
      mockPage.$x.mockResolvedValue([]);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle strategy execution errors gracefully', async () => {
      // Mock strategy to throw error
      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          throw new Error('DOM error');
        }
        if (selector.includes('phoneNumber')) {
          return Promise.resolve({
            click: jest.fn(),
            press: jest.fn()
          });
        }
        if (selector.includes('continue')) {
          return Promise.resolve({ click: jest.fn() });
        }
        if (selector.includes('error')) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      mockPage.$x.mockResolvedValue([]);

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      // Should continue to next strategy despite error
      expect(result).toBe(true);
    });

    it('should handle navigation timeouts', async () => {
      const mockSkipButton = {
        isIntersectingViewport: jest.fn().mockResolvedValue(true),
        click: jest.fn()
      };

      mockPage.$.mockImplementation((selector) => {
        if (selector.includes('Skip')) {
          return Promise.resolve(mockSkipButton);
        }
        return Promise.resolve(null);
      });

      mockPage.waitForNavigation.mockRejectedValue(new Error('Navigation timeout'));

      const result = await phoneBypass.bypassPhoneVerification(mockPage);

      expect(result).toBe(false);
    });
  });

  describe('Temp Email Generation', () => {
    it('should generate temp email via API', async () => {
      const axios = require('axios');
      axios.post.mockResolvedValue({
        data: { email: 'generated@tempmail.org' }
      });

      // Access private method for testing
      const tempEmail = await (phoneBypass as any).generateTempEmail();

      expect(tempEmail).toBe('generated@tempmail.org');
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.tempmail.com/generate',
        {},
        { timeout: 10000 }
      );
    });

    it('should generate fallback email when API unavailable', async () => {
      // No API URL configured
      const noApiBypass = new PhoneVerificationBypass({
        maxRetryAttempts: 3,
        timeoutMs: 10000
      }, 'test-worker');

      const tempEmail = await (noApiBypass as any).generateTempEmail();

      expect(tempEmail).toMatch(/^temp_[a-z0-9]+_\d+@tempmail\.org$/);
    });

    it('should handle API errors gracefully', async () => {
      const axios = require('axios');
      axios.post.mockRejectedValue(new Error('API error'));

      const tempEmail = await (phoneBypass as any).generateTempEmail();

      expect(tempEmail).toBeNull();
    });
  });
});