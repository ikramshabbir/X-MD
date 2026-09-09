/**
 * X-MD / X-ANSARI
 * WhatsApp Socket Connection
 */

import makeWASocket, {
  fetchLatestWaWebVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
} from "baileys";

import { useMongoAuthState } from "../database/mongoAuth.js";
import { serialize } from "../utils/serialize.js";
import { messageHandler } from "../handler.js";
import { setConnection } from "../utils/connection.js";
import { startReminderScheduler } from "../plugins/reminder.js";
import { handleGroupParticipantsUpdate } from "../plugins/group-events.js";
import { handleGroupGuard } from "../plugins/group-guards.js";
import { msgCache } from "../utils/cache.js";
import { handleDeletedMessage } from "../plugins/vv-antidelete.js";

/**
 * Active connections
 */
const connections = new Map();

/**
 * Cache incoming messages before serialize.
 *
 * IMPORTANT:
 * AntiDelete needs the original raw WAMessage,
 * so cache it before any processing changes it.
 */
function cacheIncomingMessage(rawMessage, sessionId) {
  try {
    if (!rawMessage?.key?.remoteJid || !rawMessage?.key?.id) {
      return;
    }

    const cacheKey = `${rawMessage.key.remoteJid}:${rawMessage.key.id}`;

    msgCache.set(cacheKey, {
      ...rawMessage,
      __sessionId: sessionId,
      __cachedAt: Date.now(),
    });
  } catch (error) {
    console.log(
      `⚠️ Message cache error [${sessionId}]:`,
      error?.message || error
    );
  }
}

/**
 * Handle AntiDelete update safely
 */
async function processAntiDeleteUpdate(conn, update, sessionId) {
  try {
    await handleDeletedMessage(conn, update, sessionId);
  } catch (error) {
    console.log(
      `⚠️ AntiDelete update error [${sessionId}]:`,
      error?.stack || error?.message || error
    );
  }
}

/**
 * Create WhatsApp connection
 */
