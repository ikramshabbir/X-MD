import { normalizeMessageContent } from "baileys";

const MIME_TYPE_MAP = {
    conversation: "text",
    extendedTextMessage: "text",
    imageMessage: "image",
    videoMessage: "video",
    stickerMessage: "sticker",
    documentMessage: "document",
    audioMessage: "audio",
    documentWithCaptionMessage: "document",
    viewOnceMessage: "image",
    viewOnceMessageV2: "image",
    viewOnceMessageV2Extension: "image",
    templateMessage: "text",
    buttonsResponseMessage: "text",
    listResponseMessage: "text",
    templateButtonReplyMessage: "text",
    interactiveResponseMessage: "text",
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

/**
 * Unwrap Baileys message wrappers.
 * First uses Baileys' own normalizer, then handles remaining wrappers.
 */
function unwrapMessage(msg) {
    if (!msg) return null;

    let current = msg;

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
        let unwrapped = false;

        for (const key of WRAPPER_KEYS) {
            if (current?.[key]?.message) {
                current = current[key].message;
                unwrapped = true;
                break;
            }
        }

        if (!unwrapped) break;
    }

    return current;
}

function extractTextFromContent(content, messageTypeKey) {
    if (messageTypeKey === "conversation") {
        return typeof content === "string" ? content : "";
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

function extractQuotedMessage(contextInfo) {
    if (!contextInfo?.quotedMessage) {
        return null;
    }

    const unwrapped = unwrapMessage(contextInfo.quotedMessage);

    if (!unwrapped) {
        return null;
    }

    const {
        key: quotedKey,
        mime,
    } = getMessageMimeType(unwrapped);

    if (mime === "unknown") {
        return null;
    }

    let content = unwrapped[quotedKey];

    if (content?.message) {
        const nested = unwrapMessage(content.message);

        if (nested) {
            const {
                key: nestedKey,
                mime: nestedMime,
            } = getMessageMimeType(nested);

            if (nestedMime !== "unknown") {
                content = nested[nestedKey];

                return normalizeQuoted(
                    content,
                    nestedMime,
                    nestedKey,
                    nested
                );
            }
        }
    }

    return normalizeQuoted(
        content,
        mime,
        quotedKey,
        unwrapped
    );
}

function normalizeQuoted(
    content,
    mime,
    messageTypeKey,
    raw
) {
    if (mime === "text") {
        const text =
            typeof content === "string"
                ? content
                : extractTextFromContent(
                      content,
                      messageTypeKey
                  );

        return {
            type: "text",
            text,
            caption: content?.caption,
            messageTypeKey,
            raw,
            mimetype: content?.mimetype,
        };
    }

    return {
        ...(typeof content === "object" && content
            ? content
            : {}),

        type: mime,

        text:
            typeof content === "object"
                ? content?.caption ||
                  content?.text ||
                  ""
                : "",

        caption: content?.caption,
        mimetype: content?.mimetype,
        messageTypeKey,
        raw,
    };
}

/**
 * Determines sender information with LID / PN support.
 */
function getSenderInfo(key, isGroup, conn) {
    const isBotMessage =
        key.fromMe === true &&
        !key.participant;

    if (isGroup) {
        const participant =
            key.participant || null;

        const participantAlt =
            key.participantAlt || null;

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
        key.remoteJid || null;

    const participantAlt =
        key.remoteJidAlt || null;

    const sender = key.fromMe
        ? conn?.user?.id || participant
        : participantAlt || participant;

    return {
        participant,
        participantAlt,
        sender,
        isBotMessage,
    };
}

/**
 * Serialize Baileys 7.x message.
 */
async function serialize(message, conn) {
    if (!message?.key?.remoteJid) {
        console.log(
            "⚠️ Serialize: missing remoteJid"
        );

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

    const unwrapped =
        unwrapMessage(message.message);

    if (!unwrapped) {
        console.log(
            "⚠️ Serialize: unable to unwrap message"
        );

        return null;
    }

    const {
        key: messageTypeKey,
        mime: messageMime,
    } = getMessageMimeType(unwrapped);

    if (messageMime === "unknown") {
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
        extractTextFromContent(
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

        body,

        quoted,

        participant,

        participantAlt,

        sender,

        isBotMessage,

        /**
         * Original Baileys message.
         * Useful for media downloading and advanced handlers.
         */
        originalMessage:
            message,
    };
}

export {
    serialize,
};
