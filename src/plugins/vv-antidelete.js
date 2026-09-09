/**
 * X-MD / X-ANSARI
 *
 * View Once + AntiDelete
 *
 * Commands:
 * .vv
 * .antidelete
 * .antidelete on
 * .antidelete off
 *
 * AntiDelete:
 * - Global ON/OFF
 * - Private + groups
 * - Reports only to bot owner's "You" chat
 * - Never reposts deleted messages in original chat
 * - Text + image + video + audio + document + sticker
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { command } from "../plugins.js";
import { reply, replyFail, replyOk } from "../utils/message.js";
import {
  msgCache,
  makeMessageCacheKey,
} from "../utils/cache.js";
import { BOT_INFO } from "../config/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(
  __dirname,
  "../database/antidelete.json"
);

/* =========================================================
   DATABASE
========================================================= */

function ensureDatabase() {
  try {
    const dir = path.dirname(DB_FILE);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {
        recursive: true,
      });
    }

    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify(
          {
            enabled: false,
          },
          null,
          2
        )
      );
    }
  } catch (error) {
    console.log(
      "⚠️ AntiDelete database error:",
      error?.message || error
    );
  }
}

function readSettings() {
  ensureDatabase();

  try {
    const data = fs.readFileSync(
      DB_FILE,
      "utf8"
    );

    const parsed = JSON.parse(data);

    return {
      enabled: Boolean(
        parsed?.enabled
      ),
    };
  } catch (error) {
    console.log(
      "⚠️ AntiDelete read error:",
      error?.message || error
    );

    return {
      enabled: false,
    };
  }
}

function writeSettings(settings) {
  ensureDatabase();

  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          enabled: Boolean(
            settings?.enabled
          ),
        },
        null,
        2
      )
    );

    return true;
  } catch (error) {
    console.log(
      "⚠️ AntiDelete write error:",
      error?.message || error
    );

    return false;
  }
}

export function isAntiDeleteEnabled() {
  return readSettings().enabled;
}

export function setAntiDelete(enabled) {
  return writeSettings({
    enabled: Boolean(enabled),
  });
}

/* =========================================================
   DELETE LOCK
========================================================= */

const processedDeletes = new Map();

const DELETE_LOCK_MS =
  60 * 1000;

function alreadyProcessed(cacheKey) {
  if (!cacheKey) {
    return true;
  }

  const now = Date.now();

  for (const [
    key,
    timestamp,
  ] of processedDeletes) {
    if (
      now - timestamp >
      DELETE_LOCK_MS
    ) {
      processedDeletes.delete(key);
    }
  }

  if (
    processedDeletes.has(
      cacheKey
    )
  ) {
    return true;
  }

  processedDeletes.set(
    cacheKey,
    now
  );

  return false;
}

/* =========================================================
   JID HELPERS
========================================================= */

function cleanJid(jid) {
  if (!jid) {
    return null;
  }

  return String(jid)
    .replace(/:.*?(?=@)/, "")
    .trim();
}

function jidToNumber(jid) {
  if (!jid) {
    return "Unknown";
  }

  const clean = String(jid)
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");

  return clean || "Unknown";
}

function isGroupJid(jid) {
  return String(
    jid || ""
  ).endsWith("@g.us");
}

/* =========================================================
   OWNER CHAT
========================================================= */

function getOwnerChatJid() {
  const raw =
    BOT_INFO?.OWNER ||
    process.env.OWNER_NUMBER ||
    "";

  const number = String(raw)
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");

  if (!number) {
    console.log(
      "⚠️ AntiDelete: OWNER_NUMBER is empty or invalid"
    );

    return null;
  }

  const ownerJid =
    `${number}@s.whatsapp.net`;

  console.log(
    "👑 AntiDelete owner JID:",
    ownerJid
  );

  return ownerJid;
}

/* =========================================================
   GROUP NAME
========================================================= */

