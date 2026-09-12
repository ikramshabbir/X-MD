import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command } from "../plugins.js";
import { kvGet, kvSet } from "../database/botKv.js";
import { reply, replyOk, replyFail } from "../utils/message.js";
import { msgCache, makeMessageCacheKey } from "../utils/cache.js";
import { BOT_INFO } from "../config/constants.js";
import { downloadMediaMessage } from "baileys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(
  __dirname,
  "../database/antidelete.json"
);

const processedDeletes = new Map();
const DELETE_LOCK_MS = 60 * 1000;

const mediaLogger = {
  level: "error",
  child() { return this; },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error(...args) {
    console.error("[AntiDelete]", ...args);
  },
  fatal(...args) {
    console.error("[AntiDelete]", ...args);
  },
};

function ensureDatabase() {
  const dir = path.dirname(DB_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ enabled: false }, null, 2)
    );
  }
}

async function isAntiDeleteEnabled() {
  try {
    const value = await kvGet("antidelete");
    return value === true || value === "true" || value === 1;
  } catch {
    return false;
  }
}

async function setAntiDelete(enabled) {
  try {
    await kvSet("antidelete", Boolean(enabled));
    return true;
  } catch (error) {
    console.log(
      "⚠️ AntiDelete settings error:",
      error?.message || error
    );
    return false;
  }
}

function cleanJid(jid) {
  if (!jid) return null;

  return String(jid)
    .replace(/:.*?(?=@)/, "")
    .trim();
}

