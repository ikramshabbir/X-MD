/**
 * Social downloaders — best-effort IG / TikTok / FB via HTTP
 * Scrapers break often; fail friendly.
 */

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";
import { assertVideoSize, assertAudioSize } from "../utils/media.js";

function pickUrl(message, patterns) {
  for (const p of patterns) {
    const args = getCommandArgs(message.body, p);
    if (args) return args.trim().split(/\s+/)[0];
  }
  const text = message.quoted?.text || "";
  const m = String(text).match(/https?:\/\/\S+/);
  return m ? m[0] : "";
}

async function downloadBuffer(url, maxBytes) {
  const axios = (await import("axios")).default;
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 90_000,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  return Buffer.from(res.data);
}

async function sendMediaUrl(conn, message, mediaUrl, caption = "") {
  const axios = (await import("axios")).default;
  const head = await axios
    .head(mediaUrl, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      validateStatus: () => true,
      maxRedirects: 5,
    })
    .catch(() => null);

  const ctype = (head?.headers?.["content-type"] || "").toLowerCase();
  const buf = await downloadBuffer(mediaUrl, 60 * 1024 * 1024);

  if (ctype.includes("image") || /\.(jpe?g|png|webp)(\?|$)/i.test(mediaUrl)) {
    await conn.sendMessage(
      message.from,
      { image: buf, caption },
      { quoted: { key: message.key, message: message.message } }
    );
    return;
  }

  if (ctype.includes("audio")) {
    assertAudioSize(buf.length);
    await conn.sendMessage(
      message.from,
      { audio: buf, mimetype: ctype || "audio/mpeg" },
      { quoted: { key: message.key, message: message.message } }
    );
    return;
  }

  assertVideoSize(buf.length);
  await conn.sendMessage(
    message.from,
    { video: buf, caption, mimetype: "video/mp4" },
    { quoted: { key: message.key, message: message.message } }
  );
}

/**
 * Try tikwm API for TikTok
 */
async function fetchTikTok(url) {
  const axios = (await import("axios")).default;
  const res = await axios.get("https://www.tikwm.com/api/", {
    params: { url, hd: 1 },
    timeout: 30_000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const data = res.data?.data;
  if (!data) throw new Error("TikTok fetch returned no data.");
  const media =
    data.hdplay || data.play || data.wmplay || data.images?.[0];
  if (!media) throw new Error("No downloadable media found.");
  return {
    mediaUrl: media,
    caption: data.title ? `🎵 ${data.title}` : "TikTok",
    images: data.images || null,
  };
}

/**
 * Best-effort Instagram via public saveig-style endpoints / oEmbed fallback
 */
async function fetchInstagram(url) {
  const timeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out.`)), ms)
      ),
    ]);

  const errors = [];

  // Primary: btch-downloader
  try {
    const { igdl } = await import("btch-downloader");
    const result = await timeout(igdl(url), 25_000, "Instagram downloader");

    const items = Array.isArray(result)
      ? result
      : Array.isArray(result?.result)
      ? result.result
      : Array.isArray(result?.data)
      ? result.data
      : [];

    const media = items.find(
      (item) =>
        item &&
        typeof (item.url || item.download || item.media) === "string" &&
        /^https?:\/\//i.test(item.url || item.download || item.media)
    );

    if (media) {
      return {
        mediaUrl: media.url || media.download || media.media,
        caption: "📸 Instagram",
      };
    }

    if (typeof result?.url === "string" && /^https?:\/\//i.test(result.url)) {
      return {
        mediaUrl: result.url,
        caption: "📸 Instagram",
      };
    }

    errors.push("btch returned no media");
  } catch (err) {
    errors.push(err?.message || "btch failed");
  }

  // Fallback: existing Tio endpoint
  try {
    const axios = (await import("axios")).default;

    const response = await timeout(
      axios.get("https://backend1.tioo.eu.org/igdl", {
        params: { url },
        timeout: 20_000,
        validateStatus: () => true,
      }),
      25_000,
      "Instagram API"
    );

    const data = response.data;
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.result)
      ? data.result
      : Array.isArray(data?.data)
      ? data.data
      : [];

    const media = items.find(
      (item) =>
        item &&
        typeof item.url === "string" &&
        /^https?:\/\//i.test(item.url)
    );

    if (media?.url) {
      return {
        mediaUrl: media.url,
        caption: "📸 Instagram",
      };
    }

    throw new Error("API returned no media");
  } catch (err) {
    errors.push(err?.message || "fallback failed");
  }

  throw new Error(
    `Instagram download failed. ${errors.slice(-2).join(" | ")}`
  );
}

async function fetchFacebook(url) {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const { spawn } = await import("child_process");

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "xmd-facebook-")
  );

  const ytdlpOutput = path.join(tempDir, "facebook-source.%(ext)s");
  const finalFile = path.join(tempDir, "facebook.mp4");

  const run = (command, args) =>
    new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        reject(new Error(`${command} could not start: ${err.message}`));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              stderr.trim().split("\n").slice(-5).join(" ") ||
                `${command} exited with code ${code}`
            )
          );
        }
      });
    });

  try {
    // Download Facebook video + audio.
    await run("yt-dlp", [
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout", "20",
      "--retries", "2",
      "--fragment-retries", "2",
      "-f", "bestvideo*+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", ytdlpOutput,
      url,
    ]);

    const files = await fs.readdir(tempDir);

    const sourceFile = files.find(
      (file) =>
        /^facebook-source\./i.test(file) &&
        /\.(mp4|mkv|webm|mov)$/i.test(file)
    );

    if (!sourceFile) {
      throw new Error("Facebook video download completed but source file was not found.");
    }

    const sourcePath = path.join(tempDir, sourceFile);

    // Convert AV1/other codecs to WhatsApp-compatible H.264 + AAC.
    await run("ffmpeg", [
      "-y",
      "-i", sourcePath,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-profile:v", "main",
      "-level", "4.0",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      finalFile,
    ]);

    return {
      filePath: finalFile,
      tempDir,
      caption: "📘 Facebook",
    };
  } catch (err) {
    await fs.rm(tempDir, {
      recursive: true,
      force: true,
    }).catch(() => {});

    throw err;
  }
}

async function igHandler(message, conn) {
  const url = pickUrl(message, ["ig", "insta"]);

  if (!url || !/instagram\.com/i.test(url)) {
    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}ig <instagram url>\``
    );
    return;
  }

  await withTyping(
    conn,
    message.from,
    async () => {
      try {
        const result = await fetchInstagram(url);
        await sendMediaUrl(
          conn,
          message,
          result.mediaUrl,
          result.caption
        );
      } catch (err) {
        await replyFail(
          conn,
          message,
          err?.message || "Instagram download failed."
        );
      }
    },
    { timeoutMs: 90_000 }
  );
}

