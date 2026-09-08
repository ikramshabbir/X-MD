/**
 * Message Handler — ACL, flags, policy, audit, metrics
 * + Deep Multilingual Context-based Auto Reaction
 *
 * Languages:
 * - Urdu
 * - Roman Urdu
 * - English
 * - Arabic
 *
 * Features:
 * - One message = exactly one reaction
 * - Meaning/context based reactions
 * - Arabic is also analyzed by emotion engine
 * - Food / Nature / Animals / Sports / Technology / Objects
 * - Bot's own messages ignored
 * - Owner messages ignored
 * - Commands ignored by AutoReact
 * - Existing ACL / flags / policy / audit / metrics preserved
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
 * RANDOM
 * ========================================================= */

function randomItem(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  return items[
    Math.floor(Math.random() * items.length)
  ];
}


/* =========================================================
 * NORMALIZE
 * ========================================================= */

function normalizeReactionText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
 * OWNER CHECK
 * ========================================================= */

function normalizeNumber(number = "") {
  return String(number)
    .replace(/[^0-9]/g, "");
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

  const sender = normalizeNumber(
    message?.sender ||
    message?.participant ||
    message?.key?.participant ||
    ""
  );

  return Boolean(
    sender &&
    owner &&
    sender === owner
  );
}


/* =========================================================
 * LANGUAGE DATA
 * ========================================================= */

const URDU_LETTERS =
  /[ٹڈڑںھہۀےژچگپڤ]/g;

const URDU_WORDS = [
  "ہے","ہیں","میں","تم","آپ","نہیں","کیوں","کیسے",
  "کہاں","مجھ","تمہیں","مجھے","ہمیں","کرنا","کرتا",
  "کرتی","کرتے","گیا","گئی","گئے","تھا","تھی","تھے",
  "ہو","ہوگا","ہوگی","ہوں","نے","کو","سے","پر","کا",
  "کی","کے","یہ","وہ","اور","لیے","لئے","رہا","رہی",
  "رہے","چاہیے","چاہتا","چاہتی","سکتا","سکتی","کر",
  "کیا","کبھی","بہت","میرا","میری","میرے","تمہارا",
  "تمہاری","تمہارے"
];


const ARABIC_WORDS = [
  "هذا","هذه","ذلك","تلك","الذي","التي","أنا","أنت",
  "نحن","هو","هي","هم","كيف","لماذا","ماذا","متى",
  "أين","الحمد","الله","اللهم","السلام","عليكم",
  "صلى","عليه","وسلم","شكرا","أحب","حب","جميل",
  "جميلة","مرحبا","نعم","لا","إن","شاء","ماشاءالله",
  "سبحان","الحمدلله","بسم","الرحمن","رحيم","دعاء",
  "آمين","حزين","حزينة","سعيد","سعيدة","غاضب",
  "غاضبة","خائف","خائفة","أحبك","اشتقت"
];


function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}


function detectReactionLanguage(text) {

  const msg = normalizeReactionText(text);

  const urduLetters = countMatches(
    msg,
    URDU_LETTERS
  );

  const urduWords = URDU_WORDS.filter(
    word => msg.includes(word)
  ).length;

  const arabicWords = ARABIC_WORDS.filter(
    word => msg.includes(word)
  ).length;

  const arabicScript = countMatches(
    msg,
    /[\u0600-\u06FF]/g
  );

  const englishLetters = countMatches(
    msg,
    /[a-z]/g
  );

  if (
    urduLetters >= 1 ||
    urduWords >= 1
  ) {
    return "urdu";
  }

  if (
    arabicWords >= 1 ||
    (
      arabicScript >= 3 &&
      englishLetters < arabicScript
    )
  ) {
    return "arabic";
  }

  if (englishLetters >= 2) {
    return "english";
  }

  return "mixed";
}


/* =========================================================
 * REACTION RULES
 * ========================================================= */

