/**
 * WhatsApp socket connection — Baileys 7.0.0-rc13
 * Portal-only pairing code login.
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

import {
  useMultiDbAuthState,
  resetMultiDbAuthState,
} from "../database/authState.js";

import { serialize } from "../messages/serialize.js";
import { messageHandler } from "../messages/handler.js";
import { setConnection } from "../terminal/handler.js";

import { groupCache, msgCache } from "../utils/cache.js";

import {
  startReminderScheduler,
  stopReminderScheduler,
} from "../utils/reminders.js";

import { attachGroupParticipantEvents } from "../events/groupParticipants.js";
import { processGroupGuards } from "../messages/groupGuards.js";

const logger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
});

let globalConnection = null;
let reconnectAttempt = 0;
let isConnecting = false;
let cachedVersion = null;

let latestPairingCode = null;
let latestPairingNumber = null;
let portalPairingInProgress = false;

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

function backoffDelay(attempt) {
  const exp = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** attempt
  );

  return exp + Math.floor(Math.random() * 500);
}

async function getVersion() {
  if (cachedVersion) return cachedVersion;

  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch {
    cachedVersion = undefined;
  }

  return cachedVersion;
}

function cleanupSocket(conn) {
  if (!conn) return;

  try {
    conn.ev?.removeAllListeners?.();
  } catch {}

  try {
    conn.ws?.close?.();
  } catch {}

  try {
    conn.end?.(undefined);
  } catch {}
}

/**
 * Information used by the web portal.
 */
export function getPairingInfo() {
  return {
    code: latestPairingCode,
    number: latestPairingNumber,
    connected: !!globalConnection?.user,
  };
}

/**
 * Wait until socket starts connecting.
 */
async function waitForSocketReady(conn, timeout = 15000) {
  if (!conn) {
    throw new Error("WhatsApp socket is not available");
  }

  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (error = null) => {
      if (finished) return;

      finished = true;

      clearTimeout(timer);

      try {
        conn.ev?.off?.("connection.update", onUpdate);
      } catch {}

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const onUpdate = (update) => {
      if (
        update?.connection === "connecting" ||
        update?.qr
      ) {
        finish();
        return;
      }

      if (update?.connection === "close") {
        finish(
          new Error(
            "WhatsApp socket closed before pairing code request"
          )
        );
      }
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          "WhatsApp socket did not become ready in time"
        )
      );
    }, timeout);

    try {
      conn.ev.on("connection.update", onUpdate);
    } catch {
      finish(
        new Error("Unable to monitor WhatsApp socket")
      );
    }
  });
}

/**
 * Request a fresh pairing code from portal.
 */
export async function requestPortalPairing(number) {
  const cleanNumber = String(number || "").replace(
    /\D/g,
    ""
  );

  if (!cleanNumber) {
    throw new Error("Invalid WhatsApp number");
  }

  if (portalPairingInProgress) {
    throw new Error(
      "A pairing code request is already in progress"
    );
  }

  portalPairingInProgress = true;

  try {
    let conn = globalConnection;

    for (let i = 0; i < 30 && !conn; i++) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );

      conn = globalConnection;
    }

    if (!conn) {
      throw new Error(
        "WhatsApp socket is not ready yet"
      );
    }

    if (conn.user) {
      throw new Error(
        "WhatsApp is already connected"
      );
    }

    await waitForSocketReady(conn);

    const code =
      await conn.requestPairingCode(
        cleanNumber
      );

    latestPairingCode = code;
    latestPairingNumber = cleanNumber;

    console.log(
      "\n🔗 Portal pairing code:"
    );

    console.log(`   ${code}`);
    console.log(
      `   Number: ${cleanNumber}\n`
    );

    return code;
  } catch (error) {
    latestPairingCode = null;
    latestPairingNumber = null;

    throw error;
  } finally {
    portalPairingInProgress = false;
  }
}

