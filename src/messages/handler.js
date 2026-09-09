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
      "assalam o alaikum",
      "assalamualaikum",
      "salam o alaikum",
      "salam",
      "aoa",
      "hello",
      "hi bro",
      "hi",
      "hey",
      "hey bro",
      "good morning",
      "good evening",
      "good afternoon",
      "good night",
      "see you",
      "bye bye",

      "السلام عليكم",
      "السلام علیکم",
      "وعليكم السلام",
      "وعلیکم السلام",
      "مرحبا",
      "اهلا",
      "أهلا",
      "اهلا وسهلا",
      "أهلا وسهلا",
      "صباح الخير",
      "مساء الخير",
      "تصبح على خير",
      "مع السلامة",
    ],
    words: [
      "hello",
      "hi",
      "hey",
      "salam",
      "aoa",
      "مرحبا",
      "اهلا",
      "أهلا",
      "سلام",
    ],
    emojis: ["👋", "😊", "🙌"]
  },

  love: {
    phrases: [
      "i love you",
      "love you",
      "love u",
      "i like you",
      "i miss you",
      "miss you",
      "miss u",
      "my love",
      "meri jaan",
      "mera pyar",
      "meri mohabbat",
      "mohabbat hai",
      "pyar karta",
      "pyar karti",
      "dil se",
      "احبك",
      "أحبك",
      "أحبك جدا",
      "احبك جدا",
      "احب",
      "أحب",
      "حبيبي",
      "حبيبتي",
      "حبي",
      "يا حبيبي",
      "يا حبيبتي",
      "حب",
      "عشق",
      "محبة",
    ],
    words: [
      "love",
      "loving",
      "pyar",
      "pyaar",
      "mohabbat",
      "ishq",
      "jaan",
      "baby",
      "darling",
      "honey",
      "حبيبي",
      "حبيبتي",
      "حبي",
      "حب",
      "عشق",
      "أحبك",
      "احبك",
    ],
    emojis: ["❤️", "🥰", "😍", "💕", "😘"]
  },

  cute: {
    phrases: [
      "so cute",
      "very cute",
      "kitna cute",
      "bohat cute",
      "bohot cute",
      "how cute",
      "how beautiful",
      "how handsome",
      "ما اجمل",
      "ما أجمل",
      "جميل جدا",
      "جميلة جدا",
      "رائع جدا",
      "رائعة جدا",
    ],
    words: [
      "cute",
      "beautiful",
      "handsome",
      "pretty",
      "sweet",
      "lovely",
      "adorable",
      "khubsurat",
      "khoobsurat",
      "pyara",
      "pyari",
      "jamil",
      "jamila",
      "جميل",
      "جميلة",
      "لطيف",
      "لطيفة",
      "رائع",
      "رائعة",
      "وسيم",
      "حلو",
      "حلوة",
    ],
    emojis: ["😍", "🥰", "✨", "❤️"]
  },

  funny: {
    phrases: [
      "hahaha",
      "haha",
      "lol",
      "lmao",
      "rofl",
      "cant stop laughing",
      "cannot stop laughing",
      "hasna nahi ruk raha",
      "hansi nahi ruk rahi",
      "bohat funny",
      "bahut funny",
      "kya joke hai",
      "هههه",
      "ههههه",
      "هههههههه",
      "مضحك جدا",
      "مضحكة جدا",
    ],
    words: [
      "lol",
      "lmao",
      "haha",
      "hahaha",
      "funny",
      "joke",
      "mazaq",
      "mazak",
      "hansi",
      "hasna",
      "comedy",
      "مضحك",
      "مضحكة",
      "ضحك",
      "نكتة",
      "هههه",
    ],
    emojis: ["😂", "🤣", "😆", "😭"]
  },

  happiness: {
    phrases: [
      "i am happy",
      "im happy",
      "so happy",
      "very happy",
      "feeling happy",
      "today is a good day",
      "aj bohat khush",
      "aaj bohat khush",
      "dil khush ho gaya",
      "bohat acha laga",
      "alhamdulillah",
      "الحمد لله",
      "الحمدلله",
      "أنا سعيد",
      "انا سعيد",
      "انا سعيدة",
      "أنا سعيدة",
    ],
    words: [
      "happy",
      "happiness",
      "khush",
      "khushi",
      "khushiyan",
      "mazay",
      "great",
      "awesome",
      "amazing",
      "perfect",
      "sukoon",
      "satisfied",
      "سعيد",
      "سعيدة",
      "فرح",
      "فرحان",
      "فرحانة",
      "سعادة",
      "مبسوط",
      "مبسوطة",
      "سرور",
    ],
    emojis: ["😊", "😄", "😁", "🥰", "❤️"]
  },

  sad: {
    phrases: [
      "i am sad",
      "im sad",
      "feeling sad",
      "so sad",
      "very sad",
      "feeling bad",
      "feel bad",
      "mood off",
      "my mood is off",
      "dil udaas hai",
      "bohat udaas",
      "aj mood off",
      "aaj mood off",
      "ro raha hu",
      "ro rahi hu",
      "i am crying",
      "im crying",
      "أنا حزين",
      "انا حزين",
      "أنا حزينة",
      "انا حزينة",
      "حزين جدا",
      "حزينة جدا",
    ],
    words: [
      "sad",
      "sadness",
      "cry",
      "crying",
      "tears",
      "udaas",
      "udas",
      "gham",
      "dard",
      "dukhi",
      "rona",
      "roona",
      "zakhm",
      "حزين",
      "حزينة",
      "حزن",
      "يبكي",
      "بكاء",
      "زعلان",
      "زعلانة",
    ],
    emojis: ["😔", "😢", "🥺", "💔"]
  },

  heartbreak: {
    phrases: [
      "heart broken",
      "heartbreak",
      "broken heart",
      "breakup ho gaya",
      "mera breakup ho gaya",
      "meri breakup ho gayi",
      "she left me",
      "he left me",
      "they left me",
      "cheat kiya",
      "dhoka mila",
      "dil toot gaya",
      "dil tor diya",
      "mohabbat haar gaya",
      "قلبي مكسور",
      "قلب مكسور",
      "انفصال",
      "خيانة",
      "فراق",
      "كسر قلبي",
    ],
    words: [
      "breakup",
      "heartbreak",
      "broken",
      "betrayal",
      "cheated",
      "dhoka",
      "dhokha",
      "bewafa",
      "bewafai",
      "judai",
      "firaq",
      "heartbroken",
      "فراق",
      "خيانة",
      "انفصال",
      "مكسور",
    ],
    emojis: ["💔", "😢", "🥺", "😭"]
  },

  angry: {
    phrases: [
      "i am angry",
      "im angry",
      "very angry",
      "so angry",
      "getting angry",
      "dont make me angry",
      "gussa aa raha",
      "bohat gussa",
      "mujhe gussa aa raha",
      "ghussa aa raha",
      "ghussa",
      "غاضب جدا",
      "غاضبة جدا",
      "انا غاضب",
      "أنا غاضب",
      "انا غاضبة",
      "أنا غاضبة",
    ],
    words: [
      "angry",
      "anger",
      "mad",
      "furious",
      "gussa",
      "ghussa",
      "naraz",
      "naraaz",
      "pagal",
      "irritated",
      "annoyed",
      "غاضب",
      "غاضبة",
      "غضب",
      "عصبي",
      "عصبية",
    ],
    emojis: ["😡", "😤", "🤬", "💢"]
  },

  surprise: {
    phrases: [
      "oh my god",
      "omg",
      "no way",
      "really",
      "are you serious",
      "seriously",
      "what the hell",
      "cant believe",
      "cannot believe",
      "ye kya ho gaya",
      "sach mein",
      "sachi",
      "yaar kya",
      "يا إلهي",
      "يا الهي",
      "مستحيل",
      "حقا",
      "حقًا",
      "صدمة",
      "مفاجأة",
    ],
    words: [
      "omg",
      "wow",
      "really",
      "serious",
      "seriously",
      "surprise",
      "shocked",
      "shock",
      "unbelievable",
      "hairan",
      "hairaan",
      "shock",
      "مستحيل",
      "صدمة",
      "مفاجأة",
      "حقا",
      "حقًا",
    ],
    emojis: ["😳", "😱", "🤯", "😮", "👀"]
  },

  question: {
    phrases: [
      "what is this",
      "what happened",
      "why did you",
      "how did you",
      "what do you mean",
      "i dont understand",
      "i don't understand",
      "samajh nahi aa rahi",
      "samajh nahi aya",
      "kya matlab",
      "kyun",
      "kaise",
      "kahan",
      "kab",
      "mujhe samajh nahi",
      "ماذا",
      "لماذا",
      "كيف",
      "أين",
      "متى",
      "من",
      "هل",
      "ما هذا",
      "ما معنى",
    ],
    words: [
      "what",
      "why",
      "how",
      "where",
      "when",
      "who",
      "which",
      "question",
      "kya",
      "kyun",
      "kyu",
      "kaise",
      "kese",
      "kahan",
      "kab",
      "kon",
      "kis",
      "matalab",
      "matlab",
      "mujhe",
      "ماذا",
      "لماذا",
      "كيف",
      "أين",
      "متى",
      "من",
      "هل",
    ],
    emojis: ["🤔", "🧐", "❓", "👀"]
  },

  agreement: {
    phrases: [
      "yes",
      "yes bro",
      "yes exactly",
      "you are right",
      "you're right",
      "i agree",
      "agreed",
      "bilkul",
      "bilkul sahi",
      "theek hai",
      "thik hai",
      "sahi hai",
      "han",
      "haan",
      "jee",
      "ji",
      "zaroor",
      "acha",
      "accha",
      "inshallah",
      "in sha allah",
      "إن شاء الله",
      "ان شاء الله",
      "نعم",
      "صحيح",
      "تمام",
      "موافق",
      "موافقة",
      "حسنا",
      "حسنًا",
      "أكيد",
      "بالتأكيد",
    ],
    words: [
      "yes",
      "agree",
      "agreed",
      "exactly",
      "correct",
      "right",
      "bilkul",
      "haan",
      "han",
      "jee",
      "sahi",
      "theek",
      "thik",
      "zaroor",
      "نعم",
      "صحيح",
      "تمام",
      "موافق",
      "أكيد",
    ],
    emojis: ["👍", "✅", "💯", "🙌"]
  },

  disagreement: {
    phrases: [
      "no",
      "no bro",
      "not at all",
      "i disagree",
      "you are wrong",
      "you're wrong",
      "bilkul nahi",
      "nahi",
      "nahin",
      "ye galat hai",
      "ghalat hai",
      "aisa nahi",
      "لا",
      "ليس كذلك",
      "لا أوافق",
      "خطأ",
      "غلط",
      "مستحيل",
    ],
    words: [
      "no",
      "wrong",
      "false",
      "never",
      "disagree",
      "nahi",
      "nahin",
      "galat",
      "ghalat",
      "لا",
      "خطأ",
      "غلط",
    ],
    emojis: ["❌", "👎", "🙅"]
  },

  thanks: {
    phrases: [
      "thank you",
      "thanks",
      "thanks bro",
      "thank u",
      "thx",
      "bohat shukriya",
      "bahut shukriya",
      "shukriya",
      "jazakallah",
      "jazak allah",
      "jazakallah khair",
      "جزاك الله خيرا",
      "جزاك الله خيرًا",
      "شكرا",
      "شكرًا",
      "شكرا جزيلا",
      "شكرًا جزيلا",
    ],
    words: [
      "thanks",
      "thank",
      "shukriya",
      "shukria",
      "jazakallah",
      "gratitude",
      "grateful",
      "شكرا",
      "شكرًا",
      "ممتن",
      "ممتنة",
    ],
    emojis: ["🙏", "❤️", "😊"]
  },

  apology: {
    phrases: [
      "i am sorry",
      "im sorry",
      "sorry bro",
      "sorry yaar",
      "my mistake",
      "meri ghalti",
      "meri galti",
      "maaf karna",
      "mujhe maaf karo",
      "excuse me",
      "i apologize",
      "أعتذر",
      "اعتذر",
      "آسف",
      "اسف",
      "آسفة",
      "اسفة",
      "سامحني",
      "سامحيني",
      "عفوا",
      "عفوًا",
    ],
    words: [
      "sorry",
      "apology",
      "apologize",
      "mistake",
      "maaf",
      "maafi",
      "ghalti",
      "galti",
      "آسف",
      "آسفة",
      "اعتذر",
      "أعتذر",
      "سامحني",
    ],
    emojis: ["🙏", "🥺", "😔"]
  },

  congratulations: {
    phrases: [
      "congratulations",
      "congrats",
      "congratulation bro",
      "well done",
      "mubarak ho",
      "bohat mubarak",
      "dher sari mubarak",
      "shabash",
      "you did it",
      "you made it",
      "alf mabrook",
      "مبروك",
      "ألف مبروك",
      "الف مبروك",
      "تهانينا",
      "أحسنت",
      "احسنت",
    ],
    words: [
      "congratulations",
      "congrats",
      "mubarak",
      "mubarakbad",
      "shabash",
      "well",
      "done",
      "winner",
      "مبروك",
      "تهانينا",
      "أحسنت",
    ],
    emojis: ["🎉", "🥳", "👏", "🎊", "🔥"]
  },

  birthday: {
    phrases: [
      "happy birthday",
      "many many happy returns",
      "birthday mubarak",
      "janamdin mubarak",
      "salgirah mubarak",
      "سالگرہ مبارک",
      "عيد ميلاد سعيد",
      "عيد ميلاد",
      "كل عام وانت بخير",
      "كل عام وأنت بخير",
      "كل عام وانتي بخير",
      "كل عام وأنتِ بخير",
    ],
    words: [
      "birthday",
      "janamdin",
      "salgirah",
      "ميلاد",
      "عيد ميلاد",
    ],
    emojis: ["🎂", "🎉", "🥳", "🎈"]
  },

  prayer: {
    phrases: [
      "alhamdulillah",
      "alhamdu lillah",
      "mashallah",
      "masha allah",
      "ma sha allah",
      "subhanallah",
      "subhan allah",
      "inshallah",
      "in sha allah",
      "allah kare",
      "dua karo",
      "dua karna",
      "pray for me",
      "allah bless you",
      "الحمد لله",
      "الحمدلله",
      "ما شاء الله",
      "ماشاء الله",
      "سبحان الله",
      "إن شاء الله",
      "ان شاء الله",
      "آمين",
      "امين",
      "دعاء",
      "أدعو",
    ],
    words: [
      "alhamdulillah",
      "mashallah",
      "mashaallah",
      "subhanallah",
      "inshallah",
      "dua",
      "ameen",
      "amin",
      "allah",
      "bless",
      "prayer",
      "الحمد",
      "ماشاء",
      "سبحان",
      "الله",
      "آمين",
      "دعاء",
    ],
    emojis: ["❤️", "🤲", "✨", "😊"]
  },

  fire: {
    phrases: [
      "on fire",
      "this is fire",
      "so good",
      "too good",
      "next level",
      "level up",
      "kya zabardast",
      "zabardast hai",
      "kamal hai",
      "kamaal hai",
      "bohat zabardast",
      "bohot zabardast",
      "kya scene hai",
      "أسطوري",
      "اسطوري",
      "رهيب",
      "رهيبة",
      "خرافي",
      "خرافية",
    ],
    words: [
      "fire",
      "lit",
      "awesome",
      "amazing",
      "legendary",
      "epic",
      "zabardast",
      "zabardust",
      "kamal",
      "kamaal",
      "mast",
      "solid",
      "danger",
      "أسطوري",
      "رهيب",
      "خرافي",
      "نار",
    ],
    emojis: ["🔥", "💯", "🤯", "⚡"]
  },

  respect: {
    phrases: [
      "respect bro",
      "full respect",
      "respect for you",
      "salute bro",
      "you are a legend",
      "kya baat hai",
      "wah ustad",
      "wah bhai",
      "izzat hai",
      "ما شاء الله عليك",
      "ماشاء الله عليك",
      "كل الاحترام",
    ],
    words: [
      "respect",
      "salute",
      "legend",
      "ustad",
      "boss",
      "king",
      "queen",
      "izzat",
      "محترم",
      "محترمة",
      "احترام",
      "ملك",
      "ملكة",
      "بطل",
      "بطلة",
    ],
    emojis: ["🫡", "👏", "👑", "❤️"]
  },

  food: {
    phrases: [
      "i am hungry",
      "im hungry",
      "bohat bhook lagi",
      "bhook lagi hai",
      "khana kha raha",
      "khana kha rahi",
      "lets eat",
      "let's eat",
      "what should i eat",
      "kya khana hai",
      "mujhe bhook lagi",
      "جوعان",
      "جائعة",
      "أنا جائع",
      "انا جائع",
    ],
    words: [
      "food",
      "eat",
      "eating",
      "hungry",
      "pizza",
      "burger",
      "biryani",
      "chicken",
      "rice",
      "chai",
      "tea",
      "coffee",
      "khana",
      "bhook",
      "nashta",
      "lunch",
      "dinner",
      "breakfast",
      "طعام",
      "أكل",
      "اكل",
      "جوعان",
      "جائعة",
      "قهوة",
      "شاي",
    ],
    emojis: ["🍕", "🍔", "😋", "🍗", "☕"]
  },

  money: {
    phrases: [
      "make money",
      "earned money",
      "made money",
      "paise aa gaye",
      "paisa mil gaya",
      "paisa kamaya",
      "bohat paisa",
      "maal aa gaya",
      "الحمد لله رزق",
    ],
    words: [
      "money",
      "cash",
      "profit",
      "salary",
      "rich",
      "dollar",
      "rupee",
      "rupees",
      "paisa",
      "paise",
      "kamai",
      "kamaya",
      "rizq",
      "maal",
      "مال",
      "فلوس",
      "نقود",
      "راتب",
      "ربح",
      "دولار",
      "ريال",
      "دينار",
      "درهم",
    ],
    emojis: ["💰", "💸", "🤑", "💵"]
  },

  sleep: {
    phrases: [
      "good night",
      "going to sleep",
      "i am sleepy",
      "im sleepy",
      "need sleep",
      "so tired",
      "neend aa rahi",
      "neend aa rhi",
      "main so raha",
      "main so rahi",
      "sona hai",
      "kal milte hain",
      "تصبح على خير",
      "أنا نعسان",
      "انا نعسان",
      "أنا نعسانة",
      "انا نعسانة",
    ],
    words: [
      "sleep",
      "sleepy",
      "tired",
      "rest",
      "neend",
      "soja",
      "sona",
      "thaka",
      "thaki",
      "نوم",
      "نائم",
      "نائمة",
      "نعسان",
      "نعسانة",
    ],
    emojis: ["🌙", "😴", "🥱"]
  },

  studyWork: {
    phrases: [
      "i am studying",
      "i am working",
      "going to work",
      "back to work",
      "exam tomorrow",
      "exam hai",
      "paper hai",
      "parhai kar raha",
      "parhai kar rahi",
      "kaam kar raha",
      "kaam kar rahi",
      "office ja raha",
      "دراسة",
      "امتحان",
      "اختبار",
      "عمل",
      "وظيفة",
      "مشروع",
    ],
    words: [
      "study",
      "studying",
      "school",
      "college",
      "university",
      "exam",
      "test",
      "work",
      "office",
      "job",
      "project",
      "parhai",
      "padhai",
      "kaam",
      "mashq",
      "دراسة",
      "جامعة",
      "مدرسة",
      "امتحان",
      "اختبار",
      "عمل",
      "وظيفة",
      "مكتب",
      "مشروع",
    ],
    emojis: ["📚", "💻", "📝", "💪"]
  },

  music: {
    phrases: [
      "listen to this song",
      "this song is amazing",
      "what a song",
      "my favorite song",
      "meri favorite song",
      "kya gana hai",
      "ye gana suno",
      "music lover",
      "اسمع هذه الاغنية",
      "اسمع هذه الأغنية",
      "موسيقى جميلة",
      "أغنية جميلة",
    ],
    words: [
      "music",
      "song",
      "singer",
      "singing",
      "gana",
      "gaana",
      "awaz",
      "awaaz",
      "beats",
      "musiqi",
      "موسيقى",
      "أغنية",
      "اغنية",
      "مغني",
      "مغنية",
      "صوت",
    ],
    emojis: ["🎵", "🎶", "🎧", "❤️"]
  },

  travel: {
    phrases: [
      "going on trip",
      "road trip",
      "going home",
      "on my way",
      "traveling today",
      "safar par",
      "safar kar raha",
      "safar kar rahi",
      "ghar ja raha",
      "ghar ja rahi",
      "سفر",
      "رحلة",
      "أنا مسافر",
      "انا مسافر",
    ],
    words: [
      "travel",
      "trip",
      "journey",
      "flight",
      "airport",
      "train",
      "car",
      "road",
      "safar",
      "musafir",
      "journey",
      "سفر",
      "رحلة",
      "طائرة",
      "مطار",
      "قطار",
      "سيارة",
    ],
    emojis: ["✈️", "🚗", "🌍", "🧳"]
  },

  weather: {
    phrases: [
      "it is raining",
      "its raining",
      "today is hot",
      "today is cold",
      "bohat garmi",
      "bohat sardi",
      "barish ho rahi",
      "baarish ho rahi",
      "mausam acha",
      "mausam kharab",
      "الجو جميل",
      "الطقس جميل",
    ],
    words: [
      "weather",
      "rain",
      "raining",
      "sun",
      "sunny",
      "cold",
      "hot",
      "winter",
      "summer",
      "barish",
      "baarish",
      "garmi",
      "sardi",
      "mausam",
      "طقس",
      "مطر",
      "شمس",
      "مشمس",
      "برد",
      "حر",
      "شتاء",
      "صيف",
    ],
    emojis: ["🌧️", "☀️", "❄️", "🌤️"]
  },

  warning: {
    phrases: [
      "be careful",
      "take care",
      "watch out",
      "danger ahead",
      "stay safe",
      "careful bro",
      "sambhal kar",
      "khayal rakhna",
      "bach ke",
      "khatra hai",
      "bohat dangerous",
      "انتبه",
      "كن حذرا",
      "كن حذرًا",
      "خطر",
      "خطير",
      "تحذير",
    ],
    words: [
      "warning",
      "danger",
      "dangerous",
      "careful",
      "alert",
      "problem",
      "risk",
      "sambhal",
      "khatra",
      "khatarnaak",
      "masla",
      "تحذير",
      "خطر",
      "خطير",
      "تنبيه",
      "مشكلة",
    ],
    emojis: ["⚠️", "🚨", "😨"]
  },

  compliment: {
    phrases: [
      "you are amazing",
      "you are awesome",
      "great job",
      "good job",
      "well done",
      "nice work",
      "bohat acha",
      "bohat pyara",
      "kya baat hai",
      "kamaal kar diya",
      "ما شاء الله عليك",
      "أنت رائع",
      "أنت رائعة",
      "عمل رائع",
    ],
    words: [
      "amazing",
      "awesome",
      "great",
      "excellent",
      "perfect",
      "nice",
      "good",
      "smart",
      "brilliant",
      "acha",
      "acha",
      "pyara",
      "pyari",
      "zabardast",
      "kamaal",
      "ممتاز",
      "رائع",
      "رائعة",
      "ذكي",
      "ذكية",
    ],
    emojis: ["👏", "😍", "🔥", "✨", "💯"]
  },

  celebration: {
    phrases: [
      "lets celebrate",
      "let's celebrate",
      "party time",
      "celebration time",
      "aaj party",
      "party hai",
      "khushi ka din",
      "حفلة",
      "احتفال",
      "يوم سعيد",
    ],
    words: [
      "party",
      "celebrate",
      "celebration",
      "festival",
      "eid",
      "party",
      "khushi",
      "jashan",
      "حفلة",
      "احتفال",
      "عيد",
      "فرح",
    ],
    emojis: ["🎉", "🥳", "🎊", "🕺"]
  },

  goodLuck: {
    phrases: [
      "good luck",
      "best of luck",
      "all the best",
      "you can do it",
      "inshallah kamyab",
      "allah kamyab kare",
      "dua hai kamyab ho",
      "best wishes",
      "حظا سعيدا",
      "حظًا سعيدًا",
      "بالتوفيق",
      "موفق",
      "موفقة",
    ],
    words: [
      "luck",
      "success",
      "kamyabi",
      "kamyab",
      "dua",
      "wishes",
      "taufiq",
      "توفيق",
      "بالتوفيق",
      "موفق",
      "موفقة",
      "نجاح",
    ],
    emojis: ["🤞", "🍀", "❤️", "✨"]
  },

  gaming: {
    phrases: [
      "lets play",
      "let's play",
      "game time",
      "gaming time",
      "gg",
      "gg bro",
      "good game",
      "game khelte hain",
      "game khelen",
      "match start",
      "مباراة",
      "لعبة",
    ],
    words: [
      "game",
      "gaming",
      "gamer",
      "player",
      "match",
      "win",
      "play",
      "khel",
      "gameplay",
      "لعبة",
      "ألعاب",
      "العاب",
      "لاعب",
      "مباراة",
    ],
    emojis: ["🎮", "🔥", "🏆", "😎"]
  },

  victory: {
    phrases: [
      "we won",
      "i won",
      "we did it",
      "victory",
      "mission complete",
      "mission accomplished",
      "jeet gaye",
      "jeet gaya",
      "jeet gayi",
      "fatah ho gayi",
      "hum jeet gaye",
      "انتصرنا",
      "فوز",
      "انتصار",
      "نجحنا",
    ],
    words: [
      "victory",
      "winner",
      "won",
      "win",
      "champion",
      "championship",
      "jeet",
      "fateh",
      "kamyabi",
      "fuz",
      "فوز",
      "فائز",
      "انتصار",
      "بطل",
      "بطولة",
      "نجاح",
    ],
    emojis: ["🏆", "🥇", "🎉", "🔥", "💯"]
  },

  flirty: {
    phrases: [
      "you look beautiful",
      "you look cute",
      "you are mine",
      "miss me",
      "thinking about you",
      "tum bohat cute ho",
      "tum bohat pyari ho",
      "meri jaan",
      "jaaneman",
      "جان قلبي",
      "يا عمري",
      "أحبك",
      "أنت جميلة",
      "أنت جميل",
    ],
    words: [
      "flirt",
      "flirty",
      "crush",
      "jaan",
      "jaaneman",
      "baby",
      "babe",
      "cutie",
      "hottie",
      "عمري",
      "قلبي",
      "حبيبي",
      "حبيبتي",
    ],
    emojis: ["🥰", "😘", "😍", "❤️", "😏"]
  },

};

