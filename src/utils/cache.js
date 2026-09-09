/**
 * Tiny in-memory TTL + max-size caches
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
      const oldest =
        store.keys().next().value;

      store.delete(oldest);
    }
  }

  return {
    get(key) {
      const entry =
        store.get(key);

      if (!entry) {
        return undefined;
      }

      if (
        entry.expiresAt <=
        Date.now()
      ) {
        store.delete(key);
        return undefined;
      }

      /**
       * Refresh insertion order
       */
      store.delete(key);
      store.set(key, entry);

      return entry.value;
    },

    set(key, value) {
      evictExpired();

      store.delete(key);

      store.set(
        key,
        {
          value,
          expiresAt:
            Date.now() + ttlMs,
        }
      );

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


/**
 * Group metadata cache
 */
export const groupCache =
  createTtlCache({
    ttlMs:
      3 * 60 * 1000,

    max: 50,
  });


/**
 * WhatsApp message cache.
 *
 * 15 minutes is useful for
 * anti-delete.
 *
 * Maximum 500 messages per
 * running bot process.
 */
export const msgCache =
  createTtlCache({
    ttlMs:
      15 * 60 * 1000,

    max: 500,
  });
