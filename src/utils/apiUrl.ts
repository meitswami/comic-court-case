/**
 * Dynamically determines the API URL based on the current hostname
 * In production the frontend and API share one origin (nginx proxies /api).
 * 
 * Strategy:
 * 1. Use VITE_API_URL if set and valid (not localhost in production)
 * 2. If localhost, use localhost:3000
 * 3. In production, warn if API URL is not configured
 */
export function getApiUrl(includeApiPath: boolean = false): string {
  // First, check if VITE_API_URL is explicitly set (environment variable)
  const envApiUrl = import.meta.env.VITE_API_URL;
  
  // Get current hostname (runtime check - only available in browser)
  const isBrowser = typeof window !== 'undefined';
  const hostname = isBrowser ? window.location.hostname : '';
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  // If running on localhost, use localhost API
  if (isLocalhost) {
    const baseUrl = envApiUrl || 'http://localhost:3000';
    // Remove trailing /api if it exists, we'll add it conditionally
    const cleanUrl = baseUrl.replace(/\/api\/?$/, '');
    return includeApiPath ? `${cleanUrl}/api` : cleanUrl;
  }

  // In production (not localhost):
  // If VITE_API_URL is set and not localhost, use it
  if (envApiUrl && !envApiUrl.includes('localhost') && !envApiUrl.includes('127.0.0.1')) {
    const cleanUrl = envApiUrl.replace(/\/api\/?$/, '');
    return includeApiPath ? `${cleanUrl}/api` : cleanUrl;
  }

  // Fallback: Use same origin. This is the normal production case: nginx serves
  // the frontend and proxies /api to the Express server on the same domain.
  const origin = isBrowser ? window.location.origin : '';
  
  // Production with no VITE_API_URL configured means same origin, which is
  // correct - no warning needed. Only log if the origin is unavailable
  // (which shouldn't happen in a browser).
  if (isBrowser && !envApiUrl && !origin) {
    // Only warn if we can't get origin at all (shouldn't happen)
    console.error('⚠️ Cannot determine API URL - origin unavailable');
  }
  
  if (includeApiPath) {
    return `${origin}/api`;
  }
  
  return origin;
}

// Export convenience constants
export const API_URL = getApiUrl(false); // Base URL without /api
export const API_BASE_URL = getApiUrl(true); // Base URL with /api
