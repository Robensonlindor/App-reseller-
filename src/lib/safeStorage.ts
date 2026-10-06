const memoryStorage = new Map<string, string>();

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch {
      // Fallback to in-memory storage when iframe or browser blocks localStorage
    }
    return memoryStorage.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    memoryStorage.set(key, value);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Ignore storage quota or iframe security errors
    }
  },

  removeItem(key: string): void {
    memoryStorage.delete(key);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore iframe security errors
    }
  }
};
