/**
 * X-MD Multi-Session WhatsApp socket connection
 *
 * Baileys 7.0.0-rc13
 *
 * Supports:
 * - default owner session
 * - multiple portal sessions
 * - independent reconnect
 * - independent pairing codes
 * - independent auth databases
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

import {
  groupCache,
  msgCache,
} from "../utils/cache.js";

import {
  startReminderScheduler,
  stopReminderScheduler,
} from "../utils/reminders.js";

import {
  attachGroupParticipantEvents,
} from "../events/groupParticipants.js";

import {
  processGroupGuards,
} from "../messages/groupGuards.js";

const logger = pino({
  level:
    process.env.BAILEYS_LOG_LEVEL ||
    "silent",
});


/* =========================
   SESSION STORAGE
========================= */

const connections = new Map();
const reconnectAttempts = new Map();
const connectingPromises = new Map();

const pairingInfo = new Map();
const pairingLocks = new Set();

let cachedVersion = null;


/*
 * Default session remains the
 * original owner bot.
 */
const DEFAULT_SESSION_ID = "default";


/* =========================
   BACKOFF
========================= */

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

function backoffDelay(attempt) {
  const exp = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** attempt
  );

  const jitter =
    Math.floor(Math.random() * 500);

  return exp + jitter;
}


/* =========================
   SESSION ID
========================= */

/*
 * Create a stable session ID
 * from the WhatsApp number.
 *
 * Example:
 *
 * 923001234567
 *
 * becomes:
 *
 * wa-923001234567
 */
export function makeSessionId(number) {
  const cleanNumber =
    String(number || "")
      .replace(/\D/g, "");

  if (!cleanNumber) {
    throw new Error(
      "Invalid WhatsApp number"
    );
  }

  return `wa-${cleanNumber}`;
}


/* =========================
   BAILEYS VERSION
========================= */

async function getVersion() {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const {
      version,
    } =
      await fetchLatestBaileysVersion();

    cachedVersion = version;
  } catch {
    cachedVersion = undefined;
  }

  return cachedVersion;
}


/* =========================
   SOCKET CLEANUP
========================= */

function cleanupSocket(conn) {
  if (!conn) {
    return;
  }

  try {
    conn.ev?.removeAllListeners?.();
  } catch {}

  try {
    conn.ws?.close?.();
  } catch {}

  try {
    conn.end?.(
      undefined
    );
  } catch {}
}


/* =========================
   PAIRING INFO
========================= */

export function getPairingInfo(
  sessionId = DEFAULT_SESSION_ID
) {
  const normalized =
    String(sessionId || DEFAULT_SESSION_ID);

  const conn =
    connections.get(normalized);

  const info =
    pairingInfo.get(normalized) || {};

  return {
    sessionId: normalized,

    code:
      info.code || null,

    number:
      info.number || null,

    connected:
      !!conn?.user,

  };
}


/*
 * Get all active session info.
 */
export function getAllPairingInfo() {
  const sessions =
    new Set([
      ...connections.keys(),
      ...pairingInfo.keys(),
    ]);

  return Array.from(sessions).map(
    (sessionId) =>
      getPairingInfo(sessionId)
  );
}


/* =========================
   WAIT FOR SOCKET
========================= */

async function waitForSocketReady(
  conn,
  timeout = 15000
) {
  if (!conn) {
    throw new Error(
      "WhatsApp socket is not available"
    );
  }

  if (
    conn.user ||
    conn.ws
  ) {
    return;
  }

  return new Promise(
    (resolve, reject) => {
      let finished = false;

      let timer;

      const finish =
        (error = null) => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(timer);

          try {
            conn.ev?.off?.(
              "connection.update",
              onUpdate
            );
          } catch {}

          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

      const onUpdate =
        (update) => {
          if (
            update?.connection ===
              "connecting" ||
            update?.qr
          ) {
            finish();
            return;
          }

          if (
            update?.connection ===
            "open"
          ) {
            finish();
            return;
          }

          if (
            update?.connection ===
            "close"
          ) {
            finish(
              new Error(
                "WhatsApp socket closed before pairing code request"
              )
            );
          }
        };

      timer =
        setTimeout(
          () => {
            finish(
              new Error(
                "WhatsApp socket did not become ready in time"
              )
            );
          },
          timeout
        );

      try {
        conn.ev.on(
          "connection.update",
          onUpdate
        );
      } catch {
        finish(
          new Error(
            "Unable to monitor WhatsApp socket"
          )
        );
      }
    }
  );
}


