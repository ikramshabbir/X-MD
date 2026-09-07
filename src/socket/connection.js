/**
 * WhatsApp socket connection — Baileys 7.0.0-rc13
 * Supports QR, PAIRING_NUMBER login, and portal pairing-code requests.
 */

import makeWASocket, {
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { useMultiDbAuthState } from "../database/authState.js";
import { serialize } from "../messages/serialize.js";
import { messageHandler } from "../messages/handler.js";
import { setConnection } from "../terminal/handler.js";
import { groupCache, msgCache } from "../utils/cache.js";
import { attachGroupParticipantEvents } from "../events/groupParticipants.js";
import {
  startReminderScheduler,
  stopReminderScheduler,
} from "../utils/reminders.js";
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
let pairingRequested = false;

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

function backoffDelay(attempt) {
  const exp = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** attempt
  );
  const jitter = Math.floor(Math.random() * 500);
  return exp + jitter;
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

function pairingNumber() {
  const raw = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
  return raw || null;
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
 * Request a pairing code from the currently running WhatsApp socket.
 */
export async function requestPortalPairing(number) {
  const cleanNumber = String(number || "").replace(/\D/g, "");

  if (!cleanNumber) {
    throw new Error("Invalid WhatsApp number");
  }

  if (!globalConnection) {
    throw new Error("WhatsApp socket is not ready yet");
  }

  if (globalConnection.user) {
    throw new Error("WhatsApp is already connected");
  }

  try {
    const code = await globalConnection.requestPairingCode(
      cleanNumber
    );

    latestPairingCode = code;
    latestPairingNumber = cleanNumber;

    console.log("\n🔗 Portal pairing code:");
    console.log(`   ${code}`);
    console.log(`   Number: ${cleanNumber}\n`);

    return code;
  } catch (error) {
    latestPairingCode = null;
    latestPairingNumber = null;
    throw error;
  }
}

async function connect() {
  if (isConnecting) return globalConnection;

  isConnecting = true;

  let conn = null;

  try {
    const { state, saveCreds } = await useMultiDbAuthState();
    const version = await getVersion();

    const hasSession = !!(
      state.creds?.me ||
      state.creds?.registered
    );

    const envPairingNumber = pairingNumber();
    const usePairing = !hasSession && !!envPairingNumber;

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
      shouldSyncHistoryMessage: () => false,
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

        return msgCache.get(id) || undefined;
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

    pairingRequested = false;

    /*
     * Existing PAIRING_NUMBER environment-variable login.
     */
    if (usePairing) {
      pairingRequested = true;

      setTimeout(async () => {
        try {
          const code = await conn.requestPairingCode(
            envPairingNumber
          );

          latestPairingCode = code;
          latestPairingNumber = envPairingNumber;

          console.log(
            "\n🔗 Pairing code (enter on phone):\n"
          );
          console.log(`   ${code}\n`);
          console.log(
            "Phone → Linked devices → Link with phone number\n"
          );
        } catch (err) {
          console.error(
            "Pairing code failed:",
            err?.message || err
          );

          console.log(
            "Scan QR instead if it appears...\n"
          );
        }
      }, 2000);
    }

    conn.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect,
          qr,
        } = update;

        /*
         * QR login.
         */
        if (qr && !usePairing) {
          qrcode.generate(qr, {
            small: true,
          });

          console.log(
            "\n📱 Scan the QR code above to log in.\n"
          );

          console.log(
            "(Or set PAIRING_NUMBER=yourNumberWithCountryCode and restart)\n"
          );
        }

        /*
         * WhatsApp connected.
         */
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
                await ensureLogGroup(conn);

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

        /*
         * WhatsApp disconnected.
         */
        if (connection === "close") {
          const statusCode =
            lastDisconnect?.error?.output
              ?.statusCode;

          const shouldReconnect =
            statusCode !==
            DisconnectReason.loggedOut;

          stopReminderScheduler();

          cleanupSocket(conn);

          if (globalConnection === conn) {
            globalConnection = null;
            setConnection(null);
          }

          if (shouldReconnect) {
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
              connect().catch((err) => {
                console.error(
                  "Reconnect failed:",
                  err?.message || err
                );

                isConnecting = false;
              });
            }, delay);
          } else {
            console.log(
              "🔓 Logged out. Restart the bot to login again."
            );

            latestPairingCode = null;
            latestPairingNumber = null;

            isConnecting = false;
          }
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

    throw error;
  }
}

export function getConnection() {
  return globalConnection;
}

export default connect;
