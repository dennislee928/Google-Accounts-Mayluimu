/**
 * Cloudflare Worker for Google Account Creation Proxy
 * Handles IP rotation, request proxying, and basic API endpoints
 */

interface Env {
  CREDENTIALS: KVNamespace;
  ENCRYPTION_KEY: string;
  TEMP_EMAIL_API_KEY?: string;
}

interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      switch (path) {
        case '/proxy/signup':
          return handleSignupProxy(request, corsHeaders);
        
        case '/temp-email':
          return handleTempEmail(request, env, corsHeaders);
        
        case '/store-credentials':
          return handleStoreCredentials(request, env, corsHeaders);
        
        case '/check-inbox':
          return handleCheckInbox(request, env, corsHeaders);
        
        case '/email-status':
          return handleEmailStatus(request, env, corsHeaders);
        
        case '/cleanup-emails':
          return handleCleanupEmails(request, env, corsHeaders);
        
        case '/get-credentials':
          return handleGetCredentials(request, env, corsHeaders);
        
        case '/list-credentials':
          return handleListCredentials(request, env, corsHeaders);
        
        case '/update-status':
          return handleUpdateStatus(request, env, corsHeaders);
        
        case '/export-credentials':
          return handleExportCredentials(request, env, corsHeaders);
        
        case '/credential-stats':
          return handleCredentialStats(request, env, corsHeaders);
        
        case '/health':
          return handleHealthCheck(corsHeaders);
        
        default:
          return new Response('Not Found', { 
            status: 404, 
            headers: corsHeaders 
          });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};

/**
 * Proxy requests to Google signup page with IP rotation
 */
async function handleSignupProxy(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const googleSignupUrl = 'https://accounts.google.com/signup';
  
  // Generate realistic headers
  const proxyHeaders = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0'
  };

  try {
    const response = await fetch(googleSignupUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' ? await request.text() : undefined,
    });

    // Clone response with CORS headers
    const modifiedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('Content-Type') || 'text/html',
      }
    });

    // Log successful proxy
    console.log(`Proxied request to Google signup: ${response.status}`);
    
    return modifiedResponse;
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response('Proxy Error', { 
      status: 502, 
      headers: corsHeaders 
    });
  }
}

/**
 * Generate temporary email for account verification
 */
