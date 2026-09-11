/**
 * X-MD / X-ANSARI
 * Multi-session WhatsApp connection manager
 *
 * Features:
 * - Default owner session
 * - Multiple independent portal sessions
 * - Independent auth DB per WhatsApp number
 * - Pairing-code login
 * - Independent reconnect
 * - Manual disconnect
 * - Detailed message debugging
 */

import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
} from "@whiskeysockets/baileys";

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
 * CONSTANTS
 * ======================================================= */

const DEFAULT_SESSION_ID = "default";

const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

/* =========================================================
 * CONNECTION MAPS
 * ======================================================= */

const connections = new Map();
const reconnectAttempts = new Map();
const connectingPromises = new Map();
const pairingInfo = new Map();
const pairingLocks = new Set();
const manualDisconnects = new Set();
const pairingReadyPromises = new Map();

/* =========================================================
 * LOGGER
 * ======================================================= */

const logger = pino({
  level:
    process.env.BAILEYS_LOG_LEVEL || "silent",
});

/* =========================================================
 * SESSION ID
 * ======================================================= */

export function makeSessionId(number) {
  const clean = String(number || "").replace(
    /\D/g,
    ""
  );

  return `wa-${clean}`;
}

/* =========================================================
 * CREATE CONNECTION
 * ======================================================= */