/* =========================================================
 * GENERIC FALLBACKS
 * ========================================================= */

const GENERIC_REACTIONS = [
  "👍",
  "❤️",
  "😊",
  "😂",
  "🔥",
  "✨",
  "🙌",
  "💯",
  "😎",
];

const MEDIA_REACTIONS = {
  sticker: [
    "😂",
    "🤣",
    "😍",
    "❤️",
    "🔥",
    "😎",
    "🥰",
  ],

  audio: [
    "🎧",
    "❤️",
    "🔥",
    "🎵",
    "😍",
    "👏",
  ],

  image: [
    "😍",
    "🔥",
    "❤️",
    "✨",
    "👏",
    "👀",
  ],

  video: [
    "🔥",
    "😂",
    "😍",
    "👏",
    "🎬",
    "👀",
  ],

  document: [
    "👍",
    "📄",
    "👀",
    "💯",
  ],
};

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
 * NEGATION
 * ========================================================= */

const NEGATION_WORDS = [
  "not",
  "never",
  "dont",
  "don't",
  "doesnt",
  "doesn't",
  "didnt",
  "didn't",
  "cant",
  "can't",
  "cannot",
  "wont",
  "won't",
  "without",

  "nahi",
  "nahin",
  "nai",
  "mat",
  "bilkul nahi",
  "bilkul nahin",

  "نہیں",
  "ليس",
  "لا",
  "لم",
  "لن",
];

