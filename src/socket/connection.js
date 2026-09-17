/**
 * X-MD / X-ANSARI
 *
 * Multi-session WhatsApp connection manager
 *
 * Features:
 * - Default owner session
 * - Multiple independent portal sessions
 * - Independent auth DB per WhatsApp number
 * - Pairing-code login
 * - Active pairing code reuse
 * - Independent reconnect
 * - Manual disconnect
 * - Detailed message debugging
 */

import makeWASocket, {
  fetchLatestWaWebVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
} from "baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

import {
  useMultiDbAuthState,
  resetMultiDbAuthState,
} from "../database/authState.js";

import { handleDeletedMessage } from "../plugins/antidelete.js";
import {
  msgCache,
  makeMessageCacheKey,
} from "../utils/cache.js";

import { serialize } from "../messages/serialize.js";
import { messageHandler } from "../messages/handler.js";
import { setConnection } from "../terminal/handler.js";

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

/* =========================================================
   CONSTANTS
========================================================= */

const DEFAULT_SESSION_ID = "default";

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

/*
 * Pairing code lifetime.
 *
 * WhatsApp pairing codes are temporary.
 * We keep the generated code for 3 minutes so that
 * repeated Portal requests do not unnecessarily
 * generate another code.
 */
const PAIRING_CODE_TTL_MS = 3 * 60 * 1000;

/*
 * Small delay after socket starts before asking
 * Baileys for the pairing code.
 */
const PAIRING_START_DELAY_MS = 1000;

let cachedVersion = null;

/* =========================================================
   CONNECTION MAPS
========================================================= */

const connections = new Map();

const reconnectAttempts = new Map();

const connectingPromises = new Map();

const pairingInfo = new Map();

const pairingLocks = new Set();

const manualDisconnects = new Set();

const pairingReadyPromises = new Map();

/* =========================================================
   LOGGER
========================================================= */

const logger = pino({
  level: process.env.BAILEYS_LOG_LEVEL || "silent",
});

/* =========================================================
   SESSION ID
========================================================= */

export function makeSessionId(number) {
  const clean = String(number || "").replace(/\D/g, "");

  return `wa-${clean}`;
}

/* =========================================================
   PAIRING CODE CLEANUP
========================================================= */

function clearPairingCode(sessionId) {
  const existing = pairingInfo.get(sessionId);

  if (!existing) {
    return;
  }

  pairingInfo.set(sessionId, {
    ...existing,
    sessionId,
    code: null,
    createdAt: null,
  });
}

/* =========================================================
   CHECK ACTIVE PAIRING CODE
========================================================= */

function getActivePairingInfo(sessionId) {
  const info = pairingInfo.get(sessionId);

  if (!info?.code || !info?.createdAt) {
    return null;
  }

  const age = Date.now() - info.createdAt;

  if (age >= PAIRING_CODE_TTL_MS) {
    clearPairingCode(sessionId);
    return null;
  }

  return info;
}

/* =========================================================
   WHATSAPP WEB VERSION
========================================================= */

async function getBaileysVersion() {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const result = await fetchLatestWaWebVersion();

    if (result?.version) {
      cachedVersion = result.version;

      console.log(
        `📡 WhatsApp Web version: ${cachedVersion.join(".")}`
      );

      return cachedVersion;
    }
  } catch (error) {
    console.log(
      "⚠️ Could not fetch WhatsApp Web version:",
      error?.message || error
    );
  }

  return undefined;
}

/* =========================================================
   CREATE CONNECTION
========================================================= */

