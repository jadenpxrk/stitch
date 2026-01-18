#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import { Blob } from "node:buffer";

function usage() {
  return `Usage: nano-banana.mjs <input.jpg> <output.jpg>

Env:
  FAL_KEY                     Required. fal.ai API key.
  NANO_BANANA_ENDPOINT         Optional. Default: fal-ai/nano-banana-pro/edit
  NANO_BANANA_PROMPT           Optional. Prompt for thumbnail generation.
  NANO_BANANA_ASPECT_RATIO     Optional. Default: 16:9
  NANO_BANANA_RESOLUTION       Optional. Default: 1K
  NANO_BANANA_OUTPUT_FORMAT    Optional. Default: jpeg
`;
}

function stripInlineComment(value) {
  return value.replace(/\s+#.*$/, "").trim();
}

function readEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const cleaned = stripInlineComment(raw);
  return cleaned ? cleaned : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  const cleaned = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(cleaned)) return true;
  if (["0", "false", "no", "n", "off"].includes(cleaned)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const [inputJpgPath, outJpgPath] = process.argv.slice(2);

  if (!inputJpgPath || !outJpgPath) {
    console.error(usage());
    process.exit(2);
  }

  const falKey = readEnv("FAL_KEY", "");
  if (!falKey) {
    throw new Error("FAL_KEY is not set.");
  }

  const endpoint = readEnv("NANO_BANANA_ENDPOINT", "fal-ai/nano-banana-pro/edit");
  const prompt =
    readEnv(
      "NANO_BANANA_PROMPT",
      "Transform this video frame into a professional, scroll-stopping YouTube thumbnail. Enhance colors and contrast, improve lighting, sharpen details, keep the main subject clear and centered, and make it feel high-quality. Keep it realistic. Do not add text, logos, or watermarks.",
    );

  const aspectRatio = readEnv("NANO_BANANA_ASPECT_RATIO", "16:9");
  const resolution = readEnv("NANO_BANANA_RESOLUTION", "1K");
  const outputFormat = readEnv("NANO_BANANA_OUTPUT_FORMAT", "jpeg");
  const enableWebSearch = parseBoolean(process.env.NANO_BANANA_ENABLE_WEB_SEARCH, false);
  const numImages = Math.max(1, Math.min(4, parseNumber(process.env.NANO_BANANA_NUM_IMAGES, 1)));

  let fal;
  try {
    ({ fal } = await import("@fal-ai/client"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load @fal-ai/client (${msg}). Install it in web/: npm install --save @fal-ai/client`);
    process.exit(1);
  }

  fal.config({ credentials: falKey });

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node.js 18+.");
  }

  const inputBuf = await fsp.readFile(inputJpgPath);
  const inputBlob = new Blob([inputBuf], { type: "image/jpeg" });

  const result = await fal.subscribe(endpoint, {
    input: {
      prompt,
      image_urls: [inputBlob],
      num_images: numImages,
      aspect_ratio: aspectRatio,
      resolution,
      output_format: outputFormat,
      limit_generations: true,
      enable_web_search: enableWebSearch,
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_QUEUE") console.error("nano banana queue position:", update.queue_position);
      if (update.status === "IN_PROGRESS") console.error("nano banana running…");
    },
  });

  const url = result?.data?.images?.[0]?.url;
  if (!url) {
    throw new Error("fal response missing images[0].url");
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download nano banana output: ${res.status} ${res.statusText}`);
  }

  const outDir = path.dirname(outJpgPath);
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(outJpgPath, Buffer.from(await res.arrayBuffer()));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
