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
 * AUTO REACTION ENGINE
 *
 * Supports:
 * English
 * Roman Urdu
 * Roman English
 * Urdu
 * Arabic
 *
 * Uses:
 * - phrase matching
 * - word matching
 * - sentiment scoring
 * - paragraph/context scoring
 * - negation awareness
 * - media fallback
 *
 * Exactly ONE emoji is returned.
 * ========================================================= */

const AUTOREACT_KEY = "autoreact";

function normalizeReactionText(text = "") {
  return safeString(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(
      /[\u064B-\u065F\u0670\u06D6-\u06ED]/g,
      ""
    )
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------
 * Reaction categories
 * --------------------------------------------------------- */

const REACTION_CATEGORIES = {
  greeting: {
    phrases: [
      "hello", "hi", "hey",
      "good morning", "good afternoon", "good evening",
      "salam", "aoa", "assalamualaikum", "hy",
      "السلام علیکم", "سلام", "صبح بخیر"
    ],
    emojis: ["♥️", "👍", "🌹", "💝", "😊", "🤝"]
  },

  funny: {
    phrases: [
      "haha", "hahaha", "lol", "funny", "joke", "hilarious",
      "mazaq", "maza aa gaya",
      "ہاہاہا", "مذاق", "مزاح"
    ],
    emojis: ["🫂", "✨", "🙂", "👍", "💯", "🤍"]
  },

  amazing: {
    phrases: [
      "awesome", "amazing", "excellent", "fantastic", "great", "wonderful",
      "zabardast", "kamaal", "shandar", "lajawab",
      "زبردست", "کمال", "شاندار", "لاجواب"
    ],
    emojis: ["💝", "😇", "🙂", "👍", "🥀", "🌟"]
  },

  agree: {
    phrases: [
      "i agree", "exactly", "absolutely", "true", "correct", "right",
      "bilkul", "sahi kaha", "theek kaha",
      "بالکل", "صحیح کہا", "درست"
    ],
    emojis: ["💯", "👍", "💖", "🙂", "🤝", "🎀"]
  },

  love: {
    phrases: [
      "love", "i love you", "lovely", "cute", "miss you",
      "pyar", "mohabbat", "jaan", "bohat pyara",
      "پیار", "محبت", "جان", "بہت پیارا"
    ],
    emojis: ["♥️", "👍", "💌", "😍", "💖", "✨"]
  },

  thanks: {
    phrases: [
      "thanks", "thank you", "many thanks", "appreciate it",
      "shukriya", "bohat shukriya",
      "شکریہ", "بہت شکریہ", "مہربانی"
    ],
    emojis: ["♥️", "🫶", "😇", "🌹", "👍", "🤍", "🤝"]
  },

  islamic: {
    phrases: [
      "ameen", "inshaAllah", "inshallah", "Allah bless you", "pray for me",
      "mashallah", "alhamdulillah", "dua", "Allah",
      "اللّٰه", "محمد", "ان شاء اللّٰه", "ماشاء اللّٰه",
      "الحمدللہ", "دعا", "آمین"
    ],
    emojis: ["👍", "♥️", "🌹", "😇", "💞", "🫶", "💝"]
  },

  sad: {
    phrases: [
      "sad", "upset", "sorry", "heartbreaking", "i miss you",
      "dukhi", "afsos", "dukh", "rona",
      "اداس", "دکھی", "افسوس", "دکھ", "غم"
    ],
    emojis: ["🖤", "🥹", "🥀", "🙂", "🍂", "♥️"]
  },

  surprise: {
    phrases: [
      "wow", "omg", "really", "seriously", "unbelievable",
      "sachi", "waqai", "kya baat hai",
      "واقعی", "سچ میں", "کیا بات ہے"
    ],
    emojis: ["💖", "🥹", "👍", "🙃", "✨", "💯", "👌"]
  },

  congratulations: {
    phrases: [
      "congratulations", "congrats", "well done", "happy for you",
      "mubarak", "mubarak ho",
      "مبارک", "مبارک ہو", "بہت بہت مبارک"
    ],
    emojis: ["🎉", "♥️", "🥳", "💝", "😇", "🌹", "👍"]
  },

  goodNight: {
    phrases: [
      "good night", "sleep well", "sweet dreams",
      "shab bakhair",
      "شب بخیر"
    ],
    emojis: ["💖", "👍", "😊", "♥️", "😴", "🩵"]
  },

  goodMorning: {
    phrases: [
      "good morning", "have a nice day",
      "subah bakhair",
      "صبح بخیر"
    ],
    emojis: ["💖", "🌻", "💦", "♥️", "😊", "🥂", "🤝"]
  },

  goodbye: {
    phrases: [
      "bye", "goodbye", "see you", "take care",
      "allah hafiz", "khuda hafiz", "phir milenge",
      "اللہ حافظ", "خدا حافظ", "پھر ملیں گے"
    ],
    emojis: ["👍", "🌹", "🫶", "❤️", "🤲", "🥹"]
  }
};

/* =========================================================
 * EXACT FALLBACK POOLS
 * ========================================================= */

const GENERAL_REACTIONS = [
  "♥️", "✨", "🌹", "🥀", "🍃", "💕", "💯", "🤍",
  "💝", "💖", "🩵", "💞", "🤎", "🦋", "💙", "🎀",
  "💌", "💚", "💗", "🌻", "💓", "🍂", "💛", "👍",
  "❣️", "🫶", "🧡", "🫰", "💟", "💜", "😇", "❤️"
];

const MEDIA_REACTIONS = [
  "♥️", "👍", "⭐", "🩵", "🪄", "🎁", "💝", "🪷",
  "💖", "🎉", "💙", "💜", "🤎", "🤍", "🩷", "💫",
  "💗", "💞", "🌺", "💌", "💟", "😍", "💦", "❤️",
  "🫅", "🧡", "💐", "💛", "🦅", "💚", "🙂", "🌟",
  "🦋", "🍁", "💓", "🥂", "💕", "☕", "🎀", "💥",
  "🎊", "🌹", "💸", "👑", "✨", "🌻", "🍂", "🫶",
  "🍷", "🫰", "💯", "🍃", "❣️"
];

const EMOJI_FAMILIES = [
  {
    emojis: [
      "🤣", "😂", "🤭", "😆", "😄", "😅", "😹", "😛",
      "😜", "🤡", "🤪", "😝", "😀", "👻", "😃", "🤥", "😁"
    ],
    reaction: "😁"
  },

  {
    emojis: [
      "😔", "☹️", "😞", "😩", "😢", "💔", "😿", "😭",
      "😪", "😥", "😕", "😓", "🥺", "😫", "🤕", "😣",
      "🫥", "😐", "😑", "🙎", "😖", "🙍", "😦"
    ],
    reaction: "🥺"
  },

  {
    emojis: [
      "🕌", "🕋", "☪️", "👳", "🛐", "🧕", "🤲", "📿"
    ],
    reactions: ["🫶", "♥️", "🌹"]
  },

  {
    emojis: [
      "😍", "💕", "♥️", "💑", "💘", "💖", "😘", "❤️",
      "🥰", "💗", "💝", "❤️‍🩹", "💟", "💞", "💜",
      "💓", "😚", "💋", "❣️"
    ],
    reactions: ["😍", "💞", "♥️"]
  }
];

/* =========================================================
 * MESSAGE TEXT EXTRACTION
 * ========================================================= */

function getReactionText(message) {
  const values = [
    message?.body,
    message?.text,
    message?.caption,
    message?.message?.conversation,
    message?.message?.extendedTextMessage?.text,
    message?.message?.imageMessage?.caption,
    message?.message?.videoMessage?.caption,
    message?.quoted?.body,
  ];

  return values
    .map(safeString)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
}

/* =========================================================
 * MESSAGE TYPE
 * ========================================================= */

function getMessageType(message) {
  const direct = safeString(
    message?.messageTypeKey ||
    message?.type
  ).toLowerCase();

  if (direct) {
    if (
      direct.includes("sticker")
    ) {
      return "sticker";
    }

    if (
      direct.includes("audio") ||
      direct.includes("ptt") ||
      direct.includes("voice")
    ) {
      return "audio";
    }

    if (
      direct.includes("image") ||
      direct.includes("photo")
    ) {
      return "image";
    }

    if (
      direct.includes("video")
    ) {
      return "video";
    }

    if (
      direct.includes("document")
    ) {
      return "document";
    }
  }

  const raw =
    message?.rawMessage ||
    message?.originalMessage ||
    message?.message ||
    {};

  const content =
    raw?.message ||
    raw;

  const keys = Object.keys(
    content || {}
  ).map((x) => x.toLowerCase());

  if (
    keys.some((x) =>
      x.includes("sticker")
    )
  ) {
    return "sticker";
  }

  if (
    keys.some((x) =>
      x.includes("audio")
    )
  ) {
    return "audio";
  }

  if (
    keys.some((x) =>
      x.includes("image")
    )
  ) {
    return "image";
  }

  if (
    keys.some((x) =>
      x.includes("video")
    )
  ) {
    return "video";
  }

  if (
    keys.some((x) =>
      x.includes("document")
    )
  ) {
    return "document";
  }

  return "text";
}

/* =========================================================
 * AUTO REACTION MATCH HELPERS
 * ========================================================= */

function reactionPhraseMatches(text, phrases = []) {
  let count = 0;

  for (const phrase of phrases) {
    const p = normalizeReactionText(phrase);
    if (!p) continue;

    if (text.includes(p)) {
      count++;
    }
  }

  return count;
}

function reactionEmojiFamily(text) {
  for (const family of EMOJI_FAMILIES) {
    if (
      family.emojis.some((emoji) =>
        text.includes(emoji)
      )
    ) {
      return family;
    }
  }

  return null;
}

/* =========================================================
 * PICK RANDOM
 * ========================================================= */

function randomItem(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return null;
  }

  return array[
    Math.floor(Math.random() * array.length)
  ];
}

/* =========================================================
 * SMART REACTION
 * ========================================================= */

function getAutoReaction(message) {
  const text = normalizeReactionText(
    getReactionText(message)
  );

  const type = getMessageType(message);

  /*
   * MEDIA WITHOUT CAPTION
   *
   * image / video / sticker / audio / voice
   * always use MEDIA_REACTIONS.
   */
  if (!text) {
    if (
      type === "image" ||
      type === "video" ||
      type === "sticker" ||
      type === "audio"
    ) {
      return randomItem(MEDIA_REACTIONS);
    }

    return randomItem(GENERAL_REACTIONS);
  }

  /*
   * 1. TEXT / CAPTION CATEGORY MATCH
   *
   * Category matching ALWAYS has priority over
   * emoji-family matching.
   */
  for (const data of Object.values(REACTION_CATEGORIES)) {
    if (
      reactionPhraseMatches(
        text,
        data.phrases || []
      ) > 0
    ) {
      return randomItem(data.emojis);
    }
  }

  /*
   * 2. NO WORD MATCH -> EMOJI FAMILY MATCH
   */
  const emojiFamily = reactionEmojiFamily(text);

  if (emojiFamily) {
    if (emojiFamily.reaction) {
      return emojiFamily.reaction;
    }

    return randomItem(
      emojiFamily.reactions
    );
  }

  /*
   * 3. NO TEXT / EMOJI MATCH
   *
   * Captioned image/video and normal text
   * use GENERAL_REACTIONS.
   */
  return randomItem(GENERAL_REACTIONS);
}



/* =========================================================
 * SMART REACTION
 * ========================================================= */

/* =========================================================
 * SHOULD AUTO REACT
 * ========================================================= */

function shouldAutoReact(message) {
  if (!message) {
    return false;
  }

  /* NEVER react to our own messages */
  if (
    message?.key?.fromMe === true
  ) {
    return false;
  }

  /* NEVER react to bot-generated messages */
  if (
    message?.isBotMessage === true
  ) {
    return false;
  }

  /* Owner messages */
  if (
    isOwnerMessage(message)
  ) {
    return false;
  }

  const jid =
    safeString(
      message?.from ||
      message?.key?.remoteJid
    );

  if (!jid) {
    return false;
  }

  /* WhatsApp status */
  if (
    jid ===
    "status@broadcast"
  ) {
    return false;
  }

  /* Broadcast */
  if (
    jid.includes(
      "broadcast"
    )
  ) {
    return false;
  }

  /* No key = no safe reaction */
  if (
    !message?.key
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * AUTO REACTION EXECUTOR
 * ========================================================= */

async function handleAutoReaction(
  message,
  conn,
  sessionId = "default"
) {
  try {
    if (
      !shouldAutoReact(
        message
      )
    ) {
      return;
    }

    const enabled =
      await kvGet(
        `${AUTOREACT_KEY}:${sessionId}`
      );

    /*
     * undefined/null means default ON.
     * Explicit false means OFF.
     */
    if (
      enabled === false
    ) {
      return;
    }

    const reaction =
      getAutoReaction(
        message
      );

    if (!reaction) {
      return;
    }

    const jid =
      message?.from ||
      message?.key?.remoteJid;

    if (!jid) {
      return;
    }

    await conn.sendMessage(
      jid,
      {
        react: {
          text: reaction,
          key: message.key,
        },
      }
    );

  } catch (error) {
    try {
      logger.debug?.(
        `[AutoReact] ${
          error?.message ||
          error
        }`
      );
    } catch {}
  }
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
  const body =
    getCommandBody(message);

  if (!body) {
    return "unknown";
  }

  const prefix =
    safeString(
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

export async function messageHandler(
  params
) {
  const message =
    params?.message;

  const conn =
    params?.conn;

  const sessionId =
    params?.sessionId || "default";

  try {

    /* =====================================================
     * BASIC VALIDATION
     * ===================================================== */

    if (
      !message ||
      !conn
    ) {
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
     * AUTO REACTION
     *
     * Runs before command processing.
     *
     * Own messages are automatically skipped.
     * Public user commands can also receive a reaction.
     * ===================================================== */

    await handleAutoReaction(
      message,
      conn,
      sessionId
    );

    /* =====================================================
     * BODY
     * ===================================================== */

    const body =
      getCommandBody(message);

    /* =====================================================
     * MEDIA-ONLY MESSAGE
     *
     * Reaction has already been handled above.
     * No command processing needed.
     * ===================================================== */

    if (!body) {
      return;
    }

    /* =====================================================
     * COMMAND CHECK
     * ===================================================== */

    const isCommand =
      isCommandBody(body);

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
      await checkCommandFlag(
        name
      );

    if (
      !flagCheck?.ok
    ) {

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

    if (
      !policy?.ok
    ) {

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
        msgs[
          policy?.reason
        ] ||
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
        disabled.includes(
          name
        ) &&
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
            error?.message ||
            error
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
      conn,
      sessionId
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
      error?.message ||
        error
    );

    console.error(
      error?.stack || ""
    );

    try {
      recordError();
    } catch {}

    const where =
      `${commandNameSafe(
        message
      )} @ ${
        message?.from ||
        "?"
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
