import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// --- Offline LocalStorage Mock Implementation ---
class MockAuth {
  private listeners: Array<(event: string, session: any) => void> = [];
  private currentUser: any = null;

  constructor() {
    const savedUser = localStorage.getItem('ysedrop_mock_user');
    if (savedUser) {
      this.currentUser = JSON.parse(savedUser);
    } else {
      // Create a default demo user so they can use the app offline instantly
      this.currentUser = {
        id: 'mock-user-123',
        email: 'demo@ysedrop.local',
        user_metadata: {
          display_name: 'Demo User',
          photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop'
        }
      };
      localStorage.setItem('ysedrop_mock_user', JSON.stringify(this.currentUser));
    }
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this.listeners.push(callback);
    // Fire initial state
    setTimeout(() => {
      callback('SIGNED_IN', this.currentUser ? { user: this.currentUser } : null);
    }, 50);

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners = this.listeners.filter(l => l !== callback);
          }
        }
      }
    };
  }

  async getSession() {
    return {
      data: {
        session: this.currentUser ? { user: this.currentUser } : null
      },
      error: null
    };
  }

  async signInWithOAuth(params: any) {
    // Check if there is a custom profile saved, otherwise use a default
    const customName = localStorage.getItem('ysedrop_custom_mock_name') || 'Demo User';
    const customEmail = localStorage.getItem('ysedrop_custom_mock_email') || 'demo@ysedrop.local';
    const customAvatar = localStorage.getItem('ysedrop_custom_mock_avatar') || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';

    // Generate simple mock session
    this.currentUser = {
      id: localStorage.getItem('ysedrop_mock_user_id') || 'mock-user-' + Math.random().toString(36).substring(2, 10),
      email: customEmail,
      user_metadata: {
        display_name: customName,
        photo_url: customAvatar
      }
    };
    localStorage.setItem('ysedrop_mock_user', JSON.stringify(this.currentUser));
    this.listeners.forEach(l => l('SIGNED_IN', { user: this.currentUser }));
    return { data: { user: this.currentUser }, error: null };
  }

  async signOut() {
    this.currentUser = null;
    localStorage.removeItem('ysedrop_mock_user');
    this.listeners.forEach(l => l('SIGNED_OUT', null));
    return { error: null };
  }

  async getUser() {
    return { data: { user: this.currentUser }, error: null };
  }
}

class MockQueryBuilder {
  private table: string;
  private filters: Array<[string, string, any]> = [];
  private orFilter: string | null = null;

  constructor(table: string) {
    this.table = table;
  }

  private getData(): any[] {
    const key = `ysedrop_mock_db_${this.table}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  }

  private saveData(data: any[]) {
    const key = `ysedrop_mock_db_${this.table}`;
    localStorage.setItem(key, JSON.stringify(data));
    // Trigger window storage event or custom event for realtime replication
    window.dispatchEvent(new CustomEvent(`mock_db_update_${this.table}`));
  }

  select(columns?: string) {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push([column, 'eq', value]);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push([column, 'in', values]);
    return this;
  }

  or(filterStr: string) {
    this.orFilter = filterStr;
    return this;
  }

  order(column: string, params?: { ascending?: boolean }) {
    // Basic sorting can be applied at rendering or execution time
    return this;
  }

  limit(count: number) {
    return this;
  }

  async insert(values: any | any[]) {
    const items = Array.isArray(values) ? values : [values];
    const database = this.getData();

    const formatted = items.map(item => ({
      ...item,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: item.updated_at || new Date().toISOString()
    }));

    database.push(...formatted);
    this.saveData(database);
    return { data: formatted, error: null };
  }

  async upsert(values: any | any[]) {
    const items = Array.isArray(values) ? values : [values];
    let database = this.getData();

    const updatedItems = items.map(item => {
      const idx = database.findIndex(dbItem => dbItem.id === item.id);
      const formatted = {
        ...item,
        created_at: item.created_at || (idx !== -1 ? database[idx].created_at : new Date().toISOString()),
        updated_at: new Date().toISOString()
      };

      if (idx !== -1) {
        database[idx] = { ...database[idx], ...formatted };
      } else {
        database.push(formatted);
      }
      return formatted;
    });

    this.saveData(database);
    return { data: updatedItems, error: null };
  }

  async update(values: any) {
    let database = this.getData();

    const updated = database.map(item => {
      // Check filters
      let matches = true;
      for (const [col, op, val] of this.filters) {
        if (op === 'eq' && item[col] !== val) {
          matches = false;
        }
      }
      if (matches) {
        return {
          ...item,
          ...values,
          updated_at: new Date().toISOString()
        };
      }
      return item;
    });

    this.saveData(updated);
    return { data: updated, error: null };
  }

  // Promise resolution executor so it can be awaited directly
  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    const database = this.getData();
    let filtered = database;

    if (this.orFilter) {
      // If doing a combined lookup in mock mode, match all mock devices to make local testing simple
      filtered = database;
    } else {
      for (const [col, op, val] of this.filters) {
        if (op === 'eq') {
          filtered = filtered.filter(item => item[col] === val);
        } else if (op === 'in') {
          const list = Array.isArray(val) ? val : [];
          filtered = filtered.filter(item => list.includes(item[col]));
        }
      }
    }

    const response = { data: filtered, error: null };
    return Promise.resolve(response).then(onfulfilled, onrejected);
  }
}

class MockRealtimeChannel {
  private table: string;
  private callback: (payload: any) => void = () => { };
  private eventListener: () => void;

  constructor(table: string) {
    this.table = table;
    this.eventListener = () => {
      // Fetch fresh items and callback
      const key = `ysedrop_mock_db_${this.table}`;
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      this.callback({
        new: data,
        eventType: 'UPDATE',
        schema: 'public',
        table: this.table
      });
    };
  }

  on(type: string, filter: any, callback: (payload: any) => void) {
    this.callback = callback;
    window.addEventListener(`mock_db_update_${this.table}`, this.eventListener);
    return this;
  }

  subscribe(callback?: (status: string) => void) {
    if (callback) {
      setTimeout(() => callback('SUBSCRIBED'), 50);
    }
    return this;
  }

  unsubscribe() {
    window.removeEventListener(`mock_db_update_${this.table}`, this.eventListener);
  }
}

class MockSupabaseClient {
  auth = new MockAuth();

  from(table: string) {
    return new MockQueryBuilder(table);
  }

  channel(name: string) {
    const table = name.split('-').pop() || name;
    return new MockRealtimeChannel(table);
  }

  removeChannel(channel: any) {
    if (channel && typeof channel.unsubscribe === 'function') {
      channel.unsubscribe();
    }
  }
}

// Export either real client or fully compatible mock client
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (new MockSupabaseClient() as any);