const DEEP_REACTION_RULES = [

  /* ---------- HUMOR ---------- */

  {
    name: "humor",
    priority: 100,
    reactions: ["😂","🤣","😭","💀"],
    keywords: [
      "haha","hahaha","hahahaha","hehe","hehehe",
      "lol","lmao","lmfao","rofl","funny","hilarious",
      "joke","joking","meme","comedy","laugh",
      "mazak","mazaq","hansi","hasna","hansna",
      "maza aa gaya","kya joke hai",
      "مزاح","مزاحیہ","مذاق","ہنسی","ہنسنا",
      "لطیفہ"
    ]
  },

  /* ---------- SADNESS ---------- */

  {
    name: "sadness",
    priority: 98,
    reactions: ["😢","😭","🥺","🥀"],
    keywords: [
      "sad","sadness","cry","crying","tears","lonely",
      "alone","depressed","upset","unhappy","miss you",
      "missing you","miss someone","i miss","feel sad",
      "feeling sad",
      "dukhi","dukh","dard","udaas","afsos","rona",
      "ro raha","ro rahi","tanha","tanhai","akela",
      "akeli","yaad aa rahi","yaad aa raha",
      "اداس","دکھی","دکھ","درد","افسوس","رونا",
      "رو رہا","رو رہی","تنہا","تنہائی","اکیلا",
      "اکیلی","آنسو","یاد آ رہی","یاد آ رہا",
      "حزين","حزينة","حزن","بكاء","دموع",
      "اشتقت"
    ]
  },

  /* ---------- LOVE ---------- */

  {
    name: "love",
    priority: 97,
    reactions: ["❤️","🥰","😍","💕"],
    keywords: [
      "i love you","love you","true love","my love",
      "love","loving","romantic","romance","beloved",
      "darling","sweetheart","my heart",
      "mohabbat","mohabbat hai","pyar","pyaar","ishq",
      "ashiq","aashiq","chahat","meri jaan","jaan",
      "jaanam","dilbar","mehboob","mehbooba",
      "محبت","پیار","عشق","چاہت","میری جان","جان",
      "جانم","دلبر","محبوب","محبوبہ",
      "أحبك","أحب","حب"
    ]
  },

  /* ---------- FLIRTING ---------- */

  {
    name: "flirting",
    priority: 96,
    reactions: ["😏","😉","🫣","🥰"],
    keywords: [
      "flirt","flirting","handsome","beautiful","sexy",
      "hot","crush","date me","marry me",
      "you look good","looking beautiful",
      "looking handsome",
      "shadi kar lo","shaadi kar lo",
      "tum bohat pyare","tum bohat pyari",
      "tum cute ho","kya ada hai","kya baat hai",
      "کتنے پیارے","کتنی پیاری","خوبصورت ہو",
      "شادی کر لو","کیا ادا ہے","کیا بات ہے"
    ]
  },

  /* ---------- ANGER ---------- */

  {
    name: "anger",
    priority: 95,
    reactions: ["😡","🤬","😤","💢"],
    keywords: [
      "angry","anger","furious","mad","hate",
      "hateful","pissed","annoyed","shut up","idiot",
      "stupid",
      "gussa","ghussa","naraz","naraaz","nafrat",
      "ghussa aa raha","bohat gussa","dimagh kharab",
      "غصہ","غصے","ناراض","نفرت","غصہ آ رہا",
      "بہت غصہ","دماغ خراب",
      "غاضب","غاضبة","غضب","كره"
    ]
  },

  /* ---------- FEAR ---------- */

  {
    name: "fear",
    priority: 94,
    reactions: ["😱","😨","😰","🥶"],
    keywords: [
      "fear","scared","afraid","terrified","danger",
      "dangerous","horror","terrifying","help me",
      "save me",
      "dar","darr","khauf","darna","dara hua",
      "bohat dar","khatra",
      "ڈر","خوف","ڈرا ہوا","بہت ڈر","خطرہ",
      "خوفناک",
      "خائف","خائفة","خوف"
    ]
  },

  /* ---------- SURPRISE ---------- */

  {
    name: "surprise",
    priority: 93,
    reactions: ["😮","😲","🤯","😳"],
    keywords: [
      "wow","omg","oh my god","really","unbelievable",
      "unexpected","surprise","shocking","shocked",
      "no way","what","seriously",
      "hairan","hairani","yaqeen nahi","sach mein",
      "kya","aisa kaise",
      "حیران","حیرت","حیران کن","یقین نہیں",
      "سچ میں","ایسا کیسے","اوہ",
      "حقا","مستحيل","مفاجأة"
    ]
  },

  /* ---------- TOUCHED ---------- */

  {
    name: "touched",
    priority: 92,
    reactions: ["🥹","🫶","❤️","🥺"],
    keywords: [
      "touched","emotional","you touched my heart",
      "touching","heart touching","so emotional",
      "made me emotional",
      "dil ko laga","dil choo gaya",
      "dil ko chhoo gaya","jazbati","jazbaat",
      "dil bhar aya",
      "دل کو لگا","دل چھو گیا","دل کو چھو گیا",
      "جذباتی","جذبات","دل بھر آیا"
    ]
  },

  /* ---------- CONFIDENCE ---------- */

  {
    name: "confidence",
    priority: 91,
    reactions: ["😎","🔥","👑","💯"],
    keywords: [
      "confidence","confident","boss","king","queen",
      "legend","i can","i will","strong","power",
      "powerful","fearless","attitude","apna time",
      "main kar sakta","main kar sakti",
      "mujhe pata hai",
      "بادشاہ","ملکہ","اعتماد","طاقت","مضبوط",
      "میں کر سکتا","میں کر سکتی"
    ]
  },

  /* ---------- CURIOSITY ---------- */

  {
    name: "curiosity",
    priority: 90,
    reactions: ["🤔","🧐","👀","❓"],
    keywords: [
      "why","how","what","where","when","who","which",
      "really","tell me","explain","curious","wonder",
      "kyun","kyon","kaise","kahan","kab","kon","kaun",
      "kya","batao","samjhao",
      "کیوں","کیسے","کہاں","کب","کون","کیا",
      "بتاؤ","سمجھاؤ",
      "لماذا","كيف","ماذا","أين","متى"
    ]
  },

  /* ---------- ANNOYANCE ---------- */

  {
    name: "annoyance",
    priority: 89,
    reactions: ["🙄","😒","😑","😤"],
    keywords: [
      "annoying","annoyed","irritating","irritated",
      "ugh","whatever","seriously again","fed up",
      "tang","tang aa gaya","pareshan","jhanjhat",
      "bakwas","bas karo",
      "تنگ","تنگ آ گیا","پریشان","جھنجھٹ","بکواس",
      "بس کرو"
    ]
  },

  /* ---------- PEACE ---------- */

  {
    name: "peace",
    priority: 88,
    reactions: ["😌","🫶","🤍","🌿"],
    keywords: [
      "peace","peaceful","calm","relax","relaxed",
      "peace of mind","finally calm","serenity",
      "sukoon","sukoon hai","aram","aaraam",
      "dil ko sukoon","itminan",
      "سکون","سکون ہے","آرام","دل کو سکون","اطمینان",
      "سلام","طمأنينة"
    ]
  },

  /* ---------- BEGGING ---------- */

  {
    name: "begging",
    priority: 87,
    reactions: ["🥺","🥹","🙏","🫶"],
    keywords: [
      "please","please help","please bro","please yaar",
      "beg","begging","i request","kindly","plz",
      "meri request","meharbani","khuda ke liye",
      "allah ke waste","madad karo",
      "براہ کرم","مہربانی","خدا کے لیے",
      "اللہ کے واسطے","مدد کرو","منت",
      "من فضلك","أرجوك"
    ]
  },

  /* ---------- AGREEMENT ---------- */

  {
    name: "agreement",
    priority: 86,
    reactions: ["🤝","👍","💯","✅"],
    keywords: [
      "agree","agreed","exactly","true","correct","right",
      "absolutely","definitely","yes","of course","same",
      "bilkul","sahi","theek","thik","durust","haan",
      "ji haan","meri bhi yehi",
      "بالکل","صحیح","ٹھیک","درست","ہاں","جی ہاں",
      "صحيح","نعم"
    ]
  },

  /* ---------- PRAISE ---------- */

  {
    name: "praise",
    priority: 85,
    reactions: ["👏","🙌","🔥","💯"],
    keywords: [
      "great","excellent","amazing","awesome","brilliant",
      "perfect","beautiful work","good job","well played",
      "well done","nice work","respect",
      "zabardast","zabardast kaam","kamal","kamaal",
      "shandar","lajawab","wah","waah","bohat khoob",
      "kya baat",
      "زبردست","کمال","شاندار","لاجواب","واہ",
      "بہت خوب","کیا بات","خوب",
      "رائع","ممتاز","أحسنت"
    ]
  },

  /* ---------- MOTIVATION ---------- */

  {
    name: "motivation",
    priority: 84,
    reactions: ["💪","🔥","🚀","👑"],
    keywords: [
      "motivation","motivational","never give up",
      "keep going","stay strong","work hard",
      "hard work","success","successful","winner",
      "winning","believe in yourself","you can do it",
      "don't give up","keep fighting","keep trying",
      "zindagi","hosla","himmat","mehnat","kamiyabi",
      "kamyabi","jeet","aage barho","haar mat mano",
      "himmat na haro","koshish karo",
      "زندگی","حوصلہ","ہمت","محنت","کامیابی","جیت",
      "آگے بڑھو","ہار مت مانو","ہمت نہ ہارو",
      "کوشش کرو"
    ]
  },

  /* ---------- RESPECT ---------- */

  {
    name: "respect",
    priority: 83,
    reactions: ["🫡","🙏","👑","❤️"],
    keywords: [
      "respect","respect bro","respect man","salute",
      "honor","legend","hero","great man","sir","madam",
      "izzat","ehtram","salam","salaam","ustad","badshah",
      "عزت","احترام","سلام","استاد","بادشاہ",
      "بہادری","لیجنڈ"
    ]
  },

  /* ---------- CELEBRATION ---------- */

  {
    name: "celebration",
    priority: 82,
    reactions: ["🎉","🥳","🔥","🥂"],
    keywords: [
      "congratulations","congrats","congratulation",
      "well done","proud of you","celebrate",
      "celebration","party","birthday","happy birthday",
      "wedding","married","marriage","engagement",
      "graduation",
      "mubarak","mubarak ho","bohat bohat mubarak",
      "bahut bahut mubarak","party hai","jashan",
      "مبارک","مبارک ہو","بہت بہت مبارک","مبارکباد",
      "سالگرہ","شادی","منگنی","جشن"
    ]
  },

  /* ---------- EMOTIONAL LAUGH ---------- */

  {
    name: "emotionalLaugh",
    priority: 81,
    reactions: ["😭","😂","💀","🤣"],
    keywords: [
      "i'm crying laughing","crying laughing",
      "dead laughing","can't stop laughing",
      "laughing so hard","too funny","dying laughing",
      "hans hans ke","hansi nahi ruk rahi",
      "hans hans kar","hans hans ke bura haal",
      "ہنس ہنس کے","ہنسی نہیں رک رہی","ہنس ہنس کر"
    ]
  },

  /* ---------- SAVAGE ---------- */

  {
    name: "savage",
    priority: 80,
    reactions: ["💀","😂","😭","😈"],
    keywords: [
      "savage","roast","roasted","destroyed","burned",
      "what a roast","destroy","brutal","dead",
      "beizzati","bezati","jalaa diya","jal gaya",
      "dhulai","class laga di",
      "بے عزتی","جلا دیا","جل گیا","دھلائی",
      "کلاس لگا دی","ذلیل"
    ]
  },

  /* ---------- TEASING ---------- */

  {
    name: "teasing",
    priority: 79,
    reactions: ["🤭","😏","😂","😉"],
    keywords: [
      "tease","teasing","just kidding","kidding",
      "got you","prank","funny bro",
      "chherna","cher raha","mazaq kar raha",
      "mazaq kar rahi","tang karna",
      "چھیڑنا","چھیڑ رہا","مذاق کر رہا",
      "مذاق کر رہی","تنگ کرنا"
    ]
  },

  /* ---------- SUSPICIOUS ---------- */

  {
    name: "suspicious",
    priority: 78,
    reactions: ["👀","🤨","🧐","😏"],
    keywords: [
      "suspicious","sus","doubt","doubtful","really?",
      "are you sure","something wrong","something fishy",
      "i don't trust",
      "shak","mujhe shak","yaqeen nahi","kuch garbar",
      "doubt hai",
      "شک","مجھے شک","یقین نہیں","کچھ گڑبڑ","شک ہے"
    ]
  },

  /* ---------- DRAMA ---------- */

  {
    name: "drama",
    priority: 77,
    reactions: ["🍿","👀","😂","😭"],
    keywords: [
      "drama","dramatic","fight","argument","beef",
      "gossip","tea","what happened","then what",
      "larai","larray","jhagra","tamasha","kya hua",
      "phir kya hua",
      "لڑائی","جھگڑا","تماشا","کیا ہوا","پھر کیا ہوا"
    ]
  },

  /* ---------- OVERWHELMED ---------- */

  {
    name: "overwhelmed",
    priority: 76,
    reactions: ["🫠","😭","🥲","😩"],
    keywords: [
      "overwhelmed","too much","can't handle",
      "i can't","exhausted","everything is too much",
      "stress","stressed",
      "bohat zyada","handle nahi ho raha","thak gaya",
      "thak gayi","sab kuch mushkil","pressure","tension",
      "بہت زیادہ","ہینڈل نہیں ہو رہا","تھک گیا",
      "تھک گئی","سب کچھ مشکل","پریشر","ٹینشن"
    ]
  },

  /* ---------- TIRED ---------- */

  {
    name: "tired",
    priority: 75,
    reactions: ["😴","🥱","😮‍💨","🫠"],
    keywords: [
      "tired","sleepy","sleep","exhausted","need sleep",
      "so tired","no energy",
      "thak","thaka hua","thaki hui","neend",
      "sona hai","bohat thak gaya","bohat thak gayi",
      "تھکا","تھکا ہوا","تھکی ہوئی","نیند","سونا ہے",
      "بہت تھک گیا","بہت تھک گئی"
    ]
  },

  /* ---------- FRUSTRATION ---------- */

  {
    name: "frustration",
    priority: 74,
    reactions: ["🤦","😩","😮‍💨","😤"],
    keywords: [
      "frustrated","frustration","failed","failure",
      "not working","doesn't work","fed up",
      "waste of time","why is this happening",
      "pareshan","mayus","jhanjhat",
      "kaam nahi kar raha","nahi ho raha",
      "dimagh kharab","tang aa gaya",
      "پریشان","مایوس","جھنجھٹ","کام نہیں کر رہا",
      "نہیں ہو رہا","دماغ خراب","تنگ آ گیا"
    ]
  },

  /* ---------- DISGUST ---------- */

  {
    name: "disgust",
    priority: 73,
    reactions: ["🤢","🤮","😖","😷"],
    keywords: [
      "disgusting","disgust","gross","nasty","sick",
      "vomit","dislike","ew","yuck",
      "ghin","gandi","ganda","nafrat","ulti",
      "gandi baat",
      "گھن","گندی","گندا","نفرت","الٹی","گندی بات"
    ]
  },

  /* ---------- SHOCK ---------- */

  {
    name: "shockCold",
    priority: 72,
    reactions: ["🥶","😳","❄️","😱"],
    keywords: [
      "cold","freezing","frozen","ice cold","shock",
      "shocked","speechless","damn","what the",
      "sardi","thand","jam gaya","sunn",
      "sunn reh gaya",
      "سردی","ٹھنڈ","جم گیا","سن","سن رہ گیا"
    ]
  },

  /* ---------- INNOCENT ---------- */

  {
    name: "innocent",
    priority: 71,
    reactions: ["😇","🥺","😌","🤍"],
    keywords: [
      "innocent","i didn't do anything","not me",
      "who me","i am innocent","nothing happened",
      "masoom","main masoom","maine kuch nahi kiya",
      "mujhe kya pata",
      "معصوم","میں معصوم","میں نے کچھ نہیں کیا",
      "مجھے کیا پتا"
    ]
  },

  /* ---------- MISCHIEF ---------- */

  {
    name: "mischief",
    priority: 70,
    reactions: ["😈","😏","😂","🤭"],
    keywords: [
      "mischief","evil","naughty","trouble",
      "troublemaker","watch me",
      "shararat","shararti","badmashi","badmash",
      "masti","fitrat",
      "شرارت","شرارتی","بدمعاشی","بدمعاش","مستی","فطرت"
    ]
  },

  /* ---------- COMFORT ---------- */

  {
    name: "comfort",
    priority: 69,
    reactions: ["🤍","🫂","🫶","❤️"],
    keywords: [
      "comfort","take care","it's okay","it will be okay",
      "don't worry","everything will be fine",
      "i understand","stay safe",
      "fikr mat karo","tension mat lo","sab theek hoga",
      "main samajhta","main samajhti","khayal rakhna",
      "فکر مت کرو","ٹینشن مت لو","سب ٹھیک ہوگا",
      "میں سمجھتا","میں سمجھتی","خیال رکھنا"
    ]
  },

  /* ---------- SUPPORT ---------- */

  {
    name: "support",
    priority: 68,
    reactions: ["🫂","❤️","🫶","🤝"],
    keywords: [
      "i am with you","i'm with you","with you",
      "support","supporting you","you are not alone",
      "we are with you","stand with you",
      "main tumhare sath","hum tumhare sath",
      "sath hoon","sath hain","main tumhare saath",
      "hum tumhare saath",
      "ہم تمہارے ساتھ","میں تمہارے ساتھ",
      "اکیلے نہیں ہو","ساتھ ہوں","ساتھ ہیں"
    ]
  },

  /* ---------- GRATITUDE ---------- */

  {
    name: "gratitude",
    priority: 67,
    reactions: ["🙏","❤️","🤲","🫶"],
    keywords: [
      "thank you","thanks","thank","grateful",
      "gratitude","thanks bro","thank you so much",
      "many thanks",
      "shukriya","bohat shukriya","dil se shukriya",
      "meharbani",
      "شکریہ","بہت شکریہ","دل سے شکریہ","مہربانی",
      "شكرا"
    ]
  },

  /* ---------- DUA ---------- */

  {
    name: "dua",
    priority: 66,
    reactions: ["🤲","❤️","🙏","🕊️"],
    keywords: [
      "dua","duaa","prayer","pray for me",
      "pray for us","please pray","ameen","aameen",
      "allah help","allah madad","mere liye dua",
      "hamare liye dua",
      "دعا","دعائیں","دعا کریں","میرے لیے دعا",
      "میرے لئے دعا","ہمارے لیے دعا","آمین",
      "اللہ مدد","اللہ آسانی",
      "دعاء","آمين","اللهم"
    ]
  },

  /* ---------- HEARTBREAK ---------- */

  {
    name: "heartbreak",
    priority: 105,
    reactions: ["💔","🥀","😭","🥺"],
    keywords: [
      "heartbreak","broken heart","breakup","break up",
      "betrayal","betrayed","cheated","cheating",
      "relationship ended","she left","he left",
      "bewafa","bewafai","dhoka","dhokha","judai",
      "dil toot","dil tut","dil toot gaya","dil tut gaya",
      "rishta toot gaya",
      "دل ٹوٹ","دل توڑ","دل ٹوٹا","دل ٹوٹ گیا",
      "دل ٹوٹ گیا ہے","بے وفائی","بے وفا","دھوکہ",
      "جدائی","رشتہ ٹوٹ گیا"
    ]
  },

  /* ---------- LONELINESS ---------- */

  {
    name: "loneliness",
    priority: 65,
    reactions: ["🥀","😔","💔","🫂"],
    keywords: [
      "loneliness","lonely","alone","nobody","no one",
      "all alone","miss everyone",
      "tanha","tanhai","akela","akeli","koi nahi",
      "sab chale gaye",
      "تنہا","تنہائی","اکیلا","اکیلی","کوئی نہیں",
      "سب چلے گئے"
    ]
  },

  /* ---------- SUCCESS ---------- */

  {
    name: "success",
    priority: 64,
    reactions: ["🚀","🔥","💯","👑"],
    keywords: [
      "success","successful","achieved","goal achieved",
      "made it","we did it","won","winner","winning",
      "promotion","new job",
      "kamyabi","kamiyabi","kamyaab","jeet gaya",
      "jeet gayi","kar dikhaya","manzil","maqsad hasil",
      "کامیابی","کامیاب","جیت گیا","جیت گئی",
      "کر دکھایا","منزل","مقصد حاصل"
    ]
  },

  /* ---------- ACHIEVEMENT ---------- */

  {
    name: "achievement",
    priority: 63,
    reactions: ["🏆","👑","🔥","🎉"],
    keywords: [
      "achievement","achieved","award","champion",
      "record","milestone","first place","number one",
      "topper",
      "kamyaabi hasil","inaam","record bana",
      "pehla number","first aya","first aayi",
      "کامیابی حاصل","انعام","ریکارڈ بنا","پہلا نمبر",
      "پہلی آئی"
    ]
  },

  /* ---------- DEEP ---------- */

  {
    name: "deep",
    priority: 60,
    reactions: ["🥀","🖤","🤍","😔"],
    keywords: [
      "life","reality","truth of life","memories",
      "memory","time","destiny","fate","silence",
      "pain","deep","deep words","deep thought",
      "life lesson","reality of life",
      "zindagi","haqeeqat","yaadein","yaadain","waqt",
      "qismat","khamoshi","dard","zindagi ki haqeeqat",
      "gehri baat","gehri soch",
      "زندگی","حقیقت","یادیں","وقت","قسمت",
      "خاموشی","درد","زندگی کی حقیقت","گہری بات",
      "گہری سوچ"
    ]
  },


  /* =======================================================
   * OBJECT / CATEGORY RULES
   * ======================================================= */

  {
    name: "food",
    priority: 58,
    reactions: ["🍔","🍕","🍟","😋"],
    keywords: [
      "food","eat","eating","hungry","breakfast","lunch",
      "dinner","biryani","pizza","burger","cake","chocolate",
      "ice cream","coffee","tea","chai","khana","bhook",
      "nashta","dawat","بریانی","کھانا","بھوک","ناشتہ",
      "پیزا","برگر","کیک","چائے","کافی",
      "طعام","طعامي","جائع","جائعة"
    ]
  },

  {
    name: "nature",
    priority: 57,
    reactions: ["🌿","🌸","🌻","🌳"],
    keywords: [
      "nature","tree","trees","flower","flowers","garden",
      "rain","rainy","sky","sun","moon","river","mountain",
      "forest","green","beautiful nature",
      "barish","baarish","phool","bagh","aasman",
      "pahaar","darya",
      "بارش","پھول","باغ","آسمان","پہاڑ","دریا",
      "طبيعة","مطر","زهرة","حديقة","سماء","جبل"
    ]
  },

  {
    name: "animals",
    priority: 56,
    reactions: ["🐶","🐱","🦋","🐼"],
    keywords: [
      "cat","cats","dog","dogs","puppy","kitten",
      "bird","birds","horse","lion","tiger","rabbit",
      "animal","animals","pet","parrot","fish",
      "billi","kutta","kutti","parinda","ghora",
      "sher","khargosh","janwar",
      "بلی","کتا","پرندہ","گھوڑا","شیر","خرگوش",
      "جانور","قط","كلب","حصان","أسد","أرنب"
    ]
  },

  {
    name: "sports",
    priority: 55,
    reactions: ["⚽","🏏","🏆","🔥"],
    keywords: [
      "football","soccer","cricket","match","goal",
      "six","four","wicket","bat","bowling","bowler",
      "batsman","championship","sports","game","win",
      "jeet","team","player","stadium",
      "فٹبال","کرکٹ","میچ","گول","وکٹ","بیٹ",
      "بولنگ","کھیل","ٹیم",
      "مباراة","كرة","رياضة","فوز"
    ]
  },

  {
    name: "technology",
    priority: 54,
    reactions: ["📱","💻","🤖","⚡"],
    keywords: [
      "phone","mobile","iphone","android","computer",
      "laptop","pc","technology","tech","software",
      "app","application","internet","wifi","router",
      "coding","code","programming","developer","bot",
      "server","github","railway","database","api",
      "موبائل","فون","کمپیوٹر","لیپ ٹاپ","ٹیکنالوجی",
      "انٹرنیٹ","وائی فائی","کوڈ","پروگرامنگ"
    ]
  },

  {
    name: "travel",
    priority: 53,
    reactions: ["✈️","🚗","🌍","🗺️"],
    keywords: [
      "travel","trip","journey","flight","airport",
      "plane","car","road","highway","tour","vacation",
      "holiday","beach","city","country","visit",
      "safar","musafir","jahaz","airport","gaari",
      "road","tour","chutti","samandar",
      "سفر","مسافر","جہاز","گاڑی","راستہ","چھٹی",
      "سمندر","سياحة","سفر","طائرة"
    ]
  },

  {
    name: "gift",
    priority: 52,
    reactions: ["🎁","🎀","💝","🥰"],
    keywords: [
      "gift","present","surprise gift","birthday gift",
      "present for you","gift for you",
      "tohfa","tofa","hadia","hadiya",
      "تحفہ","ہدیہ","هدية","هدية لك"
    ]
  },

  {
    name: "music",
    priority: 51,
    reactions: ["🎵","🎶","🎧","🔥"],
    keywords: [
      "music","song","songs","singer","singing","lyrics",
      "beat","dj","concert","playlist","listen",
      "gana","gaana","geet","music sun",
      "گانا","گیت","موسیقی","آواز",
      "موسيقى","أغنية"
    ]
  },

  {
    name: "work",
    priority: 50,
    reactions: ["💼","💻","☕","💪"],
    keywords: [
      "work","office","job","meeting","business",
      "project","deadline","boss","employee","salary",
      "career","काम","kaam","nokri","naukri","office",
      "business","project","deadline",
      "کام","نوکری","دفتر","کاروبار","ملازمت"
    ]
  },

  {
    name: "sleep",
    priority: 49,
    reactions: ["😴","🌙","🛌","💤"],
    keywords: [
      "good night","gn","sleep","sleeping","bed",
      "going to sleep","sweet dreams","night",
      "so jao","sona","neend","shab bakhair",
      "شب بخیر","سونا","نیند",
      "تصبح على خير","نوم"
    ]
  },

  {
    name: "morning",
    priority: 48,
    reactions: ["🌅","☀️","😊","🌸"],
    keywords: [
      "good morning","gm","morning","subha","subah",
      "sawere","صبح بخیر","صبح","صباح الخير"
    ]
  },

  {
    name: "weather",
    priority: 47,
    reactions: ["🌤️","🌧️","☀️","❄️"],
    keywords: [
      "weather","hot weather","cold weather","rain",
      "rainy","sunny","cloudy","storm","wind",
      "garmi","sardi","barish","hawa","badal",
      "موسم","گرمی","سردی","بارش","ہوا","بادل"
    ]
  }
];


