/**
 * X-MD / X-ANSARI
 * View Once + Global AntiDelete
 *
 * Commands:
 *
 * .vv
 * .antidelete on
 * .antidelete off
 * .antidelete
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
  getCommandArgs,
} from "../utils/message.js";

import {
  msgCache,
} from "../utils/cache.js";


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

let settings = {
  enabled: false,
};


/* =========================================================
 * PROCESSED DELETE CACHE
 * ======================================================= */

const processedDeletes =
  new Map();


/* =========================================================
 * LOAD SETTINGS
 * ======================================================= */

function loadSettings() {

  try {

    if (
      !fs.existsSync(
        DATA_DIR
      )
    ) {

      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true,
        }
      );
    }


    if (
      !fs.existsSync(
        SETTINGS_FILE
      )
    ) {

      fs.writeFileSync(
        SETTINGS_FILE,
        JSON.stringify(
          {
            enabled: false,
          },
          null,
          2
        ),
        "utf8"
      );

      settings = {
        enabled: false,
      };

      return;
    }


    const data =
      fs.readFileSync(
        SETTINGS_FILE,
        "utf8"
      );


    const parsed =
      data
        ? JSON.parse(data)
        : {};


    /*
     * Old per-chat settings ko ignore karke
     * new global setting use karte hain.
     */

    settings = {
      enabled:
        parsed.enabled === true,
    };


  } catch (error) {

    console.log(
      "⚠️ AntiDelete settings load error:",
      error?.message ||
        error
    );

    settings = {
      enabled: false,
    };
  }
}


/* =========================================================
 * SAVE SETTINGS
 * ======================================================= */

function saveSettings() {

  try {

    if (
      !fs.existsSync(
        DATA_DIR
      )
    ) {

      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true,
        }
      );
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
      error?.message ||
        error
    );
  }
}


loadSettings();


/* =========================================================
 * GLOBAL STATUS
 * ======================================================= */

export function isAntiDeleteEnabled() {

  return (
    settings.enabled === true
  );
}


export function setAntiDelete(
  enabled
) {

  settings.enabled =
    Boolean(enabled);

  saveSettings();

  return true;
}


/* =========================================================
 * CACHE KEY
 * ======================================================= */

function getCacheKey(
  jid,
  messageId
) {

  return `${jid}:${messageId}`;
}


/* =========================================================
 * JID CLEANER
 * ======================================================= */

function cleanJid(
  jid
) {

  if (!jid) {
    return null;
  }

  return String(jid)
    .split(":")[0];
}


/* =========================================================
 * JID -> NUMBER
 * ======================================================= */

