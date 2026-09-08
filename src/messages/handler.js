/**
 * X-ANSARI v4.0.0
 * Message Handler
 *
 * Features:
 * - Reliable command detection
 * - Trimmed command processing
 * - ACL / flags / policy
 * - Group permissions
 * - Audit / metrics
 * - Deep multilingual auto reaction
 * - Urdu / Roman Urdu / English / Arabic
 * - Exactly one reaction
 * - Commands ignored by AutoReact
 * - Owner messages ignored
 * - Bot messages ignored
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


/* =========================================================
 * CONFIG
 * ========================================================= */

const AUTOREACT_KEY = "autoreact";


/* =========================================================
 * SAFE HELPERS
 * ========================================================= */

function safeString(value = "") {
  try {
    return String(value ?? "");
  } catch {
    return "";
  }
}


function normalizeText(text = "") {
  return safeString(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function randomItem(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  return items[
    Math.floor(Math.random() * items.length)
  ];
}


/* =========================================================
 * OWNER
 * ========================================================= */

function normalizeNumber(number = "") {
  return safeString(number).replace(/[^0-9]/g, "");
}


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

    const sender =
      normalizeNumber(value);

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
 * REACTION RULES
 * ========================================================= */

const REACTION_RULES = [

  {
    name: "heartbreak",
    priority: 110,
    reactions: ["💔", "🥀", "😭", "🥺"],
    words: [
      "heartbreak",
      "broken heart",
      "breakup",
      "break up",
      "betrayal",
      "betrayed",
      "cheated",
      "bewafa",
      "bewafai",
      "dhoka",
      "dhokha",
      "judai",
      "dil toot",
      "dil tut",
      "dil toot gaya",
      "dil tut gaya",
      "rishta toot gaya",
      "دل ٹوٹ",
      "دل ٹوٹ گیا",
      "بے وفا",
      "بے وفائی",
      "دھوکہ",
      "جدائی"
    ]
  },

  {
    name: "love",
    priority: 108,
    reactions: ["❤️", "🥰", "😍", "💕"],
    words: [
      "i love you",
      "love you",
      "true love",
      "my love",
      "love",
      "loving",
      "romantic",
      "romance",
      "beloved",
      "darling",
      "sweetheart",
      "my heart",
      "mohabbat",
      "mohabbat hai",
      "pyar",
      "pyaar",
      "ishq",
      "ashiq",
      "aashiq",
      "chahat",
      "meri jaan",
      "jaanam",
      "dilbar",
      "mehboob",
      "محبت",
      "پیار",
      "عشق",
      "چاہت",
      "میری جان",
      "جانم",
      "دلبر",
      "محبوب",
      "أحبك",
      "أحب",
      "حب"
    ]
  },

  {
    name: "sadness",
    priority: 107,
    reactions: ["😢", "😭", "🥺", "🥀"],
    words: [
      "sad",
      "sadness",
      "cry",
      "crying",
      "tears",
      "lonely",
      "alone",
      "depressed",
      "upset",
      "unhappy",
      "miss you",
      "missing you",
      "i miss",
      "feel sad",
      "feeling sad",
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
      "akela",
      "akeli",
      "yaad aa rahi",
      "yaad aa raha",
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
      "اکیلا",
      "اکیلی",
      "آنسو",
      "حزين",
      "حزينة",
      "حزن",
      "بكاء",
      "دموع",
      "اشتقت"
    ]
  },

  {
    name: "humor",
    priority: 106,
    reactions: ["😂", "🤣", "😭", "💀"],
    words: [
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
      "comedy",
      "laugh",
      "mazak",
      "mazaq",
      "hansi",
      "hasna",
      "hansna",
      "maza aa gaya",
      "kya joke hai",
      "مزاح",
      "مزاحیہ",
      "مذاق",
      "ہنسی",
      "ہنسنا",
      "لطیفہ"
    ]
  },

  {
    name: "anger",
    priority: 105,
    reactions: ["😡", "🤬", "😤", "💢"],
    words: [
      "angry",
      "anger",
      "furious",
      "mad",
      "hate",
      "hateful",
      "pissed",
      "annoyed",
      "shut up",
      "idiot",
      "stupid",
      "gussa",
      "ghussa",
      "naraz",
      "naraaz",
      "nafrat",
      "ghussa aa raha",
      "bohat gussa",
      "dimagh kharab",
      "غصہ",
      "غصے",
      "ناراض",
      "نفرت",
      "غصہ آ رہا",
      "بہت غصہ",
      "دماغ خراب",
      "غاضب",
      "غاضبة",
      "غضب",
      "كره"
    ]
  },

  {
    name: "fear",
    priority: 104,
    reactions: ["😱", "😨", "😰", "🥶"],
    words: [
      "fear",
      "scared",
      "afraid",
      "terrified",
      "danger",
      "dangerous",
      "horror",
      "terrifying",
      "help me",
      "save me",
      "dar",
      "darr",
      "khauf",
      "darna",
      "dara hua",
      "bohat dar",
      "khatra",
      "ڈر",
      "خوف",
      "ڈرا ہوا",
      "بہت ڈر",
      "خطرہ",
      "خوفناک",
      "خائف",
      "خائفة"
    ]
  },

  {
    name: "surprise",
    priority: 103,
    reactions: ["😮", "😲", "🤯", "😳"],
    words: [
      "wow",
      "omg",
      "oh my god",
      "really",
      "unbelievable",
      "unexpected",
      "surprise",
      "shocking",
      "shocked",
      "no way",
      "seriously",
      "hairan",
      "hairani",
      "yaqeen nahi",
      "sach mein",
      "aisa kaise",
      "حیران",
      "حیرت",
      "یقین نہیں",
      "سچ میں",
      "ایسا کیسے",
      "حقا",
      "مستحيل",
      "مفاجأة"
    ]
  },

  {
    name: "flirting",
    priority: 102,
    reactions: ["😏", "😉", "🫣", "🥰"],
    words: [
      "flirt",
      "flirting",
      "handsome",
      "beautiful",
      "sexy",
      "hot",
      "crush",
      "date me",
      "marry me",
      "you look good",
      "looking beautiful",
      "looking handsome",
      "shadi kar lo",
      "shaadi kar lo",
      "tum bohat pyare",
      "tum bohat pyari",
      "tum cute ho",
      "kya ada hai",
      "کتنے پیارے",
      "کتنی پیاری",
      "خوبصورت ہو",
      "شادی کر لو",
      "کیا ادا ہے"
    ]
  },

  {
    name: "touched",
    priority: 101,
    reactions: ["🥹", "🫶", "❤️", "🥺"],
    words: [
      "touched",
      "emotional",
      "touching",
      "heart touching",
      "so emotional",
      "made me emotional",
      "dil ko laga",
      "dil choo gaya",
      "dil ko chhoo gaya",
      "jazbati",
      "jazbaat",
      "dil bhar aya",
      "دل کو لگا",
      "دل چھو گیا",
      "دل کو چھو گیا",
      "جذباتی",
      "جذبات",
      "دل بھر آیا"
    ]
  },

  {
    name: "praise",
    priority: 100,
    reactions: ["👏", "🙌", "🔥", "💯"],
    words: [
      "great",
      "excellent",
      "amazing",
      "awesome",
      "brilliant",
      "perfect",
      "beautiful work",
      "good job",
      "well played",
      "well done",
      "nice work",
      "respect",
      "zabardast",
      "zabardast kaam",
      "kamal",
      "kamaal",
      "shandar",
      "lajawab",
      "wah",
      "waah",
      "bohat khoob",
      "kya baat",
      "زبردست",
      "کمال",
      "شاندار",
      "لاجواب",
      "واہ",
      "بہت خوب",
      "رائع",
      "ممتاز",
      "أحسنت"
    ]
  },

  {
    name: "confidence",
    priority: 99,
    reactions: ["😎", "🔥", "👑", "💯"],
    words: [
      "confidence",
      "confident",
      "boss",
      "king",
      "queen",
      "legend",
      "strong",
      "power",
      "powerful",
      "fearless",
      "attitude",
      "apna time",
      "main kar sakta",
      "main kar sakti",
      "mujhe pata hai",
      "بادشاہ",
      "ملکہ",
      "اعتماد",
      "طاقت",
      "مضبوط"
    ]
  },

  {
    name: "curiosity",
    priority: 98,
    reactions: ["🤔", "🧐", "👀", "❓"],
    words: [
      "why",
      "how",
      "what",
      "where",
      "when",
      "who",
      "which",
      "tell me",
      "explain",
      "curious",
      "wonder",
      "kyun",
      "kyon",
      "kaise",
      "kahan",
      "kab",
      "kon",
      "kaun",
      "kya",
      "batao",
      "samjhao",
      "کیوں",
      "کیسے",
      "کہاں",
      "کب",
      "کون",
      "کیا",
      "بتاؤ",
      "سمجھاؤ",
      "لماذا",
      "كيف",
      "ماذا",
      "أين",
      "متى"
    ]
  },

  {
    name: "annoyance",
    priority: 97,
    reactions: ["🙄", "😒", "😑", "😤"],
    words: [
      "annoying",
      "annoyed",
      "irritating",
      "irritated",
      "ugh",
      "whatever",
      "fed up",
      "tang",
      "tang aa gaya",
      "pareshan",
      "jhanjhat",
      "bakwas",
      "bas karo",
      "تنگ",
      "تنگ آ گیا",
      "پریشان",
      "جھنجھٹ",
      "بکواس",
      "بس کرو"
    ]
  },

  {
    name: "peace",
    priority: 96,
    reactions: ["😌", "🫶", "🤍", "🌿"],
    words: [
      "peace",
      "peaceful",
      "calm",
      "relax",
      "relaxed",
      "peace of mind",
      "serenity",
      "sukoon",
      "sukoon hai",
      "aram",
      "aaraam",
      "dil ko sukoon",
      "itminan",
      "سکون",
      "سکون ہے",
      "آرام",
      "دل کو سکون",
      "اطمینان",
      "طمأنينة"
    ]
  },

  {
    name: "begging",
    priority: 95,
    reactions: ["🥺", "🥹", "🙏", "🫶"],
    words: [
      "please",
      "please help",
      "please bro",
      "please yaar",
      "beg",
      "begging",
      "i request",
      "kindly",
      "plz",
      "meri request",
      "meharbani",
      "khuda ke liye",
      "allah ke waste",
      "madad karo",
      "براہ کرم",
      "مہربانی",
      "خدا کے لیے",
      "اللہ کے واسطے",
      "مدد کرو",
      "منت",
      "من فضلك",
      "أرجوك"
    ]
  },

  {
    name: "agreement",
    priority: 94,
    reactions: ["🤝", "👍", "💯", "✅"],
    words: [
      "agree",
      "agreed",
      "exactly",
      "true",
      "correct",
      "right",
      "absolutely",
      "definitely",
      "yes",
      "of course",
      "same",
      "bilkul",
      "sahi",
      "theek",
      "thik",
      "durust",
      "haan",
      "ji haan",
      "بالکل",
      "صحیح",
      "ٹھیک",
      "درست",
      "ہاں",
      "جی ہاں",
      "صحيح",
      "نعم"
    ]
  },

  {
    name: "motivation",
    priority: 93,
    reactions: ["💪", "🔥", "🚀", "👑"],
    words: [
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
      "don't give up",
      "keep fighting",
      "keep trying",
      "zindagi",
      "hosla",
      "himmat",
      "mehnat",
      "kamiyabi",
      "kamyabi",
      "jeet",
      "aage barho",
      "haar mat mano",
      "himmat na haro",
      "koshish karo",
      "زندگی",
      "حوصلہ",
      "ہمت",
      "محنت",
      "کامیابی",
      "جیت",
      "آگے بڑھو",
      "ہار مت مانو",
      "کوشش کرو"
    ]
  },

  {
    name: "respect",
    priority: 92,
    reactions: ["🫡", "🙏", "👑", "❤️"],
    words: [
      "respect",
      "respect bro",
      "respect man",
      "salute",
      "honor",
      "hero",
      "great man",
      "sir",
      "madam",
      "izzat",
      "ehtram",
      "salam",
      "salaam",
      "ustad",
      "badshah",
      "عزت",
      "احترام",
      "سلام",
      "استاد",
      "بادشاہ",
      "بہادری"
    ]
  },

  {
    name: "celebration",
    priority: 91,
    reactions: ["🎉", "🥳", "🔥", "🎊"],
    words: [
      "congratulations",
      "congrats",
      "celebrate",
      "celebration",
      "party",
      "birthday",
      "happy birthday",
      "wedding",
      "married",
      "marriage",
      "engagement",
      "graduation",
      "mubarak",
      "mubarak ho",
      "bohat bohat mubarak",
      "bahut bahut mubarak",
      "party hai",
      "jashan",
      "مبارک",
      "مبارک ہو",
      "بہت بہت مبارک",
      "مبارکباد",
      "سالگرہ",
      "شادی",
      "منگنی",
      "جشن"
    ]
  },

  {
    name: "dua",
    priority: 90,
    reactions: ["🤲", "❤️", "🙏", "🕊️"],
    words: [
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
      "اللهم",
      "دعاء"
    ]
  },

  {
    name: "success",
    priority: 89,
    reactions: ["🚀", "🔥", "💯", "👑"],
    words: [
      "success",
      "successful",
      "achieved",
      "goal achieved",
      "made it",
      "we did it",
      "won",
      "winner",
      "winning",
      "promotion",
      "new job",
      "kamyabi",
      "kamiyabi",
      "kamyaab",
      "jeet gaya",
      "jeet gayi",
      "kar dikhaya",
      "manzil",
      "maqsad hasil",
      "کامیابی",
      "کامیاب",
      "جیت گیا",
      "جیت گئی",
      "کر دکھایا",
      "منزل",
      "مقصد حاصل"
    ]
  },

  {
    name: "food",
    priority: 80,
    reactions: ["🍔", "🍕", "🍟", "😋"],
    words: [
      "food",
      "eat",
      "eating",
      "hungry",
      "breakfast",
      "lunch",
      "dinner",
      "biryani",
      "pizza",
      "burger",
      "cake",
      "chocolate",
      "ice cream",
      "coffee",
      "tea",
      "chai",
      "khana",
      "bhook",
      "nashta",
      "dawat",
      "بریانی",
      "کھانا",
      "بھوک",
      "ناشتہ",
      "پیزا",
      "برگر",
      "کیک",
      "چائے",
      "کافی",
      "جائع"
    ]
  },

  {
    name: "nature",
    priority: 79,
    reactions: ["🌿", "🌸", "🌻", "🌳"],
    words: [
      "nature",
      "tree",
      "trees",
      "flower",
      "flowers",
      "garden",
      "rain",
      "rainy",
      "sky",
      "sun",
      "moon",
      "river",
      "mountain",
      "forest",
      "green",
      "beautiful nature",
      "barish",
      "baarish",
      "phool",
      "bagh",
      "aasman",
      "pahaar",
      "darya",
      "بارش",
      "پھول",
      "باغ",
      "آسمان",
      "پہاڑ",
      "دریا",
      "طبيعة",
      "مطر",
      "زهرة",
      "حديقة",
      "سماء",
      "جبل"
    ]
  },

  {
    name: "animals",
    priority: 78,
    reactions: ["🐶", "🐱", "🦋", "🐼"],
    words: [
      "cat",
      "cats",
      "dog",
      "dogs",
      "puppy",
      "kitten",
      "bird",
      "birds",
      "horse",
      "lion",
      "tiger",
      "rabbit",
      "animal",
      "animals",
      "pet",
      "parrot",
      "fish",
      "billi",
      "kutta",
      "kutti",
      "parinda",
      "ghora",
      "sher",
      "khargosh",
      "janwar",
      "بلی",
      "کتا",
      "پرندہ",
      "گھوڑا",
      "شیر",
      "خرگوش",
      "جانور",
      "قط",
      "كلب",
      "حصان",
      "أسد",
      "أرنب"
    ]
  },

  {
    name: "sports",
    priority: 77,
    reactions: ["⚽", "🏏", "🏆", "🔥"],
    words: [
      "football",
      "soccer",
      "cricket",
      "match",
      "goal",
      "six",
      "four",
      "wicket",
      "bat",
      "bowling",
      "bowler",
      "batsman",
      "championship",
      "sports",
      "game",
      "win",
      "jeet",
      "team",
      "player",
      "stadium",
      "فٹبال",
      "کرکٹ",
      "میچ",
      "گول",
      "وکٹ",
      "بیٹ",
      "بولنگ",
      "کھیل",
      "ٹیم",
      "مباراة",
      "كرة",
      "رياضة",
      "فوز"
    ]
  },

  {
    name: "technology",
    priority: 76,
    reactions: ["📱", "💻", "🤖", "⚡"],
    words: [
      "phone",
      "mobile",
      "iphone",
      "android",
      "computer",
      "laptop",
      "pc",
      "technology",
      "tech",
      "software",
      "app",
      "application",
      "internet",
      "wifi",
      "router",
      "coding",
      "code",
      "programming",
      "developer",
      "bot",
      "server",
      "github",
      "railway",
      "database",
      "api",
      "موبائل",
      "فون",
      "کمپیوٹر",
      "لیپ ٹاپ",
      "ٹیکنالوجی",
      "انٹرنیٹ",
      "وائی فائی",
      "کوڈ",
      "پروگرامنگ"
    ]
  },

  {
    name: "travel",
    priority: 75,
    reactions: ["✈️", "🚗", "🌍", "🗺️"],
    words: [
      "travel",
      "trip",
      "journey",
      "flight",
      "airport",
      "plane",
      "car",
      "road",
      "highway",
      "tour",
      "vacation",
      "holiday",
      "beach",
      "city",
      "country",
      "visit",
      "safar",
      "musafir",
      "jahaz",
      "gaari",
      "chutti",
      "samandar",
      "سفر",
      "مسافر",
      "جہاز",
      "گاڑی",
      "راستہ",
      "چھٹی",
      "سمندر",
      "سياحة",
      "طائرة"
    ]
  },

  {
    name: "music",
    priority: 74,
    reactions: ["🎵", "🎶", "🎧", "🔥"],
    words: [
      "music",
      "song",
      "songs",
      "singer",
      "singing",
      "lyrics",
      "beat",
      "dj",
      "concert",
      "playlist",
      "listen",
      "gana",
      "gaana",
      "geet",
      "music sun",
      "گانا",
      "گیت",
      "موسیقی",
      "آواز",
      "موسيقى",
      "أغنية"
    ]
  },

  {
    name: "sleep",
    priority: 73,
    reactions: ["😴", "🌙", "🛌", "💤"],
    words: [
      "good night",
      "gn",
      "sleep",
      "sleeping",
      "bed",
      "going to sleep",
      "sweet dreams",
      "night",
      "so jao",
      "sona",
      "neend",
      "shab bakhair",
      "شب بخیر",
      "سونا",
      "نیند",
      "تصبح على خير",
      "نوم"
    ]
  },

  {
    name: "morning",
    priority: 72,
    reactions: ["🌅", "☀️", "😊", "🌸"],
    words: [
      "good morning",
      "gm",
      "morning",
      "subha",
      "subah",
      "sawere",
      "صبح بخیر",
      "صبح",
      "صباح الخير"
    ]
  },

  {
    name: "weather",
    priority: 71,
    reactions: ["🌤️", "🌧️", "☀️", "❄️"],
    words: [
      "weather",
      "hot weather",
      "cold weather",
      "rain",
      "rainy",
      "sunny",
      "cloudy",
      "storm",
      "wind",
      "garmi",
      "sardi",
      "barish",
      "hawa",
      "badal",
      "موسم",
      "گرمی",
      "سردی",
      "بارش",
      "ہوا",
      "بادل"
    ]
  }

];


/* =========================================================
 * SCORE
 * ========================================================= */

function scoreRule(text, rule) {

  let score = 0;

  for (const keyword of rule.words || []) {

    const word =
      normalizeText(keyword);

    if (!word) {
      continue;
    }

    if (text.includes(word)) {

      if (word.length >= 10) {
        score += 7;
      }

      else if (word.length >= 6) {
        score += 5;
      }

      else if (word.length >= 4) {
        score += 3;
      }

      else {
        score += 2;
      }
    }
  }

  return score;
}


/* =========================================================
 * DEEP CONTEXT
 * ========================================================= */

function applyDeepContext(text, scores) {

  if (
    text.includes("i love you") ||
    text.includes("love you") ||
    text.includes("mujhe tumse pyar") ||
    text.includes("mujhe tum se pyar") ||
    text.includes("mujhe tumse mohabbat") ||
    text.includes("main tumse pyar") ||
    text.includes("میں تم سے محبت") ||
    text.includes("مجھے تم سے پیار") ||
    text.includes("أحبك")
  ) {
    scores.love += 50;
  }


  if (
    text.includes("broken heart") ||
    text.includes("heart is broken") ||
    text.includes("dil toot gaya") ||
    text.includes("dil tut gaya") ||
    text.includes("dil toot gaya hai") ||
    text.includes("dil tut gaya hai") ||
    text.includes("دل ٹوٹ گیا") ||
    text.includes("دل ٹوٹ گیا ہے")
  ) {
    scores.heartbreak += 60;
  }


  if (
    text.includes("i miss you") ||
    text.includes("i miss him") ||
    text.includes("i miss her") ||
    text.includes("i really miss") ||
    text.includes("tumhari yaad") ||
    text.includes("tum bohat yaad") ||
    text.includes("tumhari bohat yaad") ||
    text.includes("تمہاری یاد") ||
    text.includes("تم بہت یاد") ||
    text.includes("اشتقت")
  ) {
    scores.sadness += 45;
  }


  if (
    text.includes("pray for me") ||
    text.includes("please pray") ||
    text.includes("mere liye dua") ||
    text.includes("mere liye dua karna") ||
    text.includes("hamare liye dua") ||
    text.includes("اللہ آسانی کرے") ||
    text.includes("میرے لیے دعا") ||
    text.includes("اللهم")
  ) {
    scores.dua += 45;
  }


  if (
    text.includes("never give up") ||
    text.includes("keep going") ||
    text.includes("you can do it") ||
    text.includes("keep fighting") ||
    text.includes("keep trying") ||
    text.includes("kabhi haar mat mano") ||
    text.includes("himmat na haro") ||
    text.includes("aage barhte raho") ||
    text.includes("آگے بڑھتے رہو") ||
    text.includes("ہمت نہ ہارو")
  ) {
    scores.motivation += 45;
  }


  if (
    /haha+|hehe+|lol|lmao|lmfao|rofl/i.test(text)
  ) {
    scores.humor += 40;
  }


  if (
    /😂|🤣|😆|😅|😁|😄|😃|😀|😹/.test(text)
  ) {
    scores.humor += 30;
  }


  if (
    /❤️|♥️|💕|💖|💗|💓|💞|💘|😍|🥰/.test(text)
  ) {
    scores.love += 30;
  }


  if (
    /😢|😭|😞|😔|🥺|💔|🥀/.test(text)
  ) {
    scores.sadness += 30;
  }


  if (
    /😡|🤬|😠|😤|💢/.test(text)
  ) {
    scores.anger += 30;
  }


  if (
    /😮|😲|🤯|😳|😱/.test(text)
  ) {
    scores.surprise += 30;
  }


  if (
    /🍔|🍕|🍟|🍗|🍖|🌭|🍿|🍩|🍰|🎂|🍫|🍪|🍎|🍓|🍉|🍌|☕|🍵/.test(text)
  ) {
    scores.food += 30;
  }


  if (
    /🌳|🌲|🌴|🌱|🌿|🌸|🌹|🌺|🌻|🌼|🌷|🌞|🌙|🌈|☀️|🌧️/.test(text)
  ) {
    scores.nature += 30;
  }


  if (
    /🐶|🐱|🐭|🐹|🐰|🦊|🐻|🐼|🐨|🐯|🦁|🐮|🐷|🐸|🐵|🐔|🐧|🐦|🦋|🐟/.test(text)
  ) {
    scores.animals += 30;
  }


  if (
    /⚽|🏏|🏀|🏈|⚾|🎾|🏐|🏆|🥇|🥈|🥉/.test(text)
  ) {
    scores.sports += 30;
  }


  if (
    /📱|💻|🖥️|⌨️|🖱️|📲|🤖|💾|🔌|📡/.test(text)
  ) {
    scores.technology += 30;
  }


  if (
    /✈️|🚗|🚕|🚌|🚆|🚂|🚢|🏝️|🌍|🗺️/.test(text)
  ) {
    scores.travel += 30;
  }


  if (
    /🎵|🎶|🎧|🎤|🎸|🥁|🎹/.test(text)
  ) {
    scores.music += 30;
  }


  if (
    /🎁|🎀|💝|🎈/.test(text)
  ) {
    scores.gift =
      (scores.gift || 0) + 30;
  }


  if (
    text.includes("?") ||
    text.includes("؟")
  ) {
    scores.curiosity =
      (scores.curiosity || 0) + 12;
  }


  if (
    text.includes("congratulations") ||
    text.includes("congrats") ||
    text.includes("mubarak ho") ||
    text.includes("bohat bohat mubarak") ||
    text.includes("مبارک ہو") ||
    text.includes("بہت بہت مبارک")
  ) {
    scores.celebration += 45;
  }


  const sadSignals = [
    "sad",
    "cry",
    "tears",
    "lonely",
    "dukhi",
    "dard",
    "udaas",
    "tanhai",
    "اداس",
    "دکھی",
    "درد",
    "تنہائی",
    "آنسو",
    "حزين",
    "حزن",
    "بكاء",
    "دموع"
  ];

  const sadCount =
    sadSignals.filter(
      x => text.includes(x)
    ).length;

  if (sadCount >= 2) {
    scores.sadness += 30;
  }


  const loveSignals = [
    "love",
    "pyar",
    "pyaar",
    "mohabbat",
    "ishq",
    "chahat",
    "محبت",
    "پیار",
    "عشق",
    "چاہت",
    "حب",
    "أحب"
  ];

  const loveCount =
    loveSignals.filter(
      x => text.includes(x)
    ).length;

  if (loveCount >= 2) {
    scores.love += 30;
  }


  const angerSignals = [
    "angry",
    "furious",
    "mad",
    "gussa",
    "ghussa",
    "nafrat",
    "غصہ",
    "نفرت",
    "غاضب",
    "غضب"
  ];

  const angerCount =
    angerSignals.filter(
      x => text.includes(x)
    ).length;

  if (angerCount >= 2) {
    scores.anger += 25;
  }
}


/* =========================================================
 * AUTO REACTION
 * ========================================================= */

export function getAutoReaction(text = "") {

  const raw =
    safeString(text);

  const msg =
    normalizeText(raw);

  if (
    !msg ||
    msg.length < 2
  ) {
    return null;
  }


  const scores = {};


  for (const rule of REACTION_RULES) {

    scores[rule.name] =
      scoreRule(
        msg,
        rule
      );
  }


  applyDeepContext(
    msg,
    scores
  );


  let bestRule = null;
  let bestScore = 0;


  for (const rule of REACTION_RULES) {

    const score =
      scores[rule.name] || 0;


    if (
      score > bestScore
    ) {

      bestScore = score;
      bestRule = rule;

      continue;
    }


    if (
      score === bestScore &&
      bestRule &&
      rule.priority >
        bestRule.priority
    ) {

      bestRule = rule;
    }
  }


  if (
    !bestRule ||
    bestScore < 3
  ) {
    return "❤️";
  }


  return randomItem(
    bestRule.reactions
  );
}


/* =========================================================
 * AUDIT ACTIONS
 * ========================================================= */

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


/* =========================================================
 * COMMAND BODY
 * ========================================================= */

function getCommandBody(message) {

  return safeString(
    message?.body
  ).trim();
}


function isCommandBody(body) {

  const prefix =
    safeString(
      BOT_INFO?.PREFIX || "."
    );

  return Boolean(
    prefix &&
    body.startsWith(prefix)
  );
}


/* =========================================================
 * MESSAGE HANDLER
 * ========================================================= */

export async function messageHandler(params) {

  const message =
    params?.message;

  const conn =
    params?.conn;


  try {

    /* =====================================================
     * BASIC VALIDATION
     * ===================================================== */

    if (!message || !conn) {
      return;
    }


    /* =====================================================
     * IGNORE BOT
     * ===================================================== */

    if (
      message?.isBotMessage === true
    ) {
      return;
    }


    if (
      message?.key?.fromMe === true
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
     *
     * IMPORTANT:
     * We use trimmed body here.
     * Old code checked message.body directly.
     * ===================================================== */

    const isCommand =
      isCommandBody(body);


    /* =====================================================
     * AUTO REACTION
     * ===================================================== */

    try {

      const autoReact =
        await kvGet(
          AUTOREACT_KEY
        );


      /*
       * AutoReact is ON by default.
       */

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

      /*
       * AutoReact must NEVER
       * break command execution.
       */

      try {

        logger.debug?.(
          `[AutoReact] ${
            error?.message ||
            error
          }`
        );

      } catch {
        // Ignore logger errors.
      }
    }


    /* =====================================================
     * NOT A COMMAND
     * ===================================================== */

    if (!isCommand) {
      return;
    }


    /* =====================================================
     * COMMAND DEBUG
     * ===================================================== */

    try {

      logger.debug?.(
        `[CMD DEBUG] body=${JSON.stringify(body)} prefix=${JSON.stringify(BOT_INFO?.PREFIX)}`
      );

    } catch {
      // Ignore debug logger errors.
    }


    /* =====================================================
     * FIND COMMAND
     *
     * IMPORTANT:
     * findCommand receives trimmed body.
     * ===================================================== */

    const command =
      findCommand(body);


    /* =====================================================
     * COMMAND NOT FOUND
     * ===================================================== */

    if (!command) {

      try {

        logger.warn?.(
          `[CMD DEBUG] command NOT FOUND: ${JSON.stringify(body)}`
        );

      } catch {
        // Ignore logger errors.
      }

      /*
       * Do not silently crash.
       * Send a small safe response.
       */

      try {

        await conn.sendMessage(
          message.from,
          {
            text:
              `❌ Command not found.\nUse ${BOT_INFO?.PREFIX || "."}menu`
          }
        );

      } catch {
        // Ignore send failure.
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


    try {

      logger.debug?.(
        `[CMD DEBUG] command=${name || "unknown"}`
      );

    } catch {
      // Ignore logger errors.
    }


    /* =====================================================
     * PRIVILEGED
     * ===================================================== */

    const privileged =
      await isPrivileged(
        message,
        conn
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


    /*
     * Protect against an invalid/undefined
     * access response.
     */

    if (
      !access ||
      access.allowed !== true
    ) {

      const silent =
        access?.silent === true;


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

        /* Privileged user can continue. */

      }

      else if (
        flagCheck?.flag ===
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
          `⚠️ Feature *${flagCheck?.flag || "unknown"}* is disabled.`
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
        name ||
          "unknown",
        message.sender,
        message.isGroup
          ? message.from
          : null
      );

    } catch {
      // Logger failure must not kill command.
    }


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

      /*
       * ACK failure should not stop
       * the actual command.
       */

      try {

        logger.debug?.(
          `[ACK] ${
            error?.message ||
            error
          }`
        );

      } catch {
        // Ignore.
      }
    }


    /* =====================================================
     * METRICS
     * ===================================================== */

    try {

      recordCommand(
        name ||
          "unknown"
      );

    } catch {
      // Metrics failure must not stop command.
    }


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


    await command.function(
      message,
      conn
    );


    /* =====================================================
     * AUDIT
     * ===================================================== */

    if (
      AUDIT_ACTIONS.has(
        name
      )
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

  }

  catch (error) {

    /* =====================================================
     * HANDLER ERROR
     * ===================================================== */

    try {
      recordError();
    } catch {
      // Ignore metrics error.
    }


    const where =
      `${commandNameSafe(message)} @ ${
        message?.from ||
        "?"
      }`;


    try {

      await systemLog(
        "error",
        `Handler crash: ${where}`,
        error
      );

    } catch {
      // Ignore logging failure.
    }


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

      }

      else if (
        message?.from
      ) {

        await sendError(
          conn,
          message.from,
          await t(
            "FAILED"
          )
        );
      }

    }

    catch (sendErr) {

      try {
        recordError();
      } catch {
        // Ignore.
      }


      try {

        await systemLog(
          "error",
          "Failed to send user-safe error",
          sendErr
        );

      } catch {
        // Ignore.
      }
    }
  }
}


/* =========================================================
 * SAFE COMMAND NAME
 * ========================================================= */

function commandNameSafe(message) {

  try {

    const body =
      safeString(
        message?.body
      ).trim();


    if (!body) {
      return "unknown";
    }


    return (
      body.split(/\s+/)[0] ||
      "unknown"
    );

  }

  catch {

    return "unknown";
  }
}
