import { findCommand } from "../plugins.js";

import { validateCommand } from "../utils/validation.js";

import {
  checkCommandAccess,
  isPrivileged,
} from "../utils/access.js";

import {
  sendError,
  ackCommand,
} from "../utils/message.js";

import { validateGroupPermissions } from "../utils/group.js";

import { groupCache } from "../utils/cache.js";

import { getGroupSettings } from "../utils/groupSettings.js";

import { BOT_INFO } from "../config/constants.js";

import { t } from "../utils/i18n.js";

import logger from "../utils/logger.js";

import {
  systemLog,
  isLogGroupAsync,
} from "../utils/logGroup.js";

import { checkCommandFlag } from "../enterprise/flags.js";

import { evaluatePolicy } from "../enterprise/policy.js";

import { writeAudit } from "../enterprise/audit.js";

import {
  recordCommand,
  recordError,
} from "../enterprise/metrics.js";

import { kvGet } from "../database/botKv.js";

/* =========================================================
 * HELPERS
 * ========================================================= */

function safeString(value = "") {
  return value == null ? "" : String(value);
}

function normalizeNumber(number = "") {
  return safeString(number).replace(/[^0-9]/g, "");
}

function getCommandBody(message) {
  return safeString(message?.body).trim();
}

function isCommandBody(body) {
  const prefix = safeString(
    BOT_INFO?.PREFIX || "."
  );

  return Boolean(
    prefix &&
    body.startsWith(prefix)
  );
}

/* =========================================================
 * OWNER CHECK
 * ========================================================= */

function isOwnerMessage(message) {
  const owner = normalizeNumber(
    BOT_INFO?.OWNER ||
    process.env.OWNER_NUMBER ||
    ""
  );

  if (!owner) {
    return false;
  }

  const possibleSenders = [
    message?.sender,
    message?.participant,
    message?.key?.participant,
    message?.key?.remoteJid,
  ];

  return possibleSenders.some((value) => {
    const sender = normalizeNumber(value);

    return (
      sender &&
      (
        sender === owner ||
        sender.endsWith(owner) ||
        owner.endsWith(sender)
      )
    );
  });
}

/* =========================================================
 * AUTO REACTION
 * ========================================================= */

const AUTOREACT_KEY = "autoreact";

function getAutoReaction(body) {
  const text = safeString(body).toLowerCase();

  if (
    text.includes("lol") ||
    text.includes("haha")
  ) {
    return "😂";
  }

  if (
    text.includes("love") ||
    text.includes("cute")
  ) {
    return "❤️";
  }

  return null;
}

/* =========================================================
 * AUDIT ACTIONS
 * ========================================================= */

const AUDIT_ACTIONS = new Set([
  "mode",
  "sudo",
  "broadcast",
  "setlog",
  "createlog",
  "setup",
  "groupsetup",
  "backup",
  "role",
  "flag",
  "policy",
  "audit",
  "metrics",
]);

/* =========================================================
 * COMMAND NAME
 * ========================================================= */

function commandNameSafe(message) {
  const body = getCommandBody(message);

  if (!body) {
    return "unknown";
  }

  const prefix = safeString(
    BOT_INFO?.PREFIX || "."
  );

  let command = body;

  if (
    prefix &&
    body.startsWith(prefix)
  ) {
    command = body
      .slice(prefix.length)
      .trim();
  }

  return (
    command.split(/\s+/)[0] ||
    "unknown"
  );
}

/* =========================================================
 * MESSAGE HANDLER
 * ========================================================= */

