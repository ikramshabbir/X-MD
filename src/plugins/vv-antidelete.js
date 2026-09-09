/**
 * X-MD / X-ANSARI
 * View Once + Global AntiDelete
 *
 * .vv
 *   Reply to a View Once message
 *
 * .antidelete on
 *   Enable AntiDelete globally
 *
 * .antidelete off
 *   Disable AntiDelete globally
 *
 * .antidelete
 *   Show AntiDelete status
 *
 * Deleted messages are recovered ONLY in
 * the bot account's own "You" chat.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { command } from "../plugins.js";

import {
  reply,
  replyFail,
  replyOk,
} from "../utils/message.js";

import { msgCache } from "../utils/cache.js";

/* =========================================================
 * PATHS
 * ========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(
  __dirname,
  "../database"
);

const SETTINGS_FILE = path.join(
  DATA_DIR,
  "antidelete.json"
);

/* =========================================================
 * SETTINGS
 * ========================================================= */

let settings = {
  enabled: false,
};

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, {
        recursive: true,
      });
    }
  } catch (error) {
    console.log(
      "⚠️ AntiDelete data directory error:",
      error?.message || error
    );
  }
}

function loadSettings() {
  try {
    ensureDataDir();

    if (!fs.existsSync(SETTINGS_FILE)) {
      return;
    }

    const raw =
      fs.readFileSync(
        SETTINGS_FILE,
        "utf8"
      );

    const parsed =
      JSON.parse(raw);

    settings = {
      enabled:
        parsed?.enabled === true,
    };
  } catch (error) {
    console.log(
      "⚠️ AntiDelete settings load error:",
      error?.message || error
    );

    settings = {
      enabled: false,
    };
  }
}

function saveSettings() {
  try {
    ensureDataDir();

    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(
        settings,
        null,
        2
      )
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete settings save error:",
      error?.message || error
    );
  }
}

loadSettings();

/* =========================================================
 * EXPORTED SETTINGS
 * ========================================================= */

export function isAntiDeleteEnabled() {
  return settings.enabled === true;
}

export function setAntiDelete(enabled) {
  settings.enabled =
    enabled === true;

  saveSettings();

  return settings.enabled;
}

/* =========================================================
 * DUPLICATE DELETE PROTECTION
 * ========================================================= */

const processedDeletes =
  new Map();

const DELETE_MEMORY_MS =
  60 * 1000;

function alreadyProcessed(
  cacheKey
) {
  const previous =
    processedDeletes.get(
      cacheKey
    );

  if (
    previous &&
    Date.now() - previous <
      DELETE_MEMORY_MS
  ) {
    return true;
  }

  processedDeletes.set(
    cacheKey,
    Date.now()
  );

  for (
    const [
      key,
      time,
    ] of processedDeletes
  ) {
    if (
      Date.now() - time >
      DELETE_MEMORY_MS
    ) {
      processedDeletes.delete(
        key
      );
    }
  }

  return false;
}

/* =========================================================
 * JID HELPERS
 * ========================================================= */

function cleanJid(jid) {
  if (!jid) {
    return null;
  }

  return String(jid).replace(
    /:[0-9]+(?=@)/,
    ""
  );
}

function jidToNumber(jid) {
  if (!jid) {
    return "Unknown";
  }

  const clean =
    cleanJid(jid);

  if (!clean) {
    return "Unknown";
  }

  return (
    clean
      .split("@")[0]
      .replace(/\D/g, "") ||
    "Unknown"
  );
}

/* =========================================================
 * BOT SELF / OWNER CHAT
 * ========================================================= */

function getOwnerChatJid(conn) {
  const self =
    conn?.user?.id;

  if (!self) {
    return null;
  }

  return cleanJid(self);
}

/* =========================================================
 * GROUP NAME
 * ========================================================= */

async function getGroupName(
  conn,
  jid
) {
  try {
    if (
      !jid ||
      !String(jid).endsWith(
        "@g.us"
      )
    ) {
      return null;
    }

    const metadata =
      await conn.groupMetadata(
        jid
      );

    return (
      metadata?.subject ||
      "Unknown Group"
    );
  } catch {
    return "Unknown Group";
  }
}