async function createConnection(
  sessionId = DEFAULT_SESSION_ID
) {
  /* -------------------------------------------------------
     EXISTING CONNECTION
  ------------------------------------------------------- */

  if (connections.has(sessionId)) {
    return connections.get(sessionId);
  }

  /* -------------------------------------------------------
     CONNECTION ALREADY STARTING
  ------------------------------------------------------- */

  if (connectingPromises.has(sessionId)) {
    return connectingPromises.get(sessionId);
  }

  /* -------------------------------------------------------
     CREATE CONNECTION PROMISE
  ------------------------------------------------------- */

  const promise = (async () => {
    try {
      /* =================================================
         AUTH STATE
      ================================================= */

      const {
        state,
        saveCreds,
      } = await useMultiDbAuthState(sessionId);

      console.log(
        `🔐 Auth state ready: ${sessionId}`
      );

      /* =================================================
         BAILEYS VERSION
      ================================================= */

      const version = await getBaileysVersion();

      /* =================================================
         SOCKET OPTIONS
      ================================================= */

      const socketOptions = {
        auth: {
          creds: state.creds,

          keys: makeCacheableSignalKeyStore(
            state.keys,
            logger
          ),
        },

        logger,

        printQRInTerminal: false,

        syncFullHistory: false,

        markOnlineOnConnect: false,

        generateHighQualityLinkPreview: false,

        browser:
  Browsers.ubuntu("Chrome"),
      };

      if (version) {
        socketOptions.version = version;
      }

      /* =================================================
         CREATE SOCKET
      ================================================= */

      const conn = makeWASocket(socketOptions);

      connections.set(sessionId, conn);

      /* =================================================
         PAIRING READY PROMISE
      ================================================= */

      let resolvePairing;
      let rejectPairing;

      const pairingPromise = new Promise(
        (resolve, reject) => {
          resolvePairing = resolve;
          rejectPairing = reject;
        }
      );

      pairingReadyPromises.set(sessionId, {
        promise: pairingPromise,
        resolve: resolvePairing,
        reject: rejectPairing,
      });

      /* =================================================
         CREDENTIALS
      ================================================= */

      conn.ev.on(
        "creds.update",
        saveCreds
      );

      /* =================================================
         CONNECTION UPDATE
      ================================================= */

      conn.ev.on(
        "connection.update",
        async (update) => {
          const {
            connection,
            lastDisconnect,
            qr,
          } = update;

          /* ---------------------------------------------
             CONNECTING
          ------------------------------------------- */

          if (connection === "connecting") {
            console.log(
              `🔄 WhatsApp connecting: ${sessionId}`
            );

            const ready =
              pairingReadyPromises.get(
                sessionId
              );

            if (ready) {
              try {
                ready.resolve();
              } catch {}
            }
          }

          /* ---------------------------------------------
             QR
          ------------------------------------------- */

          if (qr) {
            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              try {
                qrcode.generate(
                  qr,
                  {
                    small: true,
                  }
                );
              } catch {}
            }
          }

          /* ---------------------------------------------
             OPEN
          ------------------------------------------- */

          if (connection === "open") {
            console.log(
              `✅ WhatsApp connected: ${sessionId}`
            );

            reconnectAttempts.set(
              sessionId,
              0
            );

            /*
             * Pairing code is no longer needed after
             * successful connection.
             */
            const oldPairingInfo =
              pairingInfo.get(sessionId);

            if (oldPairingInfo) {
              pairingInfo.set(
                sessionId,
                {
                  ...oldPairingInfo,
                  sessionId,
                  connected: true,
                  code: null,
                  createdAt: null,
                }
              );
            } else {
              pairingInfo.set(
                sessionId,
                {
                  sessionId,
                  connected: true,
                  code: null,
                  createdAt: null,
                }
              );
            }

            /* -----------------------------------------
               DEFAULT OWNER SESSION
            --------------------------------------- */

            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              try {
                setConnection(conn);
              } catch (error) {
                console.log(
                  "⚠️ setConnection error:",
                  error?.message || error
                );
              }

              try {
                startReminderScheduler(conn);
              } catch (error) {
                console.log(
                  "⚠️ Reminder scheduler error:",
                  error?.message || error
                );
              }
            }
          }

          /* ---------------------------------------------
             CLOSE
          ------------------------------------------- */

          if (connection === "close") {
            const statusCode =
              lastDisconnect
                ?.error
                ?.output
                ?.statusCode ??
              lastDisconnect
                ?.error
                ?.statusCode ??
              null;

            console.log(
              `❌ WhatsApp disconnected: ${sessionId}` +
                (
                  statusCode
                    ? ` (code ${statusCode})`
                    : ""
                )
            );

            /* -----------------------------------------
               CLEAR STALE PAIRING CODE
            --------------------------------------- */

            clearPairingCode(sessionId);

            /* -----------------------------------------
               DEFAULT SCHEDULER
            --------------------------------------- */

            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              try {
                stopReminderScheduler();
              } catch {}
            }

            /* -----------------------------------------
               UPDATE PAIRING INFO
            --------------------------------------- */

            const existingPairing =
              pairingInfo.get(sessionId);

            if (existingPairing) {
              pairingInfo.set(
                sessionId,
                {
                  ...existingPairing,
                  sessionId,
                  connected: false,
                  code: null,
                  createdAt: null,
                }
              );
            }

            /* -----------------------------------------
               MANUAL DISCONNECT CHECK
            --------------------------------------- */

            const wasManual =
              manualDisconnects.has(
                sessionId
              );

            manualDisconnects.delete(
              sessionId
            );

            /* -----------------------------------------
               REMOVE OLD CONNECTION
            --------------------------------------- */

            connections.delete(
              sessionId
            );

            pairingReadyPromises.delete(
              sessionId
            );

              /* -----------------------------------------
                 LOGGED OUT / PAIRING 401
              ----------------------------------------- */

              const pairingState = pairingInfo.get(sessionId);
              const pairingIsActive =
                pairingState &&
                !pairingState.connected &&
                pairingState.number;

              if (
                statusCode === DisconnectReason.loggedOut &&
                !pairingIsActive
              ) {
                console.log(
                  `🚪 Session logged out: ${sessionId}`
                );

                try {
                  await resetMultiDbAuthState(
                    sessionId
                  );
                } catch (error) {
                  console.log(
                    "⚠️ Auth reset error:",
                    error?.message || error
                  );
                }

                pairingInfo.delete(
                  sessionId
                );

                reconnectAttempts.delete(
                  sessionId
                );

                return;
              }

              if (
                statusCode === DisconnectReason.loggedOut &&
                pairingIsActive
              ) {
                console.log(
                  `⚠️ 401 during active pairing: ${sessionId}`
                );

                /*
                 * A 401 before pairing succeeds usually means
                 * this session's saved auth is stale/invalid.
                 *
                 * Reset ONLY this session. Do not reconnect the
                 * same stale auth state in a loop.
                 */
                try {
                  await resetMultiDbAuthState(
                    sessionId
                  );
                } catch (error) {
                  console.log(
                    "⚠️ Pairing auth reset error:",
                    error?.message || error
                  );
                }

                pairingInfo.delete(
                  sessionId
                );

                reconnectAttempts.delete(
                  sessionId
                );

                console.log(
                  `🧹 Stale pairing session cleared: ${sessionId}`
                );

                /*
                 * Stop this reconnect cycle.
                 * Portal can now create a completely fresh
                 * pairing session for this number.
                 */
                return;
              }


            /* -----------------------------------------
               MANUAL DISCONNECT
            --------------------------------------- */

            if (wasManual) {
              console.log(
                `🛑 Manual disconnect: ${sessionId}`
              );

              return;
            }

            /* -----------------------------------------
               AUTOMATIC RECONNECT
            --------------------------------------- */

            const attempt =
              (
                reconnectAttempts.get(
                  sessionId
                ) || 0
              ) + 1;

            reconnectAttempts.set(
              sessionId,
              attempt
            );

            const delay =
              Math.min(
                BASE_BACKOFF_MS *
                  Math.pow(
                    2,
                    attempt - 1
                  ),
                MAX_BACKOFF_MS
              );

            console.log(
              `♻️ Reconnecting ${sessionId} in ${delay}ms`
            );

            setTimeout(
              () => {
                connect(
                  sessionId
                ).catch(
                  (error) => {
                    console.log(
                      `❌ Reconnect failed: ${sessionId}`,
                      error?.message ||
                        error
                    );
                  }
                );
              },
              delay
            );
          }
        }
      );

      /* =================================================
         GROUP PARTICIPANT EVENTS
      ================================================= */

      try {
        attachGroupParticipantEvents(
          conn
        );
      } catch (error) {
        console.log(
          "⚠️ Group participant event error:",
          error?.message || error
        );
      }

      /* =================================================
         MESSAGES UPSERT
      ================================================= */

      conn.ev.on(
        "messages.upsert",
        async ({
          messages,
          type,
        }) => {
          console.log(
            `📩 MESSAGE EVENT [${sessionId}]:`,
            type,
            messages?.length || 0
          );

          try {
            if (
              !Array.isArray(messages)
            ) {
              console.log(
                `⚠️ Messages is not an array [${sessionId}]`
              );

              return;
            }

            for (
              const rawMessage
              of messages
            ) {
              if (
                rawMessage?.key?.id &&
                rawMessage?.key?.remoteJid &&
                !rawMessage.key.fromMe
              ) {
                const cacheKey =
                  makeMessageCacheKey(
                    sessionId,
                    rawMessage.key.remoteJid,
                    rawMessage.key.id
                  );

                if (cacheKey) {
                  msgCache.set(
                    cacheKey,
                    rawMessage
                  );
                }
              }

              if (!rawMessage) {
                console.log(
                  `⚠️ Empty raw message [${sessionId}]`
                );

                continue;
              }

              /* -----------------------------------------
                 RAW MESSAGE DEBUG
              --------------------------------------- */

              console.log(
                `📩 RAW MESSAGE [${sessionId}]:`,
                rawMessage?.key?.remoteJid ||
                  "NO_JID",

                rawMessage?.key?.fromMe
                  ? "FROM_ME"
                  : "FROM_OTHER",

                rawMessage?.message
                  ? Object.keys(
                      rawMessage.message
                    )
                  : "NO_MESSAGE"
              );

              try {
                /* ---------------------------------------
                   SERIALIZE
                ------------------------------------- */

                const message =
                  await serialize(
                    conn,
                    rawMessage,
                    sessionId
                  );

                if (!message) {
                  console.log(
                    `⚠️ Serialize returned empty message [${sessionId}]`
                  );

                  continue;
                }

                console.log(
                  `📝 SERIALIZED MESSAGE [${sessionId}]`
                );

                /* ---------------------------------------
                   GROUP GUARDS
                ------------------------------------- */

                try {
                  await processGroupGuards(
                    conn,
                    message
                  );
                } catch (error) {
                  console.log(
                    `⚠️ Group guard error [${sessionId}]:`,
                    error?.message ||
                      error
                  );
                }

                /* ---------------------------------------
                   MAIN HANDLER
                ------------------------------------- */

                console.log(
                  `🚀 SENDING TO HANDLER [${sessionId}]`
                );

                await messageHandler({
                  conn,
                  message,
                  sessionId,
                  type,
                });

                console.log(
                  `✅ HANDLER FINISHED [${sessionId}]`
                );
              } catch (error) {
                console.log(
                  `⚠️ Message processing error [${sessionId}]:`,
                  error?.stack ||
                    error?.message ||
                    error
                );
              }
            }
          } catch (error) {
            console.log(
              `⚠️ messages.upsert error [${sessionId}]:`,
              error?.stack ||
                error?.message ||
                error
            );
          }
        }
      );

      /* =================================================
         MESSAGE UPDATE / ANTIDELETE
      ================================================= */

      conn.ev.on(
        "messages.update",
        async (updates) => {
          for (
            const update of updates || []
          ) {
            try {
              await handleDeletedMessage(
                conn,
                update,
                sessionId
              );
            } catch (error) {
              console.log(
                `⚠️ AntiDelete error [${sessionId}]:`,
                error?.message || error
              );
            }
          }
        }
      );

      /* =================================================
         RETURN CONNECTION
      ================================================= */

      return conn;
    } catch (error) {
      connections.delete(
        sessionId
      );

      pairingReadyPromises.delete(
        sessionId
      );

      throw error;
    }
  })();

  /* -------------------------------------------------------
     SAVE CONNECTION PROMISE
  ----------------------------------------------------- */

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