export async function messageHandler(params) {
  const message = params?.message;
  const conn = params?.conn;

  try {
    /* =====================================================
     * BASIC VALIDATION
     * ===================================================== */

    if (!message || !conn) {
      return;
    }

    /* =====================================================
     * BOT MESSAGE CHECK
     *
     * IMPORTANT:
     * fromMe commands MUST continue.
     * ===================================================== */

    if (
      message?.isBotMessage === true &&
      message?.key?.fromMe !== true
    ) {
      return;
    }

    /* =====================================================
     * BODY
     * ===================================================== */

    const body =
      getCommandBody(message);

    if (!body) {
      return;
    }

    /* =====================================================
     * COMMAND CHECK
     * ===================================================== */

    const isCommand =
      isCommandBody(body);

    /* =====================================================
     * AUTO REACTION
     * ===================================================== */

    try {
      const autoReact =
        await kvGet(AUTOREACT_KEY);

      if (
        autoReact !== false &&
        !isCommand &&
        !isOwnerMessage(message)
      ) {
        const reaction =
          getAutoReaction(body);

        if (reaction) {
          await conn.sendMessage(
            message.from,
            {
              react: {
                text: reaction,
                key: message.key,
              },
            }
          );
        }
      }
    } catch (error) {
      try {
        logger.debug?.(
          `[AutoReact] ${
            error?.message || error
          }`
        );
      } catch {}
    }

    /* =====================================================
     * NOT A COMMAND
     * ===================================================== */

    if (!isCommand) {
      return;
    }

    /* =====================================================
     * DEBUG
     * ===================================================== */

    try {
      logger.debug?.(
        `[CMD DEBUG] body=${JSON.stringify(
          body
        )} prefix=${JSON.stringify(
          BOT_INFO?.PREFIX
        )} fromMe=${Boolean(
          message?.key?.fromMe
        )}`
      );
    } catch {}

    console.log(
      "🔥 COMMAND RECEIVED:",
      body,
      "fromMe:",
      Boolean(
        message?.key?.fromMe
      )
    );

    /* =====================================================
     * FIND COMMAND
     * ===================================================== */

    const command =
      findCommand(body);

    if (!command) {
      console.log(
        "❌ COMMAND NOT FOUND:",
        body
      );

      try {
        await conn.sendMessage(
          message.from,
          {
            text:
              `❌ Command not found.\nUse ${
                BOT_INFO?.PREFIX || "."
              }menu`,
          }
        );
      } catch (error) {
        console.error(
          "❌ Failed to send command-not-found:",
          error?.message || error
        );
      }

      return;
    }

    /* =====================================================
     * COMMAND NAME
     * ===================================================== */

    const name =
      safeString(
        command.patternName
      ).toLowerCase();

    console.log(
      "✅ COMMAND FOUND:",
      name
    );

    try {
      logger.debug?.(
        `[CMD DEBUG] command=${
          name || "unknown"
        }`
      );
    } catch {}

    /* =====================================================
     * PRIVILEGED
     * ===================================================== */

    const privileged =
      await isPrivileged(
        message,
        conn
      );

    console.log(
      "🔐 PRIVILEGED:",
      privileged
    );

    /* =====================================================
     * ACCESS
     * ===================================================== */

    const access =
      await checkCommandAccess(
        message,
        command,
        conn
      );

    console.log(
      "🔐 ACCESS:",
      access
    );

    if (
      !access ||
      access.allowed !== true
    ) {
      const silent =
        access?.silent === true;

      console.log(
        "⛔ COMMAND ACCESS DENIED:",
        name,
        access
      );

      if (silent) {
        return;
      }

      await sendError(
        conn,
        message.from,
        access?.reason ||
          "OWNER_ONLY"
      );

      return;
    }

    /* =====================================================
     * FEATURE FLAG
     * ===================================================== */

    const flagCheck =
      await checkCommandFlag(name);

    if (!flagCheck?.ok) {
      if (
        flagCheck?.flag ===
          "maintenance" &&
        privileged
      ) {
        // Privileged user may continue.
      } else if (
        flagCheck?.flag ===
        "maintenance"
      ) {
        await sendError(
          conn,
          message.from,
          "🛠 Bot is in *maintenance mode*. Try again later."
        );

        return;
      } else {
        await sendError(
          conn,
          message.from,
          `⚠️ Feature *${
            flagCheck?.flag ||
            "unknown"
          }* is disabled.`
        );

        return;
      }
    }

    /* =====================================================
     * POLICY
     * ===================================================== */

    const policy =
      await evaluatePolicy(
        message,
        command,
        {
          privileged,
        }
      );

    if (!policy?.ok) {
      const msgs = {
        QUIET_HOURS:
          "🌙 Quiet hours — try again later.",

        RATE_LIMIT:
          "⏳ Slow down — rate limit hit.",

        MEDIA_DISABLED:
          "⚠️ Media commands are disabled by policy.",

        BROADCAST_BLOCKED:
          "⚠️ Broadcast is blocked by policy.",
      };

      await sendError(
        conn,
        message.from,
        msgs[policy?.reason] ||
          policy?.reason ||
          "Command blocked by policy."
      );

      return;
    }

    /* =====================================================
     * GROUP DISABLED PLUGINS
     * ===================================================== */

    if (
      message.isGroup &&
      command.patternName
    ) {
      const settings =
        await getGroupSettings(
          message.from
        );

      const disabled =
        Array.isArray(
          settings?.disabledPlugins
        )
          ? settings.disabledPlugins
          : [];

      if (
        disabled.includes(name) &&
        !privileged
      ) {
        await sendError(
          conn,
          message.from,
          await t(
            "PLUGIN_DISABLED"
          )
        );

        return;
      }
    }

    /* =====================================================
     * LOGGER
     * ===================================================== */

    try {
      logger.command(
        name || "unknown",
        message.sender,
        message.isGroup
          ? message.from
          : null
      );
    } catch {}

    /* =====================================================
     * COMMAND VALIDATION
     * ===================================================== */

    const validation =
      await validateCommand(
        message,
        command,
        conn
      );

    if (
      !validation?.valid
    ) {
      await sendError(
        conn,
        message.from,
        validation?.error ||
          "Command validation failed."
      );

      return;
    }

    /* =====================================================
     * GROUP PERMISSIONS
     * ===================================================== */

    if (
      message.isGroup &&
      (
        command.adminOnly ||
        command.botAdminRequired
      )
    ) {
      let groupMetadata =
        groupCache.get(
          message.from
        );

      if (!groupMetadata) {
        groupMetadata =
          await conn.groupMetadata(
            message.from
          );

        groupCache.set(
          message.from,
          groupMetadata
        );
      }

      const groupValidation =
        validateGroupPermissions(
          message,
          groupMetadata,
          {
            adminOnly:
              command.adminOnly,

            botAdminRequired:
              command.botAdminRequired,
          },
          conn
        );

      if (
        !groupValidation?.valid
      ) {
        await sendError(
          conn,
          message.from,
          groupValidation?.error ||
            "Group permission denied."
        );

        return;
      }
    }

    /* =====================================================
     * ACK
     * ===================================================== */

    try {
      await ackCommand(
        conn,
        message
      );
    } catch (error) {
      try {
        logger.debug?.(
          `[ACK] ${
            error?.message || error
          }`
        );
      } catch {}
    }

    /* =====================================================
     * METRICS
     * ===================================================== */

    try {
      recordCommand(
        name || "unknown"
      );
    } catch {}

    /* =====================================================
     * EXECUTE COMMAND
     * ===================================================== */

    if (
      typeof command.function !==
      "function"
    ) {
      throw new Error(
        `Command "${name}" has no executable function`
      );
    }

    console.log(
      "🚀 EXECUTING COMMAND:",
      name
    );

    await command.function(
      message,
      conn
    );

    console.log(
      "✅ COMMAND EXECUTED:",
      name
    );

    /* =====================================================
     * AUDIT
     * ===================================================== */

    if (
      AUDIT_ACTIONS.has(name)
    ) {
      writeAudit({
        action:
          `cmd.${name}`,

        actor:
          message.sender,

        chat:
          message.from,

        meta: {
          body:
            body.slice(
              0,
              120
            ),
        },
      }).catch(
        () => {}
      );
    }

  } catch (error) {

    /* =====================================================
     * HANDLER ERROR
     * ===================================================== */

    console.error(
      "❌ MESSAGE HANDLER ERROR:",
      error?.message || error
    );

    console.error(
      error?.stack || ""
    );

    try {
      recordError();
    } catch {}

    const where =
      `${commandNameSafe(message)} @ ${
        message?.from || "?"
      }`;

    try {
      await systemLog(
        "error",
        `Handler crash: ${where}`,
        error
      );
    } catch {}

    let inLog = false;

    try {
      inLog =
        await isLogGroupAsync(
          message?.from
        );
    } catch {
      inLog = false;
    }

    try {
      if (
        message?.from &&
        inLog
      ) {
        await sendError(
          conn,
          message.from,
          `Handler error: ${
            error?.message ||
            "unknown"
          } (see log above)`
        );
      } else if (
        message?.from
      ) {
        await sendError(
          conn,
          message.from,
          await t("FAILED")
        );
      }
    } catch (sendErr) {

      try {
        recordError();
      } catch {}

      try {
        await systemLog(
          "error",
          "Failed to send user-safe error",
          sendErr
        );
      } catch {}
    }
  }
}
