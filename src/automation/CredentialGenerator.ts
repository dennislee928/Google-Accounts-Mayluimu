/**
 * Credential Generation and Validation
 * Handles generation of usernames, passwords, and validation of account data
 */

import { AccountData } from '../types';
import { Logger } from '../utils';
import { v4 as uuidv4 } from 'uuid';

export interface CredentialGeneratorConfig {
  usernameLength: number;
  passwordLength: number;
  includeNumbers: boolean;
  includeSymbols: boolean;
  avoidSimilarChars: boolean;
  enforceComplexity: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface UsernameCheckResult {
  username: string;
  available: boolean;
  suggestions: string[];
}

export class CredentialGenerator {
  private logger: Logger;
  private config: CredentialGeneratorConfig;
  private usedUsernames: Set<string> = new Set();

  // Character sets for password generation
  private readonly LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
  private readonly UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private readonly NUMBERS = '0123456789';
  private readonly SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  private readonly SIMILAR_CHARS = 'il1Lo0O';

  // Common first and last names for realistic account generation
  private readonly FIRST_NAMES = [
    'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
    'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Nancy', 'Daniel', 'Lisa',
    'Matthew', 'Betty', 'Anthony', 'Helen', 'Mark', 'Sandra', 'Donald', 'Donna',
    'Steven', 'Carol', 'Paul', 'Ruth', 'Andrew', 'Sharon', 'Joshua', 'Michelle'
  ];

  private readonly LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
    'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
    'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
    'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'
  ];

  constructor(config: CredentialGeneratorConfig, workerId: string = 'default') {
    this.config = config;
    this.logger = new Logger(undefined, workerId);
  }

  /**
   * Generate complete account data with realistic information
   */
  generateAccountData(partialData?: Partial<AccountData>): AccountData {
    const logger = this.logger.withCorrelationId('generate_account');
    logger.info('Generating new account data');

    const firstName = partialData?.firstName || this.generateFirstName();
    const lastName = partialData?.lastName || this.generateLastName();
    const username = partialData?.email?.split('@')[0] || this.generateUsername(firstName, lastName);
    const email = partialData?.email || `${username}@gmail.com`;
    const password = partialData?.password || this.generatePassword();
    const birthDate = partialData?.birthDate || this.generateBirthDate();
    const gender = partialData?.gender || this.generateGender();

    const accountData: AccountData = {
      id: uuidv4(),
      email,
      password,
      firstName,
      lastName,
      recoveryEmail: partialData?.recoveryEmail,
      birthDate,
      gender,
      createdAt: new Date(),
      workerId: partialData?.workerId || 'default',
      ipAddress: partialData?.ipAddress || '127.0.0.1',
      status: 'pending'
    };

    logger.info('Account data generated', { 
      email: accountData.email,
      firstName: accountData.firstName,
      lastName: accountData.lastName 
    });

    return accountData;
  }

  /**
   * Generate realistic username based on name
   */
  generateUsername(firstName: string, lastName: string): string {
    const baseUsername = this.createBaseUsername(firstName, lastName);
    let username = baseUsername;
    let attempt = 0;

    // Ensure uniqueness by adding numbers if needed
    while (this.usedUsernames.has(username) && attempt < 100) {
      const suffix = Math.floor(Math.random() * 9999) + 1;
      username = `${baseUsername}${suffix}`;
      attempt++;
    }

    this.usedUsernames.add(username);
    return username;
  }

  /**
   * Create base username from first and last name
   */
  private createBaseUsername(firstName: string, lastName: string): string {
    const patterns = [
      () => `${firstName.toLowerCase()}${lastName.toLowerCase()}`,
      () => `${firstName.toLowerCase()}.${lastName.toLowerCase()}`,
      () => `${firstName.toLowerCase()}_${lastName.toLowerCase()}`,
      () => `${firstName.charAt(0).toLowerCase()}${lastName.toLowerCase()}`,
      () => `${firstName.toLowerCase()}${lastName.charAt(0).toLowerCase()}`,
      () => `${firstName.toLowerCase()}${Math.floor(Math.random() * 99) + 1}`,
      () => `${lastName.toLowerCase()}${firstName.charAt(0).toLowerCase()}`
    ];

    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    let username = pattern();

    // Remove any invalid characters
    username = username.replace(/[^a-z0-9._]/g, '');

    // Ensure minimum length
    if (username.length < 6) {
      username += Math.floor(Math.random() * 999) + 100;
    }

    // Ensure maximum length (Gmail allows up to 30 characters)
    if (username.length > 30) {
      username = username.substring(0, 30);
    }

    return username;
  }

