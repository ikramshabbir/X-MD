/**
 * Owner / sudo / mode / autoreact commands
 */

import { command } from "../plugins.js";

import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
} from "../utils/message.js";

import {
  getMode,
  setMode,
  listSudo,
  addSudo,
  removeSudo,
  isOwnerMessage,
  normalizeNumber,
} from "../utils/access.js";

import { resolveTargetUser } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";


/* =========================
   BOT MODE
========================= */

command(
  {
    pattern: "mode",
    fromMe: true,
    desc: "Show or set bot mode (public|private)",
    type: "owner",
  },

  async (message, conn) => {
    const args = (
      getCommandArgs(message.body, "mode") || ""
    )
      .trim()
      .toLowerCase();

    if (!args) {
      const mode = await getMode();

      await reply(
        conn,
        message,
        `*Bot mode:* ${mode}\n\n` +
          `• \`${BOT_INFO.PREFIX}mode public\` — anyone can use commands\n` +
          `• \`${BOT_INFO.PREFIX}mode private\` — owner + sudo only`
      );

      return;
    }

    if (args !== "public" && args !== "private") {
      await replyFail(
        conn,
        message,
        `Use \`${BOT_INFO.PREFIX}mode public\` or \`${BOT_INFO.PREFIX}mode private\``
      );

      return;
    }

    const next = await setMode(args);

    await replyOk(
      conn,
      message,
      `Mode set to *${next}*`
    );
  }
);


/* =========================
   SUDO
========================= */

command(
  {
    pattern: "sudo",
    fromMe: true,
    desc: "Manage sudo users (add|del|list)",
    type: "owner",
  },

  async (message, conn) => {
    const raw = (
      getCommandArgs(message.body, "sudo") || ""
    ).trim();

    const [action, ...rest] = raw.split(/\s+/);

    const act = (
      action || "list"
    ).toLowerCase();

    if (act === "list" || !action) {
      const list = await listSudo();

      if (!list.length) {
        await reply(
          conn,
          message,
          "*Sudo list:* _(empty)_"
        );

        return;
      }

      await reply(
        conn,
        message,
        `*Sudo list:*\n${list
          .map((n, i) => `${i + 1}. ${n}`)
          .join("\n")}`
      );

      return;
    }

    if (!isOwnerMessage(message, conn)) {
      await replyFail(
        conn,
        message,
        "Only the bot owner can add/remove sudo."
      );

      return;
    }

    let target =
      rest.join(" ").trim() ||
      resolveTargetUser(message) ||
      "";

    const mentions =
      message.message?.contextInfo?.mentionedJid || [];

    if (!target && mentions.length) {
      target = mentions[0];
    }

    const number = normalizeNumber(target);

    if (
      !number &&
      (
        act === "add" ||
        act === "del" ||
        act === "remove" ||
        act === "rm"
      )
    ) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}sudo add <number|@user>\` / \`${BOT_INFO.PREFIX}sudo del <number|@user>\``
      );

      return;
    }

    if (act === "add") {
      await addSudo(number);

      await replyOk(
        conn,
        message,
        `Added sudo: *${number}*`
      );

      return;
    }

    if (
      act === "del" ||
      act === "remove" ||
      act === "rm"
    ) {
      await removeSudo(number);

      await replyOk(
        conn,
        message,
        `Removed sudo: *${number}*`
      );

      return;
    }

    await replyFail(
      conn,
      message,
      "Unknown action. Use `list`, `add`, or `del`."
    );
  }
);


/* =========================
   AUTO REACTION ON / OFF
========================= */

command(
  {
    pattern: "autoreact",
    fromMe: true,
    desc: "Turn automatic emoji reactions on or off",
    type: "owner",
  },

  async (message, conn) => {
    const args = (
      getCommandArgs(message.body, "autoreact") || ""
    )
      .trim()
      .toLowerCase();

    /* Show current status */
    if (!args) {
      const current = await kvGet("autoreact");

      const status =
        current === false
          ? "OFF ❌"
          : "ON ✅";

      await reply(
        conn,
        message,
        `🤖 *Auto Reaction:* ${status}\n\n` +
          `• \`${BOT_INFO.PREFIX}autoreact on\` — ON\n` +
          `• \`${BOT_INFO.PREFIX}autoreact off\` — OFF`
      );

      return;
    }


    /* Turn ON */
    if (args === "on") {
      await kvSet("autoreact", true);

      await replyOk(
        conn,
        message,
        "✅ Auto Reaction is now ON ❤️"
      );

      return;
    }


    /* Turn OFF */
    if (args === "off") {
      await kvSet("autoreact", false);

      await replyOk(
        conn,
        message,
        "❌ Auto Reaction is now OFF"
      );

      return;
    }


    /* Invalid option */
    await replyFail(
      conn,
      message,
      `Use \`${BOT_INFO.PREFIX}autoreact on\` or \`${BOT_INFO.PREFIX}autoreact off\``
    );
  }
);
