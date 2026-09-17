/**
 * X-ANSARI / X-MD
 * Premium Dynamic Menu
 */

import { command, getMenuCommands } from "../plugins.js";
import { reply } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getMode } from "../utils/access.js";

/*
 * Commands that must appear in MISC
 */
const MISC_SPECIAL = new Set([
  "antidelete",
  "autoreact",
]);

/*
 * FINAL SECTION STYLE
 */
const SECTION_STYLE = {
  group: ["👥", "𝗚𝗥𝗢𝗨𝗣"],
  misc: ["🛠️", "𝗠𝗜𝗦C"],
  admin: ["🛡️", "𝗔𝗗𝗠𝗜𝗡"],
  owner: ["👑", "𝗢𝗪𝗡𝗘𝗥"],
  media: ["🎬", "𝗠𝗘𝗗𝗜𝗔"],
};

/*
 * FINAL COMMAND ORDER
 */
const COMMAND_ORDER = {
  group: [
    "tagall",
    "notify",
    "groupinfo",
    "promote",
    "demote",
    "admins",
    "mention",
    "acceptall",
  ],

  misc: [
    "antidelete",
    "info",
    "menu",
    "lang",
    "status",
    "autoreact",
    "ping",
    "note",
    "remind",
    "reminders",
    "cancelremind",
    "poll",
    "vv",
  ],

  admin: [
    "disable",
    "enable",
    "plugins",
    "welcome",
    "goodbye",
    "antilink",
    "antispam",
    "groupsettings",
    "warn",
    "unwarn",
    "warns",
    "mute",
    "unmute",
    "kick",
    "kickall",
    "groupsetup",
  ],

  owner: [
    "broadcast",
    "createlog",
    "setlog",
    "setup",
    "mode",
    "sudo",
    "audit",
    "flag",
    "policy",
    "role",
    "backup",
    "metrics",
    "exif",
  ],

  media: [
    "ig",
    "tiktok",
    "fb",
    "sticker",
    "take",
    "toimg",
    "tomp3",
    "toururl",
    "quote",
    "fancy",
    "tts",
    "ttp",
    "attp",
"yt",
    "ytmp3",
    "ytmp4",
    "play",
  ],
};

/*
 * FINAL ICONS
 */
const ICONS = {
  /*
   * GROUP
   */
  admins: "👥",
  demote: "👤",
  groupinfo: "ℹ️",
  mention: "🏷️",
  notify: "🔔",
  promote: "⬆️",
  tagall: "👥",

  /*
   * MISC
   */
  antidelete: "🗑️",
  autoreact: "😊",
  cancelremind: "⛔",
  info: "ℹ️",
  lang: "🌐",
  menu: "📖",
  note: "📝",
  ping: "🏓",
  poll: "📊",
  remind: "⏰",
  reminders: "📋",
  status: "📡",
  vv: "👁️",

  /*
   * ADMIN
   */
  antilink: "🚫",
  antispam: "🚮",
  disable: "🚫",
  enable: "✍️",
  goodbye: "💬",
  groupsettings: "🧑‍🔧",
  groupsetup: "🧑‍🔧",
  acceptall: "✅",
  kick: "🔇",
  kickall: "🚀",
  mute: "🔇",
  plugins: "✍️",
  unmute: "🔊",
  unwarn: "🤝",
  warn: "⚠️",
  warns: "⚠️",
  welcome: "🎀",

  /*
   * OWNER
   */
  audit: "👑",
  backup: "👑",
  broadcast: "👑",
  createlog: "👑",
  exif: "👑",
  flag: "👑",
  metrics: "👑",
  mode: "👑",
  policy: "👑",
  role: "👑",
  setlog: "👑",
  setup: "👑",
  sudo: "👑",

  /*
   * MEDIA
   */
  attp: "🔖",
  fancy: "✍️",
  fb: "🎬",
  ig: "🎬",
  play: "🔍",
  quote: "🔖",
  sticker: "🧑‍🔧",
  take: "🧑‍🔧",
  tiktok: "⬇️",
  toimg: "🧑‍🔧",
  tomp3: "🎵",
  toururl: "🖇️",
  ttp: "🧑‍🔧",
  tts: "🧑‍🔧",
  yt: "💬",
  ytmp3: "🎵",
  ytmp4: "🎬",
};

