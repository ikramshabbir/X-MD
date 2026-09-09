/**
 * X-MD / X-ANSARI
 * View Once + Anti Delete
 *
 * Commands:
 * .vv
 * .antidelete on
 * .antidelete off
 * .antidelete status
 */

import fs from "fs";
import path from "path";

import {
  downloadContentFromMessage,
} from "baileys";

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
} from "../utils/message.js";

import { msgCache } from "../utils/cache.js";


/* =========================================================
 * ANTI DELETE SETTINGS
 * ======================================================= */

const DATA_DIR =
  path.join(
    process.cwd(),
    "database"
  );

const SETTINGS_FILE =
  path.join(
    DATA_DIR,
    "antidelete.json"
  );

let settings = {};


/* ---------------------------------------------------------
 * LOAD SETTINGS
 * ------------------------------------------------------- */

function loadSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, {
        recursive: true,
      });
    }

    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(
        SETTINGS_FILE,
        "{}",
        "utf8"
      );
    }

    const data =
      fs.readFileSync(
        SETTINGS_FILE,
        "utf8"
      );

    settings =
      data
        ? JSON.parse(data)
        : {};

  } catch (error) {

    console.log(
      "⚠️ AntiDelete settings load error:",
      error?.message || error
    );

    settings = {};
  }
}


/* ---------------------------------------------------------
 * SAVE SETTINGS
 * ------------------------------------------------------- */

function saveSettings() {
  try {

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, {
        recursive: true,
      });
    }

    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(
        settings,
        null,
        2
      ),
      "utf8"
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
 * CHAT SETTING
 * ======================================================= */

export function isAntiDeleteEnabled(
  jid
) {
  if (!jid) return false;

  return settings[jid] === true;
}


export function setAntiDelete(
  jid,
  enabled
) {

  if (!jid) {
    return false;
  }

  settings[jid] =
    Boolean(enabled);

  saveSettings();

  return true;
}


/* =========================================================
 * HELPERS
 * ======================================================= */

function getCacheKey(
  jid,
  messageId
) {

  return `${jid}:${messageId}`;
}


function jidToNumber(
  jid
) {

  if (!jid) {
    return "Unknown";
  }

  return jid
    .split(":")[0]
    .replace(
      "@s.whatsapp.net",
      ""
    )
    .replace(
      "@lid",
      ""
    );
}


function getMentionJid(
  protocolKey,
  remoteJid
) {

  if (
    remoteJid?.endsWith("@g.us")
  ) {

    return (
      protocolKey?.participant ||
      protocolKey?.participantAlt ||
      protocolKey?.remoteJid ||
      "unknown@s.whatsapp.net"
    );

  }

  return (
    protocolKey?.participant ||
    protocolKey?.remoteJid ||
    remoteJid
  );
}


function mentionText(
  jid
) {

  const number =
    jidToNumber(jid);

  return `@${number}`;
}


/* =========================================================
 * STREAM -> BUFFER
 * ======================================================= */

async function streamToBuffer(
  stream
) {

  const chunks = [];

  for await (
    const chunk of stream
  ) {

    chunks.push(
      Buffer.from(chunk)
    );
  }

  return Buffer.concat(
    chunks
  );
}


/* =========================================================
 * UNWRAP MESSAGE
 * ======================================================= */

function unwrapForSend(
  content
) {

  let current =
    content;

  for (
    let i = 0;
    i < 10 && current;
    i++
  ) {

    if (
      current.ephemeralMessage
        ?.message
    ) {

      current =
        current
          .ephemeralMessage
          .message;

      continue;
    }

    if (
      current.viewOnceMessage
        ?.message
    ) {

      current =
        current
          .viewOnceMessage
          .message;

      continue;
    }

    if (
      current.viewOnceMessageV2
        ?.message
    ) {

      current =
        current
          .viewOnceMessageV2
          .message;

      continue;
    }

    if (
      current
        .viewOnceMessageV2Extension
        ?.message
    ) {

      current =
        current
          .viewOnceMessageV2Extension
          .message;

      continue;
    }

    if (
      current.documentWithCaptionMessage
        ?.message
    ) {

      current =
        current
          .documentWithCaptionMessage
          .message;

      continue;
    }

    break;
  }

  return current;
}


/* =========================================================
 * DOWNLOAD MEDIA
 * ======================================================= */

async function downloadMedia(
  content,
  type
) {

  if (!content) {
    throw new Error(
      "Media content missing"
    );
  }

  const stream =
    await downloadContentFromMessage(
      content,
      type
    );

  return streamToBuffer(
    stream
  );
}


/* =========================================================
 * RESEND ORIGINAL MESSAGE
 * ======================================================= */