function hasNegationNear(
  text,
  index
) {
  const start =
    Math.max(0, index - 45);

  const before =
    text.slice(
      start,
      index
    );

  return NEGATION_WORDS.some(
    (word) => {
      const escaped =
        word.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      return new RegExp(
        `(?:^|\\s)${escaped}(?:\\s|$)`,
        "i"
      ).test(before);
    }
  );
}

/* =========================================================
 * MATCH HELPERS
 * ========================================================= */

function countPhraseMatches(
  text,
  phrases
) {
  let score = 0;

  for (const phrase of phrases) {
    const p =
      normalizeReactionText(
        phrase
      );

    if (!p) {
      continue;
    }

    let index = text.indexOf(p);

    while (index !== -1) {
      if (
        !hasNegationNear(
          text,
          index
        )
      ) {
        score +=
          p.includes(" ")
            ? 5
            : 2;
      }

      index =
        text.indexOf(
          p,
          index + p.length
        );
    }
  }

  return score;
}

function countWordMatches(
  text,
  words
) {
  let score = 0;

  for (const word of words) {
    const w =
      normalizeReactionText(
        word
      );

    if (!w) {
      continue;
    }

    let index = text.indexOf(w);

    while (index !== -1) {
      if (
        !hasNegationNear(
          text,
          index
        )
      ) {
        score += 1;
      }

      index =
        text.indexOf(
          w,
          index + w.length
        );
    }
  }

  return score;
}