/*
 * FINAL DESCRIPTIONS
 *
 * These override descriptions only where the final
 * X-ANSARI menu needs a specific wording.
 *
 * Commands themselves still come from the real registry.
 */
const DESCRIPTIONS = {
  /*
   * GROUP
   */
  tagall: "Tag all group members",
  notify: "Ping everyone with a short alert",
  groupinfo: "Get detailed group information",
  promote: "Promote a member to admin (mention or reply)",
  demote: "Demote an admin to member (mention or reply)",
  admins: "List all group admins",
  mention: "Mention all users in group",

  /*
   * MISC
   */
  antidelete: "Show deleted messages",
  info: "Shows user and message information",
  menu: "Show all commands",
  lang: "Show/set bot language (en|id|hi)",
  status: "Bot health status",
  autoreact: "Auto emoji reaction",
  ping: "Check bot response time",
  note: "Save/get/delete personal notes",
  remind: "Set a reminder (e.g. 10m buy milk)",
  reminders: "List pending reminders in this chat",
  cancelremind: "Cancel reminder by id",
  poll: "Create a poll: question | opt1 | opt2",
  vv: "Open View Once media",

  /*
   * ADMIN
   */
  disable: "Disable a command in this group",
  enable: "Re-enable a command in this group",
  plugins: "List disabled commands in this group",
  welcome: "Toggle/set welcome message",
  goodbye: "Toggle/set goodbye message",
  antilink: "Toggle anti-link",
  antispam: "Toggle anti-spam",
  groupsettings: "Show group moderation settings",
  warn: "Warn a user (kick at limit)",
  unwarn: "Reset warns for a user",
  warns: "Mention group on status",
  mute: "Mute a user in this group",
  unmute: "Unmute a user",
  kick: "Remove a member",
  kickall: "Remove all group members",
  groupsetup: "Quick group moderation setup",
  acceptall: "Approve all pending request",

  /*
   * OWNER
   */
  broadcast: "Broadcast message to all groups (owner)",
  createlog: "Create/recreate the system log group",
  setlog: "Mark this group as the system log group",
  setup: "Onboarding wizard (system log group only)",
  mode: "Show or set bot mode (public|private)",
  sudo: "Manage sudo users (add|del|list)",
  audit: "Show audit log (system group)",
  flag: "Feature flags: .flag list | .flag media off",
  policy: "View/set global policies",
  role: "RBAC: .role set @user admin | list",
  backup: "Export BotKV backup (optional auth db)",
  metrics: "Show runtime metrics",
  exif: "Set sticker pack|author (owner)",

  /*
   * MEDIA
   */
  ig: "Download Instagram media (best-effort)",
  tiktok: "Download TikTok video (best-effort)",
  fb: "Download Facebook media (best-effort)",
  sticker: "Convert image/video to sticker",
  take: "Repack sticker EXIF (Pack|Author)",
  toimg: "Convert sticker to PNG",
  tomp3: "Convert video/audio to mp3",
  toururl: "Upload media and get a URL",
  quote: "Fake quote sticker from text / reply",
  fancy: "Fancy unicode text styles",
  tts: "Google TTS audio",
  ttp: "Text to sticker",
  attp: "Animated text sticker",
  yt: "YouTube info / usage",
  ytmp3: "Download YouTube audio (mp3)",
  ytmp4: "Download YouTube video ≤720p",
  play: "Search YouTube and play first audio",
};

/*
 * Command icon
 */
function commandIcon(name) {
  const key = String(name || "").toLowerCase();

  return ICONS[key] || "🔹";
}

/*
 * Command description
 */
function commandDescription(cmd) {
  const name = String(cmd.patternName || "").toLowerCase();

  return DESCRIPTIONS[name] || cmd.desc || "";
}

/*
 * Get actual registered menu commands
 */