function jidToNumber(
  jid
) {

  if (!jid) {
    return "Unknown";
  }


  return String(jid)
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


/* =========================================================
 * GET DELETER
 * ======================================================= */

function getDeleter(
  deletedKey,
  originalKey,
  remoteJid
) {

  /*
   * Group:
   * participant / participantAlt
   */

  if (
    remoteJid?.endsWith(
      "@g.us"
    )
  ) {

    return (
      deletedKey?.participant ||
      deletedKey?.participantAlt ||
      originalKey?.participant ||
      originalKey?.participantAlt ||
      "unknown@s.whatsapp.net"
    );
  }


  /*
   * Private chat:
   * remoteJid itself is normally the other user.
   */

  return (
    deletedKey?.participant ||
    deletedKey?.participantAlt ||
    remoteJid
  );
}


/* =========================================================
 * MENTION TEXT
 * ======================================================= */

function mentionText(
  jid
) {

  return `@${jidToNumber(jid)}`;
}


/* =========================================================
 * STREAM -> BUFFER
 * ======================================================= */

async function streamToBuffer(
  stream
) {

  const chunks = [];

  for await (
    const chunk
    of stream
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
    i < 10 &&
    current;
    i++
  ) {

    if (
      current
        .ephemeralMessage
        ?.message
    ) {

      current =
        current
          .ephemeralMessage
          .message;

      continue;
    }


    if (
      current
        .viewOnceMessage
        ?.message
    ) {

      current =
        current
          .viewOnceMessage
          .message;

      continue;
    }


    if (
      current
        .viewOnceMessageV2
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
      current
        .documentWithCaptionMessage
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
 * GET ORIGINAL DESCRIPTION
 * ======================================================= */

function getOriginalDescription(
  rawMessage
) {

  let content =
    rawMessage?.message ||
    rawMessage;


  content =
    unwrapForSend(
      content
    );


  if (!content) {
    return "Unknown";
  }


  if (
    content.conversation
  ) {

    return content.conversation;
  }


  if (
    content.extendedTextMessage
  ) {

    return (
      content
        .extendedTextMessage
        .text ||
      "Text message"
    );
  }


  if (
    content.imageMessage
  ) {

    return (
      content.imageMessage.caption ||
      "[Image]"
    );
  }


  if (
    content.videoMessage
  ) {

    return (
      content.videoMessage.caption ||
      "[Video]"
    );
  }


  if (
    content.audioMessage
  ) {

    return "[Audio]";
  }


  if (
    content.documentMessage
  ) {

    return (
      content.documentMessage.fileName
        ? `[Document] ${content.documentMessage.fileName}`
        : "[Document]"
    );
  }


  if (
    content.stickerMessage
  ) {

    return "[Sticker]";
  }


  return `[${Object.keys(content).join(", ")}]`;
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


  /* =======================================================
   * TEXT
   * ===================================================== */

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


  /* =======================================================
   * IMAGE
   * ===================================================== */

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


  /* =======================================================
   * VIDEO
   * ===================================================== */

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


  /* =======================================================
   * AUDIO
   * ===================================================== */

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


  /* =======================================================
   * DOCUMENT
   * ===================================================== */

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


  /* =======================================================
   * STICKER
   * ===================================================== */

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
 * GET BOT'S OWN CHAT
 * ======================================================= */

function getOwnerChatJid(
  conn
) {

  const ownId =
    conn?.user?.id;

  if (!ownId) {
    return null;
  }


  return cleanJid(
    ownId
  );
}


/* =========================================================
 * GROUP NAME
 * ======================================================= */

async function getGroupName(
  conn,
  jid
) {

  try {

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
 * SEND ANTI DELETE REPORT
 * ======================================================= */

async function sendAntiDeleteReport(
  conn,
  remoteJid,
  deleter,
  original
) {

  const ownerChat =
    getOwnerChatJid(
      conn
    );


  if (!ownerChat) {

    throw new Error(
      "Bot own WhatsApp JID not available"
    );
  }


  const isGroup =
    remoteJid?.endsWith(
      "@g.us"
    );


  const originalText =
    getOriginalDescription(
      original
    );


  let report;


  if (isGroup) {

    const groupName =
      await getGroupName(
        conn,
        remoteJid
      );


    report =
      `🗑️ AntiDelete\n` +
      `👥 ${groupName}\n` +
      `👤 User: ${mentionText(deleter)}\n` +
      `❌ Deleted a message\n` +
      `💬 Original message: ${originalText}`;

  } else {

    report =
      `🗑️ AntiDelete\n` +
      `👤 User: ${mentionText(deleter)}\n` +
      `❌ Deleted a message\n` +
      `💬 Original message: ${originalText}`;
  }


  await conn.sendMessage(
    ownerChat,
    {
      text:
        report,

      mentions:
        [deleter],
    }
  );


  /*
   * Original media/text ko bhi
   * tumhari You chat mein resend karo.
   */

  await resendRawMessage(
    conn,
    ownerChat,
    original
  );


  return true;
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

      if (
        !message.quoted
      ) {

        return replyFail(
          conn,
          message,
          "View Once message ko reply karke .vv bhejo."
        );
      }


      if (
        !message
          .quoted
          .isViewOnce
      ) {

        return replyFail(
          conn,
          message,
          "Ye View Once message nahi hai."
        );
      }


      const original =
        message
          .quoted
          .originalMessage;


      if (!original) {

        return replyFail(
          conn,
          message,
          "View Once message data nahi mila."
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
        "View Once recover nahi ho saka."
      );
    }
  }
);


/* =========================================================
 * .ANTIDELETE
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
    conn
  ) => {

    try {

      const args =
        String(
          getCommandArgs(
            message.body || "",
            "antidelete"
          ) || ""
        )
          .trim()
          .toLowerCase();


      /* ===================================================
       * STATUS
       *
       * .antidelete
       * .antidelete status
       * ================================================= */

      if (
        !args ||
        args === "status"
      ) {

        return reply(
          conn,
          message,
          isAntiDeleteEnabled()
            ? "🛡️ AntiDelete: ON"
            : "🛡️ AntiDelete: OFF"
        );
      }


      /* ===================================================
       * ON
       * ================================================= */

      if (
        args === "on"
      ) {

        setAntiDelete(
          true
        );


        return reply(
          conn,
          message,
          "✅ AntiDelete: ON"
        );
      }


      /* ===================================================
       * OFF
       * ================================================= */

      if (
        args === "off"
      ) {

        setAntiDelete(
          false
        );


        return reply(
          conn,
          message,
          "❌ AntiDelete: OFF"
        );
      }


      return reply(
        conn,
        message,
        "Use:\n.antidelete on\n.antidelete off\n.antidelete"
      );


    } catch (error) {

      console.log(
        "❌ AntiDelete command error:",
        error?.stack ||
          error?.message ||
          error
      );


      return replyFail(
        conn,
        message,
        "AntiDelete setting failed."
      );
    }
  }
);


/* =========================================================
 * EXTRACT DELETE INFORMATION
 * ======================================================= */

function extractDeleteInfo(
  update
) {

  /*
   * Baileys normalized revoke event:
   *
   * update.key
   * update.update.messageStubType
   * update.update.key
   */


  const inner =
    update?.update;


  const stubType =
    inner?.messageStubType;


  const stubString =
    String(
      stubType || ""
    )
      .toUpperCase();


  /*
   * Normalized REVOKE
   */

  if (
    stubString ===
    "REVOKE"
  ) {

    const deletedKey =
      inner?.key ||
      update?.key;


    return {
      deletedKey,
      remoteJid:
        deletedKey?.remoteJid ||
        update?.key?.remoteJid,
    };
  }


  /*
   * Raw protocolMessage fallback
   */

  const protocol =
    inner?.message
      ?.protocolMessage ||
    update
      ?.update
      ?.message
      ?.protocolMessage;


  if (protocol) {

    const protocolType =
      String(
        protocol.type ||
        ""
      )
        .toUpperCase();


    if (
      protocolType ===
        "REVOKE" ||
      protocolType ===
        "DELETE"
    ) {

      const deletedKey =
        protocol.key;


      return {
        deletedKey,
        remoteJid:
          deletedKey?.remoteJid,
      };
    }
  }


  /*
   * Some versions may provide
   * a numeric protocol type.
   *
   * REVOKE is 0 in Baileys proto.
   */

  if (
    inner?.message
      ?.protocolMessage
      ?.type === 0
  ) {

    const deletedKey =
      inner
        .message
        .protocolMessage
        .key;


    return {
      deletedKey,
      remoteJid:
        deletedKey?.remoteJid,
    };
  }


  return null;
}


/* =========================================================
 * AUTOMATIC DELETED MESSAGE HANDLER
 * ======================================================= */

export async function handleDeletedMessage(
  conn,
  update,
  sessionId
) {

  try {

    /*
     * GLOBAL SWITCH
     */

    if (
      !isAntiDeleteEnabled()
    ) {

      return false;
    }


    const deleteInfo =
      extractDeleteInfo(
        update
      );


    if (!deleteInfo) {

      return false;
    }


    const {
      deletedKey,
      remoteJid,
    } = deleteInfo;


    if (
      !deletedKey ||
      !remoteJid ||
      !deletedKey.id
    ) {

      return false;
    }


    const messageId =
      deletedKey.id;


    const cacheKey =
      getCacheKey(
        remoteJid,
        messageId
      );


    /*
     * Prevent duplicate recovery
     */

    if (
      processedDeletes.has(
        cacheKey
      )
    ) {

      return false;
    }


    /*
     * Original message
     */

    const original =
      msgCache.get(
        cacheKey
      );


    if (!original) {

      console.log(
        `⚠️ AntiDelete cache miss [${sessionId}]: ${cacheKey}`
      );

      return false;
    }


    /*
     * Mark processed BEFORE sending.
     */

    processedDeletes.set(
      cacheKey,
      Date.now()
    );


    /*
     * Deleter
     */

    const deleter =
      getDeleter(
        deletedKey,
        original?.key,
        remoteJid
      );


    console.log(
      `🗑️ DELETE DETECTED [${sessionId}]`,
      {
        remoteJid,
        messageId,
        deleter,
      }
    );


    /*
     * Send ONLY to owner's You chat.
     */

    await sendAntiDeleteReport(
      conn,
      remoteJid,
      deleter,
      original
    );


    console.log(
      `🛡️ AntiDelete recovered to You [${sessionId}]:`,
      cacheKey
    );


    /*
     * Keep processed map small.
     */

    if (
      processedDeletes.size >
      1000
    ) {

      const oldest =
        processedDeletes
          .keys()
          .next()
          .value;


      if (oldest) {

        processedDeletes.delete(
          oldest
        );
      }
    }


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
