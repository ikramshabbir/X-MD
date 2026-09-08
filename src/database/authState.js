/**
 * X-MD Multi-Session Auth State
 *
 * Supports multiple independent WhatsApp sessions.
 * Default session remains "default" for backward compatibility.
 *
 * IMPORTANT:
 * authSqlite.js must receive a different DB path for each session.
 * connection.js will later use:
 *
 *   useMultiDbAuthState("session-1")
 *   useMultiDbAuthState("session-2")
 *   ...
 *
 * Each session gets its own Baileys auth state.
 */

import path from "path";
import fs from "fs/promises";

import config from "../../config.js";
import { attachBotKv, seedBotKvFromEnv } from "./botKv.js";

/*
 * Maximum number of WhatsApp accounts.
 */
export const MAX_SESSIONS = 20;

/*
 * sessionId -> initialization promise
 */
const sessionPromises = new Map();

/*
 * sessionId -> active backend
 */
const activeBackends = new Map();

/*
 * Keep the old single-session API compatible.
 */
const DEFAULT_SESSION_ID = "default";

function normalizeSessionId(sessionId = DEFAULT_SESSION_ID) {
  const value = String(sessionId || DEFAULT_SESSION_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!value) {
    return DEFAULT_SESSION_ID;
  }

  return value.slice(0, 80);
}

function getSessionDbPath(sessionId) {
  const normalized = normalizeSessionId(sessionId);

  /*
   * Postgres needs a proper per-session database/schema strategy.
   * That will be handled in the Postgres-specific implementation.
   */
  if (config.USE_POSTGRES) {
    return null;
  }

  const originalPath = config.SQLITE_PATH;

  /*
   * Example:
   * data/auth.db
   *
   * becomes:
   * data/sessions/session-1.db
   * data/sessions/session-2.db
   */
  const parsed = path.parse(originalPath);

  return path.join(
    parsed.dir || ".",
    "sessions",
    `${normalized}.db`
  );
}

async function ensureSessionDirectory(sessionId) {
  const dbPath = getSessionDbPath(sessionId);

  if (!dbPath) {
    return;
  }

  const directory = path.dirname(dbPath);

  await fs.mkdir(directory, {
    recursive: true,
  });
}

async function initBackend(sessionId = DEFAULT_SESSION_ID) {
  const normalized = normalizeSessionId(sessionId);

  /*
   * Prevent accidentally creating more than 20 accounts.
   */
  if (
    !activeBackends.has(normalized) &&
    activeBackends.size >= MAX_SESSIONS
  ) {
    throw new Error(
      `Maximum ${MAX_SESSIONS} WhatsApp sessions are allowed`
    );
  }

  if (config.USE_POSTGRES) {
    /*
     * Temporary compatibility path.
     *
     * The existing authPostgres.js is single-session.
     * It must be upgraded separately before Postgres can safely
     * run 20 independent WhatsApp accounts.
     */
    const {
      createPostgresSequelize,
      usePostgresAuthState,
    } = await import("./authPostgres.js");

    const sequelize =
      await createPostgresSequelize(
        config.DATABASE_URL
      );

    await sequelize.authenticate();

    activeBackends.set(
      normalized,
      await usePostgresAuthState(
        sequelize
      )
    );

    console.log(
      `✅ Auth backend: Postgres (${normalized})`
    );
  } else {
    await ensureSessionDirectory(normalized);

    const {
      useBetterSqliteAuthState,
    } = await import("./authSqlite.js");

    const dbPath =
      getSessionDbPath(normalized);

    const backend =
      await useBetterSqliteAuthState(
        dbPath
      );

    activeBackends.set(
      normalized,
      backend
    );

    console.log(
      `✅ Auth backend: SQLite (${normalized})`
    );
    console.log(
      `   DB: ${dbPath}`
    );
  }

  const backend =
    activeBackends.get(normalized);

  /*
   * BotKV is global application data.
   * Attach it only for the default session so that
   * existing bot settings are not duplicated.
   */
  if (
    normalized === DEFAULT_SESSION_ID &&
    backend?.botKv
  ) {
    attachBotKv(backend.botKv);
    await seedBotKvFromEnv();
  }

  return backend;
}

/**
 * Get/create auth state for a specific WhatsApp session.
 *
 * Example:
 *   await useMultiDbAuthState("session-1");
 */