function jidNumber(jid) {
  return String(jid || "")
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

function isGroupJid(jid) {
  return String(jid || "").endsWith("@g.us");
}

function getOwnerJid(conn) {
  const self =
    conn?.user?.lid ||
    conn?.user?.id ||
    conn?.user?.jid;

  if (self) {
    return cleanJid(self);
  }

  const owner =
    BOT_INFO?.OWNER ||
    process.env.OWNER_NUMBER ||
    "";

  const number = String(owner)
    .replace(/\D/g, "");

  return number
    ? `${number}@s.whatsapp.net`
    : null;
}

function alreadyProcessed(key) {
  if (!key) return true;

  const now = Date.now();

  for (const [k, time] of processedDeletes) {
    if (now - time > DELETE_LOCK_MS) {
      processedDeletes.delete(k);
    }
  }

  if (processedDeletes.has(key)) {
    return true;
  }

  processedDeletes.set(key, now);
  return false;
}

/*
 * IMPORTANT:
 * Only real View Once wrappers count as View Once.
 * A normal image/video/audio must NEVER become View Once
 * merely because it contains media.
 */
function getViewOnceInfo(rawMessage) {
  let current = rawMessage?.message || rawMessage;

  if (!current) return null;

  let isViewOnce = false;

  for (let i = 0; i < 10 && current; i++) {
    if (current.viewOnceMessage?.message) {
      isViewOnce = true;
      current = current.viewOnceMessage.message;
      continue;
    }

    if (current.viewOnceMessageV2?.message) {
      isViewOnce = true;
      current = current.viewOnceMessageV2.message;
      continue;
    }

    if (
      current.viewOnceMessageV2Extension?.message
    ) {
      isViewOnce = true;
      current =
        current.viewOnceMessageV2Extension.message;
      continue;
    }

    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    break;
  }

  if (!isViewOnce || !current) {
    return null;
  }

  if (current.imageMessage) {
    return {
      type: "image",
      content: current.imageMessage,
    };
  }

  if (current.videoMessage) {
    return {
      type: "video",
      content: current.videoMessage,
    };
  }

  if (current.audioMessage) {
    return {
      type: "audio",
      content: current.audioMessage,
    };
  }

  if (current.documentMessage) {
    return {
      type: "document",
      content: current.documentMessage,
    };
  }

  return null;
}

function getNormalMediaInfo(rawMessage) {
  const content = rawMessage?.message;

  if (!content) return null;

  if (content.imageMessage) {
    return {
      type: "image",
      content: content.imageMessage,
    };
  }

  if (content.videoMessage) {
    return {
      type: "video",
      content: content.videoMessage,
    };
  }

  if (content.audioMessage) {
    return {
      type: "audio",
      content: content.audioMessage,
    };
  }

  return null;
}

function getText(rawMessage) {
  const content = rawMessage?.message;

  if (!content) return null;

  if (typeof content.conversation === "string") {
    return content.conversation;
  }

  if (
    typeof content.extendedTextMessage?.text ===
    "string"
  ) {
    return content.extendedTextMessage.text;
  }

  return null;
}

function getActor(update, targetKey) {
  const actorKey = update?.update?.key;

  if (isGroupJid(targetKey?.remoteJid)) {
    return cleanJid(
      actorKey?.participantAlt ||
      actorKey?.participant ||
      targetKey?.participantAlt ||
      targetKey?.participant ||
      targetKey?.remoteJid
    );
  }

  return cleanJid(
    actorKey?.remoteJidAlt ||
    actorKey?.remoteJid ||
    targetKey?.remoteJidAlt ||
    targetKey?.remoteJid
  );
}

async function makeNotification(
  conn,
  targetKey,
  update
) {
  const remoteJid = targetKey.remoteJid;
  const actor = getActor(update, targetKey);

  if (isGroupJid(remoteJid)) {
    let groupName = "Group";

    try {
      const metadata =
        await conn.groupMetadata(remoteJid);

      groupName =
        metadata?.subject || groupName;
    } catch {}

    return {
      text: [
        "🗑️ *AntiDelete*",
        `👥 Group: ${groupName}`,
        `👤 User: @${jidNumber(actor) || "Unknown"}`,
        "❌ Message deleted",
      ].join("\n"),
      mentions: actor ? [actor] : [],
    };
  }

  return {
    text: [
      "🗑️ *AntiDelete*",
      `👤 User: @${jidNumber(actor || remoteJid) || "Unknown"}`,
      "❌ Message deleted",
    ].join("\n"),
    mentions: actor ? [actor] : [],
  };
}

async function recoverMessage(
  conn,
  ownerJid,
  rawMessage
) {
  if (!conn || !ownerJid || !rawMessage) {
    return false;
  }

  const viewOnce =
    getViewOnceInfo(rawMessage);

  const normalMedia =
    getNormalMediaInfo(rawMessage);

  /*
   * TEXT
   */
  const text = getText(rawMessage);

  if (text !== null) {
    await conn.sendMessage(ownerJid, {
      text,
    });

    return true;
  }

  /*
   * MEDIA
   *
   * Same downloader is used for normal + View Once.
   * updateMediaMessage is supplied so WhatsApp can
   * re-upload media when the old media URL is gone.
   */
  const media =
    viewOnce || normalMedia;

  if (!media) {
    return false;
  }

  let buffer;

  try {
    buffer = await downloadMediaMessage(
      rawMessage,
      "buffer",
      {},
      {
        logger: mediaLogger,
        reuploadRequest:
          conn.updateMediaMessage?.bind(conn),
      }
    );
  } catch (error) {
    console.log(
      "⚠️ AntiDelete media recovery failed:",
      error?.message || error
    );

    return false;
  }

  if (!buffer) {
    return false;
  }

  const content = media.content;

  if (media.type === "image") {
    await conn.sendMessage(ownerJid, {
      image: buffer,
      caption: content?.caption || "",
    });

    return true;
  }

  if (media.type === "video") {
    await conn.sendMessage(ownerJid, {
      video: buffer,
      caption: content?.caption || "",
    });

    return true;
  }

  if (media.type === "audio") {
    await conn.sendMessage(ownerJid, {
      audio: buffer,
      mimetype:
        content?.mimetype ||
        "audio/mp4",
      ptt: content?.ptt === true,
    });

    return true;
  }

  if (media.type === "document") {
    await conn.sendMessage(ownerJid, {
      document: buffer,
      mimetype:
        content?.mimetype ||
        "application/octet-stream",
      fileName:
        content?.fileName ||
        "recovered-document",
      caption:
        content?.caption || "",
    });

    return true;
  }

  return false;
}

function extractDeleteInfo(update) {
  if (!update) return null;

  const targetKey = update?.key;
  const inner = update?.update;

  /*
   * Baileys revoke update.
   */
  const isRevoke =
    inner?.messageStubType === 0 ||
    inner?.messageStubType === "REVOKE" ||
    inner?.message === null;

  if (
    isRevoke &&
    targetKey?.remoteJid &&
    targetKey?.id
  ) {
    return {
      targetKey,
      actorKey: inner?.key || null,
    };
  }

  /*
   * Protocol revoke fallback.
   */
  const protocol =
    inner?.message?.protocolMessage ||
    update?.message?.protocolMessage ||
    update?.protocolMessage;

  if (
    protocol?.type === 0 &&
    protocol?.key?.remoteJid &&
    protocol?.key?.id
  ) {
    return {
      targetKey: protocol.key,
      actorKey: update?.key || null,
    };
  }

  return null;
}

export async function handleDeletedMessage(
  conn,
  update,
  sessionId = "default"
) {
  try {
    if (!(await isAntiDeleteEnabled())) {
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

    if (alreadyProcessed(cacheKey)) {
      return false;
    }

    const original =
      msgCache.get(cacheKey);

    if (!original) {
      console.log(
        "⚠️ AntiDelete: original message not in cache:",
        cacheKey
      );

      return false;
    }

    const ownerJid =
      getOwnerJid(conn);

    if (!ownerJid) {
      return false;
    }

    const isViewOnce =
      Boolean(
        getViewOnceInfo(original)
      );

    /*
     * CRITICAL RULE:
     *
     * Recovery MUST succeed first.
     *
     * If View Once recovery fails:
     * ZERO notification.
     * ZERO fake text.
     * ZERO media.
     */
    let recovered = false;

    try {
      recovered =
        await recoverMessage(
          conn,
          ownerJid,
          original
        );
    } catch (error) {
      console.log(
        "⚠️ AntiDelete recovery error:",
        error?.message || error
      );

      recovered = false;
    }

    if (!recovered) {
      if (isViewOnce) {
        console.log(
          "👁️‍🗨️ View Once recovery failed — NO notification."
        );
      } else {
        console.log(
          "⚠️ Message recovery failed — NO notification."
        );
      }

      msgCache.delete(cacheKey);
      return false;
    }

    /*
     * Only AFTER successful recovery:
     * send notification.
     */
    try {
      const notification =
        await makeNotification(
          conn,
          targetKey,
          info
        );

      await conn.sendMessage(
        ownerJid,
        notification
      );
    } catch (error) {
      console.log(
        "⚠️ AntiDelete notification error:",
        error?.message || error
      );
    }

    msgCache.delete(cacheKey);

    console.log(
      `✅ AntiDelete recovered [${sessionId}] ${targetKey.id}`
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

/*
 * .antidelete on/off/status
 * Owner only.
 * Global setting.
 */
command(
  {
    pattern: "antidelete",
    fromMe: true,
    desc: "Enable, disable or check AntiDelete",
    type: "misc",
  },
  async (message, conn) => {
    const args =
      String(message?.body || "")
        .trim()
        .split(/\s+/)
        .slice(1)
        .join(" ")
        .toLowerCase();

    if (
      args === "on" ||
      args === "enable"
    ) {
      await setAntiDelete(true);

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
      await setAntiDelete(false);

      return replyOk(
        conn,
        message,
        "AntiDelete is OFF 🔴 globally."
      );
    }

    return reply(
      conn,
      message,
      (await isAntiDeleteEnabled())
        ? "✅ AntiDelete is ON 🟢 globally."
        : "❌ AntiDelete is OFF 🔴 globally."
    );
  }
);
