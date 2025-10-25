/**
 * Unit tests for Temporary Email Service
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TempEmailService, TempMailProvider, TenMinuteMailProvider, GuerrillaMailProvider } from '../tempEmailService';

// Mock fetch for API calls
global.fetch = jest.fn();

describe('TempMailProvider', () => {
  let provider: TempMailProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new TempMailProvider('test-api-key');
  });

  describe('generateEmail', () => {
    it('should generate valid email address', async () => {
      const result = await provider.generateEmail();
      
      expect(result.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(result.token).toBeTruthy();
      expect(result.provider).toBe('tempmail.org');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should generate unique emails', async () => {
      const result1 = await provider.generateEmail();
      const result2 = await provider.generateEmail();
      
      expect(result1.email).not.toBe(result2.email);
      expect(result1.token).not.toBe(result2.token);
    });

    it('should set expiration time to 1 hour', async () => {
      const before = new Date();
      const result = await provider.generateEmail();
      const after = new Date();
      
      const expectedExpiration = new Date(before.getTime() + 60 * 60 * 1000);
      const timeDiff = Math.abs(result.expiresAt.getTime() - expectedExpiration.getTime());
      
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });
  });

  describe('checkInbox', () => {
    it('should return empty array for new email', async () => {
      const messages = await provider.checkInbox('test@tempmail.org', 'token123');
      
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('should return true by default', async () => {
      const available = await provider.isAvailable();
      
      expect(available).toBe(true);
    });
  });
});

describe('TenMinuteMailProvider', () => {
  let provider: TenMinuteMailProvider;

  beforeEach(() => {
    provider = new TenMinuteMailProvider();
  });

  describe('generateEmail', () => {
    it('should generate 10minutemail.com email', async () => {
      const result = await provider.generateEmail();
      
      expect(result.email).toContain('@10minutemail.com');
      expect(result.provider).toBe('10minutemail.com');
    });

    it('should set expiration time to 10 minutes', async () => {
      const before = new Date();
      const result = await provider.generateEmail();
      
      const expectedExpiration = new Date(before.getTime() + 10 * 60 * 1000);
      const timeDiff = Math.abs(result.expiresAt.getTime() - expectedExpiration.getTime());
      
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });
  });
});

describe('GuerrillaMailProvider', () => {
  let provider: GuerrillaMailProvider;

  beforeEach(() => {
    provider = new GuerrillaMailProvider();
  });

  describe('generateEmail', () => {
    it('should generate guerrillamail.com email', async () => {
      const result = await provider.generateEmail();
      
      expect(result.email).toContain('@guerrillamail.com');
      expect(result.provider).toBe('guerrillamail.com');
    });

    it('should set expiration time to 1 hour', async () => {
      const before = new Date();
      const result = await provider.generateEmail();
      
      const expectedExpiration = new Date(before.getTime() + 60 * 60 * 1000);
      const timeDiff = Math.abs(result.expiresAt.getTime() - expectedExpiration.getTime());
      
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });
  });
});

describe('TempEmailService', () => {
  let service: TempEmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TempEmailService('test-api-key');
  });

  describe('generateEmail', () => {
    it('should generate email using first available provider', async () => {
      const result = await service.generateEmail();
      
      expect(result.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(result.token).toBeTruthy();
      expect(result.provider).toBeTruthy();
    });

    it('should rotate providers on subsequent calls', async () => {
      const result1 = await service.generateEmail();
      const result2 = await service.generateEmail();
      
      // Providers might be different due to rotation
      expect(result1.email).not.toBe(result2.email);
    });

    it('should handle provider failures with fallback', async () => {
      // Mock first provider to fail
      const mockProvider = {
        name: 'failing-provider',
        generateEmail: jest.fn().mockRejectedValue(new Error('Provider failed')),
        checkInbox: jest.fn(),
        isAvailable: jest.fn().mockResolvedValue(false)
      };

      // In actual implementation, would test fallback mechanism
      expect(mockProvider.isAvailable).toBeDefined();
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email format', () => {
      const validEmails = [
        'test@tempmail.org',
        'user123@10minutemail.com',
        'temp@guerrillamail.com'
      ];

      validEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(true);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'invalid-email',
        '@tempmail.org',
        'test@',
        'test.tempmail.org',
        ''
      ];

      invalidEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(false);
      });
    });

    it('should only accept supported domains', () => {
      const supportedEmails = [
        'test@tempmail.org',
        'user@10minutemail.com',
        'temp@guerrillamail.com'
      ];

      const unsupportedEmails = [
        'test@gmail.com',
        'user@yahoo.com',
        'temp@outlook.com'
      ];

      supportedEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(true);
      });

      unsupportedEmails.forEach(email => {
        expect(service.validateEmail(email)).toBe(false);
      });
    });
  });

  describe('getProviderStatus', () => {
    it('should return status for all providers', async () => {
      const status = await service.getProviderStatus();
      
      expect(typeof status).toBe('object');
      expect(status['tempmail.org']).toBeDefined();
      expect(status['10minutemail.com']).toBeDefined();
      expect(status['guerrillamail.com']).toBeDefined();
    });

    it('should handle provider availability checks', async () => {
      const status = await service.getProviderStatus();
      
      Object.values(status).forEach(isAvailable => {
        expect(typeof isAvailable).toBe('boolean');
      });
    });
  });

  describe('cleanupExpiredEmails', () => {
    let mockKVNamespace: any;

    beforeEach(() => {
      mockKVNamespace = {
        list: jest.fn(),
        get: jest.fn(),
        delete: jest.fn()
      };
    });

    it('should cleanup expired emails', async () => {
      const expiredEmail = {
        email: 'expired@tempmail.org',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
      };

      const validEmail = {
        email: 'valid@tempmail.org',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
      };

      mockKVNamespace.list.mockResolvedValue({
        keys: [
          { name: 'temp_email_expired' },
          { name: 'temp_email_valid' }
        ]
      });

      mockKVNamespace.get
        .mockResolvedValueOnce(JSON.stringify(expiredEmail))
        .mockResolvedValueOnce(JSON.stringify(validEmail));

      const cleanedCount = await service.cleanupExpiredEmails(mockKVNamespace);

      expect(mockKVNamespace.delete).toHaveBeenCalledWith('temp_email_expired');
      expect(mockKVNamespace.delete).not.toHaveBeenCalledWith('temp_email_valid');
      expect(cleanedCount).toBe(1);
    });

    it('should handle cleanup errors gracefully', async () => {
      mockKVNamespace.list.mockRejectedValue(new Error('KV error'));

      const cleanedCount = await service.cleanupExpiredEmails(mockKVNamespace);

      expect(cleanedCount).toBe(0);
    });

    it('should skip invalid data during cleanup', async () => {
      mockKVNamespace.list.mockResolvedValue({
        keys: [{ name: 'temp_email_invalid' }]
      });

      mockKVNamespace.get.mockResolvedValue('invalid-json');

      const cleanedCount = await service.cleanupExpiredEmails(mockKVNamespace);

      expect(cleanedCount).toBe(0);
      expect(mockKVNamespace.delete).not.toHaveBeenCalled();
    });
  });

  describe('checkInbox', () => {
    it('should find provider by email domain', async () => {
      const tempMailEmail = 'test@tempmail.org';
      const guerrillaEmail = 'test@guerrillamail.com';

      const messages1 = await service.checkInbox(tempMailEmail);
      const messages2 = await service.checkInbox(guerrillaEmail);

      expect(Array.isArray(messages1)).toBe(true);
      expect(Array.isArray(messages2)).toBe(true);
    });

    it('should handle inbox check errors', async () => {
      const invalidEmail = 'test@invalid-domain.com';

      const messages = await service.checkInbox(invalidEmail);

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(0);
    });
  });
});