async function getMenuData() {
  let cmds = getMenuCommands();

  /*
   * Force special commands into MISC
   */
  cmds = cmds.map((cmd) => {
    const name = String(cmd.patternName || "").toLowerCase();

    if (MISC_SPECIAL.has(name)) {
      return {
        ...cmd,
        type: "misc",
      };
    }

    return cmd;
  });

  /*
   * Keep AntiDelete visible even if another filter
   * removes it from the normal command list.
   */
  const hasAntiDelete = cmds.some(
    (cmd) =>
      String(cmd.patternName || "").toLowerCase() ===
      "antidelete"
  );

  if (!hasAntiDelete) {
    cmds.push({
      patternName: "antidelete",
      desc: "Show deleted messages",
      type: "misc",
    });
  }

  /*
   * Remove duplicate command names.
   *
   * First registered command wins.
   */
  const unique = new Map();

  for (const cmd of cmds) {
    const name = String(cmd.patternName || "")
      .trim()
      .toLowerCase();

    if (!name) continue;

    if (!unique.has(name)) {
      unique.set(name, cmd);
    }
  }

  return [...unique.values()];
}

/*
 * Sort commands according to final menu design.
 */
function sortCommands(list, type) {
  const order = COMMAND_ORDER[type] || [];

  const rank = new Map(
    order.map((name, index) => [
      String(name).toLowerCase(),
      index,
    ])
  );

  return [...list].sort((a, b) => {
    const aName = String(a.patternName || "").toLowerCase();
    const bName = String(b.patternName || "").toLowerCase();

    const aRank = rank.has(aName)
      ? rank.get(aName)
      : 9999;

    const bRank = rank.has(bName)
      ? rank.get(bName)
      : 9999;

    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return aName.localeCompare(bName);
  });
}

/*
 * Build final menu text
 */
