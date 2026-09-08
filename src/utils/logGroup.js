/**
 * X-MD System Log Group
 *
 * IMPORTANT:
 * - Automatically creates NO WhatsApp group.
 * - Uses an existing saved log group.
 * - Prevents the "missing <group> node" error caused by groupCreate().
 * - System errors are kept away from normal user chats.
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { getOwnerNumbers } from "./access.js";

const LOG_GROUP_KEY = "log_group_jid";
const SETUP_DONE_KEY = "setup_done";

let connRef = null;

let sendQueue = Promise.resolve();
let lastSendAt = 0;

const MIN_GAP_MS = 1500;


/* =========================
   Connection
========================= */

export function attachLogGroupConn(conn) {
  connRef = conn;
}


/* =========================
   Log Group
========================= */

export async function getLogGroupJid() {
  return (await kvGet(LOG_GROUP_KEY)) || null;
}


export async function setLogGroupJid(jid) {
  await kvSet(
    LOG_GROUP_KEY,
    jid
  );

  return jid;
}


/* =========================
   Setup
========================= */

export async function isSetupDone() {
  return !!(
    await kvGet(
      SETUP_DONE_KEY
    )
  );
}


export async function markSetupDone(
  done = true
) {
  await kvSet(
    SETUP_DONE_KEY,
    !!done
  );
}


/* =========================
   Log Group Check
========================= */

export function isLogGroup(jid) {
  // Synchronous check is intentionally
  // conservative.
  return false;
}


export async function isLogGroupAsync(jid) {
  const logGroup =
    await getLogGroupJid();

  return !!(
    logGroup &&
    jid === logGroup
  );
}


/* =========================
   Owner Numbers
========================= */

function ownerJids() {
  return getOwnerNumbers().map(
    (n) =>
      `${n}@s.whatsapp.net`
  );
}


/* =========================
   Ensure Log Group
========================= */

/**
 * Uses an existing log group.
 *
 * IMPORTANT:
 * We DO NOT call:
 *
 * conn.groupCreate()
 *
 * This prevents:
 *
 * "Invalid group metadata response:
 * missing <group> node"
 */
export async function ensureLogGroup(
  conn
) {
  attachLogGroupConn(conn);

  const jid =
    await getLogGroupJid();


  /*
   * Existing saved group.
   */
  if (jid) {

    try {

      /*
       * Verify that the group
       * can still be read.
       */
      await conn.groupMetadata(
        jid
      );

      console.log(
        `[log-group] Using existing log group: ${jid}`
      );

      return {
        jid,
        created: false,
        needsManual: false,
      };

    } catch (err) {

      /*
       * Do NOT create a new group.
       */
      console.warn(
        "[log-group] Existing log group could not be verified:",
        err?.message || err
      );

      console.warn(
        "[log-group] Auto group creation disabled."
      );

      return {
        jid,
        created: false,
        needsManual: true,
      };
    }
  }


  /*
   * No saved group.
   *
   * Do not automatically create one.
   */
  console.log(
    "[log-group] No system log group configured."
  );

  console.log(
    "[log-group] Auto group creation is disabled."
  );

  console.log(
    "[log-group] Create a WhatsApp group manually and add the bot."
  );

  console.log(
    "[log-group] Then configure it with the bot's log-group command."
  );


  return {
    jid: null,
    created: false,
    needsManual: true,
  };
}


/* =========================
   System Logging
========================= */

export async function systemLog(
  level,
  message,
  detail
) {

  const text =
    formatSystemLine(
      level,
      message,
      detail
    );


  /*
   * Always show logs
   * in Railway console.
   */
  if (level === "error") {

    console.error(text);

  } else if (
    level === "warn"
  ) {

    console.warn(text);

  } else {

    console.log(text);
  }


  /*
   * Error metrics.
   */
  if (
    level === "error"
  ) {

    try {

      const {
        recordError,
      } = await import(
        "../enterprise/metrics.js"
      );

      recordError();

    } catch {
      // Ignore metrics errors.
    }
  }


  /*
   * Get configured log group.
   */
  const jid =
    await getLogGroupJid();


  /*
   * No group or connection.
   *
   * Railway console logging
   * still works.
   */
  if (
    !jid ||
    !connRef
  ) {
    return;
  }


  /*
   * Queue messages so we don't
   * send too quickly to WhatsApp.
   */
  sendQueue =
    sendQueue.then(
      async () => {

        const wait =
          MIN_GAP_MS -
          (
            Date.now() -
            lastSendAt
          );


        if (wait > 0) {

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                wait
              )
          );
        }


        try {

          await connRef.sendMessage(
            jid,
            {
              text,
            }
          );

          lastSendAt =
            Date.now();

        } catch (err) {

          console.error(
            "[log-group] send failed:",
            err?.message || err
          );
        }
      }
    );


  return sendQueue;
}


/* =========================
   Format System Log
========================= */

function formatSystemLine(
  level,
  message,
  detail
) {

  const ts =
    new Date()
      .toISOString()
      .slice(
        11,
        19
      );


  const icon =
    level === "error"
      ? "🔴"
      : level === "warn"
      ? "🟡"
      : level === "success"
      ? "🟢"
      : "ℹ️";


  let body =
    `${icon} *[${level.toUpperCase()}]* ${ts}\n${message}`;


  if (detail) {

    const d =
      typeof detail === "string"
        ? detail
        : detail?.stack ||
          detail?.message ||
          safeStringify(detail);


    const clipped =
      String(d).slice(
        0,
        1500
      );


    body +=
      `\n\`\`\`\n${clipped}\n\`\`\``;
  }


  return body;
}


/* =========================
   Safe JSON
========================= */

function safeStringify(
  value
) {

  try {

    return JSON.stringify(
      value
    );

  } catch {

    return String(
      value
    );
  }
}


/* =========================
   User Safe Error
========================= */

/**
 * Never sends technical
 * stack traces to users.
 */
export async function reportUserSafeError(
  conn,
  userJid,
  userMessage,
  error
) {

  /*
   * Detailed error goes only
   * to Railway/log group.
   */
  await systemLog(
    "error",
    userMessage,
    error
  );


  /*
   * Caller is responsible for
   * sending the generic message
   * to the user.
   */
}
