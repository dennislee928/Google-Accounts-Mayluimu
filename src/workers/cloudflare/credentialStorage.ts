/**
 * Cloudflare KV Credential Storage Implementation
 * Handles secure storage and retrieval of account credentials
 */

export interface StoredCredential {
  id: string;
  encryptedData: string;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  status: 'active' | 'suspended' | 'deleted';
  workerId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialSearchCriteria {
  status?: string;
  workerId?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}

export interface CredentialStats {
  totalAccounts: number;
  activeAccounts: number;
  suspendedAccounts: number;
  deletedAccounts: number;
  lastUpdated: string;
}

/**
 * Cloudflare KV Credential Storage Service
 */
export class CloudflareKVCredentialStorage {
  private kvNamespace: KVNamespace;
  private encryptionKey: string;

  constructor(kvNamespace: KVNamespace, encryptionKey: string) {
    this.kvNamespace = kvNamespace;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Store account credentials securely
   */
  async store(accountData: any): Promise<string> {
    try {
      // Generate unique ID
      const accountId = `account_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // Encrypt sensitive data
      const encryptedData = await this.encryptCredentials(accountData);
      
      // Create storage record
      const storageData: StoredCredential = {
        id: accountId,
        encryptedData,
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        status: 'active',
        workerId: accountData.workerId,
        ipAddress: accountData.ipAddress,
        metadata: {
          email: accountData.email, // Store email unencrypted for searching
          createdBy: 'cloudflare-worker',
          version: '1.0.0'
        }
      };

      // Store in KV
      await this.kvNamespace.put(accountId, JSON.stringify(storageData));
      
      // Update statistics
      await this.updateStats('create');
      
      console.log(`Stored credentials for account: ${accountId}`);
      return accountId;
    } catch (error) {
      console.error('Failed to store credentials:', error);
      throw new Error(`Storage failed: ${error}`);
    }
  }

  /**
   * Retrieve account credentials by ID
   */
  async retrieve(id: string): Promise<any | null> {
    try {
      const data = await this.kvNamespace.get(id);
      if (!data) {
        return null;
      }

      const storedCredential: StoredCredential = JSON.parse(data);
      
      // Decrypt credentials
      const decryptedData = await this.decryptCredentials(storedCredential.encryptedData);
      
      // Update access tracking
      storedCredential.lastAccessed = new Date().toISOString();
      storedCredential.accessCount++;
      
      await this.kvNamespace.put(id, JSON.stringify(storedCredential));
      
      return {
        ...decryptedData,
        id: storedCredential.id,
        status: storedCredential.status,
        createdAt: storedCredential.createdAt,
        lastAccessed: storedCredential.lastAccessed,
        accessCount: storedCredential.accessCount
      };
    } catch (error) {
      console.error(`Failed to retrieve credentials for ${id}:`, error);
      return null;
    }
  }

  /**
   * List stored credentials with pagination
   */
  async list(criteria: CredentialSearchCriteria = {}): Promise<StoredCredential[]> {
    try {
      const { limit = 100, offset = 0 } = criteria;
      
      // Get list of keys
      const listResult = await this.kvNamespace.list({
        prefix: 'account_',
        limit: limit + offset
      });
      
      const results: StoredCredential[] = [];
      let processed = 0;
      
      for (const key of listResult.keys) {
        if (processed < offset) {
          processed++;
          continue;
        }
        
        if (results.length >= limit) {
          break;
        }
        
        try {
          const data = await this.kvNamespace.get(key.name);
          if (data) {
            const credential: StoredCredential = JSON.parse(data);
            
            // Apply filters
            if (this.matchesCriteria(credential, criteria)) {
              results.push(credential);
            }
          }
        } catch (error) {
          console.warn(`Failed to process key ${key.name}:`, error);
        }
        
        processed++;
      }
      
      return results;
    } catch (error) {
      console.error('Failed to list credentials:', error);
      return [];
    }
  }

  /**
   * Search credentials by criteria
   */
  async search(criteria: CredentialSearchCriteria): Promise<StoredCredential[]> {
    return this.list(criteria);
  }

  /**
   * Update account status
   */
  async updateStatus(id: string, status: 'active' | 'suspended' | 'deleted'): Promise<boolean> {
    try {
      const data = await this.kvNamespace.get(id);
      if (!data) {
        return false;
      }

      const storedCredential: StoredCredential = JSON.parse(data);
      const oldStatus = storedCredential.status;
      
      storedCredential.status = status;
      storedCredential.lastAccessed = new Date().toISOString();
      
      await this.kvNamespace.put(id, JSON.stringify(storedCredential));
      
      // Update statistics
      await this.updateStats('status_change', oldStatus, status);
      
      console.log(`Updated status for ${id}: ${oldStatus} -> ${status}`);
      return true;
    } catch (error) {
      console.error(`Failed to update status for ${id}:`, error);
      return false;
    }
  }

  /**
   * Delete credentials
   */
  async delete(id: string): Promise<boolean> {
    try {
      const data = await this.kvNamespace.get(id);
      if (!data) {
        return false;
      }

      await this.kvNamespace.delete(id);
      
      // Update statistics
      await this.updateStats('delete');
      
      console.log(`Deleted credentials for account: ${id}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete credentials for ${id}:`, error);
      return false;
    }
  }

  /**
   * Export credentials to encrypted format
   */
  async exportCredentials(criteria: CredentialSearchCriteria = {}): Promise<string> {
    try {
      const credentials = await this.list(criteria);
      const exportData = [];
      
      for (const credential of credentials) {
        try {
          const decryptedData = await this.decryptCredentials(credential.encryptedData);
          exportData.push({
            id: credential.id,
            email: decryptedData.email,
            password: decryptedData.password,
            firstName: decryptedData.firstName,
            lastName: decryptedData.lastName,
            recoveryEmail: decryptedData.recoveryEmail,
            status: credential.status,
            createdAt: credential.createdAt,
            workerId: credential.workerId,
            ipAddress: credential.ipAddress
          });
        } catch (error) {
          console.warn(`Failed to decrypt credential ${credential.id}:`, error);
        }
      }
      
      // Convert to CSV format
      const csvHeader = 'ID,Email,Password,FirstName,LastName,RecoveryEmail,Status,CreatedAt,WorkerId,IPAddress\n';
      const csvRows = exportData.map(row => 
        `${row.id},"${row.email}","${row.password}","${row.firstName}","${row.lastName}","${row.recoveryEmail || ''}",${row.status},${row.createdAt},"${row.workerId || ''}","${row.ipAddress || ''}"`
      ).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      // Encrypt the entire CSV
      return await this.encryptData(csvContent);
    } catch (error) {
      console.error('Failed to export credentials:', error);
      throw new Error(`Export failed: ${error}`);
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<CredentialStats> {
    try {
      const statsData = await this.kvNamespace.get('_stats');
      if (statsData) {
        return JSON.parse(statsData);
      }
      
      // Calculate stats if not cached
      const credentials = await this.list({ limit: 10000 });
      
      const stats: CredentialStats = {
        totalAccounts: credentials.length,
        activeAccounts: credentials.filter(c => c.status === 'active').length,
        suspendedAccounts: credentials.filter(c => c.status === 'suspended').length,
        deletedAccounts: credentials.filter(c => c.status === 'deleted').length,
        lastUpdated: new Date().toISOString()
      };
      
      // Cache stats for 1 hour
      await this.kvNamespace.put('_stats', JSON.stringify(stats), {
        expirationTtl: 3600
      });
      
      return stats;
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        totalAccounts: 0,
        activeAccounts: 0,
        suspendedAccounts: 0,
        deletedAccounts: 0,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * Cleanup old or expired credentials
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const credentials = await this.list({ limit: 10000 });
      
      let cleanedCount = 0;
      
      for (const credential of credentials) {
        const createdAt = new Date(credential.createdAt);
        
        if (createdAt < cutoffDate && credential.status === 'deleted') {
          try {
            await this.kvNamespace.delete(credential.id);
            cleanedCount++;
          } catch (error) {
            console.warn(`Failed to cleanup credential ${credential.id}:`, error);
          }
        }
      }
      
      console.log(`Cleaned up ${cleanedCount} old credentials`);
      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup credentials:', error);
      return 0;
    }
  }

  /**
   * Encrypt credentials using Web Crypto API
   */
  private async encryptCredentials(credentials: any): Promise<string> {
    return this.encryptData(JSON.stringify(credentials));
  }

  /**
   * Decrypt credentials using Web Crypto API
   */
  private async decryptCredentials(encryptedData: string): Promise<any> {
    const decryptedString = await this.decryptData(encryptedData);
    return JSON.parse(decryptedString);
  }

  /**
   * Encrypt data using AES-GCM
   */
  private async encryptData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const keyData = encoder.encode(this.encryptionKey.padEnd(32, '0').substring(0, 32));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      dataBuffer
    );
    
    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    // Convert to base64
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data using AES-GCM
   */
  private async decryptData(encryptedData: string): Promise<string> {
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(char => char.charCodeAt(0))
    );
    
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.encryptionKey.padEnd(32, '0').substring(0, 32));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Check if credential matches search criteria
   */
  private matchesCriteria(credential: StoredCredential, criteria: CredentialSearchCriteria): boolean {
    if (criteria.status && credential.status !== criteria.status) {
      return false;
    }
    
    if (criteria.workerId && credential.workerId !== criteria.workerId) {
      return false;
    }
    
    if (criteria.createdAfter) {
      const createdAt = new Date(credential.createdAt);
      const afterDate = new Date(criteria.createdAfter);
      if (createdAt < afterDate) {
        return false;
      }
    }
    
    if (criteria.createdBefore) {
      const createdAt = new Date(credential.createdAt);
      const beforeDate = new Date(criteria.createdBefore);
      if (createdAt > beforeDate) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Update statistics cache
   */
  private async updateStats(
    operation: 'create' | 'delete' | 'status_change',
    oldStatus?: string,
    newStatus?: string
  ): Promise<void> {
    try {
      const stats = await this.getStats();
      
      switch (operation) {
        case 'create':
          stats.totalAccounts++;
          stats.activeAccounts++;
          break;
        case 'delete':
          stats.totalAccounts--;
          break;
        case 'status_change':
          if (oldStatus === 'active') stats.activeAccounts--;
          if (oldStatus === 'suspended') stats.suspendedAccounts--;
          if (oldStatus === 'deleted') stats.deletedAccounts--;
          
          if (newStatus === 'active') stats.activeAccounts++;
          if (newStatus === 'suspended') stats.suspendedAccounts++;
          if (newStatus === 'deleted') stats.deletedAccounts++;
          break;
      }
      
      stats.lastUpdated = new Date().toISOString();
      
      await this.kvNamespace.put('_stats', JSON.stringify(stats), {
        expirationTtl: 3600
      });
    } catch (error) {
      console.warn('Failed to update stats:', error);
    }
  }
}