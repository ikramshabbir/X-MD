/**
 * Accessory tools — tomp3, url, quote, fancy, tts, ttp, attp
 */

import { command } from "../plugins.js";
import {
  reply,
  replyFail,
  withTyping,
  getCommandArgs,
} from "../utils/message.js";
import {
  downloadQuotedOrSelf,
  createTempPath,
  safeUnlink,
  writeTempFile,
  toMp3,
  assertAudioSize,
} from "../utils/media.js";
import { MEDIA, BOT_INFO } from "../config/constants.js";
import { readFile, stat } from "fs/promises";

const makeMap = (lower, upper) => {
  const m = {};
  const low = "abcdefghijklmnopqrstuvwxyz";
  const up = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  [...low].forEach((c, i) => {
    m[c] = [...lower][i] ?? c;
  });

  [...up].forEach((c, i) => {
    m[c] = [...upper][i] ?? c;
  });

  return (c) => m[c] ?? c;
};

const transform = (text, fn) => [...text].map(fn).join("");

const addMark = (text, mark) =>
  [...text].map((c) => c + mark).join("");

const reverseMap = {
  a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ",
  f: "ɟ", g: "ƃ", h: "ɥ", i: "ı", j: "ɾ",
  k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o",
  p: "d", q: "b", r: "ɹ", s: "s", t: "ʇ",
  u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ", z: "z",
};

const latinMap = {
  i: "ɨ", k: "ƙ", r: "ɾ", a: "ɑ", m: "ɱ",
};

const birdMap = {
  i: "꒐", k: "ꀘ", r: "ꋪ", a: "ꋫ", m: "ꂵ",
};

const hinaMap = {
  i: "ለ", k: "ሊ", r: "ጎ", a: "ሀ", m: "ጠ",
};

const greekMap = {
  i: "𝛊", k: "𝛋", r: "𝛒", a: "𝛂", m: "𝛍",
};

const cherokeeMap = {
  i: "Ꭵ", k: "Ꮶ", r: "Ꮢ", a: "Ꭺ", m: "Ꮇ",
};

const upsideDown = (text) =>
  [...text]
    .reverse()
    .map((c) => reverseMap[c.toLowerCase()] ?? c)
    .join("");

const mapped = (text, map) =>
  [...text].map((c) => map[c.toLowerCase()] ?? c).join("");

const fullWidth = (text) =>
  [...text]
    .map((c) => {
      const n = c.codePointAt(0);

      if (n >= 33 && n <= 126) {
        return String.fromCodePoint(0xff01 + n - 33);
      }

      if (c === " ") return "　";
      return c;
    })
    .join("");

const circledLower =
  "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ";

const circledUpper =
  "ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ";

const negativeCircleLower =
  "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ";

const negativeCircleUpper =
  "ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ";

const circled = makeMap(circledLower, circledUpper);
const negativeCircled = makeMap(negativeCircleLower, negativeCircleUpper);

const smallCapsMap = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ",
  f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ",
  k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ",
  p: "ᴘ", q: "ǫ", r: "ʀ", s: "s", t: "ᴛ",
  u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ",
};

const fontMaps = {
  bold: makeMap(
    "𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳",
    "𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙"
  ),

  italic: makeMap(
    "𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧",
    "𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍"
  ),

  script: makeMap(
    "𝒶𝒷𝒸𝒹𝑒𝒻𝑔𝒽𝒾𝒿𝓀𝓁𝓂𝓃𝑜𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏",
    "𝒜𝐵𝒞𝒟𝐸𝐹𝒢𝐻𝐼𝒥𝒦𝐿𝑀𝒩𝒪𝒫𝒬𝑅𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵"
  ),

  scriptBold: makeMap(
    "𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃",
    "𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩"
  ),

  fraktur: makeMap(
    "𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷",
    "𝔄𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ"
  ),

  frakturBold: makeMap(
    "𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟",
    "𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅"
  ),

  double: makeMap(
    "𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫",
    "𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ"
  ),

  sansItalic: makeMap(
    "𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻",
    "𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡"
  ),

  sansBold: makeMap(
    "𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯",
    "𝘼𝘽𝘾𝘿𝙀𝙁𝙂𝙃𝙄𝙅𝙆𝙇𝙈𝙉𝙊𝙋𝙌𝙍𝙎𝙏𝙐𝙑𝙒𝙓𝙔𝙕"
  ),

  mono: makeMap(
    "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣",
    "𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉"
  ),
};

