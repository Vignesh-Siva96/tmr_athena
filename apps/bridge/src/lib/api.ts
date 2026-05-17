const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'

interface ApiOptions { token?: string | null; method?: string; body?: unknown }

async function apiRequest<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>
    // NestJS errors: { statusCode, message, error }  — message is at top level
    const msg = (typeof err['message'] === 'string' ? err['message'] : null)
      ?? (typeof (err['error'] as Record<string, unknown>)?.['message'] === 'string' ? (err['error'] as Record<string, unknown>)['message'] as string : null)
      ?? `Request failed (${res.status})`
    throw new Error(msg)
  }

  const json = await res.json() as { data: T }
  return json.data
}

export const api = {
  get: <T>(path: string, token?: string | null) => apiRequest<T>(path, { token }),
  post: <T>(path: string, body: unknown, token?: string | null) => apiRequest<T>(path, { method: 'POST', body, token }),
  patch: <T>(path: string, body: unknown, token?: string | null) => apiRequest<T>(path, { method: 'PATCH', body, token }),
  delete: <T>(path: string, token?: string | null) => apiRequest<T>(path, { method: 'DELETE', token }),
}
