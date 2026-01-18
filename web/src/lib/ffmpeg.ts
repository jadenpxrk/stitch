import { spawn } from "node:child_process";
import fs from "node:fs";

type RunOptions = {
  cwd?: string;
  timeoutMs?: number;
};

export class CommandError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number | null;

  constructor(message: string, opts: { stdout: string; stderr: string; exitCode: number | null }) {
    super(message);
    this.name = "CommandError";
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
  }
}

function stripInlineComment(value: string) {
  return value.replace(/\s+#.*$/, "").trim();
}

function resolveCommand(envVarName: string, fallback: string) {
  const raw = process.env[envVarName];
  if (!raw) return fallback;
  const cleaned = stripInlineComment(raw);
  if (!cleaned) return fallback;
  // If it's an absolute/relative path, validate it exists; otherwise assume it's a binary name on PATH.
  if (cleaned.includes("/") || cleaned.includes("\\")) {
    return fs.existsSync(cleaned) ? cleaned : fallback;
  }
  return cleaned;
}

function isEnoent(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

async function run(command: string, args: string[], opts: RunOptions = {}) {
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const child = spawn(command, args, { cwd: opts.cwd });

  child.stdout?.on("data", (d) => (stdout += String(d)));
  child.stderr?.on("data", (d) => (stderr += String(d)));

  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  let exitCode: number | null = null;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on("error", (err) => reject(err));
      child.on("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }

  if (timedOut) {
    throw new CommandError(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`, {
      stdout,
      stderr,
      exitCode,
    });
  }

  if (exitCode !== 0) {
    throw new CommandError(`Command failed: ${command} ${args.join(" ")}`, {
      stdout,
      stderr,
      exitCode,
    });
  }

  return { stdout, stderr };
}

export async function runFfmpeg(args: string[], opts: RunOptions = {}) {
  const ffmpeg = resolveCommand("FFMPEG_PATH", "ffmpeg");
  try {
    return await run(ffmpeg, args, opts);
  } catch (err) {
    // If a configured absolute path is invalid, fall back to PATH lookup + common locations.
    if (isEnoent(err)) {
      const candidates =
        process.platform === "darwin"
          ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
          : ["/usr/bin/ffmpeg", "/bin/ffmpeg"];

      if (ffmpeg !== "ffmpeg") {
        try {
          return await run("ffmpeg", args, opts);
        } catch (err2) {
          if (!isEnoent(err2)) throw err2;
        }
      }

      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        return run(candidate, args, opts);
      }
    }
    throw err;
  }
}

export async function runFfprobe(args: string[], opts: RunOptions = {}) {
  const ffprobe = resolveCommand("FFPROBE_PATH", "ffprobe");
  try {
    return await run(ffprobe, args, opts);
  } catch (err) {
    if (isEnoent(err)) {
      const candidates =
        process.platform === "darwin"
          ? ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"]
          : ["/usr/bin/ffprobe", "/bin/ffprobe"];

      if (ffprobe !== "ffprobe") {
        try {
          return await run("ffprobe", args, opts);
        } catch (err2) {
          if (!isEnoent(err2)) throw err2;
        }
      }

      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        return run(candidate, args, opts);
      }
    }
    throw err;
  }
}

export async function hasAudio(inputPath: string): Promise<boolean> {
  try {
    const { stdout } = await runFfprobe(
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        inputPath,
      ],
      { timeoutMs: 20_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