async function getGroupName(
  conn,
  jid
) {
  if (!isGroupJid(jid)) {
    return null;
  }

  try {
    const metadata =
      await conn.groupMetadata(
        jid
      );

    return (
      metadata?.subject ||
      jid
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete group metadata error:",
      error?.message || error
    );

    return jid;
  }
}

/* =========================================================
   ACTOR
========================================================= */

function getActorFromUpdate(
  update
) {
  const originalKey =
    update?.key || null;

  const innerKey =
    update?.update?.key ||
    null;

  if (!originalKey) {
    return null;
  }

  if (
    isGroupJid(
      originalKey.remoteJid
    )
  ) {
    return (
      innerKey?.participantAlt ||
      innerKey?.participant ||
      originalKey?.participantAlt ||
      originalKey?.participant ||
      null
    );
  }

  if (innerKey?.fromMe) {
    return (
      innerKey?.participantAlt ||
      innerKey?.participant ||
      innerKey?.remoteJidAlt ||
      innerKey?.remoteJid ||
      originalKey?.remoteJid ||
      null
    );
  }

  return (
    originalKey?.remoteJidAlt ||
    originalKey?.remoteJid ||
    null
  );
}

/* =========================================================
   MENTION
========================================================= */

function makeMention(jid) {
  if (!jid) {
    return {
      text: "",
      mentions: [],
    };
  }

  const clean =
    cleanJid(jid);

  if (!clean) {
    return {
      text: "",
      mentions: [],
    };
  }

  return {
    text:
      `@${jidToNumber(clean)}`,
    mentions: [clean],
  };
}

/* =========================================================
   ORIGINAL MESSAGE DESCRIPTION
========================================================= */

function getOriginalDescription(
  rawMessage
) {
  const content =
    rawMessage?.message;

  if (!content) {
    return "Unknown";
  }

  if (
    typeof content.conversation ===
    "string"
  ) {
    return content.conversation;
  }

  if (
    content.extendedTextMessage
      ?.text
  ) {
    return (
      content.extendedTextMessage
        .text
    );
  }

  if (
    content.imageMessage
      ?.caption
  ) {
    return (
      content.imageMessage
        .caption
    );
  }

  if (
    content.videoMessage
      ?.caption
  ) {
    return (
      content.videoMessage
        .caption
    );
  }

  if (
    content.documentMessage
      ?.caption
  ) {
    return (
      content.documentMessage
        .caption
    );
  }

  if (
    content.stickerMessage
  ) {
    return "[Sticker]";
  }

  if (
    content.imageMessage
  ) {
    return "[Image]";
  }

  if (
    content.videoMessage
  ) {
    return "[Video]";
  }

  if (
    content.audioMessage
  ) {
    return "[Audio]";
  }

  if (
    content.documentMessage
  ) {
    return "[Document]";
  }

  if (
    content.locationMessage
  ) {
    return "[Location]";
  }

  if (
    content.contactMessage
  ) {
    return "[Contact]";
  }

  return "[Message]";
}

/* =========================================================
   MEDIA TYPE
========================================================= */

function getMediaType(
  rawMessage
) {
  const content =
    rawMessage?.message;

  if (!content) {
    return null;
  }

  if (content.imageMessage) {
    return "image";
  }

  if (content.videoMessage) {
    return "video";
  }

  if (content.audioMessage) {
    return "audio";
  }

  if (
    content.documentMessage
  ) {
    return "document";
  }

  if (
    content.stickerMessage
  ) {
    return "sticker";
  }

  return null;
}

/* =========================================================
   VIEW ONCE HELPERS
========================================================= */

function unwrapViewOnce(
  message
) {
  if (!message) {
    return null;
  }

  let current = message;

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
        current.ephemeralMessage
          .message;

      continue;
    }

    if (
      current.viewOnceMessage
        ?.message
    ) {
      current =
        current.viewOnceMessage
          .message;

      continue;
    }

    if (
      current.viewOnceMessageV2
        ?.message
    ) {
      current =
        current.viewOnceMessageV2
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

    break;
  }

  return current;
}

