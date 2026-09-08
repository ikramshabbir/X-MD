/**
 * Anti-spam / anti-link / status mention helpers + mute checks
 */

import { normalizeNumber } from "./access.js";
import { getGroupSettings } from "./groupSettings.js";

/** senderKey → timestamps[] */
const spamBuckets = new Map();

const URL_RE =
  /(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|t\.me\/)[^\s]+/gi;

export function extractLinks(text) {
  if (!text) return [];
  return text.match(URL_RE) || [];
}

/**
 * Returns true if this message should be treated as spam
 */
export function checkSpam(
  senderKey,
  limit = 5,
  windowMs = 8000
) {
  const now = Date.now();

  let arr =
    spamBuckets.get(senderKey) || [];

  arr = arr.filter(
    (t) => now - t < windowMs
  );

  arr.push(now);

  spamBuckets.set(
    senderKey,
    arr
  );

  return arr.length > limit;
}

/**
 * Detect WhatsApp Status Mention messages.
 */
export function isStatusMention(message) {
  if (!message) return false;

  const msg =
    message.message ||
    message.raw?.message ||
    message.key?.message;

  if (!msg) return false;

  return !!(
    msg.statusMentionMessage ||
    msg.statusMentionMessageV2
  );
}

export function isUserMuted(
  settings,
  message
) {
  const muted =
    settings.muted || [];

  if (!muted.length) return false;

  const candidates = [
    normalizeNumber(
      message.sender
    ),
    normalizeNumber(
      message.participant
    ),
    normalizeNumber(
      message.participantAlt
    ),
  ].filter(Boolean);

  return muted.some(
    (m) =>
      candidates.includes(
        normalizeNumber(m)
      )
  );
}

export async function shouldBlockGroupMessage(
  message,
  conn
) {
  if (!message?.isGroup) {
    return { block: false };
  }

  const settings =
    await getGroupSettings(
      message.from
    );

  /*
   * Mute
   */
  if (
    isUserMuted(
      settings,
      message
    )
  ) {
    return {
      block: true,
      reason: "MUTED",
      settings,
      deleteMsg: true,
    };
  }

  /*
   * Status Mention
   */
  if (
    isStatusMention(message) &&
    !message.key?.fromMe
  ) {
    return {
      block: true,
      reason: "STATUS_MENTION",
      settings,
      deleteMsg: true,
    };
  }

  /*
   * Anti-spam
   */
  if (
    settings.antispam &&
    !message.key?.fromMe
  ) {
    const key = `${
      message.from
    }:${
      normalizeNumber(
        message.sender
      ) ||
      message.sender
    }`;

    if (
      checkSpam(
        key,
        settings.antispamLimit,
        settings.antispamWindowMs
      )
    ) {
      return {
        block: true,
        reason: "ANTISPAM",
        settings,
        deleteMsg: true,
      };
    }
  }

  /*
   * Anti-link
   */
  if (
    settings.antilink &&
    message.body &&
    !message.key?.fromMe
  ) {
    const links =
      extractLinks(
        message.body
      );

    if (links.length) {
      return {
        block: true,
        reason: "ANTILINK",
        settings,
        deleteMsg: true,
      };
    }
  }

  return {
    block: false,
    settings,
  };
}

/**
 * Delete a message if possible.
 */
export async function tryDeleteMessage(
  conn,
  message
) {
  try {
    await conn.sendMessage(
      message.from,
      {
        delete: message.key,
      }
    );
  } catch {
    /* may lack admin */
  }
}