const advanced = (text) => [
  [...text].map((c) => `͜${c}͢`).join(""),
  [...text].map((c) => `͡${c}͢`).join(""),
  addMark(text, "፝֟"),
  addMark(text, "֟ؖ۬"),
  addMark(text, "̼̽"),
  [...text].map((c) => `֟ؖ۬͜${c}͢`).join(""),
  addMark(text, "𝅦"),
  [...text].map((c) => `͛${c}̬`).join(""),
  [...text].map((c) => `͜${c}፝֟͢`).join(""),
  [...text].map((c) => `֟ؖ۬͜${c}፝֟͢`).join(""),
  [...text].map((c) => `͜${c}̬͢`).join(""),
];

function fancyText(text) {
  const t = String(text);

  const rows = [
    ["Normal", transform(t, fontMaps.bold)],
    ["Script", transform(t, fontMaps.script)],
    ["Script Bold", transform(t, fontMaps.scriptBold)],
    ["Serif 1", transform(t, fontMaps.bold)],
    ["Serif 2", transform(t, fontMaps.italic)],
    ["Serif 3", transform(t, fontMaps.fraktur)],
    ["Sans 1", transform(t, fontMaps.frakturBold)],
    ["Sans 2", transform(t, fontMaps.sansItalic)],
    ["Sans 3", transform(t, fontMaps.sansBold)],
    ["Sans 4", transform(t, fontMaps.mono)],
    ["Courier", transform(t, fontMaps.mono)],
    ["Fractur PKR", transform(t, fontMaps.double)],
    ["Fractur Bold", transform(t, fontMaps.frakturBold)],
    ["Calligraphic", transform(t, fontMaps.scriptBold)],
    ["Caslon", transform(t, fontMaps.script)],
    ["Bauer", transform(t, fontMaps.italic)],
    ["Outline", fullWidth(t)],
    ["Typewrite", transform(t, fontMaps.mono)],

    ["COROO", mapped(t, smallCapsMap)],

    ["SQUAR", transform(t, negativeCircled)],
    ["SPOE", transform(t, circled)],

    ["『H』 『e』", `『${transform(t, fontMaps.script)}』`],
    ["【H】 【e】", `【${transform(t, fontMaps.script)}】`],

    ["SUNSHINE", transform(t, circled)],
    ["SunRound", transform(t, negativeCircled)],

    ["Bird", mapped(t, birdMap)],
    ["Install", upsideDown(t)],

    ["Empire", `亗${transform(t, fontMaps.script)}亗`],
    ["Power", `꧁${transform(t, fontMaps.script)}꧂`],
    ["Go left", `← ${transform(t, fontMaps.script)}`],
    ["Go right", `${transform(t, fontMaps.script)} →`],
    ["Arrow", `↝${transform(t, fontMaps.script)}↜`],

    ["app", mapped(t, {
      i: "ᵢ", k: "ₖ", r: "ᵣ", a: "ₐ", m: "ₘ",
    })],

    ["FOROZE", mapped(t, {
      i: "ł", k: "₭", r: "Ɽ", a: "₳", m: "₥",
    })],

    ["HOTŠ Of", mapped(t, {
      i: "ï", k: "ķ", r: "ř", a: "å", m: "m",
    })],

    ["Strike", addMark(t, "̶")],
    ["Clouds", addMark(addMark(t, "̈"), "̐")],
    ["Häppy PKR", mapped(t, latinMap)],
    ["Cheerful", addMark(t, "̽")],
    ["Gloomy", addMark(t, "̊")],
    ["hina", mapped(t, hinaMap)],
    ["Lestinky", mapped(t, {
      i: "ɨ", k: "ӄ", r: "ɾ", a: "ɑ", m: "ɱ",
    })],
    ["Lighting", mapped(t, greekMap)],
    ["Linle", addMark(t, "̬")],

    ["Underline 1", addMark(t, "̲")],
    ["Underline 2", addMark(t, "̳")],

    ["Rails 1", addMark(t, "̸")],
    ["Rails 2", addMark(t, "̷")],
    ["Rails 3", addMark(t, "⃪")],

    ["HIGHLIGHT", [...t].map((c) => `[̲̅${c}]`).join("")],

    ["Skyline 1", addMark(t, "̄")],
    ["Skyline 2", addMark(t, "̅")],
    ["Skyline 3", addMark(t, "͞")],

    ["Demons", `乂${transform(t, fontMaps.script)}乂`],
    ["Wheel", `◎${transform(t, fontMaps.script)}◎`],
    ["AIRBALL", `◉${transform(t, fontMaps.script)}◉`],
    ["Poštěr", `╔═${transform(t, fontMaps.script)}═╗`],
    ["PKR", `₱${transform(t, fontMaps.script)}₱`],
    ["Popstar", `★${transform(t, fontMaps.script)}★`],
    ["SPARKLE", `✧${transform(t, fontMaps.script)}✧`],
    ["China Legend", `༺${transform(t, fontMaps.script)}༻`],
    ["BOU DODOH", `༼${transform(t, fontMaps.script)}༽`],
    ["Koiote", `〆${transform(t, fontMaps.script)}〆`],
    ["CURLS", `❮${transform(t, fontMaps.script)}❯`],
    ["Rail.Mack", `╭─${transform(t, fontMaps.script)}─╮`],
    ["Track", `╰─${transform(t, fontMaps.script)}─╯`],

    ["Dotify 1", addMark(t, "̇")],
    ["Dotify 2", addMark(t, "̈")],
    ["Dotify 3", addMark(t, "⃛")],
    ["Foot", addMark(t, "̣")],

    ["çóóĻήέşş", mapped(t, {
      c: "ç", o: "ó", l: "Ļ", e: "ή", s: "ş",
    })],

    ["Share app", addMark(t, "֟፝")],
    ["ruff road", [...t].map((c) => `${c}𝆭`).join("")],
    ["Wave", [...t].map((c) => `֟ؖ۬͜${c}`).join("")],
    ["tiny", mapped(t, {
      a: "ₐ", b: "ᵦ", c: "𝚌", d: "ᵈ", e: "ₑ",
      f: "ᶠ", g: "ᵍ", h: "ₕ", i: "ᵢ", j: "ⱼ",
      k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ",
      p: "ₚ", q: "q", r: "ᵣ", s: "ₛ", t: "ₜ",
      u: "ᵤ", v: "ᵥ", w: "ʷ", x: "ₓ", y: "ʸ", z: "ᶻ",
    })],

    ["TINY CAPS", mapped(t, smallCapsMap)],
    ["Soo.cocoe", addMark(t, "֟፝݊")],
    ["имор әрısdn", mapped(t, latinMap)],
    ["COMIC", transform(t, negativeCircled)],
    ["爪开几开", mapped(t, {
      i: "爪", k: "开", r: "几", a: "开", m: "爪",
    })],

    ["Smartie", [...t].map((c) => `${c}꧊༨`).join("")],
    ["Rackham", addMark(t, "𝅦")],
    ["Ensemble", addMark(t, "̼̽")],
    ["HUOJSQ", mapped(t, cherokeeMap)],
  ];

  return rows
    .map(([, value], i) => ({
      name: String(i + 1),
      text: `${i + 1}• ${value}`,
    }))
    .concat(
      advanced(t).map((value, i) => ({
        name: String(rows.length + i + 1),
        text: `${rows.length + i + 1}• ${value}`,
      }))
    );
}