/* =========================================================
 * DEEP CONTEXT
 * ========================================================= */

function applyDeepContext(text, scores) {

  /* Love */

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
    scores.love += 40;
  }


  /* Heartbreak */

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
    scores.heartbreak += 45;
  }


  /* Missing */

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
    scores.sadness += 35;
  }


  /* Dua */

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
    scores.dua += 40;
  }


  /* Motivation */

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
    scores.motivation += 35;
  }


  /* Humor */

  if (
    /haha+|hehe+|lol|lmao|lmfao|rofl|🤣|😂/i.test(text)
  ) {
    scores.humor += 35;
  }


  /* Emotional laugh */

  if (
    (
      /haha+|hehe+|lol|lmao|🤣|😂/i.test(text)
    ) &&
    (
      text.includes("cry") ||
      text.includes("😭") ||
      text.includes("ro raha") ||
      text.includes("ro rahi")
    )
  ) {
    scores.emotionalLaugh += 40;
  }


  /* Congratulations */

  if (
    text.includes("congratulations") ||
    text.includes("congrats") ||
    text.includes("mubarak ho") ||
    text.includes("bohat bohat mubarak") ||
    text.includes("بہت بہت مبارک") ||
    text.includes("مبارک ہو")
  ) {
    scores.celebration += 40;
  }


  /* Success */

  if (
    text.includes("we did it") ||
    text.includes("i made it") ||
    text.includes("goal achieved") ||
    text.includes("kar dikhaya") ||
    text.includes("manzil mil") ||
    text.includes("مقصد حاصل")
  ) {
    scores.success += 35;
  }


  /* Praise */

  if (
    text.includes("well done") ||
    text.includes("good job") ||
    text.includes("beautiful work") ||
    text.includes("bohat khoob") ||
    text.includes("بہت خوب")
  ) {
    scores.praise += 30;
  }


  /* Question */

  if (
    text.includes("?") ||
    text.includes("؟")
  ) {
    scores.curiosity =
      (scores.curiosity || 0) + 12;
  }


  /* Multiple sadness */

  const sadSignals = [
    "sad","cry","tears","lonely",
    "dukhi","dard","udaas","tanhai",
    "اداس","دکھی","درد","تنہائی","آنسو",
    "حزين","حزن","بكاء","دموع"
  ];

  const sadCount =
    sadSignals.filter(
      x => text.includes(x)
    ).length;

  if (sadCount >= 2) {
    scores.sadness += 25;
  }


  /* Multiple love */

  const loveSignals = [
    "love","pyar","pyaar","mohabbat",
    "ishq","chahat","محبت","پیار",
    "عشق","چاہت","حب","أحب"
  ];

  const loveCount =
    loveSignals.filter(
      x => text.includes(x)
    ).length;

  if (loveCount >= 2) {
    scores.love += 25;
  }


  /* Multiple anger */

  const angerSignals = [
    "angry","furious","mad","gussa",
    "ghussa","nafrat","غصہ","نفرت",
    "غاضب","غضب"
  ];

  const angerCount =
    angerSignals.filter(
      x => text.includes(x)
    ).length;

  if (angerCount >= 2) {
    scores.anger += 20;
  }


  /* Positive */

  const positiveSignals = [
    "amazing","awesome","excellent","great",
    "zabardast","kamal","shandar",
    "زبردست","کمال","شاندار"
  ];

  const positiveCount =
    positiveSignals.filter(
      x => text.includes(x)
    ).length;

  if (positiveCount >= 2) {
    scores.praise += 20;
  }
}