async function buildMenuText(showDescriptions = true) {
  return `*╭━━━〔 🤖 𝑿-𝑨𝑵𝑺𝑨𝑹𝑰 〕━━━╮*
*┋ ⬡ 🫅 𝑶𝒘𝒏𝒆𝒓   :* 𝑰𝑲𝑹𝑨𝑴-𝑴𝑫
*┋ ⬡ ⚡ 𝑪𝒐𝒎𝒎𝒂𝒏𝒅𝒔 :* 𝟔𝟕
*┋ ⬡ 🔧 𝑷𝒓𝒆𝒇𝒊𝒙   :* .
*┋ ⬡ 🛡️ 𝑴𝒐𝒅𝒆    :* 𝒑𝒖𝒃𝒍𝒊𝒄
*┋ ⬡ 📚 𝑳𝒂𝒏𝒈𝒖𝒂𝒈𝒆 :* 𝒆𝒏
*┋ ⬡ 📦 𝑽𝒆𝒓𝒔𝒊𝒐𝒏  :* 𝟒.𝟎.𝟎 
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━〔 👥 𝑮𝑹𝑶𝑼𝑷 〕━━╮*
*┋ ⬡ 👥 .𝑻𝒂𝒈𝒂𝒍𝒍*
*┋ ⬡ 🔔 .𝑵𝒐𝒕𝒊𝒇𝒚*
*┋ ⬡ ℹ️ .𝑮𝒓𝒐𝒖𝒑𝒊𝒏𝒇𝒐*
*┋ ⬡ ⬆️ .𝑷𝒓𝒐𝒎𝒐𝒕𝒆*
*┋ ⬡ 👤 .𝑫𝒆𝒎𝒐𝒕𝒆*
*┋ ⬡ 👥 .𝑨𝒅𝒎𝒊𝒏𝒔*
*┋ ⬡ 📣 .𝑴𝒆𝒏𝒕𝒊𝒐𝒏*
*┋ ⬡ ✅ .𝑨𝒄𝒄𝒆𝒑𝒕𝒂𝒍𝒍*
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━〔 🛠️ 𝑴𝑰𝑺𝑪 〕━━╮*
*┋ ⬡ 🗑️ .𝑨𝒏𝒕𝒊𝒅𝒆𝒍𝒆𝒕𝒆*
*┋ ⬡ ℹ️ .𝑰𝒏𝒇𝒐*
*┋ ⬡ 📖 .𝑴𝒆𝒏𝒖*
*┋ ⬡ 🌐 .𝑳𝒂𝒏𝒈*
*┋ ⬡ 📡 .𝑺𝒕𝒂𝒕𝒖𝒔*
*┋ ⬡ 😊 .𝑨𝒖𝒕𝒐𝒓𝒆𝒂𝒄𝒕*
*┋ ⬡ 🏓 .𝑷𝒊𝒏𝒈*
*┋ ⬡ 📝 .𝑵𝒐𝒕𝒆*
*┋ ⬡ ⏰ .𝑹𝒆𝒎𝒊𝒏𝒅*
*┋ ⬡ 📋 .𝑹𝒆𝒎𝒊𝒏𝒅𝒆𝒓𝒔*
*┋ ⬡ ⛔ .𝑪𝒂𝒏𝒄𝒆𝒍𝒓𝒆𝒎𝒊𝒏𝒅*
*┋ ⬡ 📊 .𝑷𝒐𝒍𝒍*
*┋ ⬡ 👁️ .𝑽𝒗*
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━〔 🛡️ 𝑨𝑫𝑴𝑰𝑵 〕━━╮*
*┋ ⬡ ✍️ .𝑫𝒊𝒔𝒂𝒃𝒍𝒆*
*┋ ⬡ ✍️ .𝑬𝒏𝒂𝒃𝒍𝒆*
*┋ ⬡ ✍️ .𝑷𝒍𝒖𝒈𝒊𝒏𝒔*
*┋ ⬡ 🎀 .𝑾𝒆𝒍𝒄𝒐𝒎𝒆*
*┋ ⬡ 💬 .𝑮𝒐𝒐𝒅𝒃𝒚𝒆*
*┋ ⬡ 🚫 .𝑨𝒏𝒕𝒊𝒍𝒊𝒏𝒌*
*┋ ⬡ 🚮 .𝑨𝒏𝒕𝒊𝒔𝒑𝒂𝒎*
*┋ ⬡ 🧑‍🔧 .𝑮𝒓𝒐𝒖𝒑𝒔𝒆𝒕𝒕𝒊𝒏𝒈𝒔*
*┋ ⬡ ⚠️ .𝑾𝒂𝒓𝒏*
*┋ ⬡ 🤝 .𝑼𝒏𝒘𝒂𝒓𝒏*
*┋ ⬡ ⚠️ .𝑾𝒂𝒓𝒏𝒔*
*┋ ⬡ 🔇 .𝑴𝒖𝒕𝒆*
*┋ ⬡ 🔊 .𝑼𝒏𝒎𝒖𝒕𝒆*
*┋ ⬡ 🔇 .𝑲𝒊𝒄𝒌*
*┋ ⬡ 🚀 .𝑲𝒊𝒄𝒌𝒂𝒍𝒍*
*┋ ⬡ 🧑‍🔧 .𝑮𝒓𝒐𝒖𝒑𝒔𝒆𝒕𝒖𝒑*
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━〔 👑 𝑶𝑾𝑵𝑬𝑹 〕━━╮*
*┋ ⬡ 👑 .𝑩𝒓𝒐𝒂𝒅𝒄𝒂𝒔𝒕*
*┋ ⬡ 👑 .𝑪𝒓𝒆𝒂𝒕𝒆𝒍𝒐𝒈*
*┋ ⬡ 👑 .𝑺𝒆𝒕𝒍𝒐𝒈*
*┋ ⬡ 👑 .𝑺𝒆𝒕𝒖𝒑*
*┋ ⬡ 👑 .𝑴𝒐𝒅𝒆*
*┋ ⬡ 👑 .𝑺𝒖𝒅𝒐*
*┋ ⬡ 👑 .𝑨𝒖𝒅𝒊𝒕*
*┋ ⬡ 👑 .𝑭𝒍𝒂𝒈*
*┋ ⬡ 👑 .𝑷𝒐𝒍𝒊𝒄𝒚*
*┋ ⬡ 👑 .𝑹𝒐𝒍𝒆*
*┋ ⬡ 👑 .𝑩𝒂𝒄𝒌𝒖𝒑*
*┋ ⬡ 👑 .𝑴𝒆𝒕𝒓𝒊𝒄𝒔*
*┋ ⬡ 👑 .𝑬𝒙𝒊𝒇*
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━〔 🎬 𝑴𝑬𝑫𝑰𝑨 〕━━╮*
*┋ ⬡ 🎬 .𝑰𝒈*
*┋ ⬡ 🎬 .𝑻𝒊𝒌𝒕𝒐𝒌*
*┋ ⬡ 🎬 .𝑭𝒃*
*┋ ⬡ 🔖 .𝑺𝒕𝒊𝒄𝒌𝒆𝒓*
*┋ ⬡ 🫆 .𝑻𝒂𝒌𝒆*
*┋ ⬡ 🖼️ .𝑻𝒐𝒊𝒎𝒈*
*┋ ⬡ 🎵 .𝑻𝒐𝒎𝒑𝟑*
*┋ ⬡ 🖇️ .𝑻𝒐𝒖𝒓𝒖𝒓𝒍*
*┋ ⬡ 🔖 .𝑸𝒖𝒐𝒕𝒆*
*┋ ⬡ ✍️ .𝑭𝒂𝒏𝒄𝒚*
*┋ ⬡ 🎙️ .𝑻𝒕𝒔*
*┋ ⬡ 🔖 .𝑻𝒕𝒑*
*┋ ⬡ 🔖 .𝑨𝒕𝒕𝒑*
*┋ ⬡ 💬 .𝒀𝒕*
*┋ ⬡ 🎵 .𝒀𝒕𝒎𝒑𝟑*
*┋ ⬡ 🎬 .𝒀𝒕𝒎𝒑𝟒*
*┋ ⬡ 🔍 .𝑷𝒍𝒂𝒚*
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*╭━━━〔 🤖 𝑿-𝑨𝑵𝑺𝑨𝑹𝑰 〕━━━╮*
*┋ ⬡ ⛑️ .𝑯𝒆𝒍𝒑 •* 𝑫𝒆𝒕𝒂𝒊𝒍 𝑴𝒆𝒏𝒖 📝
*┋ ⬡ ♥️ 𝒗4.0.0 •* 𝑴𝒂𝒅𝒆 𝒘𝒊𝒕𝒉 ♥️
*╰━━━━┉┉━━━━┉┉━━━━┉┉⊷*

*〔 ⚡ 𝑺𝒎𝒂𝒓𝒕 • 𝑭𝒂𝒔𝒕 • 𝑺𝒊𝒎𝒑𝒍𝒆 ⚡ 〕*`;
}