/* =========================================================
 * EMOJI AWARENESS
 * ========================================================= */

function emojiBonus(text) {
  const bonuses = [
    {
      emojis: ["😂", "🤣", "😆", "😭"],
      category: "funny",
      score: 8,
    },
    {
      emojis: ["❤️", "💕", "💖", "💗", "🥰", "😍"],
      category: "love",
      score: 8,
    },
    {
      emojis: ["😢", "😔", "🥺", "💔"],
      category: "sad",
      score: 8,
    },
    {
      emojis: ["😡", "🤬", "😤"],
      category: "angry",
      score: 8,
    },
    {
      emojis: ["🔥", "💯", "⚡"],
      category: "fire",
      score: 7,
    },
    {
      emojis: ["🎉", "🥳", "🎊"],
      category: "celebration",
      score: 7,
    },
    {
      emojis: ["🙏", "🤲"],
      category: "thanks",
      score: 5,
    },
    {
      emojis: ["❓", "🤔", "🧐"],
      category: "question",
      score: 6,
    },
  ];

  return bonuses;
}

/* =========================================================
 * PICK RANDOM
 * ========================================================= */

function randomItem(array) {
  if (
    !Array.isArray(array) ||
    array.length === 0
  ) {
    return null;
  }

  return array[
    Math.floor(
      Math.random() *
      array.length
    )
  ];
}

