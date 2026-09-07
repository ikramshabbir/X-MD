/**
 * Message Handler — ACL, flags, policy, audit, metrics
 * + Content-based Auto Reaction
 */

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
import {
  checkCommandFlag,
} from "../enterprise/flags.js";
import {
  evaluatePolicy,
} from "../enterprise/policy.js";
import {
  writeAudit,
} from "../enterprise/audit.js";
import {
  recordCommand,
  recordError,
} from "../enterprise/metrics.js";
import { kvGet } from "../database/botKv.js";

const AUTOREACT_KEY = "autoreact";

/*
 * =========================================================
 * AUTO REACTION
 * =========================================================
 *
 * Emoji + Urdu + Roman Urdu + English
 */

const reactionGroups = [
  {
    emojis: ["😂", "🤣"],
    words: [
      "haha",
      "hahaha",
      "hehe",
      "lol",
      "lmao",
      "funny",
      "joke",
      "mazak",
      "mazaq",
      "hansi",
      "ہاہا",
      "ہا ہا",
      "مزاح",
      "مذاق",
      "ہنسی",
      "مزاحیہ",
    ],
    reaction: "😂",
  },

  {
    emojis: ["😢", "😭", "💔"],
    words: [
      "sad",
      "sadness",
      "dukhi",
      "dukh",
      "dard",
      "rona",
      "ro raha",
      "ro rahi",
      "afsos",
      "sorry",
      "miss you",
      "miss",
      "unfortunately",
      "اداس",
      "دکھی",
      "دکھ",
      "درد",
      "رونا",
      "رو رہا",
      "رو رہی",
      "افسوس",
      "معاف",
      "یاد",
    ],
    reaction: "😢",
  },

  {
    emojis: ["❤️", "🥰", "😍", "😘"],
    words: [
      "love",
      "lovely",
      "romantic",
      "pyar",
      "pyaar",
      "mohabbat",
      "ishq",
      "jaan",
      "jaanam",
      "baby",
      "beautiful",
      "handsome",
      "cute",
      "sweet",
      "پیار",
      "محبت",
      "عشق",
      "جان",
      "جانم",
      "خوبصورت",
      "حسین",
      "دل",
      "رومانٹک",
    ],
    reaction: "😍",
  },

  {
    emojis: ["😡", "🤬", "😤"],
    words: [
      "angry",
      "anger",
      "gussa",
      "ghussa",
      "naraz",
      "naraaz",
      "nafrat",
      "hate",
      "bakwas",
      "pagal",
      "stupid",
      "mad",
      "غصہ",
      "غصے",
      "ناراض",
      "نفرت",
      "بکواس",
      "پاگل",
      "احمق",
    ],
    reaction: "🥺",
  },

  {
    emojis: ["😮", "😳", "😱"],
    words: [
      "wow",
      "amazing",
      "awesome",
      "incredible",
      "zabardast",
      "kamaal",
      "kamal",
      "shandar",
      "wah",
      "waah",
      "surprise",
      "shocking",
      "زبردست",
      "کمال",
      "شاندار",
      "واہ",
      "حیرت",
      "حیران",
      "حیران کن",
    ],
    reaction: "😳",
  },

  {
    emojis: ["🎉", "🥳", "👏"],
    words: [
      "congrats",
      "congratulations",
      "congratulation",
      "mubarak",
      "mubarak ho",
      "well done",
      "shabash",
      "success",
      "successful",
      "passed",
      "pass ho",
      "مبارک",
      "مبارک ہو",
      "مبارکباد",
      "شاباش",
      "کامیابی",
      "کامیاب",
      "پاس",
    ],
    reaction: "🌹",
  },

  {
    emojis: ["🤔", "❓"],
    words: [
      "kya",
      "kia",
      "kyun",
      "kyu",
      "kaise",
      "kese",
      "kab",
      "kahan",
      "kon",
      "kaun",
      "what",
      "why",
      "how",
      "when",
      "where",
      "who",
      "کیا",
      "کیوں",
      "کیسے",
      "کب",
      "کہاں",
      "کون",
    ],
    reaction: "🤔",
  },
];

/**
 * Get reaction based on message content.
 */
function getAutoReaction(text = "") {
  const msg = String(text).toLowerCase().trim();

  /*
   * 1. Emoji priority
   */
  for (const group of reactionGroups) {
    if (
      group.emojis.some((emoji) =>
        msg.includes(emoji)
      )
    ) {
      return group.reaction;
    }
  }

  /*
   * 2. Urdu + Roman Urdu + English
   */
  for (const group of reactionGroups) {
    if (
      group.words.some((word) =>
        msg.includes(word.toLowerCase())
      )
    ) {
      return group.reaction;
    }
  }

  /*
   * 3. Other posts
   */
  return "❤️";
}


/*
 * =========================================================
 * AUDIT ACTIONS
 * =========================================================
 */