/* =========================================================
 * DELETER DETECTION
 * ========================================================= */

function getDeleter(
  update,
  targetKey
) {
  const innerKey =
    update?.update?.key;

  const protocol =
    update?.update
      ?.message
      ?.protocolMessage;

  /* -------------------------------------------------------
   * Normalized Baileys revoke event
   * ------------------------------------------------------- */

  if (innerKey) {
    const participant =
      innerKey.participant ||
      innerKey.participantAlt;

    if (participant) {
      return cleanJid(
        participant
      );
    }

    if (
      innerKey.fromMe === true
    ) {
      return cleanJid(
        innerKey.remoteJid
      );
    }
  }

  /* -------------------------------------------------------
   * Raw protocol revoke event
   * ------------------------------------------------------- */

  if (protocol?.key) {
    const participant =
      update?.key?.participant ||
      update?.key?.participantAlt;

    if (participant) {
      return cleanJid(
        participant
      );
    }

    if (
      update?.key?.fromMe === true
    ) {
      return cleanJid(
        update.key.remoteJid
      );
    }
  }

  /* -------------------------------------------------------
   * Fallback
   * ------------------------------------------------------- */

  if (
    update?.key?.fromMe === true
  ) {
    return cleanJid(
      update.key.remoteJid
    );
  }

  return null;
}

/* =========================================================
 * MENTION
 * ========================================================= */

function makeMention(jid) {
  if (!jid) {
    return {
      text: "Unknown",
      mentions: [],
    };
  }

  return {
    text:
      `@${jidToNumber(jid)}`,

    mentions: [jid],
  };
}

/* =========================================================
 * ORIGINAL MESSAGE DESCRIPTION
 * ========================================================= */

function getOriginalDescription(
  message
) {
  if (!message) {
    return "Unknown message";
  }

  const content =
    message.message ||
    message;

  if (!content) {
    return "Unknown message";
  }

  if (
    content.conversation
  ) {
    return content.conversation;
  }

  if (
    content.extendedTextMessage
      ?.text
  ) {
    return (
      content
        .extendedTextMessage
        .text
    );
  }

  if (
    content.imageMessage
  ) {
    return (
      content.imageMessage
        .caption ||
      "Image"
    );
  }

  if (
    content.videoMessage
  ) {
    return (
      content.videoMessage
        .caption ||
      "Video"
    );
  }

  if (
    content.audioMessage
  ) {
    return "Audio";
  }

  if (
    content.documentMessage
  ) {
    return (
      content.documentMessage
        .fileName ||
      "Document"
    );
  }

  if (
    content.stickerMessage
  ) {
    return "Sticker";
  }

  if (
    content.contactMessage
  ) {
    return "Contact";
  }

  if (
    content.locationMessage
  ) {
    return "Location";
  }

  if (
    content.pollCreationMessage
  ) {
    return "Poll";
  }

  return "Media message";
}

/* =========================================================
 * RESEND ORIGINAL MESSAGE
 * ========================================================= */