/* =========================================================
 * SMART REACTION
 * ========================================================= */

function getAutoReaction(
  message
) {
  const text =
    normalizeReactionText(
      getReactionText(message)
    );

  const type =
    getMessageType(message);

  /* -------------------------------------------------------
   * Media without meaningful text
   * ------------------------------------------------------- */

  if (!text) {
    return randomItem(
      MEDIA_REACTIONS[type] ||
      GENERIC_REACTIONS
    );
  }

  /* -------------------------------------------------------
   * Score every category
   * ------------------------------------------------------- */

  const scores = [];

  for (
    const [
      category,
      data,
    ] of Object.entries(
      REACTION_CATEGORIES
    )
  ) {
    const phraseScore =
      countPhraseMatches(
        text,
        data.phrases || []
      );

    const wordScore =
      countWordMatches(
        text,
        data.words || []
      );

    let score =
      phraseScore +
      wordScore;

    if (
      phraseScore > 0
    ) {
      score += 3;
    }

    scores.push({
      category,
      score,
      emojis:
        data.emojis || [],
    });
  }

  /* -------------------------------------------------------
   * Emoji bonuses
   * ------------------------------------------------------- */

  for (
    const bonus of emojiBonus(text)
  ) {
    if (
      text.includes(
        bonus.emojis.find(
          (emoji) =>
            text.includes(emoji)
        ) || "\0"
      )
    ) {
      const item =
        scores.find(
          (x) =>
            x.category ===
            bonus.category
        );

      if (item) {
        item.score +=
          bonus.score;
      }
    }
  }

  /* -------------------------------------------------------
   * Sort by strongest meaning
   * ------------------------------------------------------- */

  scores.sort(
    (a, b) =>
      b.score - a.score
  );

  const best =
    scores[0];

  /* -------------------------------------------------------
   * Strong semantic match
   * ------------------------------------------------------- */

  if (
    best &&
    best.score >= 2
  ) {
    return randomItem(
      best.emojis
    );
  }

  /* -------------------------------------------------------
   * Media with caption but weak text
   * ------------------------------------------------------- */

  if (
    type !== "text" &&
    MEDIA_REACTIONS[type]
  ) {
    return randomItem(
      MEDIA_REACTIONS[type]
    );
  }

  /* -------------------------------------------------------
   * Generic text fallback
   * ------------------------------------------------------- */

  return randomItem(
    GENERIC_REACTIONS
  );
}

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
  conn
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
        AUTOREACT_KEY
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
      conn
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
          error?.message ||
            error
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