command(
  {
    pattern: "tomp3",
    fromMe: false,
    desc: "Convert video/audio to mp3",
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      let input;
      let output;
      try {
        const media = await downloadQuotedOrSelf(conn, message);
        if (!media || !["video", "audio"].includes(media.type)) {
          await replyFail(conn, message, "Reply to a video or audio.");
          return;
        }
        const ext = media.type === "audio" ? ".audio" : ".mp4";
        input = await writeTempFile(media.buffer, ext);
        output = await toMp3(input);
        const st = await stat(output);
        assertAudioSize(st.size);
        const buf = await readFile(output);
        await conn.sendMessage(
          message.from,
          { audio: buf, mimetype: "audio/mpeg", ptt: false },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(
          conn,
          message,
          err?.message || "tomp3 failed (need FFmpeg on PATH)."
        );
      } finally {
        await safeUnlink(input);
        await safeUnlink(output);
      }
    }, { timeoutMs: 120_000 });
  }
);

async function uploadCatbox(buffer, filename) {
  const axios = (await import("axios")).default;
  const form = new globalThis.FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([buffer]),
    filename || "file.bin"
  );
  const res = await axios.post("https://catbox.moe/user/api.php", form, {
    maxBodyLength: Infinity,
    timeout: 60_000,
  });
  return String(res.data).trim();
}