command(
  {
    pattern: "ig",
    fromMe: false,
    desc: "Download Instagram media (best-effort)",
    type: "media",
  },
  igHandler
);

command(
  {
    pattern: "insta",
    fromMe: false,
    desc: "Alias for ig",
    type: "media",
    dontAddCommandList: true,
  },
  igHandler
);

async function ttHandler(message, conn) {
  const url = pickUrl(message, ["tiktok", "tt"]);
  if (!url || !/tiktok\.com|vm\.tiktok\.com/i.test(url)) {
    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}tiktok <url>\``
    );
    return;
  }
  await withTyping(conn, message.from, async () => {
    try {
      const result = await fetchTikTok(url);
      if (result.images?.length) {
        for (const img of result.images.slice(0, 5)) {
          await sendMediaUrl(conn, message, img, result.caption);
        }
        return;
      }
      await sendMediaUrl(conn, message, result.mediaUrl, result.caption);
    } catch (err) {
      await replyFail(
        conn,
        message,
        err?.message ||
          "TikTok download failed. The free API may be down — try later."
      );
    }
  }, { timeoutMs: 90_000 });
}

command(
  {
    pattern: "tiktok",
    fromMe: false,
    desc: "Download TikTok video (best-effort)",
    type: "media",
  },
  ttHandler
);

command(
  {
    pattern: "tt",
    fromMe: false,
    desc: "Alias for tiktok",
    type: "media",
    dontAddCommandList: true,
  },
  ttHandler
);

command(
  {
    pattern: "fb",
    fromMe: false,
    desc: "Download Facebook media (yt-dlp)",
    type: "media",
  },
  async (message, conn) => {
    const url = pickUrl(message, ["fb"]);

    if (!url || !/facebook\.com|fb\.watch/i.test(url)) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}fb <facebook url>\``
      );
      return;
    }

    await withTyping(
      conn,
      message.from,
      async () => {
        let result;

        try {
          result = await fetchFacebook(url);

          const fs = await import("fs/promises");
          const buffer = await fs.readFile(result.filePath);

          assertVideoSize(buffer.length);

          await conn.sendMessage(
            message.from,
            {
              video: buffer,
              caption: result.caption,
              mimetype: "video/mp4",
            },
            {
              quoted: {
                key: message.key,
                message: message.message,
              },
            }
          );
        } catch (err) {
          await replyFail(
            conn,
            message,
            err?.message ||
              "Facebook download failed."
          );
        } finally {
          if (result?.tempDir) {
            const fs = await import("fs/promises");
            await fs.rm(result.tempDir, {
              recursive: true,
              force: true,
            }).catch(() => {});
          }
        }
      },
      { timeoutMs: 120_000 }
    );
  }
);

