/**
 * X-MD / X-ANSARI
 *
 * View Once
 *
 * Command:
 * .vv
 *
 * Reply to a View Once image, video, audio
 * or document to recover it in the same chat.
 */

import { command } from "../plugins.js";

import {
  replyFail,
} from "../utils/message.js";

/* =========================================================
   VIEW ONCE HELPERS
========================================================= */

function unwrapViewOnce(message) {
  if (!message) {
    return null;
  }

  let current = message;

  for (let i = 0; i < 10 && current; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }

    if (
      current.viewOnceMessageV2Extension?.message
    ) {
      current =
        current.viewOnceMessageV2Extension.message;
      continue;
    }

    break;
  }

  return current;
}

function findViewOnceContent(message) {
  const unwrapped =
    unwrapViewOnce(message);

  if (!unwrapped) {
    return null;
  }

  if (unwrapped.imageMessage) {
    return {
      type: "image",
      content: unwrapped.imageMessage,
    };
  }

  if (unwrapped.videoMessage) {
    return {
      type: "video",
      content: unwrapped.videoMessage,
    };
  }

  if (unwrapped.audioMessage) {
    return {
      type: "audio",
      content: unwrapped.audioMessage,
    };
  }

  if (unwrapped.documentMessage) {
    return {
      type: "document",
      content: unwrapped.documentMessage,
    };
  }

  return null;
}

/* =========================================================
   .VV
========================================================= */

command(
  {
    pattern: "vv",
    desc: "Open View Once media",
    type: "misc",
  },

  async (message, conn) => {
    try {
      const quoted = message?.quoted;

      if (!quoted) {
        return replyFail(
          conn,
          message,
          "Reply to a View Once image, video, audio or document."
        );
      }

      const original =
        quoted?.originalMessage ||
        quoted?.raw ||
        null;

      if (!original) {
        return replyFail(
          conn,
          message,
          "View Once message data was not found."
        );
      }

      const found =
        findViewOnceContent(
          original?.message || original
        );

      if (!found) {
        if (
          quoted?.messageTypeKey ===
          "imageMessage"
        ) {
          return replyFail(
            conn,
            message,
            "View Once image data is unavailable."
          );
        }

        return replyFail(
          conn,
          message,
          "That is not a supported View Once media message."
        );
      }

      let buffer;

      try {
        buffer =
          await conn.downloadMediaMessage(
            original,
            "buffer",
            {}
          );
      } catch (error) {
        console.log(
          "⚠️ VV download error:",
          error?.stack ||
            error?.message ||
            error
        );

        return replyFail(
          conn,
          message,
          "Failed to download the View Once media."
        );
      }

      if (!buffer) {
        return replyFail(
          conn,
          message,
          "View Once media could not be recovered."
        );
      }

      /* IMAGE */

      if (found.type === "image") {
        await conn.sendMessage(
          message.from,
          {
            image: buffer,
            caption:
              found.content?.caption || "",
          },
          {
            quoted: {
              key: message.key,
              message: message.message,
            },
          }
        );

        return;
      }

      /* VIDEO */

      if (found.type === "video") {
        await conn.sendMessage(
          message.from,
          {
            video: buffer,
            caption:
              found.content?.caption || "",
          },
          {
            quoted: {
              key: message.key,
              message: message.message,
            },
          }
        );

        return;
      }

      /* AUDIO */

      if (found.type === "audio") {
        await conn.sendMessage(
          message.from,
          {
            audio: buffer,
            mimetype:
              found.content?.mimetype ||
              "audio/mp4",
            ptt:
              found.content?.ptt === true,
          },
          {
            quoted: {
              key: message.key,
              message: message.message,
            },
          }
        );

        return;
      }

      /* DOCUMENT */

      if (found.type === "document") {
        await conn.sendMessage(
          message.from,
          {
            document: buffer,
            mimetype:
              found.content?.mimetype ||
              "application/octet-stream",
            fileName:
              found.content?.fileName ||
              "view-once-document",
            caption:
              found.content?.caption || "",
          },
          {
            quoted: {
              key: message.key,
              message: message.message,
            },
          }
        );

        return;
      }

      return replyFail(
        conn,
        message,
        "Unsupported View Once type."
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
