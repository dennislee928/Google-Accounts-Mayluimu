/**
 * Encryption utilities for secure credential storage
 */

import * as CryptoJS from 'crypto-js';

export class EncryptionService {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.key).toString();
  }

  decrypt(encryptedData: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, this.key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  encryptObject<T>(obj: T): string {
    const jsonString = JSON.stringify(obj);
    return this.encrypt(jsonString);
  }

  decryptObject<T>(encryptedData: string): T {
    const decryptedString = this.decrypt(encryptedData);
    return JSON.parse(decryptedString) as T;
  }

  generateHash(data: string): string {
    return CryptoJS.SHA256(data).toString();
  }

  generateSalt(): string {
    return CryptoJS.lib.WordArray.random(128/8).toString();
  }
}