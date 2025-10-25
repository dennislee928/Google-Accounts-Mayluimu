import { AccountData } from '../types';

/**
 * Interface for account creation automation
 */
export interface IAccountCreator {
  /**
   * Create a new Google account with the provided data
   */
  createAccount(accountData: AccountData): Promise<AccountData>;

  /**
   * Handle phone verification step if encountered
   */
  handlePhoneVerification(): Promise<boolean>;

  /**
   * Solve CAPTCHA challenges
   */
  solveCaptcha(captchaType: string): Promise<boolean>;

  /**
   * Store account credentials securely
   */
  storeCredentials(credentials: AccountData): Promise<void>;

  /**
   * Clean up browser resources
   */
  cleanup(): Promise<void>;
}