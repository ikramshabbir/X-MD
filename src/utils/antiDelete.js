/**
 * X-MD AntiDelete
 */

import { kvGet, kvSet } from "../database/botKv.js";

import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { getViewOnceMediaInfo } from "./media.js";

const ENABLE_KEY = "antidelete";
const CACHE = new Map();

const MAX_CACHE = 500;
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function isAntiDeleteEnabled() {
  const value = await kvGet(ENABLE_KEY);
  return value === true || value === "true" || value === 1;
}

export async function setAntiDeleteEnabled(enabled) {
  await kvSet(ENABLE_KEY, Boolean(enabled));
  return Boolean(enabled);
}

export async function getAntiDeleteStatus() {
  return await isAntiDeleteEnabled();
}

export function cacheAntiDeleteMessage(rawMessage) {
  try {
    const key = rawMessage?.key;

    if (!key?.id || !key?.remoteJid) return;

    const cacheKey = makeCacheKey(
      key.remoteJid,
      key.id
    );

    CACHE.set(cacheKey, {
      message: rawMessage,
      savedAt: Date.now(),
    });

    cleanupCache();
  } catch (error) {
    console.log(
      "⚠️ AntiDelete cache error:",
      error?.message || error
    );
  }
}

export function getCachedAntiDeleteMessage(
  remoteJid,
  messageId
) {
  if (!remoteJid || !messageId) return null;

  const cacheKey = makeCacheKey(
    remoteJid,
    messageId
  );

  const entry = CACHE.get(cacheKey);

  if (!entry) return null;

  if (
    Date.now() - entry.savedAt >
    CACHE_TTL
  ) {
    CACHE.delete(cacheKey);
    return null;
  }

  return entry.message;
}

export function deleteCachedAntiDeleteMessage(
  remoteJid,
  messageId
) {
  if (!remoteJid || !messageId) return;

  CACHE.delete(
    makeCacheKey(remoteJid, messageId)
  );
}

/* =========================================================
 * ATTACH ANTIDELETE TO A CONNECTION
 * ======================================================= */

