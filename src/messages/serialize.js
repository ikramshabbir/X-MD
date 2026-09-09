import { normalizeMessageContent } from "baileys";

/**
 * Message type -> simplified type
 */
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


/**
 * Message wrappers used by WhatsApp.
 */
const WRAPPER_KEYS = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "templateMessage",
];


/**
 * Detect message type.
 */
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


/**
 * Unwrap WhatsApp message.
 *
 * Baileys already provides normalizeMessageContent(),
 * so we use it first and then handle remaining wrappers.
 */
function unwrapMessage(message) {
    if (!message) {
        return null;
    }

    let current = message;

    /**
     * Baileys normalizer.
     */
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

    /**
     * Additional wrapper handling.
     */
    for (let i = 0; i < 6 && current; i++) {
        let foundWrapper = false;

        for (const wrapper of WRAPPER_KEYS) {
            if (current?.[wrapper]?.message) {
                current = current[wrapper].message;
                foundWrapper = true;
                break;
            }
        }

        if (!foundWrapper) {
            break;
        }
    }

    return current;
}


/**
 * Extract text from message content.
 */
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


/**
 * Extract quoted message.
 */
function extractQuotedMessage(contextInfo) {
    if (!contextInfo?.quotedMessage) {
        return null;
    }

    const quotedRaw = unwrapMessage(
        contextInfo.quotedMessage
    );

    if (!quotedRaw) {
        return null;
    }

    const {
        key: quotedTypeKey,
        mime: quotedMime,
    } = getMessageMimeType(quotedRaw);

    if (quotedMime === "unknown") {
        return null;
    }

    const content = quotedRaw[quotedTypeKey];

    return {
        type: quotedMime,

        messageTypeKey: quotedTypeKey,

        text: getBody(
            content,
            quotedTypeKey
        ),

        caption:
            content?.caption || "",

        mimetype:
            content?.mimetype || "",

        raw: quotedRaw,
    };
}


/**
 * Get sender information.
 *
 * Supports:
 * - normal WhatsApp JID
 * - LID
 * - groups
 * - fromMe messages
 */
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


/**
 * Serialize Baileys message.
 *
 * IMPORTANT:
 * connection.js calls:
 *
 *     serialize(conn, rawMessage)
 *
 * Therefore the argument order here MUST be:
 *
 *     serialize(conn, message)
 */
async function serialize(conn, message) {
    /**
     * Validate connection.
     */
    if (!conn) {
        console.log(
            "⚠️ Serialize: connection missing"
        );

        return null;
    }

    /**
     * Validate raw WhatsApp message.
     */
    if (!message) {
        console.log(
            "⚠️ Serialize: message missing"
        );

        return null;
    }

    /**
     * Validate message key.
     */
    if (!message?.key) {
        console.log(
            "⚠️ Serialize: message key missing"
        );

        return null;
    }

    /**
     * Validate remote JID.
     */
    if (!message?.key?.remoteJid) {
        console.log(
            "⚠️ Serialize: missing remoteJid"
        );

        return null;
    }

    /**
     * Protocol messages are internal WhatsApp events.
     *
     * Do not send them to command handler.
     */
    if (message?.message?.protocolMessage) {
        return null;
    }

    /**
     * Message content must exist.
     */
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

    /**
     * Normalize / unwrap message.
     */
    const unwrapped =
        unwrapMessage(message.message);

    if (!unwrapped) {
        console.log(
            "⚠️ Serialize: unable to unwrap message"
        );

        return null;
    }

    /**
     * Detect actual content type.
     */
    const {
        key: messageTypeKey,
        mime: messageMime,
    } = getMessageMimeType(unwrapped);

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

    /**
     * Actual message content.
     */
    const messageContent =
        unwrapped[messageTypeKey];

    /**
     * Group check.
     */
    const isGroup =
        key.remoteJid.endsWith("@g.us");

    /**
     * Chat JID.
     */
    const from =
        key.remoteJid;

    /**
     * Alternative JID / LID.
     */
    const fromAlt =
        key.remoteJidAlt || null;

    /**
     * Sender information.
     */
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

    /**
     * Context information.
     */
    const contextInfo =
        messageContent?.contextInfo ||
        messageContent?.contextInfoV2 ||
        null;

    /**
     * Quoted message.
     */
    const quoted =
        extractQuotedMessage(
            contextInfo
        );

    /**
     * Message body.
     */
    const body =
        getBody(
            messageContent,
            messageTypeKey
        );

    /**
     * Final serialized message.
     */
    return {
        /**
         * Original Baileys key.
         */
        key,

        /**
         * Message ID.
         */
        id:
            key.id || "",

        /**
         * WhatsApp push name.
         */
        pushName:
            pushName || "",

        /**
         * Group or private chat.
         */
        isGroup,

        /**
         * Chat JID.
         */
        from,

        /**
         * Alternative JID / LID.
         */
        fromAlt,

        /**
         * Simplified type:
         * text/image/video/etc.
         */
        type:
            messageMime,

        /**
         * Actual message content.
         */
        message:
            messageContent,

        /**
         * Original WhatsApp message type.
         */
        messageTypeKey,

        /**
         * Unwrapped raw content.
         */
        rawMessage:
            unwrapped,

        /**
         * Text / caption.
         */
        body,

        /**
         * Quoted message.
         */
        quoted,

        /**
         * Group participant.
         */
        participant,

        /**
         * Alternative participant.
         */
        participantAlt,

        /**
         * Sender JID.
         */
        sender,

        /**
         * Whether message was sent by bot.
         */
        isBotMessage,

        /**
         * Original complete Baileys message.
         */
        originalMessage:
            message,
    };
}


export {
    serialize,
};
