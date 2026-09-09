/**
 * X-MD / X-ANSARI
 * Tiny in-memory TTL + max-size caches
 *
 * Used by:
 * - Group metadata
 * - AntiDelete message recovery
 */

export function createTtlCache({
  ttlMs = 5 * 60 * 1000,
  max = 50,
} = {}) {

  const store = new Map();


  /* =======================================================
   * REMOVE EXPIRED ITEMS
   * ===================================================== */

  function evictExpired() {

    const now = Date.now();

    for (
      const [key, entry]
      of store
    ) {

      if (
        entry.expiresAt <= now
      ) {

        store.delete(key);
      }
    }
  }


  /* =======================================================
   * REMOVE OLD ITEMS WHEN CACHE IS FULL
   * ===================================================== */

  function evictOverflow() {

    while (
      store.size > max
    ) {

      const oldest =
        store.keys()
          .next()
          .value;

      if (
        oldest === undefined
      ) {

        break;
      }

      store.delete(oldest);
    }
  }


  /* =======================================================
   * CACHE API
   * ===================================================== */

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


      /* Refresh insertion order */

      store.delete(key);

      store.set(
        key,
        entry
      );


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
            Date.now() +
            ttlMs,
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

      return (
        this.get(key) !==
        undefined
      );
    },


    get size() {

      return store.size;
    },
  };
}


/* =========================================================
 * GROUP METADATA CACHE
 *
 * 3 minutes
 * Maximum 50 groups
 * ======================================================= */

export const groupCache =
  createTtlCache({

    ttlMs:
      3 * 60 * 1000,

    max:
      50,
  });


/* =========================================================
 * WHATSAPP MESSAGE CACHE
 *
 * AntiDelete:
 * - 15 minutes retention
 * - Maximum 500 messages
 *
 * IMPORTANT:
 * This is memory based.
 * Bot restart clears cached messages.
 * ======================================================= */

export const msgCache =
  createTtlCache({

    ttlMs:
      15 * 60 * 1000,

    max:
      500,
  });
