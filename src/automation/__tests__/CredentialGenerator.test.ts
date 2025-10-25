/**
 * Unit tests for Credential Generator
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CredentialGenerator, CredentialGeneratorConfig } from '../CredentialGenerator';
import { AccountData } from '../../types';

describe('CredentialGenerator Tests', () => {
  let generator: CredentialGenerator;
  let config: CredentialGeneratorConfig;

  beforeEach(() => {
    config = {
      usernameLength: 10,
      passwordLength: 12,
      includeNumbers: true,
      includeSymbols: true,
      avoidSimilarChars: true,
      enforceComplexity: true
    };

    generator = new CredentialGenerator(config, 'test-worker');
  });

  describe('Account Data Generation', () => {
    it('should generate complete account data', () => {
      const accountData = generator.generateAccountData();

      expect(accountData).toBeDefined();
      expect(accountData.id).toBeDefined();
      expect(accountData.email).toMatch(/^[^\s@]+@gmail\.com$/);
      expect(accountData.password).toBeDefined();
      expect(accountData.firstName).toBeDefined();
      expect(accountData.lastName).toBeDefined();
      expect(accountData.birthDate).toBeInstanceOf(Date);
      expect(accountData.createdAt).toBeInstanceOf(Date);
      expect(accountData.status).toBe('pending');
    });

    it('should use partial data when provided', () => {
      const partialData: Partial<AccountData> = {
        firstName: 'CustomFirst',
        lastName: 'CustomLast',
        email: 'custom@gmail.com'
      };

      const accountData = generator.generateAccountData(partialData);

      expect(accountData.firstName).toBe('CustomFirst');
      expect(accountData.lastName).toBe('CustomLast');
      expect(accountData.email).toBe('custom@gmail.com');
    });

    it('should generate unique account IDs', () => {
      const account1 = generator.generateAccountData();
      const account2 = generator.generateAccountData();

      expect(account1.id).not.toBe(account2.id);
    });
  });

  describe('Username Generation', () => {
    it('should generate username from first and last name', () => {
      const username = generator.generateUsername('John', 'Doe');

      expect(username).toBeDefined();
      expect(username.length).toBeGreaterThan(0);
      expect(username).toMatch(/^[a-z0-9._]+$/);
    });

    it('should ensure username uniqueness', () => {
      const username1 = generator.generateUsername('John', 'Doe');
      const username2 = generator.generateUsername('John', 'Doe');

      expect(username1).not.toBe(username2);
    });

    it('should handle special characters in names', () => {
      const username = generator.generateUsername("John-Paul", "O'Connor");

      expect(username).toMatch(/^[a-z0-9._]+$/);
      expect(username).not.toContain('-');
      expect(username).not.toContain("'");
    });

    it('should ensure minimum username length', () => {
      const username = generator.generateUsername('A', 'B');

      expect(username.length).toBeGreaterThanOrEqual(6);
    });

    it('should limit maximum username length', () => {
      const longFirstName = 'VeryLongFirstNameThatExceedsLimits';
      const longLastName = 'VeryLongLastNameThatExceedsLimits';
      
      const username = generator.generateUsername(longFirstName, longLastName);

      expect(username.length).toBeLessThanOrEqual(30);
    });
  });

  describe('Password Generation', () => {
    it('should generate password with correct length', () => {
      const password = generator.generatePassword();

      expect(password.length).toBe(config.passwordLength);
    });

    it('should include required character types when enforcing complexity', () => {
      const password = generator.generatePassword();

      expect(password).toMatch(/[a-z]/); // lowercase
      expect(password).toMatch(/[A-Z]/); // uppercase
      expect(password).toMatch(/\d/); // numbers
      expect(password).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/); // symbols
    });

    it('should avoid similar characters when configured', () => {
      const password = generator.generatePassword();

      // Should not contain similar characters: il1Lo0O
      expect(password).not.toMatch(/[il1Lo0O]/);
    });

    it('should generate different passwords', () => {
      const password1 = generator.generatePassword();
      const password2 = generator.generatePassword();

      expect(password1).not.toBe(password2);
    });

    it('should respect configuration options', () => {
      const simpleConfig: CredentialGeneratorConfig = {
        usernameLength: 8,
        passwordLength: 8,
        includeNumbers: false,
        includeSymbols: false,
        avoidSimilarChars: false,
        enforceComplexity: false
      };

      const simpleGenerator = new CredentialGenerator(simpleConfig, 'test');
      const password = simpleGenerator.generatePassword();

      expect(password.length).toBe(8);
      expect(password).toMatch(/^[a-zA-Z]+$/); // Only letters
    });
  });

  describe('Name Generation', () => {
    it('should generate realistic first names', () => {
      const firstName = generator.generateFirstName();

      expect(firstName).toBeDefined();
      expect(firstName.length).toBeGreaterThan(0);
      expect(firstName).toMatch(/^[A-Z][a-z]+$/);
    });

    it('should generate realistic last names', () => {
      const lastName = generator.generateLastName();

      expect(lastName).toBeDefined();
      expect(lastName.length).toBeGreaterThan(0);
      expect(lastName).toMatch(/^[A-Z][a-z]+$/);
    });

    it('should generate different names', () => {
      const names = Array.from({ length: 10 }, () => generator.generateFirstName());
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBeGreaterThan(1);
    });
  });

  describe('Birth Date Generation', () => {
    it('should generate realistic birth dates', () => {
      const birthDate = generator.generateBirthDate();

      expect(birthDate).toBeInstanceOf(Date);
      expect(birthDate.getTime()).toBeLessThan(Date.now());
    });

    it('should generate ages between 18 and 65', () => {
      const birthDate = generator.generateBirthDate();
      const age = new Date().getFullYear() - birthDate.getFullYear();

      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(65);
    });

    it('should generate valid dates', () => {
      const birthDate = generator.generateBirthDate();

      expect(isNaN(birthDate.getTime())).toBe(false);
    });
  });

  describe('Gender Generation', () => {
    it('should generate valid gender values', () => {
      const gender = generator.generateGender();

      expect(['male', 'female', 'other', 'prefer-not-to-say']).toContain(gender);
    });

    it('should have realistic distribution', () => {
      const genders = Array.from({ length: 100 }, () => generator.generateGender());
      const maleCount = genders.filter(g => g === 'male').length;
      const femaleCount = genders.filter(g => g === 'female').length;

      // Should have reasonable distribution (not exact due to randomness)
      expect(maleCount).toBeGreaterThan(20);
      expect(femaleCount).toBeGreaterThan(20);
    });
  });

  describe('Validation', () => {
    it('should validate correct account data', () => {
      const validAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: 'ValidPass123!',
        firstName: 'John',
        lastName: 'Doe',
        birthDate: new Date('1990-01-01'),
        gender: 'male',
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(validAccount);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid email', () => {
      const invalidAccount: AccountData = {
        id: 'test-id',
        email: 'invalid-email',
        password: 'ValidPass123!',
        firstName: 'John',
        lastName: 'Doe',
        birthDate: new Date('1990-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(invalidAccount);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid email format');
    });

    it('should detect weak passwords', () => {
      const weakPasswordAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: '123',
        firstName: 'John',
        lastName: 'Doe',
        birthDate: new Date('1990-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(weakPasswordAccount);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Password must be at least 8 characters long');
    });

    it('should detect invalid names', () => {
      const invalidNameAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: 'ValidPass123!',
        firstName: '',
        lastName: 'Doe123',
        birthDate: new Date('1990-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(invalidNameAccount);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid first name');
      expect(validation.errors).toContain('Invalid last name');
    });

    it('should detect invalid birth dates', () => {
      const invalidBirthAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: 'ValidPass123!',
        firstName: 'John',
        lastName: 'Doe',
        birthDate: new Date('2020-01-01'), // Too young
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(invalidBirthAccount);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid birth date');
    });

    it('should detect obviously fake data', () => {
      const fakeAccount: AccountData = {
        id: 'test-id',
        email: 'test@gmail.com',
        password: 'password',
        firstName: 'Test',
        lastName: 'User',
        birthDate: new Date('1990-01-01'),
        createdAt: new Date(),
        workerId: 'test-worker',
        ipAddress: '127.0.0.1',
        status: 'pending'
      };

      const validation = generator.validateAccountData(fakeAccount);

      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some(w => w.includes('fake') || w.includes('weak'))).toBe(true);
    });
  });

  describe('Username Availability', () => {
    it('should check username availability', async () => {
      const result = await generator.checkUsernameAvailability('testuser123');

      expect(result).toHaveProperty('username', 'testuser123');
      expect(result).toHaveProperty('available');
      expect(result).toHaveProperty('suggestions');
      expect(typeof result.available).toBe('boolean');
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should detect common usernames as unavailable', async () => {
      const result = await generator.checkUsernameAvailability('admin');

      expect(result.available).toBe(false);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should provide username suggestions', async () => {
      const result = await generator.checkUsernameAvailability('admin');

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.every(s => s.includes('admin'))).toBe(true);
    });
  });

  describe('Batch Generation', () => {
    it('should generate batch of accounts', () => {
      const batchSize = 5;
      const batch = generator.generateAccountBatch(batchSize);

      expect(batch).toHaveLength(batchSize);
      expect(batch.every(account => account.workerId === 'test-worker')).toBe(true);
    });

    it('should generate unique accounts in batch', () => {
      const batch = generator.generateAccountBatch(10);
      
      const emails = batch.map(account => account.email);
      const uniqueEmails = new Set(emails);
      
      expect(uniqueEmails.size).toBe(batch.length);
    });

    it('should use template data in batch generation', () => {
      const template: Partial<AccountData> = {
        firstName: 'Template',
        lastName: 'User'
      };

      const batch = generator.generateAccountBatch(3, template);

      expect(batch.every(account => account.firstName === 'Template')).toBe(true);
      expect(batch.every(account => account.lastName === 'User')).toBe(true);
    });
  });

  describe('Cache Management', () => {
    it('should track used usernames', () => {
      generator.generateUsername('John', 'Doe');
      generator.generateUsername('Jane', 'Smith');

      const stats = generator.getGenerationStats();

      expect(stats.usedUsernamesCount).toBe(2);
    });

    it('should reset username cache', () => {
      generator.generateUsername('John', 'Doe');
      
      let stats = generator.getGenerationStats();
      expect(stats.usedUsernamesCount).toBe(1);

      generator.resetUsernameCache();
      
      stats = generator.getGenerationStats();
      expect(stats.usedUsernamesCount).toBe(0);
    });

    it('should return configuration settings in stats', () => {
      const stats = generator.getGenerationStats();

      expect(stats.configSettings).toEqual(config);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty names gracefully', () => {
      const username = generator.generateUsername('', '');

      expect(username).toBeDefined();
      expect(username.length).toBeGreaterThan(0);
    });

    it('should handle very long names', () => {
      const longName = 'A'.repeat(100);
      const username = generator.generateUsername(longName, longName);

      expect(username.length).toBeLessThanOrEqual(30);
    });

    it('should handle special characters in names', () => {
      const specialName = 'José-María';
      const username = generator.generateUsername(specialName, 'García');

      expect(username).toMatch(/^[a-z0-9._]+$/);
    });

    it('should generate valid passwords with minimal configuration', () => {
      const minimalConfig: CredentialGeneratorConfig = {
        usernameLength: 6,
        passwordLength: 8,
        includeNumbers: false,
        includeSymbols: false,
        avoidSimilarChars: false,
        enforceComplexity: false
      };

      const minimalGenerator = new CredentialGenerator(minimalConfig, 'test');
      const password = minimalGenerator.generatePassword();

      expect(password.length).toBe(8);
      expect(password).toMatch(/^[a-zA-Z]+$/);
    });
  });
});