async function sendMenu(message, conn, showDescriptions = true) {
  await reply(
    conn,
    message,
    await buildMenuText(showDescriptions)
  );
}

/*
 * .menu
 */


function toSerifHelpText(text) {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const u = [
    "𝑨","𝑩","𝑪","𝑫","𝑬","𝑭","𝑮","𝑯","𝑰","𝑱","𝑲","𝑳","𝑴",
    "𝑵","𝑶","𝑷","𝑸","𝑹","𝑺","𝑻","𝑼","𝑽","𝑾","𝑿","𝒀","𝒁"
  ];
  const l = [
    "𝒂","𝒃","𝒄","𝒅","𝒆","𝒇","𝒈","𝒉","𝒊","𝒋","𝒌","𝒍","𝒎",
    "𝒏","𝒐","𝒑","𝒒","𝒓","𝒔","𝒕","𝒖","𝒗","𝒘","𝒙","𝒚","𝒛"
  ];
  const d = ["𝟎","𝟏","𝟐","𝟑","𝟒","𝟓","𝟔","𝟕","𝟖","𝟗"];

  return String(text).replace(/[A-Za-z0-9]/g, ch => {
    let i = upper.indexOf(ch);
    if (i >= 0) return u[i];
    i = lower.indexOf(ch);
    if (i >= 0) return l[i];
    i = digits.indexOf(ch);
    if (i >= 0) return d[i];
    return ch;
  });
}