  /**
   * Generate secure password following Google's requirements
   */
  generatePassword(): string {
    let charset = this.LOWERCASE + this.UPPERCASE;
    
    if (this.config.includeNumbers) {
      charset += this.NUMBERS;
    }
    
    if (this.config.includeSymbols) {
      charset += this.SYMBOLS;
    }

    if (this.config.avoidSimilarChars) {
      charset = charset.split('').filter(char => !this.SIMILAR_CHARS.includes(char)).join('');
    }

    let password = '';
    
    // Ensure at least one character from each required set
    if (this.config.enforceComplexity) {
      password += this.getRandomChar(this.LOWERCASE);
      password += this.getRandomChar(this.UPPERCASE);
      
      if (this.config.includeNumbers) {
        password += this.getRandomChar(this.NUMBERS);
      }
      
      if (this.config.includeSymbols) {
        password += this.getRandomChar(this.SYMBOLS);
      }
    }

    // Fill remaining length with random characters
    const remainingLength = this.config.passwordLength - password.length;
    for (let i = 0; i < remainingLength; i++) {
      password += this.getRandomChar(charset);
    }

    // Shuffle the password to avoid predictable patterns
    return this.shuffleString(password);
  }

  /**
   * Generate realistic first name
   */
  generateFirstName(): string {
    return this.FIRST_NAMES[Math.floor(Math.random() * this.FIRST_NAMES.length)];
  }

  /**
   * Generate realistic last name
   */
  generateLastName(): string {
    return this.LAST_NAMES[Math.floor(Math.random() * this.LAST_NAMES.length)];
  }

  /**
   * Generate realistic birth date (18-65 years old)
   */
  generateBirthDate(): Date {
    const now = new Date();
    const minAge = 18;
    const maxAge = 65;
    
    const ageInYears = Math.floor(Math.random() * (maxAge - minAge + 1)) + minAge;
    const birthYear = now.getFullYear() - ageInYears;
    const birthMonth = Math.floor(Math.random() * 12);
    const birthDay = Math.floor(Math.random() * 28) + 1; // Use 28 to avoid month-specific issues
    
    return new Date(birthYear, birthMonth, birthDay);
  }

  /**
   * Generate random gender
   */
  generateGender(): AccountData['gender'] {
    const genders: AccountData['gender'][] = ['male', 'female', 'other', 'prefer-not-to-say'];
    const weights = [0.45, 0.45, 0.05, 0.05]; // Realistic distribution
    
    const random = Math.random();
    let cumulativeWeight = 0;
    
    for (let i = 0; i < genders.length; i++) {
      cumulativeWeight += weights[i];
      if (random <= cumulativeWeight) {
        return genders[i];
      }
    }
    
    return 'prefer-not-to-say';
  }