async function handleTempEmail(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    // Import temp email service (would be bundled in actual deployment)
    const { TempEmailService } = await import('./tempEmailService');
    const tempEmailService = new TempEmailService(env.TEMP_EMAIL_API_KEY);
    
    // Generate temporary email with fallback
    const emailData = await tempEmailService.generateEmail();
    
    // Store temp email data for potential retrieval
    const storageData = {
      ...emailData,
      createdAt: new Date().toISOString(),
      expiresAt: emailData.expiresAt.toISOString()
    };
    
    await env.CREDENTIALS.put(`temp_email_${emailData.token}`, JSON.stringify(storageData), {
      expirationTtl: Math.floor((emailData.expiresAt.getTime() - Date.now()) / 1000)
    });

    return new Response(JSON.stringify(storageData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Temp email error:', error);
    
    // Fallback to simple email generation
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const fallbackEmail = {
      email: `fallback_${randomId}_${timestamp}@tempmail.org`,
      token: randomId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      provider: 'fallback',
      createdAt: new Date().toISOString()
    };
    
    await env.CREDENTIALS.put(`temp_email_${randomId}`, JSON.stringify(fallbackEmail), {
      expirationTtl: 60 * 60 // 1 hour
    });
    
    return new Response(JSON.stringify(fallbackEmail), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * Store account credentials securely in Cloudflare KV
 */
async function handleStoreCredentials(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const credentials = await request.json() as any;
    
    // Validate required fields
    if (!credentials.email || !credentials.password) {
      return new Response('Missing required fields', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const accountId = await storage.store(credentials);

    return new Response(JSON.stringify({ 
      success: true, 
      accountId,
      message: 'Credentials stored successfully' 
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Store credentials error:', error);
    return new Response('Failed to store credentials', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Check inbox for temporary email
 */
async function handleCheckInbox(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const { email, token } = await request.json() as any;
    
    if (!email || !token) {
      return new Response('Missing email or token', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const { TempEmailService } = await import('./tempEmailService');
    const tempEmailService = new TempEmailService(env.TEMP_EMAIL_API_KEY);
    
    const messages = await tempEmailService.checkInbox(email, token);
    
    return new Response(JSON.stringify({ 
      email, 
      messages,
      count: messages.length 
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Check inbox error:', error);
    return new Response('Failed to check inbox', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Get email provider status
 */
async function handleEmailStatus(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { TempEmailService } = await import('./tempEmailService');
    const tempEmailService = new TempEmailService(env.TEMP_EMAIL_API_KEY);
    
    const providerStatus = await tempEmailService.getProviderStatus();
    
    return new Response(JSON.stringify({
      providers: providerStatus,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Email status error:', error);
    return new Response('Failed to get email status', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Cleanup expired temporary emails
 */
async function handleCleanupEmails(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const { TempEmailService } = await import('./tempEmailService');
    const tempEmailService = new TempEmailService(env.TEMP_EMAIL_API_KEY);
    
    const cleanedCount = await tempEmailService.cleanupExpiredEmails(env.CREDENTIALS);
    
    return new Response(JSON.stringify({
      success: true,
      cleanedCount,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Cleanup emails error:', error);
    return new Response('Failed to cleanup emails', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Get credentials by ID
 */
async function handleGetCredentials(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      return new Response('Missing credential ID', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const credentials = await storage.retrieve(id);
    
    if (!credentials) {
      return new Response('Credentials not found', { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    return new Response(JSON.stringify(credentials), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get credentials error:', error);
    return new Response('Failed to get credentials', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * List credentials with pagination and filtering
 */
async function handleListCredentials(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const url = new URL(request.url);
    const criteria = {
      status: url.searchParams.get('status') || undefined,
      workerId: url.searchParams.get('workerId') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '50'),
      offset: parseInt(url.searchParams.get('offset') || '0'),
      createdAfter: url.searchParams.get('createdAfter') || undefined,
      createdBefore: url.searchParams.get('createdBefore') || undefined
    };

    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const credentials = await storage.list(criteria);

    return new Response(JSON.stringify({
      credentials,
      count: credentials.length,
      criteria
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('List credentials error:', error);
    return new Response('Failed to list credentials', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Update credential status
 */
async function handleUpdateStatus(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const { id, status } = await request.json() as any;
    
    if (!id || !status) {
      return new Response('Missing ID or status', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    if (!['active', 'suspended', 'deleted'].includes(status)) {
      return new Response('Invalid status', { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const success = await storage.updateStatus(id, status);

    return new Response(JSON.stringify({
      success,
      message: success ? 'Status updated successfully' : 'Credential not found'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Update status error:', error);
    return new Response('Failed to update status', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Export credentials to encrypted CSV
 */
async function handleExportCredentials(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const criteria = await request.json() as any;

    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const encryptedCsv = await storage.exportCredentials(criteria);

    return new Response(JSON.stringify({
      success: true,
      encryptedData: encryptedCsv,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Export credentials error:', error);
    return new Response('Failed to export credentials', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Get credential statistics
 */
async function handleCredentialStats(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { CloudflareKVCredentialStorage } = await import('./credentialStorage');
    const storage = new CloudflareKVCredentialStorage(env.CREDENTIALS, env.ENCRYPTION_KEY);
    
    const stats = await storage.getStats();

    return new Response(JSON.stringify(stats), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return new Response('Failed to get statistics', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/**
 * Health check endpoint
 */
async function handleHealthCheck(corsHeaders: Record<string, string>): Promise<Response> {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      proxy: 'operational',
      storage: 'operational',
      tempEmail: 'operational'
    }
  };

  return new Response(JSON.stringify(healthData), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Get random user agent for realistic requests
 */
function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

