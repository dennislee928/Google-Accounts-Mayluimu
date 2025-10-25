/// <reference types="node" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: string;
      CLOUDFLARE_WORKER_URL?: string;
      TEMP_EMAIL_API_URL?: string;
      CREDENTIAL_STORAGE_URL?: string;
      ENCRYPTION_KEY?: string;
      DATABASE_URL?: string;
      ACCOUNTS_PER_DAY?: string;
      ACCOUNTS_PER_HOUR?: string;
      MAX_CONCURRENT_WORKERS?: string;
    }
  }
}

export {};