function findViewOnceContent(
  message
) {
  const unwrapped =
    unwrapViewOnce(message);

  if (!unwrapped) {
    return null;
  }

  if (unwrapped.imageMessage) {
    return {
      type: "image",
      content:
        unwrapped.imageMessage,
    };
  }

  if (unwrapped.videoMessage) {
    return {
      type: "video",
      content:
        unwrapped.videoMessage,
    };
  }

  if (unwrapped.audioMessage) {
    return {
      type: "audio",
      content:
        unwrapped.audioMessage,
    };
  }

  if (
    unwrapped.documentMessage
  ) {
    return {
      type: "document",
      content:
        unwrapped.documentMessage,
    };
  }

  return null;
}

/* =========================================================
   SEND RECOVERED MESSAGE
========================================================= */

async function resendRawMessage(
  conn,
  ownerJid,
  rawMessage
) {
  if (
    !conn ||
    !ownerJid ||
    !rawMessage
  ) {
    return false;
  }

  const mediaType =
    getMediaType(rawMessage);

  try {
    const content =
      rawMessage?.message;

    /* TEXT */

    if (
      typeof content?.conversation ===
      "string"
    ) {
      await conn.sendMessage(
        ownerJid,
        {
          text:
            content.conversation,
        }
      );

      return true;
    }

    if (
      content?.extendedTextMessage
        ?.text
    ) {
      await conn.sendMessage(
        ownerJid,
        {
          text:
            content.extendedTextMessage
              .text,
        }
      );

      return true;
    }

    /* MEDIA */

    if (mediaType) {
      let buffer;

      try {
        buffer =
          await conn.downloadMediaMessage(
            rawMessage,
            "buffer",
            {}
          );
      } catch (error) {
        console.log(
          "⚠️ AntiDelete media download error:",
          error?.message || error
        );

        return false;
      }

      if (!buffer) {
        return false;
      }

      /* IMAGE */

      if (
        mediaType === "image"
      ) {
        await conn.sendMessage(
          ownerJid,
          {
            image: buffer,
            caption:
              content
                ?.imageMessage
                ?.caption ||
              "",
          }
        );

        return true;
      }

      /* VIDEO */

      if (
        mediaType === "video"
      ) {
        await conn.sendMessage(
          ownerJid,
          {
            video: buffer,
            caption:
              content
                ?.videoMessage
                ?.caption ||
              "",
          }
        );

        return true;
      }

      /* AUDIO */

      if (
        mediaType === "audio"
      ) {
        await conn.sendMessage(
          ownerJid,
          {
            audio: buffer,
            mimetype:
              content
                ?.audioMessage
                ?.mimetype ||
              "audio/mp4",
            ptt:
              content
                ?.audioMessage
                ?.ptt === true,
          }
        );

        return true;
      }

      /* DOCUMENT */

      if (
        mediaType ===
        "document"
      ) {
        await conn.sendMessage(
          ownerJid,
          {
            document: buffer,
            mimetype:
              content
                ?.documentMessage
                ?.mimetype ||
              "application/octet-stream",
            fileName:
              content
                ?.documentMessage
                ?.fileName ||
              "recovered-document",
            caption:
              content
                ?.documentMessage
                ?.caption ||
              "",
          }
        );

        return true;
      }

      /* STICKER */

      if (
        mediaType ===
        "sticker"
      ) {
        await conn.sendMessage(
          ownerJid,
          {
            sticker: buffer,
          }
        );

        return true;
      }
    }

    /* FALLBACK */

    await conn.sendMessage(
      ownerJid,
      {
        text:
          getOriginalDescription(
            rawMessage
          ),
      }
    );

    return true;
  } catch (error) {
    console.log(
      "⚠️ AntiDelete resend error:",
      error?.stack ||
        error?.message ||
        error
    );

    return false;
  }
}

/* =========================================================
   DELETE INFORMATION
========================================================= */