async function buildHelpMenuText(showDescriptions = true) {
  const cmds = await getMenuData();
  const byType = new Map();

  for (const cmd of cmds) {
    let type = String(cmd.type || "misc").toLowerCase();

    if (!SECTION_STYLE[type]) {
      type = "misc";
    }

    if (!byType.has(type)) {
      byType.set(type, []);
    }

    byType.get(type).push(cmd);
  }

  let mode = "public";
  try {
    mode = await getMode();
  } catch {}

  const owner = process.env.OWNER_NAME || "IKRAM-MD";

  let lang = "en";
  try {
    const { getLang } = await import("../utils/i18n.js");
    lang = await getLang();
  } catch {}

  const fancyTitles = {
    group: "𝑮𝑹𝑶𝑼𝑷",
    misc: "𝑴𝑰𝑺𝑪",
    admin: "𝑨𝑫𝑴𝑰𝑵",
    owner: "𝑶𝑾𝑵𝑬𝑹",
    media: "𝑴𝑬𝑫𝑰𝑨",
  };

  const finalIcons = {
    tagall: "👥",
    notify: "🔔",
    groupinfo: "ℹ️",
    promote: "⬆️",
    demote: "👤",
    admins: "👥",
    mention: "📣",
    acceptall: "✅",

    antidelete: "🗑️",
    info: "ℹ️",
    menu: "📖",
    lang: "🌐",
    status: "📡",
    autoreact: "😊",
    ping: "🏓",
    note: "📝",
    remind: "⏰",
    reminders: "📋",
    cancelremind: "⛔",
    poll: "📊",
    vv: "👁️",

    disable: "✍️",
    enable: "✍️",
    plugins: "✍️",
    welcome: "🎀",
    goodbye: "💬",
    antilink: "🚫",
    antispam: "🚮",
    groupsettings: "🧑‍🔧",
    warn: "⚠️",
    unwarn: "🤝",
    warns: "⚠️",
    mute: "🔇",
    unmute: "🔊",
    kick: "🔇",
    kickall: "🚀",
    groupsetup: "🧑‍🔧",

    broadcast: "👑",
    createlog: "👑",
    setlog: "👑",
    setup: "👑",
    mode: "👑",
    sudo: "👑",
    audit: "👑",
    flag: "👑",
    policy: "👑",
    role: "👑",
    backup: "👑",
    metrics: "👑",
    exif: "👑",

    ig: "🎬",
    tiktok: "🎬",
    fb: "🎬",
    tomp3: "🎵",
    fancy: "✍️",
    toururl: "🖇️",
    sticker: "🔖",
    quote: "🔖",
    ttp: "🔖",
    attp: "🔖",
    take: "🫆",
    toimg: "🖼️",
    tts: "🎙️",
    yt: "💬",
    ytmp3: "🎵",
    ytmp4: "🎬",
    play: "🔍",
  };

  let text = "";

  text += `*╭━━━〔 🤖 𝑿-𝑨𝑵𝑺𝑨𝑹𝑰 〕━━━╮*\n`;
  text += `*┋ ⬡ 🫅 𝑶𝒘𝒏𝒆𝒓   :* ${owner}\n`;
  text += `*┋ ⬡ ⚡ 𝑪𝒐𝒎𝒎𝒂𝒏𝒅𝒔 :* ${cmds.length}\n`;
  text += `*┋ ⬡ 🔧 𝑷𝒓𝒆𝒇𝒊𝒙   :* ${BOT_INFO.PREFIX}\n`;
  text += `*┋ ⬡ 🛡️ 𝑴𝒐𝒅𝒆    :* ${mode}\n`;
  text += `*┋ ⬡ 📚 𝑳𝒂𝒏𝒈𝒖𝒂𝒈𝒆 :* ${lang}\n`;
  text += `*┋ ⬡ 📦 𝑽𝒆𝒓𝒔𝒊𝒐𝒏  :* ${BOT_INFO.VERSION} *╰━━━━━━━━━━━━━━━━━⊷*\n\n`;

  const typeOrder = ["group", "misc", "admin", "owner", "media"];

  for (const type of typeOrder) {
    const list = byType.get(type);
    if (!list || !list.length) continue;

    const [emoji] = SECTION_STYLE[type];
    const sorted = sortCommands(list, type);

    text += `*╭━━〔 ${emoji} ${fancyTitles[type]} 〕━━╮*\n`;

    for (const cmd of sorted) {
      const name = String(cmd.patternName || "").trim();
      if (!name) continue;

      const displayName = name.charAt(0).toUpperCase() + name.slice(1);
      const usage = `${BOT_INFO.PREFIX}${displayName}`;
      const icon = finalIcons[name] || commandIcon(name);
      const desc = commandDescription(cmd);

      text += desc
        ? `*┋ ⬡ ${icon} ${toSerifHelpText(usage)}* — ${toSerifHelpText(desc)}\n`
        : `*┋ ⬡ ${icon} ${toSerifHelpText(usage)}*\n`;
    }

    text += `*╰━━━━━━━━━━━━━━━━━⊷*\n\n`;
  }

  text += `*╭━━━〔 🤖 𝑿-𝑨𝑵𝑺𝑨𝑹𝑰 〕━━━╮*\n`;
  text += `*┋ ⬡ ⛑️ .𝑯𝒆𝒍𝒑 •* 𝑫𝒆𝒕𝒂𝒊𝒍 𝑴𝒆𝒏𝒖 📝\n`;
  text += `*┋ ⬡ ♥️ 𝒗${BOT_INFO.VERSION} •* 𝑴𝒂𝒅𝒆 𝒘𝒊𝒕𝒉 ♥️ *╰━━━━━━━━━━━━━━━━━⊷*\n\n`;
  text += `*〔⚡ 𝑺𝒎𝒂𝒓𝒕 • 𝑭𝒂𝒔𝒕 • 𝑺𝒊𝒎𝒑𝒍𝒆 ⚡〕*`;

  return toSerifHelpText(text);
}



