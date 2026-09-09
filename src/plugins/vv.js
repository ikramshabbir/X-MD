/**
 * X-MD / X-ANSARI
 *
 * View Once
 *
 * Command:
 * .vv
 *
 * Reply to a View Once image, video,
 * audio or document to recover it.
 */

import { command } from "../plugins.js";
import { replyFail } from "../utils/message.js";
import {
  downloadViewOnce,
} from "../utils/media.js";

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
      const quoted =
        message?.quoted;

      if (!quoted) {
        return replyFail(
          conn,
          message,
          "Reply to a View Once image, video, audio or document."
        );
      }

      /*
       * Download using the project's
       * proper Baileys media helper.
       */
      let result;

      try {
        result =
          await downloadViewOnce(
            conn,
            message
          );
      } catch (error) {
        console.log(
          "⚠️ .vv download error:",
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

      if (!result?.buffer) {
        return replyFail(
          conn,
          message,
          "View Once media could not be recovered."
        );
      }

      const buffer =
        result.buffer;

      const content =
        result.content || {};

      /*
       * Send recovered media
       * back to the SAME chat.
       */
      const sendOptions = {
        quoted: {
          key: message.key,
          message:
            message.message,
        },
      };

      /* =====================================================
         IMAGE
      ===================================================== */

      if (
        result.type ===
        "image"
      ) {
        await conn.sendMessage(
          message.from,
          {
            image: buffer,

            caption:
              content.caption ||
              "",
          },
          sendOptions
        );

        return;
      }

      /* =====================================================
         VIDEO
      ===================================================== */

      if (
        result.type ===
        "video"
      ) {
        await conn.sendMessage(
          message.from,
          {
            video: buffer,

            caption:
              content.caption ||
              "",
          },
          sendOptions
        );

        return;
      }

      /* =====================================================
         AUDIO
      ===================================================== */

      if (
        result.type ===
        "audio"
      ) {
        await conn.sendMessage(
          message.from,
          {
            audio: buffer,

            mimetype:
              content.mimetype ||
              result.mimetype ||
              "audio/mp4",

            ptt:
              content.ptt === true,
          },
          sendOptions
        );

        return;
      }

      /* =====================================================
         DOCUMENT
      ===================================================== */

      if (
        result.type ===
        "document"
      ) {
        await conn.sendMessage(
          message.from,
          {
            document: buffer,

            mimetype:
              content.mimetype ||
              result.mimetype ||
              "application/octet-stream",

            fileName:
              content.fileName ||
              "view-once-document",

            caption:
              content.caption ||
              "",
          },
          sendOptions
        );

        return;
      }

      return replyFail(
        conn,
        message,
        "Unsupported View Once media type."
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
