/**
 * Menu / Help Command
 */

import { command, getMenuCommands } from "../plugins.js";
import { reply } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { getMode } from "../utils/access.js";

async function buildMenuText() {
  // Hide AntiDelete from menu
  const cmds = getMenuCommands().filter(
    (cmd) =>
      String(cmd.patternName).toLowerCase() !== "antidelete"
  );

  const byType = new Map();

  for (const cmd of cmds) {
    const type = cmd.type || "misc";

    if (!byType.has(type)) {
      byType.set(type, []);
    }

    byType.get(type).push(cmd);
  }

  const typeOrder = [
    "ai",
    "anime",
    "audio",
    "download",
    "fun",
    "group",
    "main",
    "misc",
    "other",
    "owner",
    "search",
    "setting",
    "settings",
    "sound",
    "tools",
    "utility",
    "info",
    "admin",
    "media",
  ];

  const types = [
    ...typeOrder.filter((t) => byType.has(t)),
    ...[...byType.keys()]
      .filter((t) => !typeOrder.includes(t))
      .sort(),
  ];

  let lang = "en";

  try {
    const { getLang } = await import("../utils/i18n.js");
    lang = await getLang();
  } catch {
    // Ignore language errors
  }

  let mode = "public";

  try {
    mode = await getMode();
  } catch {
    // BotKV may not be ready
  }

  const runtime = formatRuntime();

  let text = "";

  text += `*╭┈───〔 ${BOT_INFO.NAME} 〕┈───⊷*\n`;
  text += `*├✦ Owner:* ${process.env.OWNER_NAME || "IKRAM-MD"}\n`;
  text += `*├✦ Commands:* ${cmds.length}\n`;
  text += `*├✦ Runtime:* ${runtime}\n`;
  text += `*├✦ Prefix:* ${BOT_INFO.PREFIX}\n`;
  text += `*├✦ Mode:* ${mode}\n`;
  text += `*├✦ Version:* ${BOT_INFO.VERSION}\n`;
  text += `*╰───────────────────⊷*\n\n`;

  for (const type of types) {
    const list = byType.get(type);

    if (!list?.length) continue;

    list.sort((a, b) =>
      String(a.patternName).localeCompare(
        String(b.patternName)
      )
    );

    text += `\`『 ${type.toUpperCase()} 』\`\n`;
    text += `╭───────────────────⊷\n`;

    for (const cmd of list) {
      const usage = `${BOT_INFO.PREFIX}${cmd.patternName}`;

      text += `*┋ ⬡ ${usage}*`;

      if (cmd.desc) {
        text += ` — ${cmd.desc}`;
      }

      text += `\n`;
    }

    text += `╰───────────────────⊷\n\n`;
  }

  text += `_Reply with a command to use it._`;

  return text;
}

function formatRuntime() {
  const seconds = Math.floor(
    (Date.now() - process.uptime() * 1000) / 1000
  );

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  parts.push(`${secs}s`);

  return parts.join(" ");
}

async function sendMenu(message, conn) {
  await reply(
    conn,
    message,
    await buildMenuText()
  );
}

/**
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

/**
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

    if (!args) {
      await sendMenu(message, conn);
      return;
    }

    // Hide AntiDelete from help lookup too
    const cmds = getMenuCommands().filter(
      (cmd) =>
        String(cmd.patternName).toLowerCase() !== "antidelete"
    );

    const hit =
      cmds.find(
        (c) =>
          String(c.patternName).toLowerCase() === args
      ) ||
      cmds.find((c) =>
        String(c.patternName)
          .toLowerCase()
          .startsWith(args)
      );

    if (!hit) {
      const suggestions = cmds
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

    await reply(
      conn,
      message,
      `*${BOT_INFO.PREFIX}${hit.patternName}*\n` +
        `${hit.desc || "_No description_"}\n` +
        `Type: ${hit.type || "misc"}` +
        (hit.groupOnly ? " · group" : "") +
        (hit.adminOnly ? " · admin" : "") +
        (hit.fromMe ? " · owner" : "")
    );
  }
);
