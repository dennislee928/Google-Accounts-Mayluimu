/**
 * Cloudflare Worker entry point
 * This file will be populated in task 2.1
 */

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Cloudflare Worker placeholder - to be implemented');
  }
};