export async function resendRawMessage(
  conn,
  jid,
  rawMessage
) {

  if (!conn) {
    throw new Error(
      "Connection missing"
    );
  }

  if (!jid) {
    throw new Error(
      "Chat JID missing"
    );
  }

  let content =
    rawMessage?.message ||
    rawMessage;

  content =
    unwrapForSend(
      content
    );

  if (!content) {
    throw new Error(
      "Original message missing"
    );
  }


  /* -------------------------------------------------------
   * TEXT
   * ----------------------------------------------------- */

  if (
    content.conversation
  ) {

    return conn.sendMessage(
      jid,
      {
        text:
          content.conversation,
      }
    );
  }


  if (
    content.extendedTextMessage
  ) {

    return conn.sendMessage(
      jid,
      {
        text:
          content
            .extendedTextMessage
            .text ||
          "",
      }
    );
  }


  /* -------------------------------------------------------
   * IMAGE
   * ----------------------------------------------------- */

  if (
    content.imageMessage
  ) {

    const media =
      await downloadMedia(
        content.imageMessage,
        "image"
      );

    return conn.sendMessage(
      jid,
      {
        image:
          media,

        caption:
          content
            .imageMessage
            .caption ||
          undefined,

        mimetype:
          content
            .imageMessage
            .mimetype ||
          undefined,
      }
    );
  }


  /* -------------------------------------------------------
   * VIDEO
   * ----------------------------------------------------- */

  if (
    content.videoMessage
  ) {

    const media =
      await downloadMedia(
        content.videoMessage,
        "video"
      );

    return conn.sendMessage(
      jid,
      {
        video:
          media,

        caption:
          content
            .videoMessage
            .caption ||
          undefined,

        mimetype:
          content
            .videoMessage
            .mimetype ||
          undefined,
      }
    );
  }


  /* -------------------------------------------------------
   * AUDIO
   * ----------------------------------------------------- */

  if (
    content.audioMessage
  ) {

    const media =
      await downloadMedia(
        content.audioMessage,
        "audio"
      );

    return conn.sendMessage(
      jid,
      {
        audio:
          media,

        mimetype:
          content
            .audioMessage
            .mimetype ||
          "audio/mpeg",

        ptt:
          Boolean(
            content
              .audioMessage
              .ptt
          ),
      }
    );
  }


  /* -------------------------------------------------------
   * DOCUMENT
   * ----------------------------------------------------- */

  if (
    content.documentMessage
  ) {

    const media =
      await downloadMedia(
        content.documentMessage,
        "document"
      );

    return conn.sendMessage(
      jid,
      {
        document:
          media,

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

        caption:
          content
            .documentMessage
            .caption ||
          undefined,
      }
    );
  }


  /* -------------------------------------------------------
   * STICKER
   * ----------------------------------------------------- */

  if (
    content.stickerMessage
  ) {

    const media =
      await downloadMedia(
        content.stickerMessage,
        "sticker"
      );

    return conn.sendMessage(
      jid,
      {
        sticker:
          media,
      }
    );
  }


  throw new Error(
    `Unsupported message type: ${
      Object.keys(content)
    }`
  );
}


/* =========================================================
 * .VV
 * ======================================================= */

command(
  {
    pattern:
      "vv",

    fromMe:
      false,

    desc:
      "Recover View Once message",

    type:
      "misc",
  },

  async (
    message,
    conn
  ) => {

    try {

      if (!message.quoted) {

        return replyFail(
          conn,
          message,
          "❌ View Once message ko reply karke .vv bhejo."
        );
      }


      if (
        !message.quoted.isViewOnce
      ) {

        return replyFail(
          conn,
          message,
          "❌ Ye View Once message nahi hai."
        );
      }


      const original =
        message.quoted
          .originalMessage;

      if (!original) {

        return replyFail(
          conn,
          message,
          "❌ View Once message data nahi mila."
        );
      }


      await resendRawMessage(
        conn,
        message.from,
        original
      );

    } catch (error) {

      console.log(
        "❌ .vv error:",
        error?.stack ||
          error?.message ||
          error
      );

      return replyFail(
        conn,
        message,
        "❌ View Once recover nahi ho saka."
      );
    }
  }
);


/* =========================================================
 * .ANTIDELETE ON / OFF / STATUS
 * ======================================================= */