async function urlHandler(message, conn) {
  await withTyping(conn, message.from, async () => {
    try {
      const media = await downloadQuotedOrSelf(conn, message);
      if (!media) {
        await replyFail(conn, message, "Reply to an image/video/audio/document.");
        return;
      }
      let ext = "bin";
      try {
        const { fileTypeFromBuffer } = await import("file-type");
        const ft = await fileTypeFromBuffer(media.buffer);
        if (ft?.ext) ext = ft.ext;
      } catch {
        /* ignore */
      }
      const url = await uploadCatbox(media.buffer, `upload.${ext}`);
      if (!url.startsWith("http")) {
        throw new Error("Upload failed.");
      }
      await reply(conn, message, `🔗 ${url}`);
    } catch (err) {
      await replyFail(conn, message, err?.message || "Upload failed.");
    }
  }, { timeoutMs: 90_000 });
}

command(
  {
    pattern: "toururl",
    fromMe: false,
    desc: "Upload media and get a URL",
    type: "media",
  },
  urlHandler
);

command(
  {
    pattern: "url",
    fromMe: false,
    desc: "Alias for tourl",
    type: "media",
    dontAddCommandList: true,
  },
  urlHandler
);

command(
  {
    pattern: "quote",
    fromMe: false,
    desc: "Fake quote sticker from text / reply",
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      let out = null;
      try {
        let text =
          getCommandArgs(message.body, "quote") ||
          message.quoted?.text ||
          "";
        text = String(text).trim().replace(/^["']|["']$/g, "").slice(0, 200);

        if (!text) {
          await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}quote <text>\` or reply to a message`);
          return;
        }

        const name = message.quoted
          ? message.message?.contextInfo?.participant?.split("@")[0] ||
            message.pushName || "User"
          : message.pushName || "User";

        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const runFFmpeg = promisify(execFile);

        const esc = (v) => String(v)
          .replace(/\\/g, "\\\\")
          .replace(/:/g, "\\:")
          .replace(/'/g, "\\'")
          .replace(/%/g, "\\%")
          .replace(/\[/g, "\\[")
          .replace(/\]/g, "\\]");

        const words = text.split(/\s+/);
        const lines = [];
        let line = "";
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (test.length > 25) {
            if (line) lines.push(line);
            line = word;
          } else line = test;
        }
        if (line) lines.push(line);

        const textFilters = lines.slice(0, 8).map((l, i) =>
          `drawtext=fontfile=/system/fonts/NotoSerif-Regular.ttf:text='${esc(l)}':fontcolor=white:fontsize=58:borderw=2:bordercolor=white:x=(w-text_w)/2:y=${125 + i * 55}`
        ).join(",");

        const safeName = esc(String(name).slice(0, 24));

        out = createTempPath(".webp");

        await runFFmpeg("ffmpeg", [
          "-hide_banner",
          "-loglevel", "error",
          "-f", "lavfi",
          "-i", "color=c=black:s=512x512:r=1",
          "-vf",
          `${textFilters},drawtext=text='— ${safeName}':fontcolor=#d9d9d9:fontsize=28:borderw=1:bordercolor=#d9d9d9:x=w-text_w-28:y=h-text_h-24`,
          "-frames:v", "1",
          "-c:v", "libwebp",
          "-q:v", "75",
          "-y",
          out
        ]);

        const webp = await readFile(out);
        await conn.sendMessage(
          message.from,
          { sticker: webp },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "quote failed.");
      } finally {
        if (out) await safeUnlink(out);
      }
    });
  }
)
command(
  {
    pattern: "fancy",
    fromMe: false,
    desc: "Fancy unicode text styles",
    type: "media",
  },
  async (message, conn) => {
    const text =
      getCommandArgs(message.body, "fancy") ||
      message.quoted?.text ||
      "";
    if (!String(text).trim()) {
      await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}fancy <text>\``);
      return;
    }
    const styles = fancyText(String(text).trim().slice(0, 80));
    await reply(
      conn,
      message,
      styles.map((s) => s.text).join("\n")
    );
  }
);