/* =========================================================
   CONNECT
========================================================= */

export async function connect(
  sessionId = DEFAULT_SESSION_ID
) {
  if (
    connections.has(sessionId)
  ) {
    return connections.get(
      sessionId
    );
  }

  return createConnection(
    sessionId
  );
}

/* =========================================================
   PORTAL PAIRING
========================================================= */

export async function requestPortalPairing(
  number,
  suppliedSessionId = null
) {
  const cleanNumber =
    String(number || "").replace(/\D/g, "");

  if (!cleanNumber) {
    throw new Error("Invalid WhatsApp number");
  }

  const sessionId =
    suppliedSessionId ||
    makeSessionId(cleanNumber);

  console.log(
    `🔐 Pairing request: ${cleanNumber}`
  );

  /*
   * -------------------------------------------------------
   * DUPLICATE REQUEST
   * -------------------------------------------------------
   *
   * Never allow two pairing operations for the
   * same WhatsApp number at the same time.
   */
  if (pairingLocks.has(sessionId)) {
    const active =
      getActivePairingInfo(sessionId);

    if (
      active?.code &&
      !active.connected
    ) {
      console.log(
        `♻️ Returning active pairing code for ${sessionId}`
      );

      return {
        code: active.code,
        sessionId,
      };
    }

    throw new Error(
      "Pairing request already in progress"
    );
  }

  pairingLocks.add(sessionId);

  try {
    /*
     * -------------------------------------------------------
     * SAME-NUMBER REPLACEMENT
     * -------------------------------------------------------
     *
     * If this number already has a socket, close ONLY
     * that socket. Other WhatsApp sessions are untouched.
     */
    const oldConn =
      connections.get(sessionId);

    if (oldConn) {
      console.log(
        `♻️ Replacing old WhatsApp session: ${sessionId}`
      );

      /*
       * Prevent the close handler from automatically
       * reconnecting the old socket.
       */
      manualDisconnects.add(sessionId);

      clearPairingCode(sessionId);

      try {
        oldConn.end(
          new Error(
            "Replacing session for fresh pairing"
          )
        );
      } catch (error) {
        console.log(
          `⚠️ Old socket close warning: ${sessionId}`,
          error?.message || error
        );
      }

      /*
       * Wait for the old socket's close handler.
       */
      const closeDeadline =
        Date.now() + 8000;

      while (
        connections.get(sessionId) === oldConn &&
        Date.now() < closeDeadline
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(resolve, 100)
        );
      }

      /*
       * Safety cleanup if the close event did not
       * remove the old connection.
       */
      if (
        connections.get(sessionId) === oldConn
      ) {
        connections.delete(sessionId);
      }

      pairingReadyPromises.delete(
        sessionId
      );

      connectingPromises.delete(
        sessionId
      );
    }

    /*
     * -------------------------------------------------------
     * FRESH AUTH
     * -------------------------------------------------------
     *
     * Reset ONLY this number's SQLite auth state.
     */
    console.log(
      `🧹 Clearing old auth: ${sessionId}`
    );

    try {
      await resetMultiDbAuthState(
        sessionId
      );
    } catch (error) {
      console.log(
        `⚠️ Auth reset warning for ${sessionId}:`,
        error?.message || error
      );
    }

    /*
     * Make sure the old manual-disconnect state
     * does not affect the NEW socket.
     */
    manualDisconnects.delete(
      sessionId
    );

    reconnectAttempts.delete(
      sessionId
    );

    pairingInfo.delete(
      sessionId
    );

    clearPairingCode(
      sessionId
    );

    /*
     * -------------------------------------------------------
     * CREATE COMPLETELY FRESH SOCKET
     * -------------------------------------------------------
     */
    console.log(
      `🆕 Creating fresh WhatsApp session: ${sessionId}`
    );

    const conn =
      await connect(sessionId);

    /*
     * -------------------------------------------------------
     * WAIT FOR SOCKET INITIALIZATION
     * -------------------------------------------------------
     */
    const ready =
      pairingReadyPromises.get(
        sessionId
      );

    if (ready) {
      await Promise.race([
        ready.promise,

        new Promise(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "WhatsApp socket did not start pairing in time"
                  )
                ),
              15000
            )
        ),
      ]);
    }

    /*
     * Small delay so Baileys finishes socket setup.
     */
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          PAIRING_START_DELAY_MS
        )
    );

    /*
     * Do NOT reject because this number was previously
     * connected. We intentionally replaced that session.
     */
    if (conn.user) {
      console.log(
        `⚠️ Fresh socket unexpectedly became connected: ${sessionId}`
      );

      throw new Error(
        "Fresh pairing socket connected before pairing code was requested"
      );
    }

    /*
     * -------------------------------------------------------
     * REQUEST FRESH PAIRING CODE
     * -------------------------------------------------------
     */
    console.log(
      `🔑 Requesting fresh pairing code for ${cleanNumber}`
    );

    const code =
      await conn.requestPairingCode(
        cleanNumber
      );

    if (!code) {
      throw new Error(
        "WhatsApp did not return a pairing code"
      );
    }

    /*
     * -------------------------------------------------------
     * SAVE PAIRING INFO
     * -------------------------------------------------------
     */
    pairingInfo.set(
      sessionId,
      {
        sessionId,
        number: cleanNumber,
        code,
        connected: false,
        createdAt: Date.now(),
      }
    );

    console.log(
      `🔗 Fresh pairing code generated for ${sessionId}: ${code}`
    );

    return {
      code,
      sessionId,
    };

  } catch (error) {
    clearPairingCode(
      sessionId
    );

    console.log(
      `❌ Pairing failed for ${sessionId}:`,
      error?.message || error
    );

    throw error;

  } finally {
    pairingLocks.delete(
      sessionId
    );
  }
}