function extractDeleteInfo(
  update
) {
  if (!update) {
    return null;
  }

  const outerKey =
    update?.key;

  const innerUpdate =
    update?.update;

  const stub =
    innerUpdate
      ?.messageStubType;

  const isRevoke =
    stub === 0 ||
    stub === "REVOKE" ||
    stub === "revoke" ||
    Boolean(
      innerUpdate &&
        innerUpdate.message ===
          null &&
        innerUpdate.key
    );

  if (
    isRevoke &&
    outerKey?.remoteJid &&
    outerKey?.id
  ) {
    return {
      targetKey:
        outerKey,
      actorKey:
        innerUpdate?.key ||
        null,
    };
  }

  const protocol =
    update?.update
      ?.message
      ?.protocolMessage ||
    update?.message
      ?.protocolMessage ||
    update?.protocolMessage;

  if (
    protocol?.type === 0 &&
    protocol?.key?.remoteJid &&
    protocol?.key?.id
  ) {
    return {
      targetKey:
        protocol.key,
      actorKey:
        update?.key ||
        null,
    };
  }

  if (
    outerKey?.remoteJid &&
    outerKey?.id &&
    (
      innerUpdate
        ?.message === null ||
      innerUpdate
        ?.messageStubType
    )
  ) {
    return {
      targetKey:
        outerKey,
      actorKey:
        innerUpdate?.key ||
        null,
    };
  }

  return null;
}

/* =========================================================
   ANTI DELETE REPORT
========================================================= */

async function sendAntiDeleteReport(
  conn,
  sessionId,
  targetKey,
  actorKey,
  originalMessage
) {
  if (
    !conn ||
    !targetKey ||
    !originalMessage
  ) {
    return false;
  }

  const ownerJid =
    getOwnerChatJid();

  if (!ownerJid) {
    console.log(
      `⚠️ AntiDelete owner JID unavailable [${sessionId}]`
    );

    return false;
  }

  const remoteJid =
    targetKey.remoteJid;

  const group =
    isGroupJid(remoteJid);

  let actor =
    getActorFromUpdate({
      key: targetKey,
      update: {
        key: actorKey,
      },
    });

  if (!actor) {
    actor =
      actorKey?.participantAlt ||
      actorKey?.participant ||
      actorKey?.remoteJidAlt ||
      actorKey?.remoteJid ||
      targetKey?.participantAlt ||
      targetKey?.participant ||
      targetKey?.remoteJid;
  }

  actor = cleanJid(actor);

  const description =
    getOriginalDescription(
      originalMessage
    );

  let report = "";
  let mentions = [];

  /* GROUP */

  if (group) {
    const groupName =
      await getGroupName(
        conn,
        remoteJid
      );

    const mention =
      makeMention(actor);

    mentions =
      mention.mentions;

    report = [
      "🗑️ AntiDelete",
      `👥 ${
        groupName || "Group"
      }`,
      `👤 User: ${
        mention.text ||
        `@${jidToNumber(actor)}`
      }`,
      "❌ Deleted a message",
      `💬 Original message: ${description}`,
    ].join("\n");
  }

  /* PRIVATE */

  else {
    report = [
      "🗑️ AntiDelete",
      `👤 User: @${jidToNumber(
        actor || remoteJid
      )}`,
      "❌ Deleted a message",
      `💬 Original message: ${description}`,
    ].join("\n");
  }

  /* REPORT */

  try {
    await conn.sendMessage(
      ownerJid,
      {
        text: report,
        mentions,
      }
    );

    console.log(
      `📤 AntiDelete report sent to OWNER [${sessionId}]:`,
      ownerJid
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete report send error:",
      error?.stack ||
        error?.message ||
        error
    );

    return false;
  }

  /* RECOVER ORIGINAL */

  try {
    const sent =
      await resendRawMessage(
        conn,
        ownerJid,
        originalMessage
      );

    console.log(
      `📦 AntiDelete recovery result [${sessionId}]:`,
      sent
    );

    if (!sent) {
      await conn.sendMessage(
        ownerJid,
        {
          text:
            `📦 Recovered message:\n` +
            description,
        }
      );
    }
  } catch (error) {
    console.log(
      "⚠️ AntiDelete recovery error:",
      error?.stack ||
        error?.message ||
        error
    );
  }

  return true;
}