const AUDIT_ACTIONS = new Set([
  "kick",
  "warn",
  "mute",
  "unmute",
  "promote",
  "demote",
  "mode",
  "sudo",
  "broadcast",
  "disable",
  "enable",
  "flag",
  "policy",
  "role",
  "backup",
  "setlog",
  "createlog",
]);


/*
 * =========================================================
 * MESSAGE HANDLER
 * =========================================================
 */

export async function messageHandler(params) {
  const { message, conn } = params;

  try {
    /*
     * Ignore bot messages
     */
    if (message.isBotMessage) return;

    /*
     * Ignore messages without text/body
     */
    if (!message.body) return;


    /*
     * =====================================================
     * AUTO REACTION
     * =====================================================
     */

    try {
      const autoReact =
        await kvGet(AUTOREACT_KEY);

      /*
       * Default = ON
       */
      if (autoReact !== false) {
        const reaction =
          getAutoReaction(message.body);

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
    } catch (error) {
      /*
       * Reaction failure must NOT stop commands
       */
    }


    /*
     * =====================================================
     * COMMAND HANDLER
     * =====================================================
     */

    if (
      !message.body.startsWith(
        BOT_INFO.PREFIX
      )
    ) {
      return;
    }

    const command =
      findCommand(message.body);

    if (!command) return;

    const name =
      (
        command.patternName || ""
      ).toLowerCase();

    const privileged =
      await isPrivileged(
        message,
        conn
      );

    /*
     * Access check
     */
    const access =
      await checkCommandAccess(
        message,
        command,
        conn
      );

    if (!access.allowed) {
      if (access.silent) return;

      await sendError(
        conn,
        message.from,
        access.reason ||
          "OWNER_ONLY"
      );

      return;
    }


    /*
     * Feature flag
     */
    const flagCheck =
      await checkCommandFlag(name);

    if (!flagCheck.ok) {

      if (
        flagCheck.flag ===
          "maintenance" &&
        privileged
      ) {
        /*
         * Privileged users can continue
         * during maintenance.
         */
      }

      else if (
        flagCheck.flag ===
        "maintenance"
      ) {

        await sendError(
          conn,
          message.from,
          "🛠 Bot is in *maintenance mode*. Try again later."
        );

        return;
      }

      else {

        await sendError(
          conn,
          message.from,
          `⚠️ Feature *${flagCheck.flag}* is disabled.`
        );

        return;
      }
    }


    /*
     * Policy
     */
    const policy =
      await evaluatePolicy(
        message,
        command,
        {
          privileged,
        }
      );

    if (!policy.ok) {

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
        msgs[policy.reason] ||
          policy.reason
      );

      return;
    }


    /*
     * Group disabled plugins
     */
    if (
      message.isGroup &&
      command.patternName
    ) {

      const settings =
        await getGroupSettings(
          message.from
        );

      const disabled =
        settings.disabledPlugins ||
        [];

      if (
        disabled.includes(name)
      ) {

        if (!privileged) {

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
    }


    /*
     * Logger
     */
    logger.command(
      name || "unknown",
      message.sender,
      message.isGroup
        ? message.from
        : null
    );


    /*
     * Command validation
     */
    const validation =
      await validateCommand(
        message,
        command,
        conn
      );

    if (!validation.valid) {

      await sendError(
        conn,
        message.from,
        validation.error
      );

      return;
    }


    /*
     * Group permissions
     */
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

      if (!groupValidation.valid) {

        await sendError(
          conn,
          message.from,
          groupValidation.error
        );

        return;
      }
    }


    /*
     * Command acknowledgement
     */
    await ackCommand(
      conn,
      message
    );

    /*
     * Metrics
     */
    recordCommand(
      name || "unknown"
    );


    /*
     * Execute command
     */
    await command.function(
      message,
      conn
    );


    /*
     * Audit
     */
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
          body: String(
            message.body || ""
          ).slice(0, 120),
        },
      }).catch(() => {});
    }

  }

  catch (error) {

    recordError();

    const where =
      `${commandNameSafe(message)} @ ${
        message?.from || "?"
      }`;

    await systemLog(
      "error",
      `Handler crash: ${where}`,
      error
    );


    const inLog =
      await isLogGroupAsync(
        message?.from
      );


    try {

      if (inLog) {

        await sendError(
          conn,
          message.from,
          `Handler error: ${
            error?.message ||
            "unknown"
          } (see log above)`
        );

      }

      else {

        await sendError(
          conn,
          message.from,
          await t("FAILED")
        );
      }

    }

    catch (sendErr) {

      recordError();

      await systemLog(
        "error",
        "Failed to send user-safe error",
        sendErr
      );
    }
  }
}


/*
 * =========================================================
 * SAFE COMMAND NAME
 * =========================================================
 */

function commandNameSafe(message) {

  try {

    const body =
      message?.body || "";

    return (
      body.split(/\s+/)[0] ||
      "unknown"
    );

  }

  catch {

    return "unknown";
  }
}
