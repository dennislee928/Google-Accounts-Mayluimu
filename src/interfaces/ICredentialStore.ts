import { AccountData, CredentialStoreEntry } from '../types';

/**
 * Interface for secure credential storage
 */
export interface ICredentialStore {
  /**
   * Store account credentials securely
   */
  store(accountData: AccountData): Promise<string>;

  /**
   * Retrieve account credentials by ID
   */
  retrieve(id: string): Promise<AccountData | null>;

  /**
   * List all stored credentials with pagination
   */
  list(offset?: number, limit?: number): Promise<CredentialStoreEntry[]>;

  /**
   * Export credentials in encrypted CSV format
   */
  exportToCSV(filePath: string): Promise<void>;

  /**
   * Delete credentials by ID
   */
  delete(id: string): Promise<boolean>;

  /**
   * Update account status
   */
  updateStatus(id: string, status: AccountData['status']): Promise<void>;

  /**
   * Search credentials by email or other criteria
   */
  search(criteria: Partial<AccountData>): Promise<CredentialStoreEntry[]>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<{
    totalAccounts: number;
    activeAccounts: number;
    suspendedAccounts: number;
    deletedAccounts: number;
  }>;
}