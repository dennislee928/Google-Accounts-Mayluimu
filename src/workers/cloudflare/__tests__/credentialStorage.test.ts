/**
 * Unit tests for Cloudflare KV Credential Storage
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CloudflareKVCredentialStorage } from '../credentialStorage';

// Mock Web Crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      importKey: jest.fn(),
      encrypt: jest.fn(),
      decrypt: jest.fn()
    },
    getRandomValues: jest.fn()
  }
});

// Mock btoa/atob for base64 encoding
global.btoa = jest.fn((str: string) => Buffer.from(str, 'binary').toString('base64'));
global.atob = jest.fn((str: string) => Buffer.from(str, 'base64').toString('binary'));

describe('CloudflareKVCredentialStorage', () => {
  let storage: CloudflareKVCredentialStorage;
  let mockKVNamespace: any;
  const testEncryptionKey = 'test-encryption-key-32-characters';

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockKVNamespace = {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      list: jest.fn()
    };

    storage = new CloudflareKVCredentialStorage(mockKVNamespace, testEncryptionKey);

    // Setup crypto mocks
    (global.crypto.getRandomValues as jest.Mock).mockReturnValue(new Uint8Array(12));
    (global.crypto.subtle.importKey as jest.Mock).mockResolvedValue({});
    (global.crypto.subtle.encrypt as jest.Mock).mockResolvedValue(new ArrayBuffer(16));
    (global.crypto.subtle.decrypt as jest.Mock).mockResolvedValue(
      new TextEncoder().encode('{"email":"test@gmail.com","password":"testpass"}')
    );
    
    (global.btoa as jest.Mock).mockReturnValue('encrypted-data-base64');
    (global.atob as jest.Mock).mockReturnValue('decrypted-data');
  });

  describe('store', () => {
    it('should store credentials with encryption', async () => {
      const accountData = {
        email: 'test@gmail.com',
        password: 'testpassword',
        firstName: 'Test',
        lastName: 'User',
        workerId: 'worker-1',
        ipAddress: '192.168.1.1'
      };

      mockKVNamespace.put.mockResolvedValue(undefined);
      mockKVNamespace.get.mockResolvedValue(null); // For stats

      const accountId = await storage.store(accountData);

      expect(accountId).toMatch(/^account_\d+_[a-z0-9]+$/);
      expect(mockKVNamespace.put).toHaveBeenCalledTimes(1);
      expect(global.crypto.subtle.encrypt).toHaveBeenCalled();
    });

    it('should generate unique account IDs', async () => {
      const accountData = {
        email: 'test@gmail.com',
        password: 'testpassword',
        firstName: 'Test',
        lastName: 'User'
      };

      mockKVNamespace.put.mockResolvedValue(undefined);
      mockKVNamespace.get.mockResolvedValue(null);

      const id1 = await storage.store(accountData);
      const id2 = await storage.store(accountData);

      expect(id1).not.toBe(id2);
    });

    it('should handle storage errors', async () => {
      const accountData = {
        email: 'test@gmail.com',
        password: 'testpassword'
      };

      mockKVNamespace.put.mockRejectedValue(new Error('KV error'));

      await expect(storage.store(accountData)).rejects.toThrow('Storage failed');
    });
  });

  describe('retrieve', () => {
    it('should retrieve and decrypt credentials', async () => {
      const storedData = {
        id: 'account_123',
        encryptedData: 'encrypted-data',
        createdAt: '2023-01-01T00:00:00.000Z',
        lastAccessed: '2023-01-01T00:00:00.000Z',
        accessCount: 0,
        status: 'active'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      mockKVNamespace.put.mockResolvedValue(undefined); // For access tracking update

      const result = await storage.retrieve('account_123');

      expect(result).toBeTruthy();
      expect(result.email).toBe('test@gmail.com');
      expect(result.password).toBe('testpass');
      expect(result.id).toBe('account_123');
      expect(global.crypto.subtle.decrypt).toHaveBeenCalled();
    });

    it('should return null for non-existent credentials', async () => {
      mockKVNamespace.get.mockResolvedValue(null);

      const result = await storage.retrieve('non-existent');

      expect(result).toBeNull();
    });

    it('should update access tracking', async () => {
      const storedData = {
        id: 'account_123',
        encryptedData: 'encrypted-data',
        createdAt: '2023-01-01T00:00:00.000Z',
        lastAccessed: '2023-01-01T00:00:00.000Z',
        accessCount: 5,
        status: 'active'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      mockKVNamespace.put.mockResolvedValue(undefined);

      await storage.retrieve('account_123');

      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        'account_123',
        expect.stringContaining('"accessCount":6')
      );
    });

    it('should handle decryption errors', async () => {
      const storedData = {
        id: 'account_123',
        encryptedData: 'invalid-encrypted-data',
        status: 'active'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      (global.crypto.subtle.decrypt as jest.Mock).mockRejectedValue(new Error('Decryption failed'));

      const result = await storage.retrieve('account_123');

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should list credentials with pagination', async () => {
      const mockKeys = [
        { name: 'account_1' },
        { name: 'account_2' },
        { name: 'account_3' }
      ];

      const mockCredentials = [
        {
          id: 'account_1',
          status: 'active',
          createdAt: '2023-01-01T00:00:00.000Z'
        },
        {
          id: 'account_2',
          status: 'suspended',
          createdAt: '2023-01-02T00:00:00.000Z'
        }
      ];

      mockKVNamespace.list.mockResolvedValue({ keys: mockKeys });
      mockKVNamespace.get
        .mockResolvedValueOnce(JSON.stringify(mockCredentials[0]))
        .mockResolvedValueOnce(JSON.stringify(mockCredentials[1]))
        .mockResolvedValueOnce(null); // Third key returns null

      const result = await storage.list({ limit: 10, offset: 0 });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('account_1');
      expect(result[1].id).toBe('account_2');
    });

    it('should filter by status', async () => {
      const mockKeys = [
        { name: 'account_1' },
        { name: 'account_2' }
      ];

      const mockCredentials = [
        {
          id: 'account_1',
          status: 'active',
          createdAt: '2023-01-01T00:00:00.000Z'
        },
        {
          id: 'account_2',
          status: 'suspended',
          createdAt: '2023-01-02T00:00:00.000Z'
        }
      ];

      mockKVNamespace.list.mockResolvedValue({ keys: mockKeys });
      mockKVNamespace.get
        .mockResolvedValueOnce(JSON.stringify(mockCredentials[0]))
        .mockResolvedValueOnce(JSON.stringify(mockCredentials[1]));

      const result = await storage.list({ status: 'active' });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
    });

    it('should handle list errors gracefully', async () => {
      mockKVNamespace.list.mockRejectedValue(new Error('List error'));

      const result = await storage.list();

      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update credential status', async () => {
      const storedData = {
        id: 'account_123',
        status: 'active',
        lastAccessed: '2023-01-01T00:00:00.000Z'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      mockKVNamespace.put.mockResolvedValue(undefined);

      const result = await storage.updateStatus('account_123', 'suspended');

      expect(result).toBe(true);
      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        'account_123',
        expect.stringContaining('"status":"suspended"')
      );
    });

    it('should return false for non-existent credentials', async () => {
      mockKVNamespace.get.mockResolvedValue(null);

      const result = await storage.updateStatus('non-existent', 'suspended');

      expect(result).toBe(false);
    });

    it('should handle update errors', async () => {
      const storedData = {
        id: 'account_123',
        status: 'active'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      mockKVNamespace.put.mockRejectedValue(new Error('Update error'));

      const result = await storage.updateStatus('account_123', 'suspended');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete credentials', async () => {
      const storedData = {
        id: 'account_123',
        status: 'active'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(storedData));
      mockKVNamespace.delete.mockResolvedValue(undefined);

      const result = await storage.delete('account_123');

      expect(result).toBe(true);
      expect(mockKVNamespace.delete).toHaveBeenCalledWith('account_123');
    });

    it('should return false for non-existent credentials', async () => {
      mockKVNamespace.get.mockResolvedValue(null);

      const result = await storage.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('exportCredentials', () => {
    it('should export credentials as encrypted CSV', async () => {
      const mockCredentials = [
        {
          id: 'account_1',
          encryptedData: 'encrypted-data-1',
          status: 'active',
          createdAt: '2023-01-01T00:00:00.000Z'
        }
      ];

      mockKVNamespace.list.mockResolvedValue({
        keys: [{ name: 'account_1' }]
      });
      mockKVNamespace.get.mockResolvedValue(JSON.stringify(mockCredentials[0]));

      const result = await storage.exportCredentials();

      expect(typeof result).toBe('string');
      expect(global.crypto.subtle.encrypt).toHaveBeenCalled();
    });

    it('should handle export errors', async () => {
      mockKVNamespace.list.mockRejectedValue(new Error('Export error'));

      await expect(storage.exportCredentials()).rejects.toThrow('Export failed');
    });
  });

  describe('getStats', () => {
    it('should return cached statistics', async () => {
      const cachedStats = {
        totalAccounts: 10,
        activeAccounts: 8,
        suspendedAccounts: 1,
        deletedAccounts: 1,
        lastUpdated: '2023-01-01T00:00:00.000Z'
      };

      mockKVNamespace.get.mockResolvedValue(JSON.stringify(cachedStats));

      const result = await storage.getStats();

      expect(result).toEqual(cachedStats);
    });

    it('should calculate statistics when not cached', async () => {
      const mockCredentials = [
        { status: 'active' },
        { status: 'active' },
        { status: 'suspended' },
        { status: 'deleted' }
      ];

      mockKVNamespace.get.mockResolvedValue(null); // No cached stats
      mockKVNamespace.list.mockResolvedValue({
        keys: mockCredentials.map((_, i) => ({ name: `account_${i}` }))
      });
      
      mockCredentials.forEach((cred, i) => {
        mockKVNamespace.get.mockResolvedValueOnce(JSON.stringify(cred));
      });

      mockKVNamespace.put.mockResolvedValue(undefined); // For caching stats

      const result = await storage.getStats();

      expect(result.totalAccounts).toBe(4);
      expect(result.activeAccounts).toBe(2);
      expect(result.suspendedAccounts).toBe(1);
      expect(result.deletedAccounts).toBe(1);
    });

    it('should handle stats errors gracefully', async () => {
      mockKVNamespace.get.mockRejectedValue(new Error('Stats error'));

      const result = await storage.getStats();

      expect(result.totalAccounts).toBe(0);
      expect(result.activeAccounts).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should cleanup old deleted credentials', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const mockCredentials = [
        {
          id: 'account_1',
          status: 'deleted',
          createdAt: oldDate.toISOString()
        },
        {
          id: 'account_2',
          status: 'deleted',
          createdAt: recentDate.toISOString()
        },
        {
          id: 'account_3',
          status: 'active',
          createdAt: oldDate.toISOString()
        }
      ];

      mockKVNamespace.list.mockResolvedValue({
        keys: mockCredentials.map(c => ({ name: c.id }))
      });
      
      mockCredentials.forEach(cred => {
        mockKVNamespace.get.mockResolvedValueOnce(JSON.stringify(cred));
      });

      mockKVNamespace.delete.mockResolvedValue(undefined);

      const cleanedCount = await storage.cleanup(30);

      expect(cleanedCount).toBe(1);
      expect(mockKVNamespace.delete).toHaveBeenCalledWith('account_1');
      expect(mockKVNamespace.delete).not.toHaveBeenCalledWith('account_2');
      expect(mockKVNamespace.delete).not.toHaveBeenCalledWith('account_3');
    });

    it('should handle cleanup errors gracefully', async () => {
      mockKVNamespace.list.mockRejectedValue(new Error('Cleanup error'));

      const cleanedCount = await storage.cleanup();

      expect(cleanedCount).toBe(0);
    });
  });

  describe('encryption/decryption', () => {
    it('should use AES-GCM encryption', async () => {
      const testData = { email: 'test@gmail.com', password: 'secret' };
      
      // Test that encryption methods are called with correct parameters
      await storage.store(testData);

      expect(global.crypto.subtle.importKey).toHaveBeenCalledWith(
        'raw',
        expect.any(Uint8Array),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );

      expect(global.crypto.subtle.encrypt).toHaveBeenCalledWith(
        { name: 'AES-GCM', iv: expect.any(Uint8Array) },
        expect.anything(),
        expect.any(Uint8Array)
      );
    });

    it('should handle encryption key padding', () => {
      const shortKey = 'short';
      const paddedKey = shortKey.padEnd(32, '0').substring(0, 32);
      
      expect(paddedKey).toHaveLength(32);
      expect(paddedKey).toBe('short000000000000000000000000000');
    });
  });
});