async function resendRawMessage(
  conn,
  jid,
  original
) {
  if (
    !conn ||
    !jid ||
    !original
  ) {
    return false;
  }

  const content =
    original.message;

  if (!content) {
    return false;
  }

  /* -------------------------------------------------------
   * TEXT
   * ------------------------------------------------------- */

  if (
    content.conversation
  ) {
    await conn.sendMessage(
      jid,
      {
        text:
          content.conversation,
      }
    );

    return true;
  }

  /* -------------------------------------------------------
   * EXTENDED TEXT
   * ------------------------------------------------------- */

  if (
    content.extendedTextMessage
      ?.text
  ) {
    await conn.sendMessage(
      jid,
      {
        text:
          content
            .extendedTextMessage
            .text,
      }
    );

    return true;
  }

  /* -------------------------------------------------------
   * IMAGE
   * ------------------------------------------------------- */

  if (
    content.imageMessage
  ) {
    try {
      const buffer =
        await conn.downloadMediaMessage(
          original,
          "buffer",
          {}
        );

      if (!buffer) {
        return false;
      }

      await conn.sendMessage(
        jid,
        {
          image: buffer,
          caption:
            content
              .imageMessage
              .caption ||
            "",
        }
      );

      return true;
    } catch (error) {
      console.log(
        "⚠️ AntiDelete image resend error:",
        error?.message ||
          error
      );

      return false;
    }
  }

  /* -------------------------------------------------------
   * VIDEO
   * ------------------------------------------------------- */

  if (
    content.videoMessage
  ) {
    try {
      const buffer =
        await conn.downloadMediaMessage(
          original,
          "buffer",
          {}
        );

      if (!buffer) {
        return false;
      }

      await conn.sendMessage(
        jid,
        {
          video: buffer,

          caption:
            content
              .videoMessage
              .caption ||
            "",

          gifPlayback:
            content
              .videoMessage
              .gifPlayback ||
            false,
        }
      );

      return true;
    } catch (error) {
      console.log(
        "⚠️ AntiDelete video resend error:",
        error?.message ||
          error
      );

      return false;
    }
  }

  /* -------------------------------------------------------
   * AUDIO
   * ------------------------------------------------------- */

  if (
    content.audioMessage
  ) {
    try {
      const buffer =
        await conn.downloadMediaMessage(
          original,
          "buffer",
          {}
        );

      if (!buffer) {
        return false;
      }

      await conn.sendMessage(
        jid,
        {
          audio: buffer,

          mimetype:
            content
              .audioMessage
              .mimetype ||
            "audio/mpeg",

          ptt:
            content
              .audioMessage
              .ptt ||
            false,
        }
      );

      return true;
    } catch (error) {
      console.log(
        "⚠️ AntiDelete audio resend error:",
        error?.message ||
          error
      );

      return false;
    }
  }

  /* -------------------------------------------------------
   * DOCUMENT
   * ------------------------------------------------------- */

  if (
    content.documentMessage
  ) {
    try {
      const buffer =
        await conn.downloadMediaMessage(
          original,
          "buffer",
          {}
        );

      if (!buffer) {
        return false;
      }

      await conn.sendMessage(
        jid,
        {
          document: buffer,

          mimetype:
            content
              .documentMessage
              .mimetype ||
            "application/octet-stream",

          fileName:
            content
              .documentMessage
              .fileName ||
            "document",
        }
      );

      return true;
    } catch (error) {
      console.log(
        "⚠️ AntiDelete document resend error:",
        error?.message ||
          error
      );

      return false;
    }
  }

  /* -------------------------------------------------------
   * STICKER
   * ------------------------------------------------------- */

  if (
    content.stickerMessage
  ) {
    try {
      const buffer =
        await conn.downloadMediaMessage(
          original,
          "buffer",
          {}
        );

      if (!buffer) {
        return false;
      }

      await conn.sendMessage(
        jid,
        {
          sticker: buffer,
        }
      );

      return true;
    } catch (error) {
      console.log(
        "⚠️ AntiDelete sticker resend error:",
        error?.message ||
          error
      );

      return false;
    }
  }

  return false;
}

/* =========================================================
 * EXTRACT DELETE INFORMATION
 * ========================================================= */

function extractDeleteInfo(
  update
) {
  if (!update) {
    return null;
  }

  const inner =
    update.update || {};

  const stub =
    inner.messageStubType;

  /* -------------------------------------------------------
   * Normalized REVOKE
   *
   * update.key = deleted message
   * update.update.key = revoke actor
   * ------------------------------------------------------- */

  if (
    stub === "REVOKE" ||
    stub === 0 ||
    String(stub).toUpperCase() ===
      "REVOKE"
  ) {
    const targetKey =
      update.key;

    if (
      targetKey?.remoteJid &&
      targetKey?.id
    ) {
      return {
        targetKey,

        actorKey:
          inner.key || null,

        type: "REVOKE",
      };
    }
  }

  /* -------------------------------------------------------
   * Raw protocolMessage
   * ------------------------------------------------------- */

  const protocol =
    inner.message
      ?.protocolMessage;

  if (protocol) {
    const type =
      protocol.type;

    const typeString =
      String(
        type || ""
      ).toUpperCase();

    const isDelete =
      typeString ===
        "REVOKE" ||
      typeString ===
        "DELETE" ||
      type === 0;

    if (
      isDelete &&
      protocol.key?.id
    ) {
      return {
        targetKey:
          protocol.key,

        actorKey:
          update.key || null,

        type: "REVOKE",
      };
    }
  }

  return null;
}

