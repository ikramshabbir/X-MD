/**
 * Bot system log group — onboarding + internal logs only.
 * Safe version: does NOT auto-create WhatsApp groups.
 */

import { kvGet, kvSet } from "../database/botKv.js";
import { getOwnerNumbers, normalizeNumber } from "./access.js";

const LOG_GROUP_KEY = "log_group_jid";
const SETUP_DONE_KEY = "setup_done";

let connRef = null;
let sendQueue = Promise.resolve();
let lastSendAt = 0;

const MIN_GAP_MS = 1500;

export function attachLogGroupConn(conn) {
  connRef = conn;
}

export async function getLogGroupJid() {
  return (await kvGet(LOG_GROUP_KEY)) || null;
}

export async function setLogGroupJid(jid) {
  await kvSet(LOG_GROUP_KEY, jid);
  return jid;
}

export async function isSetupDone() {
  return !!(await kvGet(SETUP_DONE_KEY));
}

export async function markSetupDone(done = true) {
  await kvSet(SETUP_DONE_KEY, !!done);
}

/**
 * Synchronous check is intentionally conservative.
 */
export function isLogGroup(jid) {
  return false;
}

export async function isLogGroupAsync(jid) {
  const log = await getLogGroupJid();
  return !!(log && jid === log);
}

function ownerJids() {
  return getOwnerNumbers().map(
    (n) => `${n}@s.whatsapp.net`
  );
}

function botBareJid(conn) {
  const id = conn?.user?.id;

  if (!id) return null;

  return id.replace(/:\d+@/, "@");
}

/**
 * Ensure system log group.
 *
 * IMPORTANT:
 * We no longer call conn.groupCreate().
 *
 * Baileys 7 rc13 can return an invalid group metadata
 * response on some WhatsApp accounts, causing:
 *
 * "Invalid group metadata response: missing <group> node"
 *
 * The bot will continue normally without an automatic
 * system group.
 *
 * To use a log group:
 * 1. Create a WhatsApp group manually.
 * 2. Add the bot.
 * 3. Set the group using #setlog if supported.
 */
export async function ensureLogGroup(conn) {
  attachLogGroupConn(conn);

  const jid = await getLogGroupJid();

  /*
   * Existing saved log group.
   */
  if (jid) {
    try {
      await conn.groupMetadata(jid);

      return {
        jid,
        created: false,
        needsManual: false,
      };

    } catch (err) {

      console.warn(
        "[log-group] Saved log group is unavailable. Clearing it."
      );

      try {
        await kvSet(
          LOG_GROUP_KEY,
          ""
        );
      } catch {}

      return {
        jid: null,
        created: false,
        needsManual: true,
      };
    }
  }

  /*
   * Do NOT automatically create a group.
   */
  console.log(
    "[log-group] No system log group configured."
  );

  console.log(
    "[log-group] Create a WhatsApp group manually and add the bot."
  );

  console.log(
    "[log-group] Then use the bot's #setlog command if available."
  );

  return {
    jid: null,
    created: false,
    needsManual: true,
  };
}

/**
 * Send a system message to the log group only.
 */
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
   * Always mirror to console.
   */
  if (level === "error") {
    console.error(text);
  } else if (level === "warn") {
    console.warn(text);
  } else {
    console.log(text);
  }

  /*
   * Record errors in metrics.
   */
  if (level === "error") {
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

  const jid =
    await getLogGroupJid();

  /*
   * No log group configured.
   * Console logging still works.
   */
  if (!jid || !connRef) {
    return;
  }

  /*
   * Serialize system messages so WhatsApp
   * is not spammed with simultaneous sends.
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

/**
 * Format internal system log.
 */
function formatSystemLine(
  level,
  message,
  detail
) {
  const ts =
    new Date()
      .toISOString()
      .slice(11, 19);

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
          JSON.stringify(detail);

    const clipped =
      String(d).slice(0, 1500);

    body +=
      `\n\`\`\`\n${clipped}\n\`\`\``;
  }

  return body;
}

/**
 * User-facing safe error.
 * Never sends stack traces to users.
 */
export async function reportUserSafeError(
  conn,
  userJid,
  userMessage,
  error
) {
  await systemLog(
    "error",
    userMessage,
    error
  );

  /*
   * Caller sends userMessage to the user.
   * Detailed error remains internal.
   */
}