async function connect() {
  if (isConnecting) {
    return globalConnection;
  }

  isConnecting = true;

  let conn = null;

  try {
    const {
      state,
      saveCreds,
    } = await useMultiDbAuthState();

    const version = await getVersion();

    const socketOptions = {
      logger,

      auth: {
        creds: state.creds,

        keys: makeCacheableSignalKeyStore(
          state.keys,
          logger
        ),
      },

      syncFullHistory: false,

      shouldSyncHistoryMessage: () =>
        false,

      markOnlineOnConnect: false,

      generateHighQualityLinkPreview: false,

      emitOwnEvents: false,

      shouldIgnoreJid: (jid) =>
        !jid ||
        jid === "status@broadcast" ||
        jid.endsWith("@broadcast"),

      getMessage: async (key) => {
        const id = key?.id;

        if (!id) return undefined;

        return (
          msgCache.get(id) ||
          undefined
        );
      },

      cachedGroupMetadata: async (jid) =>
        groupCache.get(jid),
    };

    if (version) {
      socketOptions.version = version;
    }

    conn = makeWASocket(socketOptions);

    globalConnection = conn;

    setConnection(conn);

    conn.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect,
          qr,
        } = update;

        if (qr) {
          console.log(
            "\n📱 QR available as fallback.\n"
          );

          qrcode.generate(qr, {
            small: true,
          });
        }

        if (connection === "open") {
          reconnectAttempt = 0;

          latestPairingCode = null;

          console.log(
            "✅ Connected successfully!"
          );

          startReminderScheduler(conn);

          setTimeout(async () => {
            try {
              const {
                ensureLogGroup,
                attachLogGroupConn,
                systemLog,
              } = await import(
                "../utils/logGroup.js"
              );

              const {
                startOnboardingIfNeeded,
              } = await import(
                "../onboarding/setup.js"
              );

              const loggerMod =
                (
                  await import(
                    "../utils/logger.js"
                  )
                ).default;

              attachLogGroupConn(conn);

              loggerMod.setRemoteSink(
                (level, msg, detail) =>
                  systemLog(
                    level,
                    msg,
                    detail
                  )
              );

              const res =
                await ensureLogGroup(
                  conn
                );

              if (res.needsManual) {
                console.warn(
                  "[onboarding] Set OWNER_NUMBER or run #setlog in a group you create."
                );
              }

              if (res.jid) {
                await startOnboardingIfNeeded(
                  conn
                );
              }
            } catch (err) {
              console.error(
                "Onboarding/log-group init failed:",
                err?.message || err
              );
            }
          }, 2500);
        }

        if (connection === "close") {
          const statusCode =
            lastDisconnect?.error?.output
              ?.statusCode;

          const isLoggedOut =
            statusCode ===
            DisconnectReason.loggedOut;

          stopReminderScheduler();

          latestPairingCode = null;
          latestPairingNumber = null;

          if (globalConnection === conn) {
            globalConnection = null;
            setConnection(null);
          }

          cleanupSocket(conn);

          /*
           * Real WhatsApp logout/unlink.
           */
          if (isLoggedOut) {
            console.log(
              "🔓 WhatsApp session logged out/unlinked."
            );

            try {
              await resetMultiDbAuthState();

              console.log(
                "🧹 Old authentication completely removed."
              );
            } catch (err) {
              console.error(
                "❌ Auth reset failed:",
                err?.message || err
              );
            }

            isConnecting = false;

            console.log(
              "⏹️ Waiting for a new pairing request..."
            );

            return;
          }

          /*
           * Temporary connection failure.
           *
           * IMPORTANT:
           * Do not clear authentication here.
           * This keeps the WhatsApp account safe.
           */
          const delay =
            backoffDelay(
              reconnectAttempt
            );

          reconnectAttempt += 1;

          console.log(
            `❌ Connection closed (code ${
              statusCode ?? "?"
            }). Reconnecting in ${Math.round(
              delay / 1000
            )}s...`
          );

          isConnecting = false;

          setTimeout(() => {
            connect().catch(
              (err) => {
                console.error(
                  "Reconnect failed:",
                  err?.message || err
                );

                isConnecting = false;
              }
            );
          }, delay);
        }
      }
    );

    conn.ev.on(
      "creds.update",
      saveCreds
    );

    attachGroupParticipantEvents(conn);

    conn.ev.on(
      "groups.update",
      async (updates) => {
        for (const update of updates) {
          if (update.id) {
            groupCache.delete(update.id);
          }
        }
      }
    );

    conn.ev.on(
      "messages.upsert",
      async (m) => {
        try {
          if (
            m.type &&
            m.type !== "notify"
          ) {
            return;
          }

          if (m.requestId) return;

          const msg =
            m.messages?.[0];

          if (!msg?.message) return;

          if (
            msg.key?.remoteJid ===
            "status@broadcast"
          ) {
            return;
          }

          if (msg.key?.id) {
            msgCache.set(
              msg.key.id,
              msg.message
            );
          }

          const message =
            await serialize(
              msg,
              conn
            );

          if (!message) return;

          const blocked =
            await processGroupGuards({
              message,
              conn,
            });

          if (blocked) return;

          await messageHandler({
            message,
            conn,
          });
        } catch (error) {
          console.error(
            "❌ Error processing message:",
            error?.message || error
          );

          try {
            const {
              systemLog,
            } = await import(
              "../utils/logGroup.js"
            );

            await systemLog(
              "error",
              "messages.upsert failed",
              error
            );
          } catch {}
        }
      }
    );

    isConnecting = false;

    return conn;
  } catch (error) {
    isConnecting = false;

    cleanupSocket(conn);

    if (globalConnection === conn) {
      globalConnection = null;
      setConnection(null);
    }

    throw error;
  }
}

export function getConnection() {
  return globalConnection;
}

export default connect;
