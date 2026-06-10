const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'Admin' | 'User';
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
  },
  cows: {
    list: () => request<any[]>('/api/cows'),
    get: (id: number) => request<any>(`/api/cows/${id}`),
    create: (data: any) =>
      request<{ id: number }>('/api/cows', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) =>
      request<any>(`/api/cows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/api/cows/${id}`, { method: 'DELETE' }),
  },
  trackers: {
    list: () => request<any[]>('/api/trackers'),
    create: (data: any) =>
      request<{ id: number }>('/api/trackers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) =>
      request<any>(`/api/trackers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    assign: (id: number, cow_id: number | null) =>
      request<any>(`/api/trackers/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ cow_id }),
      }),
  },
  geofences: {
    list: () => request<any[]>('/api/geofences'),
    create: (data: any) =>
      request<{ id: number }>('/api/geofences', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) =>
      request<any>(`/api/geofences/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/api/geofences/${id}`, { method: 'DELETE' }),
  },
  alerts: {
    list: (unread?: boolean) =>
      request<any[]>(`/api/alerts${unread ? '?unread=true' : ''}`),
    markRead: (id: number) =>
      request<any>(`/api/alerts/${id}/read`, { method: 'PATCH' }),
    markAllRead: () => request<any>('/api/alerts/read-all', { method: 'PATCH' }),
  },
};
