/**
 * Non-command group moderation guards
 * mute / antilink / antispam / status mentions
 */

import {
  shouldBlockGroupMessage,
  tryDeleteMessage,
} from "../utils/moderation.js";

import {
  isPrivileged,
  normalizeNumber,
} from "../utils/access.js";

import { t } from "../utils/i18n.js";

import {
  isAdmin,
  isBotAdmin,
} from "../utils/group.js";

import { groupCache } from "../utils/cache.js";

import {
  addWarn,
  resetWarns,
} from "../utils/groupSettings.js";

/**
 * @returns {Promise<boolean>}
 * true = message should not continue to command handler
 */
export async function processGroupGuards({
  message,
  conn,
}) {
  if (!message?.isGroup) return false;
  if (message.key?.fromMe) return false;

  const privileged =
    await isPrivileged(
      message,
      conn
    );

  /*
   * Get group metadata
   */
  let meta =
    groupCache.get(
      message.from
    );

  if (!meta) {
    try {
      meta =
        await conn.groupMetadata(
          message.from
        );

      groupCache.set(
        message.from,
        meta
      );
    } catch {
      meta = null;
    }
  }

  /*
   * Check admin
   */
  const admin =
    meta &&
    (
      isAdmin(
        meta,
        message.sender
      ) ||
      isAdmin(
        meta,
        message.participant
      ) ||
      isAdmin(
        meta,
        message.participantAlt
      )
    );

  /*
   * Check moderation rules
   */
  const result =
    await shouldBlockGroupMessage(
      message,
      conn
    );

  if (!result.block) {
    return false;
  }

  /*
   * Admins / privileged users
   * bypass antilink, antispam and
   * status mention protection.
   *
   * Mute remains explicit.
   */
  if (
    result.reason !== "MUTED" &&
    (
      privileged ||
      admin
    )
  ) {
    return false;
  }

  /*
   * Delete message when possible.
   */
  if (
    result.deleteMsg &&
    meta &&
    isBotAdmin(
      meta,
      conn
    )
  ) {
    await tryDeleteMessage(
      conn,
      message
    );
  }

  /*
   * STATUS MENTION
   *
   * 1st violation:
   * WARNING (1/2)
   *
   * 2nd violation:
   * REMOVE USER
   */
  if (
    result.reason ===
    "STATUS_MENTION"
  ) {
    try {
      const user =
        normalizeNumber(
          message.sender
        );

      if (!user) {
        return true;
      }

      const count =
        await addWarn(
          message.from,
          user
        );

      const limit =
        result.settings
          ?.warnLimit || 2;

      /*
       * Second warning = remove
       */
      if (
        count >= limit
      ) {
        await resetWarns(
          message.from,
          user
        );

        /*
         * Bot must be admin
         */
        if (
          meta &&
          isBotAdmin(
            meta,
            conn
          )
        ) {
          try {
            await conn.groupParticipantsUpdate(
              message.from,
              [message.sender],
              "remove"
            );

            await conn.sendMessage(
              message.from,
              {
                text:
                  "🚫 User removed for repeated status mentions.",
              }
            );
          } catch (error) {
            console.error(
              "❌ Failed to remove status mention violator:",
              error?.message ||
                error
            );
          }
        } else {
          /*
           * Bot is not admin
           */
          try {
            await conn.sendMessage(
              message.from,
              {
                text:
                  "⚠️ I need admin permission to remove the user.",
              }
            );
          } catch {}
        }
      } else {
        /*
         * First warning
         */
        try {
          await conn.sendMessage(
            message.from,
            {
              text:
                `⚠️ WARNING (${count}/${limit})\n\n` +
                `*Status mentions are not allowed in this group*\n` +
                `> *Next time you will be removed*`,
            }
          );
        } catch {}
      }
    } catch (error) {
      console.error(
        "❌ Status mention guard error:",
        error?.message ||
          error
      );
    }

    return true;
  }

  /*
   * Anti-link
   */
  if (
    result.reason ===
    "ANTILINK"
  ) {
    try {
      await conn.sendMessage(
        message.from,
        {
          text:
            await t(
              "ANTILINK"
            ),
        }
      );
    } catch {
      /* ignore */
    }

    return true;
  }

  /*
   * Anti-spam
   */
  if (
    result.reason ===
    "ANTISPAM"
  ) {
    try {
      await conn.sendMessage(
        message.from,
        {
          text:
            await t(
              "ANTISPAM"
            ),
        }
      );
    } catch {
      /* ignore */
    }

    return true;
  }

  /*
   * Muted user
   */
  if (
    result.reason ===
    "MUTED"
  ) {
    // Silent delete if possible.
    // Do not route commands.
    return true;
  }

  return true;
}