/* =========================================================
 * SEND ANTIDELETE REPORT
 * ========================================================= */

async function sendAntiDeleteReport(
  conn,
  original,
  targetKey,
  deleter
) {
  const ownerJid =
    getOwnerChatJid(conn);

  if (!ownerJid) {
    console.log(
      "⚠️ AntiDelete: self JID not available"
    );

    return false;
  }

  const remoteJid =
    cleanJid(
      targetKey?.remoteJid
    );

  if (!remoteJid) {
    return false;
  }

  const isGroup =
    remoteJid.endsWith(
      "@g.us"
    );

  const mention =
    makeMention(
      deleter
    );

  const groupName =
    isGroup
      ? await getGroupName(
          conn,
          remoteJid
        )
      : null;

  const originalDescription =
    getOriginalDescription(
      original
    );

  let report = "";

  /* -------------------------------------------------------
   * GROUP
   * ------------------------------------------------------- */

  if (isGroup) {
    report =
`🗑️ AntiDelete
👥 ${groupName || "Unknown Group"}
👤 User: ${mention.text}
❌ Deleted a message
💬 Original message: ${originalDescription}`;
  }

  /* -------------------------------------------------------
   * PRIVATE
   * ------------------------------------------------------- */

  else {
    const number =
      jidToNumber(
        deleter ||
          remoteJid
      );

    report =
`🗑️ AntiDelete
👤 User: @${number}
❌ Deleted a message
💬 Original message: ${originalDescription}`;
  }

  /* -------------------------------------------------------
   * REPORT
   * ------------------------------------------------------- */

  try {
    await conn.sendMessage(
      ownerJid,
      {
        text: report,

        mentions:
          deleter
            ? [deleter]
            : [],
      }
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete report error:",
      error?.stack ||
        error?.message ||
        error
    );

    return false;
  }

  /* -------------------------------------------------------
   * ORIGINAL MESSAGE / MEDIA
   * ------------------------------------------------------- */

  try {
    await resendRawMessage(
      conn,
      ownerJid,
      original
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete original resend error:",
      error?.stack ||
        error?.message ||
        error
    );
  }

  return true;
}

/* =========================================================
 * HANDLE DELETED MESSAGE
 * ========================================================= */

