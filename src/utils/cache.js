 /**
  * X-MD / X-ANSARI
  * Tiny in-memory TTL + max-size caches
  *
  * Used for:
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

    const now =
      Date.now();

    for (
      const [key, entry]
      of store
    ) {

      if (
        entry.expiresAt <= now
      ) {

        store.delete(
          key
        );
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

      store.delete(
        oldest
      );
    }
  }


  /* =======================================================
   * CACHE API
   * ===================================================== */

  return {

    /* -----------------------------------------------------
     * GET
     * --------------------------------------------------- */

    get(key) {

      const entry =
        store.get(
          key
        );

      if (!entry) {

        return undefined;
      }


      /* Expired */

      if (
        entry.expiresAt <=
        Date.now()
      ) {

        store.delete(
          key
        );

        return undefined;
      }


      /**
       * Refresh insertion order.
       *
       * This keeps recently used
       * messages near the end.
       */

      store.delete(
        key
      );

      store.set(
        key,
        entry
      );


      return entry.value;
    },


    /* -----------------------------------------------------
     * SET
     * --------------------------------------------------- */

    set(
      key,
      value
    ) {

      /* Remove expired entries first */

      evictExpired();


      /* Replace existing key */

      store.delete(
        key
      );


      /* Store new value */

      store.set(
        key,
        {
          value,

          expiresAt:
            Date.now() +
            ttlMs,
        }
      );


      /* Keep cache under maximum size */

      evictOverflow();
    },


    /* -----------------------------------------------------
     * DELETE
     * --------------------------------------------------- */

    delete(key) {

      store.delete(
        key
      );
    },


    /* -----------------------------------------------------
     * CLEAR
     * --------------------------------------------------- */

    clear() {

      store.clear();
    },


    /* -----------------------------------------------------
     * HAS
     * --------------------------------------------------- */

    has(key) {

      return (
        this.get(key) !==
        undefined
      );
    },


    /* -----------------------------------------------------
     * SIZE
     * --------------------------------------------------- */

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
 * Used by AntiDelete.
 *
 * Messages remain available for:
 * 15 minutes
 *
 * Maximum:
 * 500 messages
 *
 * IMPORTANT:
 * This is an in-memory cache.
 * Restarting the bot clears it.
 * ======================================================= */

export const msgCache =
  createTtlCache({

    ttlMs:
      15 * 60 * 1000,

    max:
      500,
  });