  /**
   * Validate account data before submission
   */
  validateAccountData(accountData: AccountData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate email
    if (!this.isValidEmail(accountData.email)) {
      errors.push('Invalid email format');
    }

    // Validate password
    const passwordValidation = this.validatePassword(accountData.password);
    if (!passwordValidation.isValid) {
      errors.push(...passwordValidation.errors);
    }
    warnings.push(...passwordValidation.warnings);

    // Validate names
    if (!this.isValidName(accountData.firstName)) {
      errors.push('Invalid first name');
    }

    if (!this.isValidName(accountData.lastName)) {
      errors.push('Invalid last name');
    }

    // Validate birth date
    if (!this.isValidBirthDate(accountData.birthDate)) {
      errors.push('Invalid birth date');
    }

    // Check for realistic data
    if (this.isObviouslyFake(accountData)) {
      warnings.push('Account data may appear fake or suspicious');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check username availability (simulation)
   */
  async checkUsernameAvailability(username: string): Promise<UsernameCheckResult> {
    // In a real implementation, this would check against Google's API
    // For now, we'll simulate based on common patterns
    
    const isAvailable = !this.isCommonUsername(username) && !this.usedUsernames.has(username);
    const suggestions = isAvailable ? [] : this.generateUsernameSuggestions(username);

    return {
      username,
      available: isAvailable,
      suggestions
    };
  }

  /**
   * Generate alternative username suggestions
   */
  private generateUsernameSuggestions(baseUsername: string): string[] {
    const suggestions: string[] = [];
    
    for (let i = 0; i < 5; i++) {
      const suffix = Math.floor(Math.random() * 9999) + 1;
      suggestions.push(`${baseUsername}${suffix}`);
    }
    
    // Add variations
    suggestions.push(`${baseUsername}.${Math.floor(Math.random() * 99) + 1}`);
    suggestions.push(`${baseUsername}_${Math.floor(Math.random() * 99) + 1}`);
    
    return suggestions.slice(0, 3); // Return top 3 suggestions
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  /**
   * Validate password strength
   */
  private validatePassword(password: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Google's password requirements
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    if (password.length > 100) {
      errors.push('Password must be less than 100 characters');
    }

    // Check for character variety
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSymbols = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password);

    if (!hasLowercase) {
      warnings.push('Password should include lowercase letters');
    }

    if (!hasUppercase) {
      warnings.push('Password should include uppercase letters');
    }

    if (!hasNumbers) {
      warnings.push('Password should include numbers');
    }

    // Check for common weak patterns
    if (this.isWeakPassword(password)) {
      warnings.push('Password appears to be weak or common');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate name format
   */
  private isValidName(name: string): boolean {
    if (!name || name.length < 1 || name.length > 60) {
      return false;
    }

    // Allow letters, spaces, hyphens, and apostrophes
    const nameRegex = /^[a-zA-Z\s\-']+$/;
    return nameRegex.test(name);
  }

  /**
   * Validate birth date
   */
  private isValidBirthDate(birthDate: Date): boolean {
    const now = new Date();
    const age = now.getFullYear() - birthDate.getFullYear();
    
    // Must be at least 13 years old (Google's requirement)
    if (age < 13) {
      return false;
    }

    // Must not be more than 120 years old
    if (age > 120) {
      return false;
    }

    // Must be a valid date
    return birthDate instanceof Date && !isNaN(birthDate.getTime());
  }

  /**
   * Check if account data appears obviously fake
   */
  private isObviouslyFake(accountData: AccountData): boolean {
    const fakeIndicators = [
      // Names that are obviously fake
      accountData.firstName.toLowerCase().includes('test'),
      accountData.lastName.toLowerCase().includes('test'),
      accountData.firstName.toLowerCase().includes('fake'),
      accountData.lastName.toLowerCase().includes('fake'),
      
      // Sequential or repeated characters
      /(.)\1{3,}/.test(accountData.password),
      
      // Very simple passwords
      ['password', '12345678', 'qwerty123'].includes(accountData.password.toLowerCase()),
      
      // Unrealistic birth dates
      accountData.birthDate.getFullYear() === new Date().getFullYear()
    ];

    return fakeIndicators.some(indicator => indicator);
  }

  /**
   * Check if username is commonly used
   */
  private isCommonUsername(username: string): boolean {
    const commonUsernames = [
      'admin', 'test', 'user', 'guest', 'demo', 'sample',
      'john', 'jane', 'user123', 'test123', 'admin123'
    ];

    return commonUsernames.includes(username.toLowerCase());
  }

  /**
   * Check if password is weak
   */
  private isWeakPassword(password: string): boolean {
    const weakPasswords = [
      'password', '123456', 'qwerty', 'abc123', 'password123',
      'admin', 'letmein', 'welcome', 'monkey', 'dragon'
    ];

    return weakPasswords.includes(password.toLowerCase()) ||
           /^(.)\1+$/.test(password) || // All same character
           /^(012|123|234|345|456|567|678|789|890)+/.test(password); // Sequential numbers
  }

  /**
   * Get random character from charset
   */
  private getRandomChar(charset: string): string {
    return charset.charAt(Math.floor(Math.random() * charset.length));
  }

  /**
   * Shuffle string characters
   */
  private shuffleString(str: string): string {
    return str.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate batch of account data
   */
  generateAccountBatch(count: number, template?: Partial<AccountData>): AccountData[] {
    const logger = this.logger.withCorrelationId('generate_batch');
    logger.info(`Generating batch of ${count} accounts`);

    const accounts: AccountData[] = [];
    
    for (let i = 0; i < count; i++) {
      const accountData = this.generateAccountData(template);
      accounts.push(accountData);
    }

    logger.info(`Generated ${accounts.length} accounts successfully`);
    return accounts;
  }

  /**
   * Reset used usernames cache
   */
  resetUsernameCache(): void {
    this.usedUsernames.clear();
    this.logger.info('Username cache reset');
  }

  /**
   * Get generation statistics
   */
  getGenerationStats(): {
    usedUsernamesCount: number;
    configSettings: CredentialGeneratorConfig;
  } {
    return {
      usedUsernamesCount: this.usedUsernames.size,
      configSettings: { ...this.config }
    };
  }
}