export function attachAntiDelete(conn, sessionId = "default") {
  if (!conn || conn.__antiDeleteAttached) {
    return;
  }

  conn.__antiDeleteAttached = true;

  /* -------------------------------------------------------
   * CACHE ALL INCOMING MESSAGES
   * ----------------------------------------------------- */

  conn.ev.on(
    "messages.upsert",
    async ({ messages }) => {
      try {
        if (!(await isAntiDeleteEnabled())) {
          return;
        }

        for (const rawMessage of messages || []) {
          if (!rawMessage?.key?.id) {
            continue;
          }

          if (rawMessage.key.fromMe) {
            continue;
          }

          cacheAntiDeleteMessage(rawMessage);
        }
      } catch (error) {
        console.log(
          `⚠️ AntiDelete cache error [${sessionId}]:`,
          error?.message || error
        );
      }
    }
  );

  /* -------------------------------------------------------
   * DETECT DELETED MESSAGES
   * ----------------------------------------------------- */

  conn.ev.on(
    "messages.update",
    async (updates) => {
      try {
        if (!(await isAntiDeleteEnabled())) {
          return;
        }

        for (const item of updates || []) {
          const update = item?.update;
          const key = item?.key;

          if (!key?.id || !key?.remoteJid) {
            continue;
          }

          const isRevoke =
            update?.message === null ||
            String(
              update?.messageStubType || ""
            ).toUpperCase() === "REVOKE";

          if (!isRevoke) {
            continue;
          }

          const deletedMessage =
            getCachedAntiDeleteMessage(
              key.remoteJid,
              key.id
            );

          if (!deletedMessage) {
            console.log(
              `⚠️ AntiDelete: original message not found [${sessionId}] ${key.id}`
            );
            continue;
          }

          /* Ignore bot's own deleted messages */
          if (deletedMessage.key?.fromMe) {
            continue;
          }

          /* ------------------------------------------------
           * OWNER / YOU CHAT
           * ---------------------------------------------- */

          const ownerJid =
            conn?.user?.id
              ? String(conn.user.id).replace(
                  /:\d+@/,
                  "@"
                )
              : null;

          if (!ownerJid) {
            console.log(
              `⚠️ AntiDelete: owner JID unavailable [${sessionId}]`
            );
            continue;
          }

          const remoteJid =
            deletedMessage.key.remoteJid ||
            key.remoteJid;

          const isGroup =
            String(remoteJid).endsWith("@g.us");

          /* ------------------------------------------------
           * SENDER
           * ---------------------------------------------- */

          const senderJid =
            deletedMessage.key.participantAlt ||
            deletedMessage.key.remoteJidAlt ||
            deletedMessage.key.participant ||
            deletedMessage.key.remoteJid ||
            "Unknown";

          const senderName =
            deletedMessage.pushName ||
            "Unknown";

          const senderNumber =
            String(senderJid).endsWith(
              "@s.whatsapp.net"
            )
              ? String(senderJid).split("@")[0]
              : null;

          /* ------------------------------------------------
           * GROUP NAME
           * ---------------------------------------------- */

          let groupName = "";

          if (isGroup) {
            try {
              const metadata =
                await conn.groupMetadata(
                  remoteJid
                );

              groupName =
                metadata?.subject ||
                "Unknown Group";
            } catch {
              groupName = "Unknown Group";
            }
          }

          /* ------------------------------------------------
           * ORIGINAL MESSAGE
           * ---------------------------------------------- */

          const msg =
            deletedMessage.message || {};

    // View Once ko AntiDelete se completely ignore karo.
    // .vv is check se unaffected rahega.
    const viewOnceInfo =
      getViewOnceMediaInfo(deletedMessage);

    if (viewOnceInfo) {
      console.log(
        `⏭️ AntiDelete: View Once ignored [${sessionId}]`
      );
      deleteCachedAntiDeleteMessage(
        key.remoteJid,
        key.id
      );
      continue;
    }

    const image =
            msg.imageMessage;

          const video =
            msg.videoMessage;

          const document =
            msg.documentMessage;

          const audio =
            msg.audioMessage;

          const sticker =
            msg.stickerMessage;

          let originalText = "";

          if (msg.conversation) {
            originalText =
              msg.conversation;
          } else if (
            msg.extendedTextMessage?.text
          ) {
            originalText =
              msg.extendedTextMessage.text;
          } else if (
            image?.caption
          ) {
            originalText =
              image.caption;
          } else if (
            video?.caption
          ) {
            originalText =
              video.caption;
          } else if (
            document?.caption
          ) {
            originalText =
              document.caption;
          }

          /* ------------------------------------------------
           * REPORT
           * ---------------------------------------------- */

          let report =
            "🗑️ *AntiDelete*\n";

          if (isGroup) {
            report +=
              `👥 *${groupName}*\n`;
          }

          report +=
            `👤 User: ${senderName}`;

          if (senderNumber) {
            report +=
              ` (@${senderNumber})`;
          }

          report +=
            "\n❌ Deleted a message";

          if (originalText) {
            report +=
              `\n💬 Original message: ${originalText}`;
          }

          /* ------------------------------------------------
           * SEND REPORT ONLY TO OWNER
           * ---------------------------------------------- */

          await conn.sendMessage(
            ownerJid,
            {
              text: report,
              mentions:
                senderNumber
                  ? [senderJid]
                  : [],
            }
          );

          /* ------------------------------------------------
           * RECOVER MEDIA
           * ---------------------------------------------- */

          if (
            image ||
            video ||
            document ||
            audio ||
            sticker
          ) {
            try {
              const buffer =
                await downloadMediaMessage(
                  deletedMessage,
                  "buffer",
                  {},
                  {
                    logger:
                      conn?.logger ||
                      console,
                    reuploadRequest:
                      conn.updateMediaMessage?.bind(conn),
                  }
                );

              if (image) {
                await conn.sendMessage(
                  ownerJid,
                  {
                    image: buffer,
                    mimetype:
                      image.mimetype,
                    caption:
                      image.caption ||
                      undefined,
                  }
                );
              } else if (video) {
                await conn.sendMessage(
                  ownerJid,
                  {
                    video: buffer,
                    mimetype:
                      video.mimetype,
                    caption:
                      video.caption ||
                      undefined,
                  }
                );
              } else if (document) {
                await conn.sendMessage(
                  ownerJid,
                  {
                    document: buffer,
                    mimetype:
                      document.mimetype,
                    fileName:
                      document.fileName ||
                      "document",
                    caption:
                      document.caption ||
                      undefined,
                  }
                );
              } else if (audio) {
                await conn.sendMessage(
                  ownerJid,
                  {
                    audio: buffer,
                    mimetype:
                      audio.mimetype ||
                      "audio/mp4",
                    ptt:
                      Boolean(audio.ptt),
                  }
                );
              } else if (sticker) {
                await conn.sendMessage(
                  ownerJid,
                  {
                    sticker: buffer,
                  }
                );
              }

              console.log(
                `📦 AntiDelete: media recovered [${sessionId}]`
              );
            } catch (mediaError) {
              console.log(
                `⚠️ AntiDelete media recovery failed [${sessionId}]:`,
                mediaError?.message ||
                  mediaError
              );
            }
          }

          console.log(
            `✅ AntiDelete report sent to owner [${sessionId}]`
          );

          deleteCachedAntiDeleteMessage(
            key.remoteJid,
            key.id
          );
        }
      } catch (error) {
        console.log(
          `⚠️ AntiDelete delete handler error [${sessionId}]:`,
          error?.stack ||
            error?.message ||
            error
        );
      }
    }
  );

  console.log(
    `🛡️ AntiDelete attached: ${sessionId}`
  );
}

function makeCacheKey(
  remoteJid,
  messageId
) {
  return `${remoteJid}:${messageId}`;
}

function cleanupCache() {
  const now = Date.now();

  for (const [key, entry] of CACHE) {
    if (
      now - entry.savedAt >
      CACHE_TTL
    ) {
      CACHE.delete(key);
    }
  }

  while (CACHE.size > MAX_CACHE) {
    const firstKey =
      CACHE.keys().next().value;

    if (!firstKey) break;

    CACHE.delete(firstKey);
  }
}
