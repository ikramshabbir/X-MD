/**
 * X-MD / X-ANSARI
 * TTL + max-size caches
 *
 * Session-aware message cache for AntiDelete.
 */

export function createTtlCache({
  ttlMs = 5 * 60 * 1000,
  max = 50,
} = {}) {
  const store = new Map();

  function evictExpired() {
    const now = Date.now();

    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  function evictOverflow() {
    while (store.size > max) {
      const oldest = store.keys().next().value;

      if (oldest === undefined) break;

      store.delete(oldest);
    }
  }

  return {
    get(key) {
      const entry = store.get(key);

      if (!entry) return undefined;

      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }

      // Refresh LRU position
      store.delete(key);
      store.set(key, entry);

      return entry.value;
    },

    set(key, value) {
      evictExpired();

      store.delete(key);

      store.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });

      evictOverflow();
    },

    delete(key) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },

    has(key) {
      return this.get(key) !== undefined;
    },

    get size() {
      return store.size;
    },
  };
}

/* =========================================================
 * GROUP CACHE
 * ======================================================= */

export const groupCache = createTtlCache({
  ttlMs: 3 * 60 * 1000,
  max: 50,
});

/* =========================================================
 * MESSAGE CACHE
 * ======================================================= */

export const msgCache = createTtlCache({
  ttlMs: 30 * 60 * 1000,
  max: 1000,
});

/* =========================================================
 * ANTI-DELETE CACHE KEY
 * ======================================================= */

export function makeMessageCacheKey(
  sessionId,
  remoteJid,
  messageId
) {
  if (!remoteJid || !messageId) {
    return null;
  }

  return [
    String(sessionId || "default"),
    String(remoteJid),
    String(messageId),
  ].join(":");
}
