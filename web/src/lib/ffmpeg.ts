import { spawn } from "node:child_process";

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

async function run(command: string, args: string[], opts: RunOptions = {}) {
  const child = spawn(command, args, { cwd: opts.cwd });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (d) => (stdout += String(d)));
  child.stderr.on("data", (d) => (stderr += String(d)));

  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, timeoutMs);

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  clearTimeout(timeout);

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
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  return run(ffmpeg, args, opts);
}

export async function runFfprobe(args: string[], opts: RunOptions = {}) {
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  return run(ffprobe, args, opts);
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

