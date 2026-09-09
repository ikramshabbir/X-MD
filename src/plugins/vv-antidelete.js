/**
 * X-MD
 *
 * .vv
 * ----
 * Reply to a View Once message and
 * resend it as normal media.
 *
 * .antidelete
 * -----------
 * Reply to a deleted/cached message
 * and resend the original message.
 */

import {
  downloadContentFromMessage,
} from "baileys";

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
} from "../utils/message.js";

import {
  msgCache,
} from "../utils/cache.js";


/* =========================================================
 * HELPERS
 * ======================================================= */

function getQuotedKey(message) {
  const quoted =
    message?.quoted;

  if (!quoted?.stanzaId) {
    return null;
  }

  return {
    remoteJid:
      message.from,

    id:
      quoted.stanzaId,

    participant:
      quoted.participant ||
      undefined,
  };
}


function getCacheKey(
  remoteJid,
  id
) {
  return `${remoteJid}:${id}`;
}


function getQuotedMessage(
  message
) {
  const key =
    getQuotedKey(message);

  if (!key) {
    return null;
  }

  return {
    key,
    cached:
      msgCache.get(
        getCacheKey(
          key.remoteJid,
          key.id
        )
      ),
  };
}


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

  return Buffer.concat(chunks);
}


/**
 * Download a Baileys media message.
 */
async function downloadMedia(
  content,
  type
) {
  if (!content) {
    return null;
  }

  let downloadType =
    type;

  /**
   * Baileys media types.
   */
  if (
    type === "imageMessage"
  ) {
    downloadType = "image";
  }

  if (
    type === "videoMessage"
  ) {
    downloadType = "video";
  }

  if (
    type === "audioMessage"
  ) {
    downloadType = "audio";
  }

  if (
    type === "documentMessage"
  ) {
    downloadType = "document";
  }

  if (
    type === "stickerMessage"
  ) {
    downloadType = "sticker";
  }

  const stream =
    await downloadContentFromMessage(
      content,
      downloadType
    );

  return streamToBuffer(
    stream
  );
}


/* =========================================================
 * SEND NORMAL MESSAGE
 * ======================================================= */

async function resendRawMessage(
  conn,
  jid,
  rawMessage
) {
  if (!rawMessage) {
    return false;
  }

  /**
   * Unwrap common WhatsApp wrappers.
   */
  let content =
    rawMessage?.message ||
    rawMessage;

  if (
    content?.ephemeralMessage
      ?.message
  ) {
    content =
      content
        .ephemeralMessage
        .message;
  }

  if (
    content?.viewOnceMessage
      ?.message
  ) {
    content =
      content
        .viewOnceMessage
        .message;
  }

  if (
    content?.viewOnceMessageV2
      ?.message
  ) {
    content =
      content
        .viewOnceMessageV2
        .message;
  }

  if (
    content?.viewOnceMessageV2Extension
      ?.message
  ) {
    content =
      content
        .viewOnceMessageV2Extension
        .message;
  }

  /* -------------------------------------------------------
   * TEXT
   * ----------------------------------------------------- */

  if (
    content?.conversation
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


  if (
    content?.extendedTextMessage
  ) {
    const msg =
      content.extendedTextMessage;

    await conn.sendMessage(
      jid,
      {
        text:
          msg.text || "",
      }
    );

    return true;
  }


  /* -------------------------------------------------------
   * IMAGE
   * ----------------------------------------------------- */

  if (
    content?.imageMessage
  ) {
    const msg =
      content.imageMessage;

    const buffer =
      await downloadMedia(
        msg,
        "imageMessage"
      );

    await conn.sendMessage(
      jid,
      {
        image:
          buffer,

        caption:
          msg.caption || "",
      }
    );

    return true;
  }


  /* -------------------------------------------------------
   * VIDEO
   * ----------------------------------------------------- */

  if (
    content?.videoMessage
  ) {
    const msg =
      content.videoMessage;

    const buffer =
      await downloadMedia(
        msg,
        "videoMessage"
      );

    await conn.sendMessage(
      jid,
      {
        video:
          buffer,

        caption:
          msg.caption || "",
      }
    );

    return true;
  }


  /* -------------------------------------------------------
   * AUDIO
   * ----------------------------------------------------- */

  if (
    content?.audioMessage
  ) {
    const msg =
      content.audioMessage;

    const buffer =
      await downloadMedia(
        msg,
        "audioMessage"
      );

    await conn.sendMessage(
      jid,
      {
        audio:
          buffer,

        mimetype:
          msg.mimetype ||
          "audio/mpeg",

        ptt:
          Boolean(msg.ptt),
      }
    );

    return true;
  }


  /* -------------------------------------------------------
   * DOCUMENT
   * ----------------------------------------------------- */

  if (
    content?.documentMessage
  ) {
    const msg =
      content.documentMessage;

    const buffer =
      await downloadMedia(
        msg,
        "documentMessage"
      );

    await conn.sendMessage(
      jid,
      {
        document:
          buffer,

        mimetype:
          msg.mimetype ||
          "application/octet-stream",

        fileName:
          msg.fileName ||
          "document",

        caption:
          msg.caption || "",
      }
    );

    return true;
  }


  /* -------------------------------------------------------
   * STICKER
   * ----------------------------------------------------- */

  if (
    content?.stickerMessage
  ) {
    const msg =
      content.stickerMessage;

    const buffer =
      await downloadMedia(
        msg,
        "stickerMessage"
      );

    await conn.sendMessage(
      jid,
      {
        sticker:
          buffer,
      }
    );

    return true;
  }


  return false;
}


/* =========================================================
 * .VV
 * ======================================================= */

command(
  {
    pattern: "vv",
    fromMe: false,
    desc:
      "View a View Once message again",
    type: "misc",
  },

  async (message, conn) => {
    const quoted =
      message?.quoted;

    if (!quoted) {
      await replyFail(
        conn,
        message,
        "Reply to a View Once image, video, audio or document."
      );

      return;
    }

    if (
      !quoted.isViewOnce
    ) {
      await replyFail(
        conn,
        message,
        "The replied message is not a View Once message."
      );

      return;
    }

    try {
      const sent =
        await resendRawMessage(
          conn,
          message.from,
          {
            message:
              quoted.originalMessage,
          }
        );

      if (!sent) {
        await replyFail(
          conn,
          message,
          "I couldn't open this View Once message."
        );
      }
    } catch (error) {
      console.log(
        "❌ .vv error:",
        error?.stack ||
          error?.message ||
          error
      );

      await replyFail(
        conn,
        message,
        "Failed to open the View Once message."
      );
    }
  }
);


/* =========================================================
 * .ANTIDELETE
 * ======================================================= */

command(
  {
    pattern: "antidelete",
    fromMe: false,
    desc:
      "Recover a recently deleted message",
    type: "misc",
  },

  async (message, conn) => {
    const result =
      getQuotedMessage(
        message
      );

    if (!result) {
      await replyFail(
        conn,
        message,
        "Reply to the deleted message and send .antidelete."
      );

      return;
    }

    const {
      key,
      cached,
    } = result;

    if (!cached) {
      await replyFail(
        conn,
        message,
        "This message is no longer in my cache."
      );

      return;
    }

    try {
      const sent =
        await resendRawMessage(
          conn,
          message.from,
          cached
        );

      if (!sent) {
        await replyFail(
          conn,
          message,
          "This message type cannot be recovered."
        );
      }
    } catch (error) {
      console.log(
        "❌ .antidelete error:",
        error?.stack ||
          error?.message ||
          error
      );

      await replyFail(
        conn,
        message,
        "Failed to recover the deleted message."
      );
    }
  }
);
