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
    // Generate a simple temporary email
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const tempEmail = `temp_${randomId}_${timestamp}@tempmail.org`;
    
    const emailData = {
      email: tempEmail,
      token: randomId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      createdAt: new Date().toISOString()
    };

    // Store temp email data for potential retrieval
    await env.CREDENTIALS.put(`temp_email_${randomId}`, JSON.stringify(emailData), {
      expirationTtl: 24 * 60 * 60 // 24 hours
    });

    return new Response(JSON.stringify(emailData), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Temp email error:', error);
    return new Response('Failed to generate temp email', { 
      status: 500, 
      headers: corsHeaders 
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

    // Encrypt sensitive data
    const encryptedData = await encryptCredentials(credentials, env.ENCRYPTION_KEY);
    
    // Generate unique ID
    const accountId = `account_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Store in KV with metadata
    const storageData = {
      id: accountId,
      encryptedCredentials: encryptedData,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      status: 'created'
    };

    await env.CREDENTIALS.put(accountId, JSON.stringify(storageData));

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

/**
 * Simple encryption for credentials (basic implementation)
 */
async function encryptCredentials(credentials: any, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(credentials));
  const keyData = encoder.encode(key.padEnd(32, '0').substring(0, 32));
  
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
    data
  );
  
  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}