/*
 * .menu
 */
command(
  {
    pattern: "menu",
    fromMe: false,
    desc: "Show all commands",
    type: "misc",
  },
  async (message, conn) => {
    await sendMenu(message, conn, false);
  }
);

/*
 * .help
 */
command(
  {
    pattern: "help",
    fromMe: false,
    desc: "Show detailed command menu",
    type: "misc",
    dontAddCommandList: true,
  },

  async (message, conn) => {
    const body = message.body || "";

    const args = body
      .replace(
        new RegExp(
          `^\\${BOT_INFO.PREFIX}\\s*help\\s*`,
          "i"
        ),
        ""
      )
      .trim()
      .toLowerCase();

    /*
     * .help
     */
    if (!args) {
      const helpText = await buildHelpMenuText(true);
      await reply(conn, message, helpText);
      return;
    }

    const cmds =
      await getMenuData();

    /*
     * Exact match first
     */
    const hit =
      cmds.find(
        (c) =>
          String(c.patternName)
            .toLowerCase() === args
      ) ||

      /*
       * Prefix match
       */
      cmds.find(
        (c) =>
          String(c.patternName)
            .toLowerCase()
            .startsWith(args)
      );

    /*
     * Unknown command
     */
    if (!hit) {
      const suggestions =
        cmds
          .filter((c) =>
            String(c.patternName)
              .toLowerCase()
              .includes(args)
          )
          .slice(0, 5)
          .map(
            (c) =>
              `\`${BOT_INFO.PREFIX}${c.patternName}\``
          );

      await reply(
        conn,
        message,
        suggestions.length
          ? `Unknown. Did you mean: ${suggestions.join(", ")}?`
          : `Unknown command. Try \`${BOT_INFO.PREFIX}menu\`.`
      );

      return;
    }

    /*
     * Command details
     */
    const desc =
      commandDescription(hit);

    await reply(
      conn,
      message,
      `*${BOT_INFO.PREFIX}${hit.patternName}*\n` +
        `${desc || "_No description_"}\n` +
        `Type: ${hit.type || "misc"}` +
        (hit.groupOnly
          ? " · group"
          : "") +
        (hit.adminOnly
          ? " · admin"
          : "") +
        (hit.fromMe
          ? " · owner"
          : "")
    );
  }
);
