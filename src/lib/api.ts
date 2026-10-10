// Small helper for calling our own API with the signed-in user's token.

import { getApiUrl } from '@/utils/apiUrl';

function accessToken(): string | null {
  try {
    const stored = localStorage.getItem('auth_session');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.access_token || parsed?.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<T> {
  const token = accessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${getApiUrl(true)}${path}`, {
      method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const raw = data?.error;
    const message = typeof raw === 'string' ? raw : raw?.message;
    const error: any = new Error(message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
}