/* =========================================================
   GET CONNECTION
========================================================= */

export function getConnection(
  sessionId = DEFAULT_SESSION_ID
) {
  return (
    connections.get(
      sessionId
    ) || null
  );
}

/* =========================================================
   GET ALL CONNECTIONS
========================================================= */

export function getConnections() {
  return connections;
}

/* =========================================================
   GET PAIRING INFO
========================================================= */

export function getPairingInfo(
  sessionId = DEFAULT_SESSION_ID
) {
  /*
   * Automatically hide expired pairing codes.
   */
  const info =
    getActivePairingInfo(
      sessionId
    );

  if (info) {
    return info;
  }

  const stored =
    pairingInfo.get(
      sessionId
    );

  if (stored?.connected) {
    return stored;
  }

  return (
    stored || null
  );
}

/* =========================================================
   GET ALL PAIRING INFO
========================================================= */

export function getAllPairingInfo() {
  return pairingInfo;
}

/* =========================================================
   DISCONNECT SESSION
========================================================= */

export async function disconnectSession(
  sessionId
) {
  const conn =
    connections.get(
      sessionId
    );

  if (!conn) {
    return false;
  }

  console.log(
    `🛑 Disconnecting session: ${sessionId}`
  );

  manualDisconnects.add(
    sessionId
  );

  /* Clear pairing code immediately */
  clearPairingCode(
    sessionId
  );

  try {
    conn.end(
      new Error(
        "Manual disconnect"
      )
    );
  } catch {
    connections.delete(
      sessionId
    );

    pairingReadyPromises.delete(
      sessionId
    );
  }

  return true;
}

/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default connect;