/* =========================================================
 * EMOJI CONTEXT
 * ========================================================= */

function applyEmojiContext(text, scores) {

  /* Happy / laughing */

  if (
    /😂|🤣|😆|😅|😁|😄|😃|😀|😹/.test(text)
  ) {
    scores.humor += 30;
  }


  /* Love */

  if (
    /❤️|♥️|💕|💖|💗|💓|💞|💘|😍|🥰/.test(text)
  ) {
    scores.love += 30;
  }


  /* Sad */

  if (
    /😢|😭|😞|😔|🥺|💔|🥀/.test(text)
  ) {
    scores.sadness += 30;
  }


  /* Angry */

  if (
    /😡|🤬|😠|😤|💢/.test(text)
  ) {
    scores.anger += 30;
  }


  /* Surprise */

  if (
    /😮|😲|🤯|😳|😱/.test(text)
  ) {
    scores.surprise += 25;
  }


  /* Food */

  if (
    /🍔|🍕|🍟|🍗|🍖|🌭|🍿|🍩|🍰|🎂|🍫|🍪|🍎|🍓|🍉|🍌|☕|🍵/.test(text)
  ) {
    scores.food += 30;
  }


  /* Nature */

  if (
    /🌳|🌲|🌴|🌱|🌿|🌸|🌹|🌺|🌻|🌼|🌷|🌞|🌙|🌈|☀️|🌧️/.test(text)
  ) {
    scores.nature += 30;
  }


  /* Animals */

  if (
    /🐶|🐱|🐭|🐹|🐰|🦊|🐻|🐼|🐨|🐯|🦁|🐮|🐷|🐸|🐵|🐔|🐧|🐦|🦋|🐟/.test(text)
  ) {
    scores.animals += 30;
  }


  /* Sports */

  if (
    /⚽|🏏|🏀|🏈|⚾|🎾|🏐|🏆|🥇|🥈|🥉/.test(text)
  ) {
    scores.sports += 30;
  }


  /* Technology */

  if (
    /📱|💻|🖥️|⌨️|🖱️|📲|🤖|💾|🔌|📡/.test(text)
  ) {
    scores.technology += 30;
  }


  /* Travel */

  if (
    /✈️|🚗|🚕|🚌|🚆|🚂|🚢|🏝️|🌍|🗺️/.test(text)
  ) {
    scores.travel += 30;
  }


  /* Music */

  if (
    /🎵|🎶|🎧|🎤|🎸|🥁|🎹/.test(text)
  ) {
    scores.music += 30;
  }


  /* Gift */

  if (
    /🎁|🎀|💝|🎈/.test(text)
  ) {
    scores.gift += 30;
  }
}


