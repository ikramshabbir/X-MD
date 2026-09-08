/**
 * Message Handler — ACL, flags, policy, audit, metrics
 * + Deep Content-based Auto Reaction
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


/*
 * =========================================================
 * AUTO REACTION CONFIG
 * =========================================================
 */

const AUTOREACT_KEY = "autoreact";


/*
 * =========================================================
 * DEEP REACTION RULES
 * =========================================================
 *
 * One message = one emoji
 *
 * Arabic language = 🌹 ONLY
 *
 * Urdu / Roman Urdu / English:
 * Context + emotion based reaction
 */

const DEEP_REACTION_RULES = [

  /*
   * HEARTBREAK
   */

  {
    name: "heartbreak",
    emoji: "💔",
    priority: 100,

    keywords: [
      "heartbreak",
      "broken heart",
      "breakup",
      "break up",
      "betrayal",
      "betrayed",
      "cheated",
      "cheating",

      "bewafa",
      "bewafai",
      "dhoka",
      "dhokha",
      "judai",
      "dil toot",
      "dil tut",

      "دل ٹوٹ",
      "دل توڑ",
      "دل ٹوٹا",
      "دل ٹوٹ گیا",
      "بے وفائی",
      "بے وفا",
      "دھوکہ",
      "جدائی",
    ],
  },


  /*
   * LOVE
   */

  {
    name: "love",
    emoji: "❤️",
    priority: 95,

    keywords: [
      "i love you",
      "love you",
      "true love",
      "my love",
      "loving",
      "romantic",
      "romance",

      "mohabbat",
      "mohabbat hai",
      "pyar",
      "pyaar",
      "ishq",
      "ashiq",
      "aashiq",
      "chahat",
      "meri jaan",
      "jaan",
      "jaanam",

      "محبت",
      "پیار",
      "عشق",
      "چاہت",
      "میری جان",
      "جان",
      "جانم",
    ],
  },


  /*
   * SADNESS
   */

  {
    name: "sadness",
    emoji: "😢",
    priority: 90,

    keywords: [
      "sad",
      "sadness",
      "cry",
      "crying",
      "tears",
      "lonely",
      "alone",

      "miss you",
      "missing you",
      "miss someone",
      "i miss",

      "dukhi",
      "dukh",
      "dard",
      "udaas",
      "afsos",
      "rona",
      "ro raha",
      "ro rahi",
      "tanha",
      "tanhai",

      "اداس",
      "دکھی",
      "دکھ",
      "درد",
      "افسوس",
      "رونا",
      "رو رہا",
      "رو رہی",
      "تنہا",
      "تنہائی",
      "یاد آتی",
      "یاد آتا",
    ],
  },


  /*
   * DUA
   */

  {
    name: "dua",
    emoji: "🤲",
    priority: 88,

    keywords: [
      "dua",
      "duaa",
      "prayer",
      "pray for me",
      "pray for us",
      "please pray",

      "ameen",
      "aameen",

      "allah help",
      "allah madad",

      "mere liye dua",
      "hamare liye dua",

      "دعا",
      "دعائیں",
      "دعا کریں",
      "میرے لیے دعا",
      "میرے لئے دعا",
      "ہمارے لیے دعا",
      "آمین",
      "اللہ مدد",
      "اللہ آسانی",
    ],
  },


  /*
   * RELIGIOUS
   */

  {
    name: "religious",
    emoji: "❤️",
    priority: 85,

    keywords: [
      "allah",
      "alhamdulillah",
      "mashallah",
      "inshallah",
      "inshaallah",
      "subhanallah",
      "bismillah",

      "quran",
      "islam",
      "islamic",
      "deen",
      "namaz",
      "roza",
      "ramadan",

      "اللہ",
      "الحمدللہ",
      "ماشاءاللہ",
      "ان شاء اللہ",
      "سبحان اللہ",
      "بسم اللہ",
      "قرآن",
      "اسلام",
      "دین",
      "نماز",
      "روزہ",
      "رمضان",
    ],
  },


  /*
   * MOTIVATION
   */

  {
    name: "motivation",
    emoji: "🔥",
    priority: 82,

    keywords: [
      "motivation",
      "motivational",
      "never give up",
      "keep going",
      "stay strong",
      "work hard",
      "hard work",
      "success",
      "successful",
      "winner",
      "winning",
      "believe in yourself",
      "you can do it",

      "zindagi",
      "zindagi mein",
      "hosla",
      "himmat",
      "mehnat",
      "kamiyabi",
      "kamyabi",
      "jeet",
      "aage barho",
      "haar mat mano",

      "زندگی",
      "حوصلہ",
      "ہمت",
      "محنت",
      "کامیابی",
      "جیت",
      "آگے بڑھو",
      "ہار مت مانو",
    ],
  },


  /*
   * CONGRATULATIONS
   */

  {
    name: "congratulations",
    emoji: "🎉",
    priority: 80,

    keywords: [
      "congratulations",
      "congrats",
      "congratulation",
      "well done",
      "proud of you",

      "birthday",
      "happy birthday",
      "wedding",
      "married",
      "marriage",
      "engagement",

      "mubarak",
      "mubarak ho",
      "bohat bohat mubarak",
      "bahut bahut mubarak",

      "مبارک",
      "مبارک ہو",
      "بہت بہت مبارک",
      "مبارکباد",
      "سالگرہ",
      "شادی",
      "منگنی",
    ],
  },


  /*
   * FUNNY
   */

  {
    name: "funny",
    emoji: "😂",
    priority: 78,

    keywords: [
      "haha",
      "hahaha",
      "hahahaha",
      "hehe",
      "hehehe",
      "lol",
      "lmao",
      "lmfao",
      "rofl",

      "funny",
      "hilarious",
      "joke",
      "joking",
      "meme",

      "mazak",
      "mazaq",
      "hansi",
      "hasna",

      "مزاح",
      "مزاحیہ",
      "مذاق",
      "ہنسی",
      "ہنستا",
      "ہنسی مذاق",
    ],
  },


  /*
   * ROAST
   */

  {
    name: "roast",
    emoji: "💀",
    priority: 76,

    keywords: [
      "roast",
      "roasted",
      "destroyed",
      "savage",
      "burned",
      "what a roast",

      "beizzati",
      "bezati",
      "jalaa diya",

      "جل گیا",
      "جلا دیا",
      "بے عزتی",
      "ذلیل",
    ],
  },


  /*
   * RESPECT
   */

  {
    name: "respect",
    emoji: "🫡",
    priority: 74,

    keywords: [
      "respect",
      "respect bro",
      "respect man",
      "salute",
      "honor",
      "legend",
      "hero",
      "great man",

      "izzat",
      "ehtram",
      "salam",

      "عزت",
      "احترام",
      "سلام",
      "بہادری",
      "لیجنڈ",
    ],
  },


  /*
   * PRAISE
   */

  {
    name: "praise",
    emoji: "👏",
    priority: 72,

    keywords: [
      "great",
      "excellent",
      "amazing",
      "awesome",
      "brilliant",
      "perfect",
      "beautiful work",
      "good job",
      "well played",

      "zabardast",
      "zabardast kaam",
      "kamal",
      "kamaal",
      "shandar",
      "lajawab",
      "wah",
      "waah",

      "زبردست",
      "کمال",
      "شاندار",
      "لاجواب",
      "واہ",
    ],
  },


  /*
   * ANGER
   */

  {
    name: "anger",
    emoji: "😡",
    priority: 70,

    keywords: [
      "angry",
      "anger",
      "furious",
      "mad",
      "hate",
      "hateful",

      "gussa",
      "ghussa",
      "naraz",
      "naraaz",
      "nafrat",
      "ghussa aa raha",

      "غصہ",
      "غصے",
      "ناراض",
      "نفرت",
      "غصہ آ رہا",
    ],
  },


  /*
   * SURPRISE
   */

  {
    name: "surprise",
    emoji: "😮",
    priority: 68,

    keywords: [
      "wow",
      "omg",
      "oh my god",
      "really",
      "unbelievable",
      "unexpected",
      "surprise",
      "shocking",
      "shocked",

      "hairan",
      "hairani",

      "حیران",
      "حیرت",
      "حیران کن",
      "اوہ",
      "واہ",
    ],
  },


  /*
   * CUTE
   */

  {
    name: "cute",
    emoji: "🥺",
    priority: 66,

    keywords: [
      "cute",
      "adorable",
      "sweet",
      "so cute",
      "cutie",

      "pyara",
      "pyaara",
      "pyari",
      "masoom",

      "پیارا",
      "پیاری",
      "معصوم",
      "کِیوٹ",
    ],
  },


  /*
   * SUPPORT
   */

  {
    name: "support",
    emoji: "🫂",
    priority: 64,

    keywords: [
      "i am with you",
      "i'm with you",
      "with you",
      "stay strong",
      "support",
      "supporting you",
      "you are not alone",
      "we are with you",

      "main tumhare sath",
      "hum tumhare sath",
      "sath hoon",
      "sath hain",

      "حوصلہ رکھو",
      "ہم تمہارے ساتھ",
      "میں تمہارے ساتھ",
      "اکیلے نہیں ہو",
    ],
  },


  /*
   * DEEP / POETRY
   */

  {
    name: "deep",
    emoji: "🥀",
    priority: 60,

    keywords: [
      "life",
      "reality",
      "truth of life",
      "memories",
      "memory",
      "time",
      "destiny",
      "fate",
      "silence",
      "pain",
      "deep",

      "zindagi",
      "haqeeqat",
      "yaadein",
      "yaadain",
      "waqt",
      "qismat",
      "khamoshi",
      "dard",

      "تنہائی",
      "حقیقت",
      "یادیں",
      "وقت",
      "قسمت",
      "خاموشی",
      "درد",
    ],
  },
];


