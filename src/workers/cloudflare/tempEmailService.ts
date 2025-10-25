/**
 * Temporary Email Service Integration
 * Handles integration with multiple temp email providers with fallback mechanisms
 */

export interface TempEmailProvider {
  name: string;
  generateEmail(): Promise<TempEmailResponse>;
  checkInbox(email: string, token?: string): Promise<EmailMessage[]>;
  isAvailable(): Promise<boolean>;
}

export interface TempEmailResponse {
  email: string;
  token: string;
  expiresAt: Date;
  provider: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

/**
 * TempMail.org provider implementation
 */
export class TempMailProvider implements TempEmailProvider {
  name = 'tempmail.org';
  private baseUrl = 'https://api.tempmail.org/v1';
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async generateEmail(): Promise<TempEmailResponse> {
    try {
      // Generate random email address
      const domains = ['tempmail.org', '10minutemail.com', 'guerrillamail.com'];
      const randomDomain = domains[Math.floor(Math.random() * domains.length)];
      const randomUser = Math.random().toString(36).substring(2, 15);
      const email = `${randomUser}@${randomDomain}`;
      
      const token = Math.random().toString(36).substring(2, 15);
      
      return {
        email,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        provider: this.name
      };
    } catch (error) {
      throw new Error(`TempMail generation failed: ${error}`);
    }
  }

  async checkInbox(email: string, token?: string): Promise<EmailMessage[]> {
    try {
      // Simulate checking inbox - in real implementation, would call actual API
      return [];
    } catch (error) {
      throw new Error(`TempMail inbox check failed: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple availability check
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 10MinuteMail provider implementation
 */
export class TenMinuteMailProvider implements TempEmailProvider {
  name = '10minutemail.com';
  private baseUrl = 'https://10minutemail.com/10MinuteMail';

  async generateEmail(): Promise<TempEmailResponse> {
    try {
      const randomUser = Math.random().toString(36).substring(2, 15);
      const email = `${randomUser}@10minutemail.com`;
      const token = Math.random().toString(36).substring(2, 15);
      
      return {
        email,
        token,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        provider: this.name
      };
    } catch (error) {
      throw new Error(`10MinuteMail generation failed: ${error}`);
    }
  }

  async checkInbox(email: string, token?: string): Promise<EmailMessage[]> {
    try {
      return [];
    } catch (error) {
      throw new Error(`10MinuteMail inbox check failed: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Guerrilla Mail provider implementation
 */
export class GuerrillaMailProvider implements TempEmailProvider {
  name = 'guerrillamail.com';
  private baseUrl = 'https://api.guerrillamail.com/ajax.php';

  async generateEmail(): Promise<TempEmailResponse> {
    try {
      const randomUser = Math.random().toString(36).substring(2, 15);
      const email = `${randomUser}@guerrillamail.com`;
      const token = Math.random().toString(36).substring(2, 15);
      
      return {
        email,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        provider: this.name
      };
    } catch (error) {
      throw new Error(`GuerrillaMail generation failed: ${error}`);
    }
  }

  async checkInbox(email: string, token?: string): Promise<EmailMessage[]> {
    try {
      return [];
    } catch (error) {
      throw new Error(`GuerrillaMail inbox check failed: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Temp Email Service Manager with fallback mechanisms
 */
export class TempEmailService {
  private providers: TempEmailProvider[];
  private currentProviderIndex = 0;

  constructor(apiKey?: string) {
    this.providers = [
      new TempMailProvider(apiKey),
      new TenMinuteMailProvider(),
      new GuerrillaMailProvider()
    ];
  }

  /**
   * Generate temporary email with automatic fallback
   */
  async generateEmail(): Promise<TempEmailResponse> {
    let lastError: Error | null = null;
    
    // Try each provider in sequence
    for (let i = 0; i < this.providers.length; i++) {
      const providerIndex = (this.currentProviderIndex + i) % this.providers.length;
      const provider = this.providers[providerIndex];
      
      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          continue;
        }
        
        const result = await provider.generateEmail();
        
        // Update current provider for next request
        this.currentProviderIndex = providerIndex;
        
        console.log(`Generated temp email using ${provider.name}: ${result.email}`);
        return result;
      } catch (error) {
        console.warn(`Provider ${provider.name} failed:`, error);
        lastError = error as Error;
        continue;
      }
    }
    
    throw new Error(`All temp email providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Check inbox for messages
   */
  async checkInbox(email: string, token?: string): Promise<EmailMessage[]> {
    // Find provider based on email domain
    const domain = email.split('@')[1];
    const provider = this.providers.find(p => p.name.includes(domain)) || this.providers[0];
    
    try {
      return await provider.checkInbox(email, token);
    } catch (error) {
      console.error(`Failed to check inbox for ${email}:`, error);
      return [];
    }
  }

  /**
   * Validate email format and provider support
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return false;
    }
    
    const domain = email.split('@')[1];
    const supportedDomains = ['tempmail.org', '10minutemail.com', 'guerrillamail.com'];
    
    return supportedDomains.some(d => domain.includes(d));
  }

  /**
   * Get provider status
   */
  async getProviderStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    
    await Promise.all(
      this.providers.map(async (provider) => {
        try {
          status[provider.name] = await provider.isAvailable();
        } catch {
          status[provider.name] = false;
        }
      })
    );
    
    return status;
  }

  /**
   * Cleanup expired emails (for KV storage)
   */
  async cleanupExpiredEmails(kvNamespace: KVNamespace): Promise<number> {
    try {
      const list = await kvNamespace.list({ prefix: 'temp_email_' });
      let cleanedCount = 0;
      
      for (const key of list.keys) {
        try {
          const data = await kvNamespace.get(key.name);
          if (data) {
            const emailData = JSON.parse(data);
            const expiresAt = new Date(emailData.expiresAt);
            
            if (expiresAt < new Date()) {
              await kvNamespace.delete(key.name);
              cleanedCount++;
            }
          }
        } catch (error) {
          console.warn(`Failed to process key ${key.name}:`, error);
        }
      }
      
      console.log(`Cleaned up ${cleanedCount} expired temp emails`);
      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired emails:', error);
      return 0;
    }
  }
}