/* =========================================================
 * GET AUTO REACTION
 * ========================================================= */
function scoreRule(text, rule) {
  let score = 0;

  for (const keyword of rule.keywords || []) {
    const k = normalizeReactionText(keyword);

    if (!k) continue;

    if (text.includes(k)) {
      score += k.length >= 8 ? 5 : k.length >= 4 ? 3 : 2;
    }
  }

  return score;
}

function getAutoReaction(text) {
  // ...
    }
export function getAutoReaction(text = "") {

  const rawText = String(text || "");

  const msg =
    normalizeReactionText(rawText);

  if (
    !msg ||
    msg.length < 2
  ) {
    return null;
  }


  const scores = {};


  /* Score text */

  for (
    const rule of DEEP_REACTION_RULES
  ) {

    scores[rule.name] =
      scoreRule(
        msg,
        rule
      );
  }


  /* Deep context */

  applyDeepContext(
    msg,
    scores
  );


  /* Existing emojis also influence meaning */

  applyEmojiContext(
    rawText,
    scores
  );


  /* =======================================================
   * BEST RULE
   * ======================================================= */

  let bestRule = null;
  let bestScore = 0;


  for (
    const rule of DEEP_REACTION_RULES
  ) {

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


  /* =======================================================
   * FALLBACK
   * ======================================================= */

  if (
    !bestRule ||
    bestScore < 3
  ) {

    return "❤️";
  }


  /*
   * EXACTLY ONE EMOJI
   */

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
 * MESSAGE HANDLER
 * ========================================================= */

export async function messageHandler(params) {

  const {
    message,
    conn,
  } = params;


  try {

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
     * NO BODY
     * ===================================================== */

    if (
      !message?.body
    ) {
      return;
    }


    /* =====================================================
     * AUTO REACTION
     * ===================================================== */

    try {

      const autoReact =
        await kvGet(
          AUTOREACT_KEY
        );


      /*
       * Default ON.
       */

      if (
        autoReact !== false
      ) {

        /*
         * Commands should NOT receive reactions.
         */

        const body =
          String(
            message.body || ""
          ).trim();


        const isCommand =
          body.startsWith(
            BOT_INFO.PREFIX
          );


        /*
         * Owner messages should NOT receive reactions.
         */

        const ownerMessage =
          isOwnerMessage(
            message
          );


        if (
          !isCommand &&
          !ownerMessage
        ) {

          const reaction =
            getAutoReaction(
              body
            );


          /*
           * Exactly ONE reaction.
           */

          if (
            reaction
          ) {

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
      }

    } catch (error) {

      /*
       * AutoReact failure must NEVER
       * stop command processing.
       */

      logger.debug?.(
        `[AutoReact] ${
          error?.message ||
          error
        }`
      );
    }


    /* =====================================================
     * COMMAND HANDLER
     * ===================================================== */

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


    if (
      !command
    ) {
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


    /* =====================================================
     * ACCESS
     * ===================================================== */

    const access =
      await checkCommandAccess(
        message,
        command,
        conn
      );


    if (
      !access.allowed
    ) {

      if (
        access.silent
      ) {
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


    /* =====================================================
     * FEATURE FLAG
     * ===================================================== */

    const flagCheck =
      await checkCommandFlag(
        name
      );


    if (
      !flagCheck.ok
    ) {

      if (
        flagCheck.flag ===
          "maintenance" &&
        privileged
      ) {

        /* Privileged can continue. */

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
      !policy.ok
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
          policy.reason
        ] ||
          policy.reason
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
        settings.disabledPlugins ||
        [];


      if (
        disabled.includes(name)
      ) {

        if (
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
    }


    /* =====================================================
     * LOGGER
     * ===================================================== */

    logger.command(
      name ||
        "unknown",
      message.sender,
      message.isGroup
        ? message.from
        : null
    );


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
      !validation.valid
    ) {

      await sendError(
        conn,
        message.from,
        validation.error
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


      if (
        !groupMetadata
      ) {

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


    /* =====================================================
     * ACKNOWLEDGEMENT
     * ===================================================== */

    await ackCommand(
      conn,
      message
    );


    /* =====================================================
     * METRICS
     * ===================================================== */

    recordCommand(
      name ||
        "unknown"
    );


    /* =====================================================
     * EXECUTE COMMAND
     * ===================================================== */

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
            String(
              message.body ||
              ""
            ).slice(
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

    recordError();


    const where =
      `${commandNameSafe(message)} @ ${
        message?.from ||
        "?"
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

      if (
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

      else {

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

      recordError();


      await systemLog(
        "error",
        "Failed to send user-safe error",
        sendErr
      );
    }
  }
}


/* =========================================================
 * SAFE COMMAND NAME
 * ========================================================= */

function commandNameSafe(message) {

  try {

    const body =
      message?.body ||
      "";


    return (
      body.split(/\s+/)[0] ||
      "unknown"
    );

  }

  catch {

    return "unknown";
  }
}
