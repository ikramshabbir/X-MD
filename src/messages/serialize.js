import { normalizeMessageContent } from "baileys";

const MIME_TYPE_MAP = {
  conversation: "text",
  extendedTextMessage: "text",

  imageMessage: "image",
  videoMessage: "video",
  stickerMessage: "sticker",

  documentMessage: "document",
  documentWithCaptionMessage: "document",

  audioMessage: "audio",

  viewOnceMessage: "message",
  viewOnceMessageV2: "message",
  viewOnceMessageV2Extension: "message",

  templateMessage: "text",

  buttonsResponseMessage: "text",
  listResponseMessage: "text",
  templateButtonReplyMessage: "text",

  locationMessage: "location",
  liveLocationMessage: "location",

  contactMessage: "contact",
  contactsArrayMessage: "contact",

  reactionMessage: "reaction",

  pollCreationMessage: "poll",
  pollUpdateMessage: "poll",
};

const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "templateMessage",
];

function getMessageMimeType(message) {
  if (!message || typeof message !== "object") {
    return {
      key: "unknown",
      mime: "unknown",
    };
  }

  for (const key of Object.keys(message)) {
    if (MIME_TYPE_MAP[key]) {
      return {
        key,
        mime: MIME_TYPE_MAP[key],
      };
    }
  }

  return {
    key: "unknown",
    mime: "unknown",
  };
}

function unwrapMessage(message) {
  if (!message) return null;

  let current = message;

  try {
    const normalized = normalizeMessageContent(current);

    if (normalized) {
      current = normalized;
    }
  } catch (error) {
    console.log(
      "⚠️ normalizeMessageContent error:",
      error?.message || error
    );
  }

  for (let i = 0; i < 6 && current; i++) {
    let foundWrapper = false;

    for (const wrapper of WRAPPER_KEYS) {
      if (current?.[wrapper]?.message) {
        current = current[wrapper].message;
        foundWrapper = true;
        break;
      }
    }

    if (!foundWrapper) break;
  }

  return current;
}

function getBody(content, typeKey) {
  if (typeKey === "conversation") {
    return typeof content === "string"
      ? content
      : "";
  }

  if (!content || typeof content !== "object") {
    return "";
  }

  return (
    content.text ||
    content.caption ||
    content.selectedDisplayText ||
    content.title ||
    content.description ||
    ""
  );
}

function isViewOnceMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  return Boolean(
    message.viewOnceMessage ||
    message.viewOnceMessageV2 ||
    message.viewOnceMessageV2Extension ||
    message.imageMessage?.viewOnce ||
    message.videoMessage?.viewOnce ||
    message.audioMessage?.viewOnce ||
    message.documentMessage?.viewOnce
  );
}

function extractQuotedMessage(contextInfo) {
  if (!contextInfo?.quotedMessage) {
    return null;
  }

  const originalQuoted =
    contextInfo.quotedMessage;

  const quotedRaw =
    unwrapMessage(originalQuoted);

  if (!quotedRaw) {
    return null;
  }

  const {
    key: quotedTypeKey,
    mime: quotedMime,
  } = getMessageMimeType(quotedRaw);

  if (
    quotedTypeKey === "unknown" ||
    quotedMime === "unknown"
  ) {
    return null;
  }

  const content =
    quotedRaw[quotedTypeKey];

  return {
    type: quotedMime,

    messageTypeKey:
      quotedTypeKey,

    text:
      getBody(
        content,
        quotedTypeKey
      ),

    caption:
      content?.caption || "",

    mimetype:
      content?.mimetype || "",

    raw:
      quotedRaw,

    /**
     * Complete quoted content before
     * normalize/unwrap.
     */
    originalMessage:
      originalQuoted,

    /**
     * Used by .vv
     */
    isViewOnce:
      isViewOnceMessage(
        originalQuoted
      ),

    /**
     * Message ID of quoted message.
     */
    stanzaId:
      contextInfo?.stanzaId || null,

    participant:
      contextInfo?.participant || null,

    participantAlt:
      contextInfo?.participantAlt || null,
  };
}

function getSenderInfo(key, isGroup, conn) {
  const isBotMessage =
    key?.fromMe === true &&
    !key?.participant;

  if (isGroup) {
    const participant =
      key?.participant || null;

    const participantAlt =
      key?.participantAlt || null;

    const sender = isBotMessage
      ? conn?.user?.id || null
      : participantAlt ||
        participant ||
        null;

    return {
      participant,
      participantAlt,
      sender,
      isBotMessage,
    };
  }

  const participant =
    key?.remoteJid || null;

  const participantAlt =
    key?.remoteJidAlt || null;

  const sender = key?.fromMe
    ? conn?.user?.id || participant
    : participantAlt ||
      participant;

  return {
    participant,
    participantAlt,
    sender,
    isBotMessage,
  };
}

async function serialize(conn, message) {
  if (!conn) {
    console.log(
      "⚠️ Serialize: connection missing"
    );
    return null;
  }

  if (!message) {
    console.log(
      "⚠️ Serialize: message missing"
    );
    return null;
  }

  if (!message?.key) {
    console.log(
      "⚠️ Serialize: message key missing"
    );
    return null;
  }

  if (!message?.key?.remoteJid) {
    console.log(
      "⚠️ Serialize: missing remoteJid"
    );
    return null;
  }

  if (message?.message?.protocolMessage) {
    return null;
  }

  if (!message?.message) {
    console.log(
      "⚠️ Serialize: missing message content"
    );
    return null;
  }

  const {
    key,
    pushName,
  } = message;

  const originalContent =
    message.message;

  const viewOnce =
    isViewOnceMessage(
      originalContent
    );

  const unwrapped =
    unwrapMessage(
      originalContent
    );

  if (!unwrapped) {
    console.log(
      "⚠️ Serialize: unable to unwrap message"
    );
    return null;
  }

  const {
    key: messageTypeKey,
    mime: messageMime,
  } = getMessageMimeType(
    unwrapped
  );

  if (
    messageTypeKey === "unknown" ||
    messageMime === "unknown"
  ) {
    console.log(
      "⚠️ Serialize: unknown message type:",
      Object.keys(unwrapped)
    );

    return null;
  }

  const messageContent =
    unwrapped[messageTypeKey];

  const isGroup =
    key.remoteJid.endsWith("@g.us");

  const from =
    key.remoteJid;

  const fromAlt =
    key.remoteJidAlt || null;

  const {
    participant,
    participantAlt,
    sender,
    isBotMessage,
  } = getSenderInfo(
    key,
    isGroup,
    conn
  );

  const contextInfo =
    messageContent?.contextInfo ||
    messageContent?.contextInfoV2 ||
    null;

  const quoted =
    extractQuotedMessage(
      contextInfo
    );

  const body =
    getBody(
      messageContent,
      messageTypeKey
    );

  return {
    key,

    id:
      key.id || "",

    pushName:
      pushName || "",

    isGroup,

    from,

    fromAlt,

    type:
      messageMime,

    message:
      messageContent,

    messageTypeKey,

    rawMessage:
      unwrapped,

    /**
     * Original complete WAMessage
     */
    originalMessage:
      message,

    /**
     * True when this incoming message
     * itself is View Once.
     */
    isViewOnce:
      viewOnce,

    body,

    quoted,

    participant,

    participantAlt,

    sender,

    isBotMessage,
  };
}

export {
  serialize,
  unwrapMessage,
  getMessageMimeType,
  isViewOnceMessage,
};