command(
  {
    pattern: "tts",
    fromMe: false,
    desc: "Google TTS audio",
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        let text =
          getCommandArgs(message.body, "tts") ||
          message.quoted?.text ||
          "";
        text = String(text).trim();
        if (!text) {
          await replyFail(conn, message, `Usage: \`${BOT_INFO.PREFIX}tts <text>\``);
          return;
        }
        // Urdu script -> Pakistani Urdu TTS; explicit lang:text remains supported
        let lang = "en";
        const m = text.match(/^([a-z]{2})[:|]\s*(.+)$/i);

        if (m) {
          lang = m[1].toLowerCase();
          text = m[2];
        } else if (/[,،؟ٰٔٓۓےںھہوعیپٹڈڑژچگکفثصضطظذخحجشسزرسداب] /u.test(text) || /[\u0600-\u06FF]/u.test(text)) {
          lang = "ur";
        }
        text = text.slice(0, 200);
        const { getAudioUrl } = await import("google-tts-api");
        const url = getAudioUrl(text, {
          lang,
          slow: false,
          host: "https://translate.google.com",
        });
        const axios = (await import("axios")).default;
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });
        const buf = Buffer.from(res.data);
        await conn.sendMessage(
          message.from,
          { audio: buf, mimetype: "audio/mpeg" },
          { quoted: { key: message.key, message: message.message } }
        );
      } catch (err) {
        await replyFail(conn, message, err?.message || "tts failed.");
      }
    });
  }
);

async function textToSticker(message, conn, { animated = false } = {}) {
  const pattern = animated ? "attp" : "ttp";
  let text =
    getCommandArgs(message.body, pattern) ||
    message.quoted?.text ||
    "";

  text = String(text).trim().slice(0, 40);

  if (!text) {
    await replyFail(
      conn,
      message,
      `Usage: \`${BOT_INFO.PREFIX}${pattern} <text>\``
    );
    return;
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const runFFmpeg = promisify(execFile);

  const escapeDrawtext = (value) =>
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'")
      .replace(/%/g, "\\%")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");

  const safeText = escapeDrawtext(text);
  const font = "/system/fonts/Roboto-Regular.ttf";

  if (!animated) {
    const out = createTempPath(".webp");

    try {
      await runFFmpeg("ffmpeg", [
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=white:s=512x512:r=1",
        "-vf",
        `drawtext=text='${safeText}':fontcolor=black:fontsize=64:fontfile=${font}:x=(w-text_w)/2:y=(h-text_h)/2`,
        "-frames:v", "1",
        "-c:v", "libwebp",
        "-y",
        out
      ]);

      const webp = await readFile(out);

      await conn.sendMessage(
        message.from,
        { sticker: webp },
        {
          quoted: {
            key: message.key,
            message: message.message
          }
        }
      );
    } finally {
      await safeUnlink(out);
    }

    return;
  }

  const colors = [
    "red",
    "orange",
    "yellow",
    "lime",
    "cyan",
    "blue",
    "magenta"
  ];

  const frames = [];
  const out = createTempPath(".webp");

  try {
    for (let i = 0; i < colors.length; i++) {
      const fp = createTempPath(".png");

      await runFFmpeg("ffmpeg", [
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=512x512:r=1",
        "-vf",
        `drawtext=text='${safeText}':fontcolor=${colors[i]}:fontsize=64:fontfile=${font}:x=(w-text_w)/2:y=(h-text_h)/2`,
        "-frames:v", "1",
        "-update", "1",
        "-y",
        fp
      ]);

      frames.push(fp);
    }

    const input = createTempPath(".txt");
    const { writeFile } = await import("fs/promises");

    await writeFile(
      input,
      frames.map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration 0.15`).join("\n") +
      `\nfile '${frames[frames.length - 1].replace(/'/g, "'\\''")}'`
    );

    await runFFmpeg("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "concat",
      "-safe", "0",
      "-i", input,
      "-c:v", "libwebp",
      "-loop", "0",
      "-lossless", "0",
      "-q:v", "60",
      "-y",
      out
    ]);

    const webp = await readFile(out);

    await conn.sendMessage(
      message.from,
      { sticker: webp },
      {
        quoted: {
          key: message.key,
          message: message.message
        }
      }
    );

    await safeUnlink(input);
  } finally {
    await Promise.all(frames.map(safeUnlink));
    await safeUnlink(out);
  }
}
command(
  {
    pattern: "ttp",
    fromMe: false,
    desc: "Text to sticker",
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        await textToSticker(message, conn, { animated: false });
      } catch (err) {
        await replyFail(conn, message, err?.message || "ttp failed.");
      }
    });
  }
);

command(
  {
    pattern: "attp",
    fromMe: false,
    desc: "Animated text sticker",
    type: "media",
  },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      try {
        await textToSticker(message, conn, { animated: true });
      } catch (err) {
        await replyFail(conn, message, err?.message || "attp failed.");
      }
    }, { timeoutMs: 60_000 });
  }
);