export async function handleDeletedMessage(
  conn,
  update,
  sessionId = "default"
) {
  try {
    if (
      !isAntiDeleteEnabled()
    ) {
      return false;
    }

    const info =
      extractDeleteInfo(
        update
      );

    if (!info) {
      return false;
    }

    const targetKey =
      info.targetKey;

    if (
      !targetKey?.remoteJid ||
      !targetKey?.id
    ) {
      return false;
    }

    const cacheKey =
      `${targetKey.remoteJid}:${targetKey.id}`;

    /* -------------------------------------------------------
     * DUPLICATE PROTECTION
     * ------------------------------------------------------- */

    if (
      alreadyProcessed(
        cacheKey
      )
    ) {
      return false;
    }

    /* -------------------------------------------------------
     * GET ORIGINAL MESSAGE
     * ------------------------------------------------------- */

    const original =
      msgCache.get(
        cacheKey
      );

    if (!original) {
      console.log(
        `⚠️ AntiDelete original message not found [${sessionId}]:`,
        cacheKey
      );

      return false;
    }

    /* -------------------------------------------------------
     * DETECT DELETER
     * ------------------------------------------------------- */

    let deleter = null;

    if (
      info.actorKey
    ) {
      deleter =
        info.actorKey
          .participant ||
        info.actorKey
          .participantAlt ||
        null;

      if (
        !deleter &&
        info.actorKey
          .fromMe
      ) {
        deleter =
          cleanJid(
            info.actorKey
              .remoteJid
          );
      }
    }

    if (!deleter) {
      deleter =
        getDeleter(
          update,
          targetKey
        );
    }

    /* -------------------------------------------------------
     * PRIVATE FALLBACK
     * ------------------------------------------------------- */

    if (
      !deleter &&
      !String(
        targetKey.remoteJid
      ).endsWith(
        "@g.us"
      )
    ) {
      deleter =
        cleanJid(
          targetKey.remoteJid
        );
    }

    console.log(
      `🗑️ ANTIDELETE DETECTED [${sessionId}]`,
      {
        chat:
          targetKey.remoteJid,

        messageId:
          targetKey.id,

        deleter:
          deleter ||
          "unknown",

        cacheKey,
      }
    );

    return await sendAntiDeleteReport(
      conn,
      original,
      targetKey,
      deleter
    );
  } catch (error) {
    console.log(
      `⚠️ handleDeletedMessage error [${sessionId}]:`,
      error?.stack ||
        error?.message ||
        error
    );

    return false;
  }
}

/* =========================================================
 * .VV COMMAND
 * ========================================================= */

command(
  {
    pattern: "vv",

    desc:
      "Open View Once message",

    type: "misc",
  },

  /* IMPORTANT:
   * Handler calls command as:
   * command.function(message, conn)
   */

  async (message, conn) => {
    try {
      const quoted =
        message?.quoted;

      if (!quoted) {
        return replyFail(
          conn,
          message,
          "Reply to a View Once message."
        );
      }

      const original =
        quoted.originalMessage ||
        quoted.message;

      if (!original) {
        return replyFail(
          conn,
          message,
          "Original message not found."
        );
      }

      let viewOnceMessage =
        original;

      /* ---------------------------------------------------
       * ViewOnce V2
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .viewOnceMessageV2
          ?.message
      ) {
        viewOnceMessage =
          viewOnceMessage
            .viewOnceMessageV2
            .message;
      }

      /* ---------------------------------------------------
       * ViewOnce V2 Extension
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .viewOnceMessageV2Extension
          ?.message
      ) {
        viewOnceMessage =
          viewOnceMessage
            .viewOnceMessageV2Extension
            .message;
      }

      /* ---------------------------------------------------
       * Old ViewOnce
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .viewOnceMessage
          ?.message
      ) {
        viewOnceMessage =
          viewOnceMessage
            .viewOnceMessage
            .message;
      }

      /* ---------------------------------------------------
       * Fake message for media download
       * --------------------------------------------------- */

      const fakeMessage = {
        key:
          quoted.key ||
          message.key,

        message:
          viewOnceMessage,
      };

      const targetJid =
        message.from;

      /* ---------------------------------------------------
       * IMAGE
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .imageMessage
      ) {
        const media =
          await conn.downloadMediaMessage(
            fakeMessage,
            "buffer",
            {}
          );

        if (!media) {
          return replyFail(
            conn,
            message,
            "Unable to open View Once image."
          );
        }

        await conn.sendMessage(
          targetJid,
          {
            image: media,

            caption:
              viewOnceMessage
                .imageMessage
                .caption ||
              "",
          },
          {
            quoted:
              message.key
                ? {
                    key:
                      message.key,

                    message:
                      message.message,
                  }
                : undefined,
          }
        );

        return;
      }

      /* ---------------------------------------------------
       * VIDEO
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .videoMessage
      ) {
        const media =
          await conn.downloadMediaMessage(
            fakeMessage,
            "buffer",
            {}
          );

        if (!media) {
          return replyFail(
            conn,
            message,
            "Unable to open View Once video."
          );
        }

        await conn.sendMessage(
          targetJid,
          {
            video: media,

            caption:
              viewOnceMessage
                .videoMessage
                .caption ||
              "",

            gifPlayback:
              viewOnceMessage
                .videoMessage
                .gifPlayback ||
              false,
          },
          {
            quoted:
              message.key
                ? {
                    key:
                      message.key,

                    message:
                      message.message,
                  }
                : undefined,
          }
        );

        return;
      }

      /* ---------------------------------------------------
       * TEXT
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .conversation
      ) {
        return replyOk(
          conn,
          message,
          viewOnceMessage
            .conversation
        );
      }

      /* ---------------------------------------------------
       * EXTENDED TEXT
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .extendedTextMessage
          ?.text
      ) {
        return replyOk(
          conn,
          message,
          viewOnceMessage
            .extendedTextMessage
            .text
        );
      }

      /* ---------------------------------------------------
       * AUDIO
       * --------------------------------------------------- */

      if (
        viewOnceMessage
          .audioMessage
      ) {
        const media =
          await conn.downloadMediaMessage(
            fakeMessage,
            "buffer",
            {}
          );

        if (!media) {
          return replyFail(
            conn,
            message,
            "Unable to open View Once audio."
          );
        }

        await conn.sendMessage(
          targetJid,
          {
            audio: media,

            mimetype:
              viewOnceMessage
                .audioMessage
                .mimetype ||
              "audio/mpeg",

            ptt:
              viewOnceMessage
                .audioMessage
                .ptt ||
              false,
          },
          {
            quoted:
              message.key
                ? {
                    key:
                      message.key,

                    message:
                      message.message,
                  }
                : undefined,
          }
        );

        return;
      }

      /* ---------------------------------------------------
       * UNSUPPORTED
       * --------------------------------------------------- */

      return replyFail(
        conn,
        message,
        "Unsupported View Once message type."
      );
    } catch (error) {
      console.log(
        "⚠️ .vv error:",
        error?.stack ||
          error?.message ||
          error
      );

      return replyFail(
        conn,
        message,
        "Failed to open View Once message."
      );
    }
  }
);