/* =========================
   PORTAL PAIRING
========================= */

export async function requestPortalPairing(
  number,
  suppliedSessionId = null
) {
  const cleanNumber =
    String(number || "")
      .replace(/\D/g, "");

  if (!cleanNumber) {
    throw new Error(
      "Invalid WhatsApp number"
    );
  }

  /*
   * Use supplied portal session
   * when available.
   *
   * Otherwise create a stable
   * WhatsApp-number based session.
   */
  const sessionId =
    suppliedSessionId ||
    makeSessionId(cleanNumber);

  /*
   * Prevent two pairing requests
   * for the same session.
   */
  if (pairingLocks.has(sessionId)) {
    throw new Error(
      "A pairing code request is already in progress for this session"
    );
  }

  pairingLocks.add(sessionId);

  try {
    let conn =
      connections.get(sessionId);

    /*
     * If an existing socket is
     * already authenticated, don't
     * create another one.
     */
    if (conn?.user) {
      throw new Error(
        "WhatsApp is already connected for this session"
      );
    }

    /*
     * Create a fresh socket if needed.
     */
    if (!conn) {
      console.log(
        `🔄 Creating WhatsApp session: ${sessionId}`
      );

      conn =
        await connect(
          sessionId
        );

      if (!conn) {
        throw new Error(
          "Unable to create WhatsApp socket"
        );
      }
    }

    /*
     * If credentials from an
     * already-linked session exist,
     * pairing again is not needed.
     */
    if (conn.user) {
      throw new Error(
        "WhatsApp is already connected for this session"
      );
    }

    await waitForSocketReady(
      conn
    );

    /*
     * Request fresh pairing code.
     */
    const code =
      await conn.requestPairingCode(
        cleanNumber
      );

    pairingInfo.set(
      sessionId,
      {
        code,
        number: cleanNumber,
        connected: false,
      }
    );

    console.log(
      "\n🔗 Portal pairing code:"
    );

    console.log(
      `   Session: ${sessionId}`
    );

    console.log(
      `   Number: ${cleanNumber}`
    );

    console.log(
      `   Code: ${code}\n`
    );

    return {
      code,
      sessionId,
    };

  } catch (error) {

    const old =
      pairingInfo.get(
        sessionId
      );

    pairingInfo.set(
      sessionId,
      {
        ...(old || {}),
        code: null,
      }
    );

    throw error;

  } finally {
    pairingLocks.delete(
      sessionId
    );
  }
}


/* =========================
   CONNECT
========================= */

async function connect(
  sessionId = DEFAULT_SESSION_ID
) {
  /*
   * Return existing socket.
   */
  const existing =
    connections.get(
      sessionId
    );

  if (existing) {
    return existing;
  }

  /*
   * Prevent duplicate socket
   * creation for same session.
   */
  if (
    connectingPromises.has(
      sessionId
    )
  ) {
    return connectingPromises.get(
      sessionId
    );
  }

  const promise =
    createConnection(
      sessionId
    );

  connectingPromises.set(
    sessionId,
    promise
  );

  try {
    return await promise;
  } finally {
    connectingPromises.delete(
      sessionId
    );
  }
}


/* =========================
   CREATE CONNECTION
========================= */

