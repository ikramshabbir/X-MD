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
    "removebg",
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
  kick: "🔇",
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
  removebg: "🧑‍🔧",
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
  groupsetup: "Quick group moderation setup",

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
  removebg: "Remove image background (API key)",
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
async function buildMenuText() {
  const cmds = await getMenuData();

  const byType = new Map();

  /*
   * Put every real command into a section.
   */
  for (const cmd of cmds) {
    let type = String(cmd.type || "misc").toLowerCase();

    /*
     * Only final five sections are displayed.
     *
     * Any unknown command type goes to MISC,
     * so no registered command disappears.
     */
    if (!SECTION_STYLE[type]) {
      type = "misc";
    }

    if (!byType.has(type)) {
      byType.set(type, []);
    }

    byType.get(type).push(cmd);
  }

  /*
   * Get current bot mode.
   */
  let mode = "public";

  try {
    mode = await getMode();
  } catch {
    // Keep public if BotKV is unavailable.
  }

  /*
   * Owner name.
   */
  const owner =
    process.env.OWNER_NAME || "IKRAM-MD";

  /*
   * Current language.
   */
  let lang = "en";

  try {
    const { getLang } =
      await import("../utils/i18n.js");

    lang = await getLang();
  } catch {
    // Keep en if language system is unavailable.
  }

  /*
   * HEADER
   */
  let text = "";

  text += `*╭━━━〔 🤖 𝗫-𝗔𝗡𝗦𝗔𝗥𝗜 〕━━━╮*\n`;
  text += `*┋ ⬡ 👤 Owner    :* ${owner}\n`;
  text += `*┋ ⬡ ⚡ Commands :* ${cmds.length}\n`;
  text += `*┋ ⬡ 🔧 Prefix   :* ${BOT_INFO.PREFIX}\n`;
  text += `*┋ ⬡ 🛡️ Mode     :* ${mode}\n`;
  text += `*┋ ⬡ 📚 Language :* ${lang}\n`;
  text += `*┋ ⬡ 📦 Version  :* ${BOT_INFO.VERSION}\n`;
  text += `*╰━━━━━━━━━━━━━━━━━━━━⊷*\n\n`;

  /*
   * FINAL SECTION ORDER
   */
  const typeOrder = [
    "group",
    "misc",
    "admin",
    "owner",
    "media",
  ];

  for (const type of typeOrder) {
    const list = byType.get(type);

    if (!list || !list.length) {
      continue;
    }

    const [emoji, title] =
      SECTION_STYLE[type];

    const sorted = sortCommands(
      list,
      type
    );

    text += `*╭━━〔 ${emoji} ${title} 〕━━╮*\n`;

    for (const cmd of sorted) {
      const name = String(
        cmd.patternName || ""
      ).trim();

      if (!name) continue;

      const usage =
        `${BOT_INFO.PREFIX}${name}`;

      const icon =
        commandIcon(name);

      const desc =
        commandDescription(cmd);

      if (desc) {
        text +=
          `*┋ ⬡ ${icon} ${usage}* — ${desc}\n`;
      } else {
        text +=
          `*┋ ⬡ ${icon} ${usage}*\n`;
      }
    }

    text +=
      `*╰━━━━━━━━━━━━━━━━━━⊷*\n\n`;
  }

  /*
   * FOOTER
   */
  text +=
    `*╭━━━〔 🚀 𝗫-𝗔𝗡𝗦𝗔𝗥𝗜 〕━━━╮*\n`;

  text +=
    `*┋ ⬡ v${BOT_INFO.VERSION} •* Made with ❤️\n`;

  text +=
    `*╰━━━━━━━━━━━━━━━━━━━⊷*\n`;

  text +=
    `\n*[Reply with a command to use it]*`;

  return text;
}

/*
 * Send menu
 */
async function sendMenu(message, conn) {
  await reply(
    conn,
    message,
    await buildMenuText()
  );
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
  sendMenu
);

/*
 * .help
 */
command(
  {
    pattern: "help",
    fromMe: false,
    desc: "Show menu or help for one command",
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
      await sendMenu(
        message,
        conn
      );
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