/*
 * =========================================================
 * TEXT NORMALIZATION
 * =========================================================
 */

function normalizeReactionText(text = "") {

  return String(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


/*
 * =========================================================
 * LANGUAGE DETECTION
 * =========================================================
 */

const URDU_LETTERS =
  /[ٹڈڑںھہۀےژچگپ]/g;

const URDU_WORDS = [
  "ہے",
  "ہیں",
  "میں",
  "تم",
  "آپ",
  "نہیں",
  "کیوں",
  "کیسے",
  "کہاں",
  "مجھ",
  "تمہیں",
  "مجھے",
  "ہمیں",
  "کرنا",
  "کرتا",
  "کرتی",
  "گیا",
  "گئی",
  "تھا",
  "تھی",
  "ہو",
  "ہوگا",
  "ہوگی",
];

const ARABIC_WORDS = [
  "هذا",
  "هذه",
  "ذلك",
  "الذي",
  "التي",
  "أنا",
  "أنت",
  "نحن",
  "هو",
  "هي",
  "كيف",
  "لماذا",
  "الحمد",
  "الله",
  "اللهم",
  "السلام",
  "عليكم",
  "صلى",
  "عليه",
  "وسلم",
  "شكرا",
  "أحب",
  "حب",
  "جميل",
  "جميلة",
];


function detectReactionLanguage(text) {

  const msg =
    normalizeReactionText(text);

  const urduLetters =
    (msg.match(URDU_LETTERS) || []).length;

  const urduWords =
    URDU_WORDS.filter(
      (word) =>
        msg.includes(word)
    ).length;

  const arabicWords =
    ARABIC_WORDS.filter(
      (word) =>
        msg.includes(word)
    ).length;

  const arabicScript =
    (msg.match(/[\u0600-\u06FF]/g) || [])
      .length;

  const englishLetters =
    (msg.match(/[a-z]/g) || []).length;


  /*
   * Urdu first.
   *
   * Urdu uses Arabic-derived script,
   * so Urdu-specific letters are important.
   */

  if (
    urduLetters >= 1 ||
    urduWords >= 1
  ) {
    return "urdu";
  }


  /*
   * Arabic.
   */

  if (
    arabicWords >= 1 ||
    (
      arabicScript >= 3 &&
      englishLetters < arabicScript
    )
  ) {
    return "arabic";
  }


  /*
   * English.
   */

  if (englishLetters >= 2) {
    return "english";
  }


  return "mixed";
}


/*
 * =========================================================
 * SCORE EMOTION
 * =========================================================
 */

function scoreRule(text, rule) {

  let score = 0;

  for (const keyword of rule.keywords) {

    const word =
      normalizeReactionText(keyword);

    if (!word) continue;


    if (text.includes(word)) {

      /*
       * Longer phrase = stronger context.
       */

      if (word.length >= 12) {
        score += 12;
      }

      else if (word.length >= 8) {
        score += 8;
      }

      else if (word.length >= 5) {
        score += 5;
      }

      else {
        score += 3;
      }
    }
  }

  return score;
}


/*
 * =========================================================
 * DEEP CONTEXT BOOST
 * =========================================================
 */

function applyDeepContext(text, scores) {


  /*
   * LOVE
   */

  if (
    text.includes("i love you") ||
    text.includes("love you") ||
    text.includes("میں تم سے محبت") ||
    text.includes("مجھے تم سے پیار") ||
    text.includes("mujhe tumse pyar")
  ) {
    scores.love += 25;
  }


  /*
   * HEARTBREAK
   */

  if (
    text.includes("broken heart") ||
    text.includes("dil toot gaya") ||
    text.includes("dil tut gaya") ||
    text.includes("دل ٹوٹ گیا") ||
    text.includes("دل ٹوٹ گیا ہے")
  ) {
    scores.heartbreak += 30;
  }


  /*
   * SAD / MISSING
   */

  if (
    text.includes("i miss you") ||
    text.includes("i miss him") ||
    text.includes("i miss her") ||
    text.includes("تمہاری یاد") ||
    text.includes("تم بہت یاد") ||
    text.includes("tumhari yaad")
  ) {
    scores.sadness += 25;
  }


  /*
   * DUA
   */

  if (
    text.includes("pray for me") ||
    text.includes("please pray") ||
    text.includes("میرے لیے دعا") ||
    text.includes("میرے لئے دعا") ||
    text.includes("اللہ آسانی کرے")
  ) {
    scores.dua += 30;
  }


  /*
   * MOTIVATION
   */

  if (
    text.includes("never give up") ||
    text.includes("keep going") ||
    text.includes("you can do it") ||
    text.includes("کبھی ہار مت مانو") ||
    text.includes("ہمت نہ ہارو") ||
    text.includes("آگے بڑھتے رہو")
  ) {
    scores.motivation += 25;
  }


  /*
   * FUNNY
   */

  if (
    /haha+|hehe+|lol|lmao|🤣|😂/i
      .test(text)
  ) {
    scores.funny += 20;
  }


  /*
   * CONGRATULATIONS
   */

  if (
    text.includes("congratulations") ||
    text.includes("congrats") ||
    text.includes("مبارک ہو") ||
    text.includes("بہت بہت مبارک")
  ) {
    scores.congratulations += 30;
  }


  /*
   * QUESTION
   */

  if (
    text.includes("?") ||
    text.includes("؟")
  ) {
    scores.thinking =
      (scores.thinking || 0) + 2;
  }


  /*
   * MULTIPLE SAD SIGNALS
   */

  const sadSignals = [
    "sad",
    "cry",
    "tears",
    "dukhi",
    "dard",
    "اداس",
    "دکھی",
    "درد",
    "آنسو",
  ];

  const sadCount =
    sadSignals.filter(
      (x) => text.includes(x)
    ).length;

  if (sadCount >= 2) {
    scores.sadness += 15;
  }


  /*
   * MULTIPLE LOVE SIGNALS
   */

  const loveSignals = [
    "love",
    "pyar",
    "pyaar",
    "mohabbat",
    "ishq",
    "محبت",
    "پیار",
    "عشق",
  ];

  const loveCount =
    loveSignals.filter(
      (x) => text.includes(x)
    ).length;

  if (loveCount >= 2) {
    scores.love += 15;
  }
}


/*
 * =========================================================
 * GET AUTO REACTION
 * =========================================================
 */

export function getAutoReaction(text = "") {

  const msg =
    normalizeReactionText(text);

  if (!msg || msg.length < 2) {
    return null;
  }


  /*
   * =======================================================
   * ARABIC = 🌹 ONLY
   * =======================================================
   */

  const language =
    detectReactionLanguage(msg);

  if (language === "arabic") {
    return "🌹";
  }


  /*
   * =======================================================
   * SCORE ALL EMOTIONS
   * =======================================================
   */

  const scores = {};

  for (const rule of DEEP_REACTION_RULES) {

    scores[rule.name] =
      scoreRule(msg, rule);
  }


  /*
   * Context boosts.
   */

  applyDeepContext(
    msg,
    scores
  );


  /*
   * =======================================================
   * SELECT BEST EMOTION
   * =======================================================
 */

  let bestRule = null;
  let bestScore = 0;

  for (const rule of DEEP_REACTION_RULES) {

    const score =
      scores[rule.name] || 0;

    if (
      score > bestScore ||
      (
        score === bestScore &&
        bestRule &&
        rule.priority >
          bestRule.priority
      )
    ) {

      bestScore = score;
      bestRule = rule;
    }
  }


  /*
   * No meaningful emotion.
   */

  if (
    !bestRule ||
    bestScore < 3
  ) {
    return "❤️";
  }


  return bestRule.emoji;
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

  const {
    message,
    conn,
  } = params;


  try {

    /*
     * Ignore bot messages.
     */

    if (
      message.isBotMessage
    ) {
      return;
    }


    /*
     * Ignore messages without body.
     */

    if (!message.body) {
      return;
    }


    /*
     * =====================================================
     * DEEP AUTO REACTION
     * =====================================================
     */

    try {

      const autoReact =
        await kvGet(
          AUTOREACT_KEY
        );


      /*
       * Default = ON
       */

      if (
        autoReact !== false
      ) {

        const reaction =
          getAutoReaction(
            message.body
          );


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

      /*
       * Reaction failure must NEVER
       * stop command processing.
       */

      logger.debug?.(
        `[AutoReact] ${
          error?.message || error
        }`
      );
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
      findCommand(
        message.body
      );


    if (!command) {
      return;
    }


    const name =
      (
        command.patternName ||
        ""
      ).toLowerCase();


    const privileged =
      await isPrivileged(
        message,
        conn
      );


    /*
     * Access check.
     */

    const access =
      await checkCommandAccess(
        message,
        command,
        conn
      );


    if (!access.allowed) {

      if (access.silent) {
        return;
      }


      await sendError(
        conn,
        message.from,
        access.reason ||
          "OWNER_ONLY"
      );

      return;
    }


    /*
     * =====================================================
     * FEATURE FLAG
     * =====================================================
     */

    const flagCheck =
      await checkCommandFlag(
        name
      );


    if (!flagCheck.ok) {

      if (
        flagCheck.flag ===
          "maintenance" &&
        privileged
      ) {

        /*
         * Privileged users can continue.
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
     * =====================================================
     * POLICY
     * =====================================================
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
     * =====================================================
     * GROUP DISABLED PLUGINS
     * =====================================================
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
     * =====================================================
     * LOGGER
     * =====================================================
     */

    logger.command(
      name || "unknown",
      message.sender,
      message.isGroup
        ? message.from
        : null
    );


    /*
     * =====================================================
     * COMMAND VALIDATION
     * =====================================================
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
     * =====================================================
     * GROUP PERMISSIONS
     * =====================================================
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


      if (
        !groupValidation.valid
      ) {

        await sendError(
          conn,
          message.from,
          groupValidation.error
        );

        return;
      }
    }


    /*
     * =====================================================
     * COMMAND ACKNOWLEDGEMENT
     * =====================================================
     */

    await ackCommand(
      conn,
      message
    );


    /*
     * =====================================================
     * METRICS
     * =====================================================
 */

    recordCommand(
      name || "unknown"
    );


    /*
     * =====================================================
     * EXECUTE COMMAND
     * =====================================================
 */

    await command.function(
      message,
      conn
    );


    /*
     * =====================================================
     * AUDIT
     * =====================================================
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
          body:
            String(
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
