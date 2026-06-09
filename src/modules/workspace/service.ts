import Docker from "dockerode";
import { Writable } from "stream";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ModuleContext } from "../../core/module.js";
import { log } from "../../utils/log.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface WorkspaceService {
  ensureContainer(userId: number): Promise<void>;
  exec(userId: number, command: string, timeoutSec?: number): Promise<ExecResult>;
  write(userId: number, filePath: string, content: string): Promise<void>;
  read(userId: number, filePath: string): Promise<string>;
  shutdown(): Promise<void>;
}

export function createWorkspaceService(ctx: ModuleContext): WorkspaceService {
  const baseDir = String(ctx.config.WORKSPACE_BASE_DIR);
  const image = String(ctx.config.WORKSPACE_IMAGE);
  const memoryLimit = String(ctx.config.WORKSPACE_MEMORY_LIMIT);
  const cpuLimit = String(ctx.config.WORKSPACE_CPU_LIMIT);
  const defaultTimeout = Number(ctx.config.WORKSPACE_TIMEOUT_SEC);

  const docker = new Docker();

  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  const containers = new Map<number, Docker.Container>();

  function workspaceDir(userId: number): string {
    const dir = join(baseDir, String(userId));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async function ensureImage(): Promise<void> {
    try {
      await docker.getImage(image).inspect();
    } catch {
      log.info({ image }, "Pulling workspace image");
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    }
  }

  async function ensureContainer(userId: number): Promise<void> {
    if (containers.has(userId)) return;

    const name = `skye-workspace-${userId}`;
    const hostDir = workspaceDir(userId);

    try {
      const existing = docker.getContainer(name);
      const info = await existing.inspect();
      containers.set(userId, existing);

      if (!info.State.Running) {
        await existing.start();
        log.info({ userId, name }, "Started existing workspace container");
      }
      return;
    } catch {
      // Container doesn't exist yet, create it
    }

    await ensureImage();

    const container = await docker.createContainer({
      name,
      Image: image,
      WorkingDir: "/workspace",
      Cmd: ["tail", "-f", "/dev/null"],
      HostConfig: {
        Binds: [`${hostDir}:/workspace`],
        Memory: parseMemory(memoryLimit),
        NanoCpus: parseCpus(cpuLimit),
        PidsLimit: 64,
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"],
        NetworkMode: "none",
      },
    });

    await container.start();
    containers.set(userId, container);
    log.info({ userId, name }, "Created and started workspace container");
  }

  async function exec(userId: number, command: string, timeoutSec?: number): Promise<ExecResult> {
    await ensureContainer(userId);

    const container = containers.get(userId)!;
    const timeout = (timeoutSec ?? defaultTimeout) * 1000;

    const exec = await container.exec({
      Cmd: ["sh", "-c", command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
    }, timeout);

    const result = await new Promise<{ exitCode: number }>((resolve) => {
      const stdoutStream = new Writable({
        write(chunk: Buffer | string, _encoding: string, callback: () => void) {
          stdout += chunk.toString("utf-8");
          callback();
        },
      });
      const stderrStream = new Writable({
        write(chunk: Buffer | string, _encoding: string, callback: () => void) {
          stderr += chunk.toString("utf-8");
          callback();
        },
      });

      docker.modem.demuxStream(stream as NodeJS.ReadableStream, stdoutStream, stderrStream);

      stream.on("end", async () => {
        clearTimeout(timeoutId);
        const info = await exec.inspect();
        resolve({ exitCode: info.ExitCode ?? 0 });
      });
    });

    if (stdout.length > 10000) {
      stdout = stdout.slice(0, 10000) + "\n... [output truncated]";
    }
    if (stderr.length > 10000) {
      stderr = stderr.slice(0, 10000) + "\n... [output truncated]";
    }

    return { stdout, stderr, exitCode: result.exitCode, timedOut };
  }

  async function write(userId: number, filePath: string, content: string): Promise<void> {
    await ensureContainer(userId);

    const safePath = filePath.replace(/'/g, "'\\''");
    const escaped = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");

    const dirPath = safePath.substring(0, safePath.lastIndexOf("/"));
    if (dirPath) {
      await exec(userId, `mkdir -p '${dirPath}'`);
    }

    await exec(userId, `printf '%s' '${escaped}' > '/workspace/${safePath}'`);
  }

  async function read(userId: number, filePath: string): Promise<string> {
    await ensureContainer(userId);

    const safePath = filePath.replace(/'/g, "'\\''");

    const result = await exec(userId, `cat '/workspace/${safePath}' 2>&1`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stdout || result.stderr}`);
    }
    return result.stdout;
  }

  async function shutdown(): Promise<void> {
    for (const [userId, container] of containers) {
      try {
        await container.stop().catch(() => {});
        log.info({ userId }, "Stopped workspace container");
      } catch (e) {
        log.error({ userId, err: e }, "Failed to stop workspace container");
      }
    }
    containers.clear();
  }

  return { ensureContainer, exec, write, read, shutdown };
}

function parseMemory(value: string): number {
  const match = value.match(/^(\d+)([kmg]?)b?$/i);
  if (!match) return 512 * 1024 * 1024;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "k":
      return num * 1024;
    case "m":
      return num * 1024 * 1024;
    case "g":
      return num * 1024 * 1024 * 1024;
    default:
      return num;
  }
}

function parseCpus(value: string): number {
  return Math.round(parseFloat(value) * 1e9);
}
