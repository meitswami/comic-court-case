// Data client for eNyayaSetu.
//
// The app was first built on Supabase, and most components still read and
// write through the familiar `supabase.from('table')...` calls. Supabase is no
// longer used: this file provides the same interface on top of our own API
// (Express + MySQL on the VPS), so those components work unchanged.
//
//   supabase.from(table)          -> POST /api/data/query
//   supabase.rpc(fn, args)        -> POST /api/data/rpc
//   supabase.functions.invoke(n)  -> POST /api/functions/<n>
//   supabase.storage.from(bucket) -> /api/storage/*
//   supabase.channel(name)        -> polling (/api/data/watch, /api/realtime/presence)
//   supabase.auth.getUser()       -> the signed-in user from useAuth's session
//
// Who may read or change what is decided on the server
// (server/lib/dataPolicies.js), never here.

import { getApiUrl } from '@/utils/apiUrl';

type Json = any;

interface ApiError {
  message: string;
  code?: string;
  details?: string;
  status?: number;
}

interface Result<T = any> {
  data: T | null;
  error: ApiError | null;
  count?: number | null;
  status?: number;
}

const SESSION_KEY = 'auth_session';

function readSession(): any | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.access_token ? parsed : parsed?.session?.access_token ? parsed.session : null;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function apiBase(): string {
  return getApiUrl(true);
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${getApiUrl(false)}${path}`;
}

function toError(payload: any, status: number, fallback: string): ApiError {
  const raw = payload?.error;
  if (raw && typeof raw === 'object') {
    return { message: raw.message || fallback, code: raw.code, details: raw.details, status };
  }
  if (typeof raw === 'string') return { message: raw, status };
  return { message: fallback, status };
}

async function post(path: string, body: Json | FormData): Promise<{ ok: boolean; status: number; payload: any }> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: isForm ? authHeaders() : { 'Content-Type': 'application/json', ...authHeaders() },
      body: isForm ? (body as FormData) : JSON.stringify(body ?? {}),
    });
    let payload: any = null;
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      payload = await response.json().catch(() => null);
    }
    return { ok: response.ok, status: response.status, payload };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      payload: { error: { message: 'Could not reach the server. Check your connection and try again.' } },
    };
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Action = 'select' | 'insert' | 'update' | 'delete';

interface Filter {
  col: string;
  op: string;
  val: any;
}

class QueryBuilder implements PromiseLike<Result> {
  private action: Action = 'select';
  private selectSpec = '*';
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private singleMode: 'single' | 'maybe' | null = null;
  private countMode: string | null = null;
  private headOnly = false;
  private values: any = null;
  private returning = false;

  constructor(private table: string) {}

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.action !== 'select') {
      this.returning = true;
    }
    this.selectSpec = columns && columns.trim() ? columns : '*';
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(values: any) {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  upsert(values: any) {
    return this.insert(values);
  }

  update(values: any) {
    this.action = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  private where(col: string, op: string, val: any) {
    this.filters.push({ col, op, val });
    return this;
  }

  eq(col: string, val: any) { return this.where(col, 'eq', val); }
  neq(col: string, val: any) { return this.where(col, 'neq', val); }
  gt(col: string, val: any) { return this.where(col, 'gt', val); }
  gte(col: string, val: any) { return this.where(col, 'gte', val); }
  lt(col: string, val: any) { return this.where(col, 'lt', val); }
  lte(col: string, val: any) { return this.where(col, 'lte', val); }
  like(col: string, val: string) { return this.where(col, 'like', val); }
  ilike(col: string, val: string) { return this.where(col, 'ilike', val); }
  in(col: string, val: any[]) { return this.where(col, 'in', val); }
  is(col: string, val: any) { return this.where(col, 'is', val); }

  not(col: string, op: string, val: any) {
    if (op === 'is') return this.where(col, 'is_not', val);
    if (op === 'in') return this.where(col, 'not_in', val);
    if (op === 'eq') return this.where(col, 'neq', val);
    console.warn(`[data] .not(${op}) is not supported`);
    return this;
  }

  match(query: Record<string, any>) {
    Object.entries(query).forEach(([col, val]) => this.where(col, 'eq', val));
    return this;
  }

  order(col: string, options?: { ascending?: boolean }) {
    this.orders.push({ col, asc: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitValue = count;
    return this;
  }

  range(from: number, to: number) {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  private async run(): Promise<Result> {
    const { ok, status, payload } = await post('/data/query', {
      table: this.table,
      action: this.action,
      select: this.selectSpec,
      filters: this.filters,
      order: this.orders,
      limit: this.limitValue,
      offset: this.offsetValue,
      single: this.singleMode,
      count: this.countMode,
      head: this.headOnly,
      values: this.values,
      returning: this.returning,
    });

    if (!ok) {
      return { data: null, error: toError(payload, status, 'Request failed'), count: null, status };
    }
    return { data: payload?.data ?? null, error: null, count: payload?.count ?? null, status };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

// Links handed back by uploads, so getPublicUrl() can answer without a request.
const uploadedUrls = new Map<string, string>();

function storageBucket(bucket: string) {
  return {
    async upload(path: string, file: Blob | File, options?: { contentType?: string; upsert?: boolean }) {
      const form = new FormData();
      // Text fields first so the server has the path before the file arrives.
      form.append('path', path);
      if (options?.contentType) form.append('contentType', options.contentType);
      const name = (file as File).name || path.split('/').pop() || 'file';
      form.append('file', file, name);

      const { ok, status, payload } = await post(`/storage/upload/${encodeURIComponent(bucket)}`, form);
      if (!ok) {
        const fallback = status === 413 ? 'File is too large to upload.' : 'Upload failed';
        return { data: null, error: toError(payload, status, fallback) };
      }
      if (payload?.publicUrl) {
        uploadedUrls.set(`${bucket}/${path}`, absoluteUrl(payload.publicUrl));
        uploadedUrls.set(`${bucket}/${payload.path}`, absoluteUrl(payload.publicUrl));
      }
      return { data: { path: payload.path, fullPath: payload.fullPath }, error: null };
    },

    getPublicUrl(path: string) {
      const known = uploadedUrls.get(`${bucket}/${path}`);
      const fallback = absoluteUrl(
        `/api/storage/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
      );
      return { data: { publicUrl: known || fallback } };
    },

    async createSignedUrl(path: string, expiresIn: number) {
      const { ok, status, payload } = await post(`/storage/sign/${encodeURIComponent(bucket)}`, { path, expiresIn });
      if (!ok || !payload?.signedUrl) {
        return { data: null, error: toError(payload, status, 'Could not create a link to the file') };
      }
      return { data: { signedUrl: absoluteUrl(payload.signedUrl) }, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Realtime (polling)
// ---------------------------------------------------------------------------

interface ChangeListener {
  event: string;
  table: string;
  filter: { col: string; val: string } | null;
  callback: (payload: any) => void;
  sig: string | null;
  started: boolean;
  seen: Set<string>;
}

interface PresenceListener {
  event: string;
  callback: (payload: any) => void;
}

const CHANGE_INTERVAL = 3000;
const PRESENCE_INTERVAL = 2000;

function parseFilter(filter?: string): { col: string; val: string } | null {
  if (!filter) return null;
  const match = filter.match(/^([A-Za-z_][A-Za-z0-9_]*)=eq\.(.*)$/);
  return match ? { col: match[1], val: match[2] } : null;
}

class Channel {
  private changes: ChangeListener[] = [];
  private presence: PresenceListener[] = [];
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private since: string | null = null;
  private active = false;
  private presenceKey: string;
  private myState: any = null;
  private lastPresence: Record<string, any> = {};

  constructor(public topic: string, options?: any) {
    this.presenceKey = options?.config?.presence?.key || `anon-${Math.random().toString(36).slice(2)}`;
  }

  on(type: string, config: any, callback: (payload: any) => void) {
    if (type === 'postgres_changes') {
      this.changes.push({
        event: config?.event || '*',
        table: config?.table,
        filter: parseFilter(config?.filter),
        callback,
        sig: null,
        started: false,
        seen: new Set(),
      });
    } else if (type === 'presence') {
      this.presence.push({ event: config?.event || 'sync', callback });
    }
    return this;
  }

  subscribe(callback?: (status: string) => void) {
    if (this.active) return this;
    this.active = true;
    if (this.changes.length > 0) this.pollChanges();
    if (this.presence.length > 0) this.pollPresence();
    if (callback) setTimeout(() => callback('SUBSCRIBED'), 0);
    return this;
  }

  private async pollChanges() {
    if (!this.active) return;
    try {
      if (readSession()) {
        const { ok, payload } = await post('/data/watch', {
          subs: this.changes.map((listener) => ({
            table: listener.table,
            filter: listener.filter,
            since: this.since,
          })),
        });
        if (ok && Array.isArray(payload?.results) && this.active) {
          payload.results.forEach((result: any, index: number) => {
            const listener = this.changes[index];
            if (!listener || result.sig === null) return;

            const inserted: any[] = Array.isArray(result.inserted) ? result.inserted : [];
            const fresh = inserted.filter((row) => row?.id && !listener.seen.has(row.id));
            fresh.forEach((row) => listener.seen.add(row.id));

            const changed = listener.started && result.sig !== listener.sig;
            listener.sig = result.sig;
            if (!listener.started) {
              // First answer only records where things stand.
              listener.started = true;
              return;
            }
            if (!changed) return;

            const base = { schema: 'public', table: listener.table, old: {} };
            if (fresh.length > 0 && (listener.event === '*' || listener.event === 'INSERT')) {
              fresh.forEach((row) => listener.callback({ ...base, eventType: 'INSERT', new: row }));
            } else if (listener.event === '*' || listener.event === 'UPDATE' || listener.event === 'DELETE') {
              listener.callback({ ...base, eventType: listener.event === '*' ? 'UPDATE' : listener.event, new: {} });
            }
          });
          if (payload.now) this.since = payload.now;
        }
      }
    } catch (error) {
      // Network hiccup: try again on the next tick.
    }
    if (this.active) {
      const delay = typeof document !== 'undefined' && document.hidden ? CHANGE_INTERVAL * 3 : CHANGE_INTERVAL;
      this.changeTimer = setTimeout(() => this.pollChanges(), delay);
    }
  }

  private emitPresence(next: Record<string, any>) {
    const previous = this.lastPresence;
    this.lastPresence = next;
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    if (!changed) return;

    for (const listener of this.presence) {
      if (listener.event === 'sync') {
        listener.callback({});
      } else if (listener.event === 'join') {
        Object.keys(next).forEach((key) => {
          if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
            listener.callback({ key, newPresences: [next[key]], currentPresences: [] });
          }
        });
      } else if (listener.event === 'leave') {
        Object.keys(previous).forEach((key) => {
          if (!(key in next)) listener.callback({ key, leftPresences: [previous[key]], currentPresences: [] });
        });
      }
    }
  }

  private async sendPresence(leave = false) {
    const body: any = { channel: this.topic, key: this.presenceKey };
    if (leave) body.leave = true;
    else if (this.myState) body.state = this.myState;
    const { ok, payload } = await post('/realtime/presence', body);
    if (ok && payload?.state && !leave) this.emitPresence(payload.state);
  }

  private async pollPresence() {
    if (!this.active) return;
    try {
      if (readSession()) await this.sendPresence();
    } catch (error) {
      // try again on the next tick
    }
    if (this.active) {
      const delay = typeof document !== 'undefined' && document.hidden ? PRESENCE_INTERVAL * 3 : PRESENCE_INTERVAL;
      this.presenceTimer = setTimeout(() => this.pollPresence(), delay);
    }
  }

  async track(state: any) {
    this.myState = state;
    if (this.active && readSession()) {
      try {
        await this.sendPresence();
      } catch (error) {
        // the next poll will send it
      }
    }
    return 'ok';
  }

  async untrack() {
    this.myState = null;
    if (readSession()) await this.sendPresence(true).catch(() => undefined);
    return 'ok';
  }

  presenceState(): Record<string, any[]> {
    const out: Record<string, any[]> = {};
    Object.entries(this.lastPresence).forEach(([key, state]) => {
      out[key] = [state];
    });
    return out;
  }

  async send() {
    return 'ok';
  }

  async unsubscribe() {
    const wasActive = this.active;
    this.active = false;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (wasActive && this.myState && readSession()) {
      this.sendPresence(true).catch(() => undefined);
    }
    return 'ok';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function currentUser() {
  const session = readSession();
  return session?.user || null;
}

export const supabase: any = {
  from(table: string) {
    return new QueryBuilder(table);
  },

  async rpc(fn: string, args?: Record<string, any>): Promise<Result> {
    const { ok, status, payload } = await post('/data/rpc', { fn, args: args || {} });
    if (!ok) return { data: null, error: toError(payload, status, 'Request failed'), status };
    return { data: payload?.data ?? null, error: null, status };
  },

  functions: {
    async invoke(name: string, options?: { body?: any }): Promise<Result> {
      const { ok, status, payload } = await post(`/functions/${encodeURIComponent(name)}`, options?.body ?? {});
      if (!ok) {
        const error: any = new Error(toError(payload, status, 'Request failed').message);
        error.status = status;
        error.context = payload;
        return { data: null, error, status };
      }
      return { data: payload, error: null, status };
    },
  },

  storage: {
    from: storageBucket,
  },

  channel(name: string, options?: any) {
    return new Channel(name, options);
  },

  removeChannel(channel: Channel) {
    channel?.unsubscribe?.();
    return Promise.resolve('ok');
  },

  auth: {
    async getUser() {
      return { data: { user: currentUser() }, error: null };
    },
    async getSession() {
      return { data: { session: readSession() }, error: null };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signOut() {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch {
        // ignore
      }
      return { error: null };
    },
  },
};