async function createConnection(
  sessionId = DEFAULT_SESSION_ID
) {
  /* -------------------------------------------------------
   * EXISTING CONNECTION
   * ----------------------------------------------------- */

  if (
    connections.has(sessionId)
  ) {
    return connections.get(
      sessionId
    );
  }

  /* -------------------------------------------------------
   * CONNECTION ALREADY STARTING
   * ----------------------------------------------------- */

  if (
    connectingPromises.has(
      sessionId
    )
  ) {
    return connectingPromises.get(
      sessionId
    );
  }

  /* -------------------------------------------------------
   * CREATE CONNECTION PROMISE
   * ----------------------------------------------------- */

  const promise = (async () => {
    try {
      /* =================================================
       * AUTH STATE
       * =============================================== */

      const {
        state,
        saveCreds,
      } =
        await useMultiDbAuthState(
          sessionId
        );

      console.log(
        `🔐 Auth state ready: ${sessionId}`
      );

      /* =================================================
       * SOCKET OPTIONS
       * =============================================== */

      const socketOptions = {
        auth: {
          creds: state.creds,

          keys:
            makeCacheableSignalKeyStore(
              state.keys,
              logger
            ),
        },

        logger,

        printQRInTerminal: false,

        syncFullHistory: false,

        markOnlineOnConnect: false,

        generateHighQualityLinkPreview:
          false,

        browser:
          Browsers.macOS("Chrome"),
      };

      /* =================================================
       * CREATE SOCKET
       * =============================================== */

      const conn =
        makeWASocket(
          socketOptions
        );

      connections.set(
        sessionId,
        conn
      );

      /* =================================================
       * PAIRING READY PROMISE
       * =============================================== */

      let resolvePairing;
      let rejectPairing;

      const pairingPromise =
        new Promise(
          (resolve, reject) => {
            resolvePairing =
              resolve;

            rejectPairing =
              reject;
          }
        );

      pairingReadyPromises.set(
        sessionId,
        {
          promise:
            pairingPromise,

          resolve:
            resolvePairing,

          reject:
            rejectPairing,
        }
      );

      /* =================================================
       * CREDENTIALS
       * =============================================== */

      conn.ev.on(
        "creds.update",
        saveCreds
      );

      /* =================================================
       * CONNECTION UPDATE
       * =============================================== */

      conn.ev.on(
        "connection.update",
        async (update) => {
          const {
            connection,
            lastDisconnect,
            qr,
          } = update;

          /* ---------------------------------------------
           * CONNECTING
           * ------------------------------------------- */

          if (
            connection ===
            "connecting"
          ) {
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
           * QR
           * ------------------------------------------- */

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
           * OPEN
           * ------------------------------------------- */

          if (
            connection ===
            "open"
          ) {
            console.log(
              `✅ WhatsApp connected: ${sessionId}`
            );

            reconnectAttempts.set(
              sessionId,
              0
            );

            pairingInfo.set(
              sessionId,
              {
                ...(
                  pairingInfo.get(
                    sessionId
                  ) || {}
                ),

                sessionId,

                connected: true,

                code: null,
              }
            );

            /* -----------------------------------------
             * DEFAULT OWNER SESSION
             * --------------------------------------- */

            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              try {
                setConnection(
                  conn
                );
              } catch (error) {
                console.log(
                  "⚠️ setConnection error:",
                  error?.message ||
                    error
                );
              }

              try {
                startReminderScheduler(
                  conn
                );
              } catch (error) {
                console.log(
                  "⚠️ Reminder scheduler error:",
                  error?.message ||
                    error
                );
              }
            }
          }

          /* ---------------------------------------------
           * CLOSE
           * ------------------------------------------- */

          if (
            connection ===
            "close"
          ) {
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
             * DEFAULT SCHEDULER
             * --------------------------------------- */

            if (
              sessionId ===
              DEFAULT_SESSION_ID
            ) {
              try {
                stopReminderScheduler();
              } catch {}
            }

            /* -----------------------------------------
             * UPDATE PAIRING INFO
             * --------------------------------------- */

            pairingInfo.set(
              sessionId,
              {
                ...(
                  pairingInfo.get(
                    sessionId
                  ) || {}
                ),

                sessionId,

                connected: false,

                code:
                  pairingInfo.get(
                    sessionId
                  )?.code ||
                  null,
              }
            );

            /* -----------------------------------------
             * MANUAL DISCONNECT CHECK
             * --------------------------------------- */

            const wasManual =
              manualDisconnects.has(
                sessionId
              );

            manualDisconnects.delete(
              sessionId
            );

            /* -----------------------------------------
             * REMOVE OLD CONNECTION
             * --------------------------------------- */

            connections.delete(
              sessionId
            );

            pairingReadyPromises.delete(
              sessionId
            );

            /* -----------------------------------------
             * LOGGED OUT
             * --------------------------------------- */

            if (
              statusCode ===
              DisconnectReason.loggedOut
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
                  error?.message ||
                    error
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

            /* -----------------------------------------
             * MANUAL DISCONNECT
             * --------------------------------------- */

            if (
              wasManual
            ) {
              console.log(
                `🛑 Manual disconnect: ${sessionId}`
              );

              return;
            }

            /* -----------------------------------------
             * AUTOMATIC RECONNECT
             * --------------------------------------- */

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
       * GROUP PARTICIPANT EVENTS
       * =============================================== */

      try {
        attachGroupParticipantEvents(
          conn
        );
      } catch (error) {
        console.log(
          "⚠️ Group participant event error:",
          error?.message ||
            error
        );
      }

      /* =================================================
       * MESSAGES UPSERT
       * =============================================== */

      conn.ev.on(
        "messages.upsert",
        async ({
          messages,
          type,
        }) => {
          console.log(
            `📩 MESSAGE EVENT [${sessionId}]:`,
            type,
            messages?.length ||
              0
          );

          try {
            if (
              !Array.isArray(
                messages
              )
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
                !rawMessage
              ) {
                console.log(
                  `⚠️ Empty raw message [${sessionId}]`
                );

                continue;
              }

              /* -----------------------------------------
               * RAW MESSAGE DEBUG
               * --------------------------------------- */

              console.log(
                `📩 RAW MESSAGE [${sessionId}]:`,
                rawMessage?.key
                  ?.remoteJid ||
                  "NO_JID",

                rawMessage?.key
                  ?.fromMe
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
                 * SERIALIZE
                 * ------------------------------------- */

                const message =
                  await serialize(
                    conn,
                    rawMessage
                  );

                if (
                  !message
                ) {
                  console.log(
                    `⚠️ Serialize returned empty message [${sessionId}]`
                  );

                  continue;
                }

                console.log(
                  `📝 SERIALIZED MESSAGE [${sessionId}]`
                );

                /* ---------------------------------------
                 * GROUP GUARDS
                 * ------------------------------------- */

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
                 * MAIN HANDLER
                 * ------------------------------------- */

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
       * RETURN CONNECTION
       * =============================================== */

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
   * SAVE CONNECTION PROMISE
   * ----------------------------------------------------- */

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
 * CONNECT
 * ======================================================= */

export async function connect(
  sessionId = DEFAULT_SESSION_ID
) {
  if (
    connections.has(
      sessionId
    )
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
 * PORTAL PAIRING
 * ======================================================= */

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

  /* NUMBER = SEPARATE SESSION */

  const sessionId =
    suppliedSessionId ||
    makeSessionId(
      cleanNumber
    );

  /* ALREADY CONNECTED */

  const existing =
    connections.get(
      sessionId
    );

  if (existing?.user) {
    throw new Error(
      "WhatsApp is already connected"
    );
  }

  /* DUPLICATE PAIRING REQUEST */

  if (
    pairingLocks.has(
      sessionId
    )
  ) {
    throw new Error(
      "Pairing request already in progress"
    );
  }

  pairingLocks.add(
    sessionId
  );

  try {
    console.log(
      `🔐 Pairing request: ${cleanNumber}`
    );

    /* CREATE NUMBER-SPECIFIC SESSION */

    const conn =
      await connect(
        sessionId
      );

    /* WAIT FOR SOCKET START */

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
              20000
            )
        ),
      ]);
    }

    /* INITIALIZATION DELAY */

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1500
        )
    );

    /* CHECK CONNECTION */

    if (conn.user) {
      throw new Error(
        "WhatsApp is already connected"
      );
    }

    /* REQUEST PAIRING CODE */

    const code =
      await conn.requestPairingCode(
        cleanNumber
      );

    if (!code) {
      throw new Error(
        "WhatsApp did not return a pairing code"
      );
    }

    /* SAVE PAIRING INFO */

    pairingInfo.set(
      sessionId,
      {
        sessionId,

        number:
          cleanNumber,

        code,

        connected:
          false,

        createdAt:
          Date.now(),
      }
    );

    console.log(
      `🔗 Pairing code generated for ${sessionId}: ${code}`
    );

    return {
      code,
      sessionId,
    };
  } catch (error) {
    console.log(
      `❌ Pairing failed [${sessionId}]:`,
      error?.stack ||
        error?.message ||
        error
    );

    throw error;
  } finally {
    pairingLocks.delete(
      sessionId
    );
  }
}

/* =========================================================
 * GET CONNECTION
 * ======================================================= */

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
 * GET ALL CONNECTIONS
 * ======================================================= */

export function getConnections() {
  return connections;
}

/* =========================================================
 * GET PAIRING INFO
 * ======================================================= */

export function getPairingInfo(
  sessionId = DEFAULT_SESSION_ID
) {
  return (
    pairingInfo.get(
      sessionId
    ) || null
  );
}

/* =========================================================
 * GET ALL PAIRING INFO
 * ======================================================= */

export function getAllPairingInfo() {
  return pairingInfo;
}

/* =========================================================
 * DISCONNECT SESSION
 * ======================================================= */

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
  }

  return true;
}

/* =========================================================
 * DEFAULT EXPORT
 * ======================================================= */

export default connect;