/* =========================================================
 * .ANTIDELETE COMMAND
 * ========================================================= */

command(
  {
    pattern:
      "antidelete",

    desc:
      "Enable, disable or check AntiDelete",

    type:
      "misc",
  },

  /* IMPORTANT:
   * Handler calls:
   * command.function(message, conn)
   */

  async (message, conn) => {
    try {
      const body =
        message?.body ||
        message?.text ||
        message?.message
          ?.conversation ||
        "";

      const args =
        String(body)
          .trim()
          .split(/\s+/)
          .slice(1);

      const action =
        (
          args[0] ||
          "status"
        ).toLowerCase();

      /* ---------------------------------------------------
       * ON
       * --------------------------------------------------- */

      if (
        action === "on" ||
        action === "enable"
      ) {
        setAntiDelete(
          true
        );

        return replyOk(
          conn,
          message,
          "AntiDelete is now ON globally."
        );
      }

      /* ---------------------------------------------------
       * OFF
       * --------------------------------------------------- */

      if (
        action === "off" ||
        action === "disable"
      ) {
        setAntiDelete(
          false
        );

        return replyOk(
          conn,
          message,
          "AntiDelete is now OFF globally."
        );
      }

      /* ---------------------------------------------------
       * STATUS
       * --------------------------------------------------- */

      if (
        action === "status" ||
        action === "check"
      ) {
        return replyOk(
          conn,
          message,
          `AntiDelete is ${
            isAntiDeleteEnabled()
              ? "ON 🟢"
              : "OFF 🔴"
          } globally.`
        );
      }

      /* ---------------------------------------------------
       * INVALID
       * --------------------------------------------------- */

      return replyFail(
        conn,
        message,
        "Use .antidelete on, .antidelete off or .antidelete"
      );
    } catch (error) {
      console.log(
        "⚠️ .antidelete command error:",
        error?.stack ||
          error?.message ||
          error
      );

      return replyFail(
        conn,
        message,
        "AntiDelete command failed."
      );
    }
  }
);