command(
  {
    pattern:
      "antidelete",

    fromMe:
      false,

    desc:
      "AntiDelete on/off/status",

    type:
      "misc",
  },

  async (
    message,
    conn,
    match
  ) => {

    try {

      const args =
        String(
          match || ""
        )
          .trim()
          .toLowerCase();

      const jid =
        message.from;


      /* ---------------------------------------------------
       * STATUS
       * ------------------------------------------------- */

      if (
        !args ||
        args === "status"
      ) {

        const enabled =
          isAntiDeleteEnabled(
            jid
          );

        return reply(
          conn,
          message,
          enabled
            ? "🛡️ AntiDelete is ON for this chat."
            : "🛡️ AntiDelete is OFF for this chat."
        );
      }


      /* ---------------------------------------------------
       * ON
       * ------------------------------------------------- */

      if (
        args === "on"
      ) {

        setAntiDelete(
          jid,
          true
        );

        return reply(
          conn,
          message,
          "✅ AntiDelete ON\n\nDeleted messages will be recovered automatically in this chat."
        );
      }


      /* ---------------------------------------------------
       * OFF
       * ------------------------------------------------- */

      if (
        args === "off"
      ) {

        setAntiDelete(
          jid,
          false
        );

        return reply(
          conn,
          message,
          "❌ AntiDelete OFF"
        );
      }


      return reply(
        conn,
        message,
        "Use:\n.antidelete on\n.antidelete off\n.antidelete status"
      );

    } catch (error) {

      console.log(
        "❌ AntiDelete command error:",
        error?.message ||
          error
      );

      return replyFail(
        conn,
        message,
        "❌ AntiDelete setting failed."
      );
    }
  }
);


/* =========================================================
 * AUTOMATIC DELETED MESSAGE HANDLER
 * ======================================================= */

export async function handleDeletedMessage(
  conn,
  update,
  sessionId
) {

  try {

    const protocol =
      update
        ?.update
        ?.message
        ?.protocolMessage;

    if (!protocol) {
      return false;
    }


    /* -----------------------------------------------------
     * ONLY REVOKE / DELETE
     * --------------------------------------------------- */

    const type =
      String(
        protocol.type || ""
      ).toUpperCase();

    if (
      type !== "REVOKE" &&
      type !== "DELETE"
    ) {

      return false;
    }


    const deletedKey =
      protocol.key;

    if (!deletedKey) {
      return false;
    }


    const remoteJid =
      deletedKey.remoteJid;

    const messageId =
      deletedKey.id;

    if (
      !remoteJid ||
      !messageId
    ) {

      return false;
    }


    /* -----------------------------------------------------
     * CHECK ON/OFF
     * --------------------------------------------------- */

    if (
      !isAntiDeleteEnabled(
        remoteJid
      )
    ) {

      return false;
    }


    /* -----------------------------------------------------
     * FIND ORIGINAL MESSAGE
     * --------------------------------------------------- */

    const cacheKey =
      getCacheKey(
        remoteJid,
        messageId
      );

    const original =
      msgCache.get(
        cacheKey
      );


    if (!original) {

      console.log(
        `⚠️ AntiDelete cache miss [${sessionId}]:`,
        cacheKey
      );

      return false;
    }


    /* -----------------------------------------------------
     * WHO DELETED?
     * --------------------------------------------------- */

    const deleter =
      getMentionJid(
        deletedKey,
        remoteJid
      );


    const mention =
      mentionText(
        deleter
      );


    const isGroup =
      remoteJid.endsWith(
        "@g.us"
      );


    /* -----------------------------------------------------
     * HEADER
     * --------------------------------------------------- */

    const header =
      isGroup
        ? `🗑️ *AntiDelete*\n👤 User: ${mention}\n❌ Deleted a message`
        : `🗑️ *AntiDelete*\n❌ Message deleted`;


    /* -----------------------------------------------------
     * SEND HEADER
     * --------------------------------------------------- */

    await conn.sendMessage(
      remoteJid,
      {
        text:
          header,

        mentions:
          isGroup
            ? [deleter]
            : [],
      }
    );


    /* -----------------------------------------------------
     * SEND ORIGINAL
     * --------------------------------------------------- */

    try {

      await resendRawMessage(
        conn,
        remoteJid,
        original
      );

    } catch (mediaError) {

      console.log(
        `⚠️ AntiDelete resend error [${sessionId}]:`,
        mediaError?.message ||
          mediaError
      );

      await conn.sendMessage(
        remoteJid,
        {
          text:
            `💬 Original message recover nahi ho saka.\n\nReason: ${
              mediaError?.message ||
              "Unknown error"
            }`,
        }
      );
    }


    console.log(
      `🛡️ AntiDelete recovered [${sessionId}]:`,
      cacheKey
    );

    return true;

  } catch (error) {

    console.log(
      `❌ AntiDelete handler error [${sessionId}]:`,
      error?.stack ||
        error?.message ||
        error
    );

    return false;
  }
}