/* =========================================================
   HANDLE DELETED MESSAGE
========================================================= */

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
      extractDeleteInfo(update);

    if (!info) {
      return false;
    }

    const targetKey =
      info.targetKey;

    const cacheKey =
      makeMessageCacheKey(
        sessionId,
        targetKey.remoteJid,
        targetKey.id
      );

    if (!cacheKey) {
      return false;
    }

    if (
      alreadyProcessed(cacheKey)
    ) {
      return false;
    }

    const originalMessage =
      msgCache.get(cacheKey);

    if (!originalMessage) {
      console.log(
        `⚠️ AntiDelete original message not found in cache [${sessionId}]:`,
        cacheKey
      );

      return false;
    }

    console.log(
      `🗑️ DELETE DETECTED [${sessionId}]:`,
      targetKey.remoteJid,
      targetKey.id
    );

    await sendAntiDeleteReport(
      conn,
      sessionId,
      targetKey,
      info.actorKey,
      originalMessage
    );

    msgCache.delete(
      cacheKey
    );

    return true;
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
   .ANTIDELETE COMMAND
========================================================= */

command(
  {
    pattern:
      "antidelete",
    desc:
      "Enable, disable or check AntiDelete",
    type: "misc",
  },
  async (
    message,
    conn
  ) => {
    const args =
      String(
        message?.body ||
          ""
      )
        .trim()
        .split(/\s+/)
        .slice(1)
        .join(" ")
        .toLowerCase();

    if (
      args === "on" ||
      args === "enable"
    ) {
      setAntiDelete(
        true
      );

      return replyOk(
        conn,
        message,
        "AntiDelete is ON 🟢 globally."
      );
    }

    if (
      args === "off" ||
      args === "disable"
    ) {
      setAntiDelete(
        false
      );

      return replyOk(
        conn,
        message,
        "AntiDelete is OFF 🔴 globally."
      );
    }

    const enabled =
      isAntiDeleteEnabled();

    return reply(
      conn,
      message,
      enabled
        ? "✅ AntiDelete is ON 🟢 globally."
        : "❌ AntiDelete is OFF 🔴 globally."
    );
  }
);

/* =========================================================
   .VV COMMAND
========================================================= */

command(
  {
    pattern: "vv",
    desc:
      "Open View Once media",
    type: "misc",
  },
  async (
    message,
    conn
  ) => {
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
          original?.message ||
            original
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

      if (
        found.type ===
        "image"
      ) {
        await conn.sendMessage(
          message.from,
          {
            image: buffer,
            caption:
              found.content
                ?.caption ||
              "",
          },
          {
            quoted: {
              key:
                message.key,
              message:
                message.message,
            },
          }
        );

        return;
      }

      if (
        found.type ===
        "video"
      ) {
        await conn.sendMessage(
          message.from,
          {
            video: buffer,
            caption:
              found.content
                ?.caption ||
              "",
          },
          {
            quoted: {
              key:
                message.key,
              message:
                message.message,
            },
          }
        );

        return;
      }

      if (
        found.type ===
        "audio"
      ) {
        await conn.sendMessage(
          message.from,
          {
            audio: buffer,
            mimetype:
              found.content
                ?.mimetype ||
              "audio/mp4",
            ptt:
              found.content
                ?.ptt === true,
          },
          {
            quoted: {
              key:
                message.key,
              message:
                message.message,
            },
          }
        );

        return;
      }

      if (
        found.type ===
        "document"
      ) {
        await conn.sendMessage(
          message.from,
          {
            document:
              buffer,
            mimetype:
              found.content
                ?.mimetype ||
              "application/octet-stream",
            fileName:
              found.content
                ?.fileName ||
              "view-once-document",
            caption:
              found.content
                ?.caption ||
              "",
          },
          {
            quoted: {
              key:
                message.key,
              message:
                message.message,
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