async function createConnection(
  sessionId
) {
  let conn = null;

  try {
    const {
      state,
      saveCreds,
    } =
      await useMultiDbAuthState(
        sessionId
      );

    const version =
      await getVersion();

    const socketOptions = {
      logger,

      auth: {
        creds:
          state.creds,

        keys:
          makeCacheableSignalKeyStore(
            state.keys,
            logger
          ),
      },

      syncFullHistory:
        false,

      shouldSyncHistoryMessage:
        () => false,

      markOnlineOnConnect:
        false,

      generateHighQualityLinkPreview:
        false,

      emitOwnEvents:
        false,

      shouldIgnoreJid:
        (jid) =>
          !jid ||
          jid ===
            "status@broadcast" ||
          jid.endsWith(
            "@broadcast"
          ),

      getMessage:
        async (key) => {
          const id =
            key?.id;

          if (!id) {
            return undefined;
          }

          return (
            msgCache.get(id) ||
            undefined
          );
        },

      cachedGroupMetadata:
        async (jid) =>
          groupCache.get(jid),
    };

    if (version) {
      socketOptions.version =
        version;
    }

    conn =
      makeWASocket(
        socketOptions
      );

    connections.set(
      sessionId,
      conn
    );

    /*
     * Terminal handler controls
     * only the default/owner socket.
     */
    if (
      sessionId ===
      DEFAULT_SESSION_ID
    ) {
      setConnection(
        conn
      );
    }

    console.log(
      `🔌 WhatsApp socket created: ${sessionId}`
    );


    /* =====================
       CONNECTION EVENTS
    ===================== */

    conn.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect,
          qr,
        } = update;


        /*
         * QR fallback.
         */

        if (qr) {
          console.log(
            `\n📱 QR available: ${sessionId}\n`
          );

          qrcode.generate(
            qr,
            {
              small: true,
            }
          );
        }


        /*
         * CONNECTED
         */

        if (
          connection ===
          "open"
        ) {
          reconnectAttempts.set(
            sessionId,
            0
          );

          const current =
            pairingInfo.get(
              sessionId
            ) || {};

          pairingInfo.set(
            sessionId,
            {
              ...current,
              code: null,
              connected: true,
            }
          );

          console.log(
            `✅ WhatsApp connected: ${sessionId}`
          );


          /*
           * Reminder scheduler.
           *
           * Only the default bot
           * uses the existing global
           * scheduler to avoid conflicts.
           */

          if (
            sessionId ===
            DEFAULT_SESSION_ID
          ) {
            startReminderScheduler(
              conn
            );
          }


          /*
           * Log group / onboarding
           * belongs to default bot.
           */

          if (
            sessionId ===
            DEFAULT_SESSION_ID
          ) {
            setTimeout(
              async () => {
                try {
                  const {
                    ensureLogGroup,
                    attachLogGroupConn,
                    systemLog,
                  } =
                    await import(
                      "../utils/logGroup.js"
                    );

                  const {
                    startOnboardingIfNeeded,
                  } =
                    await import(
                      "../onboarding/setup.js"
                    );

                  const loggerMod =
                    (
                      await import(
                        "../utils/logger.js"
                      )
                    ).default;

                  attachLogGroupConn(
                    conn
                  );

                  loggerMod.setRemoteSink(
                    (
                      level,
                      msg,
                      detail
                    ) =>
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

                  if (
                    res.needsManual
                  ) {
                    console.warn(
                      "[onboarding] Set OWNER_NUMBER or run #setlog in a group you create."
                    );
                  }

                  if (
                    res.jid
                  ) {
                    await startOnboardingIfNeeded(
                      conn
                    );
                  }

                } catch (err) {
                  console.error(
                    "Onboarding/log-group init failed:",
                    err?.message ||
                      err
                  );
                }
              },
              2500
            );
          }

          return;
        }


        /*
         * DISCONNECTED
         */

        if (
          connection ===
          "close"
        ) {
          const statusCode =
            lastDisconnect
              ?.error
              ?.output
              ?.statusCode;

          const isLoggedOut =
            statusCode ===
            DisconnectReason.loggedOut;


          /*
           * Stop scheduler only
           * for default session.
           */

          if (
            sessionId ===
            DEFAULT_SESSION_ID
          ) {
            stopReminderScheduler();
          }


          /*
           * Remove connection.
           */

          if (
            connections.get(
              sessionId
            ) === conn
          ) {
            connections.delete(
              sessionId
            );
          }


          pairingInfo.set(
            sessionId,
            {
              ...(pairingInfo.get(
                sessionId
              ) || {}),
              code: null,
              connected: false,
            }
          );


          cleanupSocket(
            conn
          );


          /*
           * TRUE LOGOUT
           */

          if (
            isLoggedOut
          ) {
            console.log(
              `🔓 WhatsApp logged out: ${sessionId}`
            );

            try {
              await resetMultiDbAuthState(
                sessionId
              );

              console.log(
                `🧹 Auth removed: ${sessionId}`
              );

            } catch (err) {
              console.error(
                `❌ Auth reset failed (${sessionId}):`,
                err?.message ||
                  err
              );
            }

            reconnectAttempts.delete(
              sessionId
            );

            pairingInfo.delete(
              sessionId
            );

            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              setConnection(
                null
              );
            }

            console.log(
              `⏹️ Waiting for new pairing: ${sessionId}`
            );

            return;
          }


          /*
           * TEMPORARY DISCONNECT
           */

          const attempt =
            reconnectAttempts.get(
              sessionId
            ) || 0;

          const delay =
            backoffDelay(
              attempt
            );

          reconnectAttempts.set(
            sessionId,
            attempt + 1
          );


          console.log(
            `❌ Connection closed (${sessionId}, code ${statusCode ?? "?"}). Reconnecting in ${Math.round(
              delay / 1000
            )}s...`
          );


          setTimeout(
            () => {
              connect(
                sessionId
              ).catch(
                (err) => {
                  console.error(
                    `Reconnect failed (${sessionId}):`,
                    err?.message ||
                      err
                  );
                }
              );
            },
            delay
          );
        }
      }
    );


    /* =====================
       CREDENTIALS
    ===================== */

    conn.ev.on(
      "creds.update",
      saveCreds
    );


    /* =====================
       GROUP EVENTS
    ===================== */

    attachGroupParticipantEvents(
      conn
    );


    conn.ev.on(
      "groups.update",
      async (updates) => {
        for (
          const update of updates
        ) {
          if (
            update.id
          ) {
            groupCache.delete(
              update.id
            );
          }
        }
      }
    );


    /* =====================
       MESSAGE HANDLER
    ===================== */

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

          if (
            m.requestId
          ) {
            return;
          }

          const msg =
            m.messages?.[0];

          if (
            !msg?.message
          ) {
            return;
          }

          if (
            msg.key
              ?.remoteJid ===
            "status@broadcast"
          ) {
            return;
          }

          if (
            msg.key?.id
          ) {
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

          if (!message) {
            return;
          }

          const blocked =
            await processGroupGuards(
              {
                message,
                conn,
              }
            );

          if (blocked) {
            return;
          }

          await messageHandler(
            {
              message,
              conn,
            }
          );

        } catch (error) {
          console.error(
            `❌ Error processing message (${sessionId}):`,
            error?.message ||
              error
          );

          try {
            const {
              systemLog,
            } =
              await import(
                "../utils/logGroup.js"
              );

            /*
             * Remote system log is
             * kept for default bot only.
             */
            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              await systemLog(
                "error",
                "messages.upsert failed",
                error
              );
            }
          } catch {}
        }
      }
    );


    return conn;

  } catch (error) {
    console.error(
      `❌ Failed creating session ${sessionId}:`,
      error?.message ||
        error
    );

    if (
      connections.get(
        sessionId
      ) === conn
    ) {
      connections.delete(
        sessionId
      );
    }

    if (
      sessionId ===
      DEFAULT_SESSION_ID
    ) {
      setConnection(
        null
      );
    }

    cleanupSocket(
      conn
    );

    throw error;
  }
}


/* =========================
   GET CONNECTION
========================= */

export function getConnection(
  sessionId = DEFAULT_SESSION_ID
) {
  return connections.get(
    sessionId
  ) || null;
}


/* =========================
   GET ALL CONNECTIONS
========================= */

export function getConnections() {
  return new Map(
    connections
  );
}


/* =========================
   DISCONNECT ONE SESSION
========================= */

export async function disconnectSession(
  sessionId
) {
  const normalized =
    String(sessionId || "").trim();

  if (!normalized) {
    return false;
  }

  const conn =
    connections.get(
      normalized
    );

  if (!conn) {
    return false;
  }

  try {
    await conn.end?.(
      undefined
    );
  } catch {}

  connections.delete(
    normalized
  );

  pairingInfo.delete(
    normalized
  );

  reconnectAttempts.delete(
    normalized
  );

  if (
    normalized ===
    DEFAULT_SESSION_ID
  ) {
    setConnection(
      null
    );
  }

  return true;
}


/* =========================
   DEFAULT EXPORT
========================= */

export default connect;
