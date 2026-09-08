title="authState.js replacement"

/**
 * Auth State Factory
 * Dual backend: better-sqlite3 | Sequelize Postgres
 * Supports full auth reset for fresh WhatsApp pairing.
 */

import config from "../../config.js";
import { attachBotKv, seedBotKvFromEnv } from "./botKv.js";

let initPromise = null;
let activeBackend = null;

async function initBackend() {
  if (config.USE_POSTGRES) {
    const { createPostgresSequelize, usePostgresAuthState } = await import(
      "./authPostgres.js"
    );

    const sequelize = await createPostgresSequelize(config.DATABASE_URL);

    await sequelize.authenticate();

    activeBackend = await usePostgresAuthState(sequelize);

    console.log("✅ Auth backend: Postgres (Sequelize)");
  } else {
    const { useBetterSqliteAuthState } = await import(
      "./authSqlite.js"
    );

    activeBackend = await useBetterSqliteAuthState(
      config.SQLITE_PATH
    );

    console.log(
      `✅ Auth backend: better-sqlite3 (${config.SQLITE_PATH})`
    );
  }

  if (activeBackend?.botKv) {
    attachBotKv(activeBackend.botKv);
    await seedBotKvFromEnv();
  }

  return activeBackend;
}

export async function useMultiDbAuthState() {
  if (!initPromise) {
    initPromise = initBackend();
  }

  const backend = await initPromise;

  return {
    state: backend.state,
    saveCreds: backend.saveCreds,
  };
}

/**
 * Clear saved WhatsApp authentication.
 */
export async function clearAuthState() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }

  const backend = await initPromise;

  if (typeof backend.clearAuthState === "function") {
    await backend.clearAuthState();
    console.log("🧹 Saved WhatsApp auth state cleared.");
  }
}

/**
 * Completely destroy the cached auth backend.
 *
 * This is important because clearing the database alone
 * does not remove the old in-memory Baileys state.
 */
export async function resetMultiDbAuthState() {
  try {
    if (initPromise) {
      const backend = await initPromise;

      if (typeof backend.clearAuthState === "function") {
        await backend.clearAuthState();
      }

      if (typeof backend.close === "function") {
        try {
          await backend.close();
        } catch (err) {
          console.warn(
            "[auth] backend close warning:",
            err?.message || err
          );
        }
      }
    }
  } catch (err) {
    console.error(
      "[auth] reset error:",
      err?.message || err
    );
  } finally {
    activeBackend = null;
    initPromise = null;
  }

  console.log("🔄 Auth state completely reset.");
}

export async function checkAuthCreds() {
  if (!initPromise) {
    await useMultiDbAuthState();
  }

  await initPromise;

  const has =
    typeof activeBackend?.hasCreds === "function"
      ? await activeBackend.hasCreds()
      : false;

  return {
    valid: !!has,
    hasCreds: !!has,
  };
}

export async function validateAuthState() {
  const result = await checkAuthCreds();

  return {
    valid: result.hasCreds,
    issues: result.hasCreds
      ? []
      : ["No credentials found"],
    stats: null,
  };
}

export async function getAuthStateStats() {
  return null;
}