export async function connectToWhatsApp(sessionId = "default") {
  try {
    console.log(`🔄 Starting WhatsApp connection [${sessionId}]...`);

    const { state, saveCreds } = await useMongoAuthState(sessionId);

    let version;

    try {
      const latest = await fetchLatestWaWebVersion();

      if (latest?.version) {
        version = latest.version;
        console.log(
          `📱 WhatsApp Web version [${sessionId}]: ${version.join(".")}`
        );
      }
    } catch (error) {
      console.log(
        `⚠️ Could not fetch latest WhatsApp version [${sessionId}]:`,
        error?.message || error
      );
    }

    const conn = makeWASocket({
      ...(version ? { version } : {}),

      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          console
        ),
      },

      browser: Browsers.ubuntu("Chrome"),

      printQRInTerminal: false,

      generateHighQualityLinkPreview: true,

      syncFullHistory: false,

      markOnlineOnConnect: false,

      connectTimeoutMs: 60_000,

      defaultQueryTimeoutMs: 60_000,

      keepAliveIntervalMs: 25_000,

      retryRequestDelayMs: 2_000,

      getMessage: async (key) => {
        try {
          if (!key?.remoteJid || !key?.id) {
            return undefined;
          }

          const cacheKey = `${key.remoteJid}:${key.id}`;
          const cached = msgCache.get(cacheKey);

          if (cached?.message) {
            return cached;
          }

          return undefined;
        } catch {
          return undefined;
        }
      },
    });

    /**
     * Save credentials
     */
    conn.ev.on("creds.update", async () => {
      try {
        await saveCreds();
      } catch (error) {
        console.log(
          `⚠️ Save creds error [${sessionId}]:`,
          error?.message || error
        );
      }
    });

    /**
     * Store connection
     */
    connections.set(sessionId, conn);

    try {
      setConnection(conn, sessionId);
    } catch (error) {
      console.log(
        `⚠️ setConnection error [${sessionId}]:`,
        error?.message || error
      );
    }

    /**
     * Connection updates
     */
    conn.ev.on("connection.update", async (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`📲 QR generated [${sessionId}]`);
        }

        if (connection === "connecting") {
          console.log(`🔄 Connecting WhatsApp [${sessionId}]...`);
        }

        if (connection === "open") {
          console.log(`✅ WhatsApp connected [${sessionId}]`);

          try {
            startReminderScheduler(conn);
          } catch (error) {
            console.log(
              `⚠️ Reminder scheduler error [${sessionId}]:`,
              error?.message || error
            );
          }
        }

        if (connection === "close") {
          connections.delete(sessionId);

          const statusCode =
            lastDisconnect?.error?.output?.statusCode;

          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut;

          console.log(
            `❌ WhatsApp disconnected [${sessionId}]`,
            `status=${statusCode}`,
            `reconnect=${shouldReconnect}`
          );

          if (shouldReconnect) {
            setTimeout(() => {
              connectToWhatsApp(sessionId).catch((error) => {
                console.log(
                  `❌ Reconnect failed [${sessionId}]:`,
                  error?.message || error
                );
              });
            }, 3000);
          } else {
            console.log(
              `🚪 Session logged out [${sessionId}]`
            );
          }
        }
      } catch (error) {
        console.log(
          `⚠️ connection.update error [${sessionId}]:`,
          error?.stack || error?.message || error
        );
      }
    });

    /**
     * =========================================================
     * INCOMING MESSAGES
     * =========================================================
     */
    conn.ev.on("messages.upsert", async (event) => {
      try {
        const messages = Array.isArray(event?.messages)
          ? event.messages
          : [];

        for (const rawMessage of messages) {
          try {
            /**
             * Cache ORIGINAL raw message first.
             *
             * This is required by AntiDelete.
             */
            cacheIncomingMessage(rawMessage, sessionId);

            /**
             * Ignore status broadcasts
             */
            if (
              rawMessage?.key?.remoteJid ===
              "status@broadcast"
            ) {
              continue;
            }

            /**
             * Serialize message
             */
            const message = await serialize(
              conn,
              rawMessage,
              sessionId
            );

            if (!message) {
              continue;
            }

            /**
             * Group participant / guard handling
             */
            try {
              await handleGroupGuard(conn, message);
            } catch (error) {
              console.log(
                `⚠️ Group guard error [${sessionId}]:`,
                error?.message || error
              );
            }

            /**
             * Main command/message handler
             */
            try {
              await messageHandler(conn, message);
            } catch (error) {
              console.log(
                `⚠️ Message handler error [${sessionId}]:`,
                error?.stack || error?.message || error
              );
            }
          } catch (error) {
            console.log(
              `⚠️ Message processing error [${sessionId}]:`,
              error?.stack || error?.message || error
            );
          }
        }
      } catch (error) {
        console.log(
          `⚠️ messages.upsert error [${sessionId}]:`,
          error?.stack || error?.message || error
        );
      }
    });

    /**
     * =========================================================
     * ANTIDELETE — Baileys normalized revoke events
     * =========================================================
     *
     * In newer Baileys versions a deleted message may arrive as:
     *
     * update.update.messageStubType === "REVOKE"
     *
     * instead of a raw protocolMessage.
     */
    conn.ev.on("messages.update", async (updates) => {
      try {
        if (!Array.isArray(updates)) {
          return;
        }

        for (const update of updates) {
          await processAntiDeleteUpdate(
            conn,
            update,
            sessionId
          );
        }
      } catch (error) {
        console.log(
          `⚠️ messages.update error [${sessionId}]:`,
          error?.stack || error?.message || error
        );
      }
    });

    /**
     * =========================================================
     * ANTIDELETE — messages.delete fallback
     * =========================================================
     *
     * Some Baileys versions may emit deleted message keys here.
     */
    conn.ev.on("messages.delete", async (event) => {
      try {
        const keys = Array.isArray(event?.keys)
          ? event.keys
          : [];

        if (!keys.length) {
          return;
        }

        for (const key of keys) {
          if (!key?.remoteJid || !key?.id) {
            continue;
          }

          await processAntiDeleteUpdate(
            conn,
            {
              key,
              update: {
                messageStubType: "REVOKE",
                key,
              },
            },
            sessionId
          );
        }
      } catch (error) {
        console.log(
          `⚠️ messages.delete error [${sessionId}]:`,
          error?.stack || error?.message || error
        );
      }
    });

    /**
     * =========================================================
     * GROUP PARTICIPANT EVENTS
     * =========================================================
     */
    conn.ev.on(
      "group-participants.update",
      async (event) => {
        try {
          await handleGroupParticipantsUpdate(
            conn,
            event
          );
        } catch (error) {
          console.log(
            `⚠️ Group participant event error [${sessionId}]:`,
            error?.stack || error?.message || error
          );
        }
      }
    );

    /**
     * =========================================================
     * STORE CONNECTION REFERENCE
     * =========================================================
     */
    connections.set(sessionId, conn);

    console.log(
      `🚀 WhatsApp socket ready [${sessionId}]`
    );

    return conn;
  } catch (error) {
    console.log(
      `❌ WhatsApp connection failed [${sessionId}]:`,
      error?.stack || error?.message || error
    );

    connections.delete(sessionId);

    throw error;
  }
}

/**
 * Get active connection
 */
export function getConnection(sessionId = "default") {
  return connections.get(sessionId) || null;
}

/**
 * Get all active connections
 */
export function getConnections() {
  return connections;
}

/**
 * Remove connection
 */
export function removeConnection(sessionId = "default") {
  connections.delete(sessionId);
}

/**
 * Check connection
 */
export function isConnected(sessionId = "default") {
  const conn = connections.get(sessionId);

  return Boolean(
    conn?.user?.id
  );
}