export async function useMultiDbAuthState(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    normalizeSessionId(sessionId);

  if (!sessionPromises.has(normalized)) {
    const promise =
      initBackend(normalized);

    sessionPromises.set(
      normalized,
      promise
    );
  }

  try {
    const backend =
      await sessionPromises.get(
        normalized
      );

    return {
      sessionId: normalized,
      state: backend.state,
      saveCreds: backend.saveCreds,
    };
  } catch (error) {
    /*
     * Remove failed initialization so the next
     * request can retry cleanly.
     */
    sessionPromises.delete(normalized);
    activeBackends.delete(normalized);

    throw error;
  }
}

/**
 * Check whether a session has saved WhatsApp credentials.
 */
export async function checkAuthCreds(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    normalizeSessionId(sessionId);

  await useMultiDbAuthState(
    normalized
  );

  const backend =
    activeBackends.get(normalized);

  const has =
    typeof backend?.hasCreds === "function"
      ? await backend.hasCreds()
      : false;

  return {
    sessionId: normalized,
    valid: !!has,
    hasCreds: !!has,
  };
}

/**
 * Clear saved WhatsApp authentication
 * for ONE session only.
 */
export async function clearAuthState(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    normalizeSessionId(sessionId);

  await useMultiDbAuthState(
    normalized
  );

  const backend =
    activeBackends.get(normalized);

  if (
    typeof backend?.clearAuthState ===
    "function"
  ) {
    await backend.clearAuthState();

    console.log(
      `🧹 WhatsApp auth cleared: ${normalized}`
    );
  }
}

/**
 * Completely reset ONE WhatsApp session.
 *
 * This removes:
 * - saved auth
 * - backend
 * - cached initialization
 */
export async function resetMultiDbAuthState(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    normalizeSessionId(sessionId);

  try {
    if (
      !sessionPromises.has(normalized)
    ) {
      /*
       * Nothing initialized yet.
       */
      return;
    }

    const backend =
      await sessionPromises.get(
        normalized
      );

    if (
      typeof backend?.clearAuthState ===
      "function"
    ) {
      await backend.clearAuthState();
    }

    if (
      typeof backend?.close ===
      "function"
    ) {
      try {
        await backend.close();
      } catch (err) {
        console.warn(
          `[auth:${normalized}] close warning:`,
          err?.message || err
        );
      }
    }
  } catch (err) {
    console.error(
      `[auth:${normalized}] reset error:`,
      err?.message || err
    );
  } finally {
    activeBackends.delete(
      normalized
    );

    sessionPromises.delete(
      normalized
    );
  }

  console.log(
    `🔄 Auth session completely reset: ${normalized}`
  );
}

/**
 * Reset ALL WhatsApp sessions.
 *
 * Useful when the whole installation needs
 * to be cleaned.
 */
export async function resetAllAuthStates() {
  const sessions = Array.from(
    new Set([
      ...sessionPromises.keys(),
      ...activeBackends.keys(),
    ])
  );

  for (const sessionId of sessions) {
    await resetMultiDbAuthState(
      sessionId
    );
  }

  console.log(
    "🔄 All WhatsApp auth sessions reset."
  );
}

/**
 * Validate one session.
 */
export async function validateAuthState(
  sessionId = DEFAULT_SESSION_ID
) {
  const result =
    await checkAuthCreds(
      sessionId
    );

  return {
    valid: result.hasCreds,
    issues: result.hasCreds
      ? []
      : ["No credentials found"],
    stats: null,
  };
}

/**
 * Get basic statistics for one session.
 */
export async function getAuthStateStats(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    normalizeSessionId(sessionId);

  const backend =
    activeBackends.get(normalized);

  return {
    sessionId: normalized,
    active: !!backend,
    hasCreds:
      typeof backend?.hasCreds ===
      "function"
        ? !!(await backend.hasCreds())
        : false,
  };
}

/**
 * List currently initialized sessions.
 */
export function getAuthSessions() {
  return Array.from(
    activeBackends.keys()
  );
}

/**
 * Check whether a session exists in memory.
 */
export function hasAuthSession(
  sessionId
) {
  return activeBackends.has(
    normalizeSessionId(sessionId)
  );
}

/**
 * Get the backend for internal use.
 */
export function getAuthBackend(
  sessionId = DEFAULT_SESSION_ID
) {
  return activeBackends.get(
    normalizeSessionId(sessionId)
  );
}
