/**
 * Secure credential storage implementation with database backend
 */

import { ICredentialStore } from '../interfaces';
import { AccountData, CredentialStoreEntry } from '../types';
import { Logger, EncryptionService } from '../utils';
import { randomUUID as uuidv4 } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DatabaseConfig {
  provider: 'sqlite' | 'postgresql' | 'mysql';
  connectionString: string;
  encryptionKey: string;
  maxConnections?: number;
  connectionTimeout?: number;
}

export class CredentialStore implements ICredentialStore {
  private config: DatabaseConfig;
  private logger: Logger;
  private encryption: EncryptionService;
  private db: any; // Database connection

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.logger = new Logger(undefined, 'credential-store');
    this.encryption = new EncryptionService(config.encryptionKey);
    this.initializeDatabase();
  }

  async store(accountData: AccountData): Promise<string> {
    const logger = this.logger.withCorrelationId('store');
    
    try {
      const accountId = accountData.id || uuidv4();
      
      // Encrypt sensitive data
      const encryptedPassword = this.encryption.encrypt(accountData.password);
      const encryptedRecoveryEmail = accountData.recoveryEmail 
        ? this.encryption.encrypt(accountData.recoveryEmail) 
        : null;

      const entry: CredentialStoreEntry = {
        id: accountId,
        encryptedData: this.encryption.encryptObject({
          password: accountData.password,
          recoveryEmail: accountData.recoveryEmail
        }),
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 0
      };

      // Store in database
      await this.executeQuery(`
        INSERT INTO accounts (
          id, email, encrypted_password, first_name, last_name, 
          encrypted_recovery_email, birth_date, gender, created_at, 
          worker_id, ip_address, status, encrypted_data, last_accessed, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        accountId,
        accountData.email,
        encryptedPassword,
        accountData.firstName,
        accountData.lastName,
        encryptedRecoveryEmail,
        accountData.birthDate.toISOString(),
        accountData.gender,
        accountData.createdAt.toISOString(),
        accountData.workerId,
        accountData.ipAddress,
        accountData.status,
        entry.encryptedData,
        entry.lastAccessed,
        entry.accessCount
      ]);

      logger.info('Account credentials stored', { accountId, email: accountData.email });
      return accountId;

    } catch (error) {
      logger.error('Failed to store credentials', { 
        error: error instanceof Error ? error.message : error,
        email: accountData.email 
      });
      throw error;
    }
  }

  async retrieve(id: string): Promise<AccountData | null> {
    const logger = this.logger.withCorrelationId('retrieve');
    
    try {
      const result = await this.executeQuery(
        'SELECT * FROM accounts WHERE id = ?',
        [id]
      );

      if (!result || result.length === 0) {
        return null;
      }

      const row = result[0];
      
      // Decrypt sensitive data
      const decryptedData = this.encryption.decryptObject(row.encrypted_data) as {
        password: string;
        recoveryEmail?: string;
      };
      
      // Update access tracking
      await this.executeQuery(
        'UPDATE accounts SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?',
        [new Date().toISOString(), id]
      );

      const accountData: AccountData = {
        id: row.id,
        email: row.email,
        password: decryptedData.password,
        firstName: row.first_name,
        lastName: row.last_name,
        recoveryEmail: decryptedData.recoveryEmail,
        birthDate: new Date(row.birth_date),
        gender: row.gender,
        createdAt: new Date(row.created_at),
        workerId: row.worker_id,
        ipAddress: row.ip_address,
        status: row.status
      };

      logger.info('Account credentials retrieved', { accountId: id });
      return accountData;

    } catch (error) {
      logger.error('Failed to retrieve credentials', { 
        error: error instanceof Error ? error.message : error,
        accountId: id 
      });
      return null;
    }
  }

  async list(offset: number = 0, limit: number = 50): Promise<CredentialStoreEntry[]> {
    try {
      const results = await this.executeQuery(`
        SELECT id, created_at, last_accessed, access_count, status
        FROM accounts 
        ORDER BY created_at DESC 
        LIMIT ? OFFSET ?
      `, [limit, offset]);

      return results.map((row: any) => ({
        id: row.id,
        encryptedData: '', // Don't return encrypted data in list
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count
      }));

    } catch (error) {
      this.logger.error('Failed to list credentials', { 
        error: error instanceof Error ? error.message : error 
      });
      return [];
    }
  }

  async exportToCSV(filePath: string): Promise<void> {
    const logger = this.logger.withCorrelationId('export');
    
    try {
      const results = await this.executeQuery('SELECT * FROM accounts ORDER BY created_at');
      
      const csvHeader = 'ID,Email,FirstName,LastName,Status,CreatedAt,WorkerId,IPAddress\n';
      const csvRows = results.map((row: any) => 
        `${row.id},"${row.email}","${row.first_name}","${row.last_name}",${row.status},${row.created_at},"${row.worker_id}","${row.ip_address}"`
      ).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      // Encrypt the CSV content
      const encryptedContent = this.encryption.encrypt(csvContent);
      
      await fs.writeFile(filePath, encryptedContent);
      
      logger.info('Credentials exported to CSV', { filePath, count: results.length });

    } catch (error) {
      logger.error('Failed to export credentials', { 
        error: error instanceof Error ? error.message : error,
        filePath 
      });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.executeQuery('DELETE FROM accounts WHERE id = ?', [id]);
      
      const deleted = result.changes > 0;
      if (deleted) {
        this.logger.info('Account credentials deleted', { accountId: id });
      }
      
      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete credentials', { 
        error: error instanceof Error ? error.message : error,
        accountId: id 
      });
      return false;
    }
  }

  async updateStatus(id: string, status: AccountData['status']): Promise<void> {
    try {
      await this.executeQuery(
        'UPDATE accounts SET status = ?, last_accessed = ? WHERE id = ?',
        [status, new Date().toISOString(), id]
      );
      
      this.logger.info('Account status updated', { accountId: id, status });

    } catch (error) {
      this.logger.error('Failed to update account status', { 
        error: error instanceof Error ? error.message : error,
        accountId: id,
        status 
      });
      throw error;
    }
  }

  async search(criteria: Partial<AccountData>): Promise<CredentialStoreEntry[]> {
    try {
      let query = 'SELECT id, created_at, last_accessed, access_count FROM accounts WHERE 1=1';
      const params: any[] = [];

      if (criteria.email) {
        query += ' AND email LIKE ?';
        params.push(`%${criteria.email}%`);
      }

      if (criteria.status) {
        query += ' AND status = ?';
        params.push(criteria.status);
      }

      if (criteria.workerId) {
        query += ' AND worker_id = ?';
        params.push(criteria.workerId);
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      const results = await this.executeQuery(query, params);
      
      return results.map((row: any) => ({
        id: row.id,
        encryptedData: '',
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count
      }));

    } catch (error) {
      this.logger.error('Failed to search credentials', { 
        error: error instanceof Error ? error.message : error,
        criteria 
      });
      return [];
    }
  }

  async getStats(): Promise<{
    totalAccounts: number;
    activeAccounts: number;
    suspendedAccounts: number;
    deletedAccounts: number;
  }> {
    try {
      const results = await this.executeQuery(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'created' OR status = 'verified' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as deleted
        FROM accounts
      `);

      const row = results[0];
      return {
        totalAccounts: row.total || 0,
        activeAccounts: row.active || 0,
        suspendedAccounts: row.suspended || 0,
        deletedAccounts: row.deleted || 0
      };

    } catch (error) {
      this.logger.error('Failed to get stats', { 
        error: error instanceof Error ? error.message : error 
      });
      
      return {
        totalAccounts: 0,
        activeAccounts: 0,
        suspendedAccounts: 0,
        deletedAccounts: 0
      };
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.logger.info('Initializing database connection');
      
      if (this.config.provider === 'sqlite') {
        await this.initializeSQLite();
      } else {
        throw new Error(`Database provider ${this.config.provider} not implemented`);
      }
      
      await this.createTables();
      this.logger.info('Database initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize database', { 
        error: error instanceof Error ? error.message : error 
      });
      throw error;
    }
  }

  private async initializeSQLite(): Promise<void> {
    const sqlite3 = require('sqlite3');
    const Database = sqlite3.Database;
    
    return new Promise((resolve, reject) => {
      this.db = new Database(this.config.connectionString.replace('sqlite:', ''), (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    });
  }

  private async createTables(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        encrypted_password TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        encrypted_recovery_email TEXT,
        birth_date TEXT NOT NULL,
        gender TEXT,
        created_at TEXT NOT NULL,
        worker_id TEXT,
        ip_address TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        encrypted_data TEXT NOT NULL,
        last_accessed TEXT NOT NULL,
        access_count INTEGER DEFAULT 0
      )
    `;

    await this.executeQuery(createTableSQL);
    
    // Create indexes
    await this.executeQuery('CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email)');
    await this.executeQuery('CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status)');
    await this.executeQuery('CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)');
  }

  private async executeQuery(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        this.db.all(sql, params, (err: any, rows: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      } else {
        this.db.run(sql, params, function(this: any, err: any) {
          if (err) {
            reject(err);
          } else {
            resolve({ changes: this.changes, lastID: this.lastID });
          }
        });
      }
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close(() => {
          this.logger.info('Database connection closed');
          resolve(undefined);
        });
      });
    }
  }
}