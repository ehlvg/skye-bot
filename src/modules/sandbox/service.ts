import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk";
import { log } from "../../utils/log.js";
import { resolve, relative, isAbsolute, sep } from "node:path";

export interface SandboxServiceConfig {
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  target?: string;
  image: string;
  snapshot?: string;
  cpu: number;
  memoryGiB: number;
  diskGiB: number;
  autoStopMinutes: number;
  autoArchiveMinutes: number;
  persistent: boolean;
  commandTimeoutMs: number;
  maxOutputChars: number;
  maxFileBytes: number;
  maxArgs: number;
  maxArgChars: number;
}

const SANDBOX_ROOT = "/home/daytona";

export function sandboxPath(input: string): string {
  const value = String(input || ".");
  const candidate = isAbsolute(value) ? value : `${SANDBOX_ROOT}/${value}`;
  const normalized = resolve(candidate);
  const rel = relative(SANDBOX_ROOT, normalized);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Sandbox path must stay inside /home/daytona");
  }
  return normalized;
}

export function validateSandboxCommand(
  command: string,
  args: string[],
  maxArgs: number,
  maxArgChars: number
): void {
  if (!/^[A-Za-z0-9_./-]+$/.test(command) || command === "." || command === "..") {
    throw new Error("Sandbox command must be an executable name or path, without shell syntax");
  }
  if (args.length > maxArgs) throw new Error(`Too many command arguments (maximum ${maxArgs})`);
  if (args.some((arg) => arg.length > maxArgChars))
    throw new Error(`Command argument exceeds ${maxArgChars} characters`);
}

function limitText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n... [truncated]`;
}

interface ActiveSandbox {
  sandbox: Sandbox;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Manages one Daytona Sandbox per Telegram chat. Each sandbox is isolated
 * and can run commands and read/write files. Network policy is deliberately
 * left to the Daytona organization, which is required for Tier 1 accounts.
 *
 * Sandboxes are named `skye-chat-<chatId>` so they can be resumed by name.
 * When persistence is disabled (the default) the filesystem is discarded
 * whenever the VM stops, giving every session a fresh environment.
 */
export class SandboxService {
  private sandboxes = new Map<string, ActiveSandbox>();
  private config: SandboxServiceConfig;
  private daytona: Daytona | null;

  constructor(config: SandboxServiceConfig) {
    this.config = config;
    this.daytona = config.enabled
      ? new Daytona({ apiKey: config.apiKey, apiUrl: config.apiUrl, target: config.target })
      : null;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private sandboxName(chatId: number): string {
    const safeId = String(chatId).replace(/^-/, "g_");
    return `skye-chat-${safeId}`;
  }

  private client(): Daytona {
    if (!this.daytona) throw new Error("Daytona Sandbox is not enabled");
    return this.daytona;
  }

  /**
   * Get an existing sandbox for the chat or create a fresh one. The first
   * call starts the VM; subsequent calls reuse the running session until it
   * times out.
   */
  async getOrCreate(chatId: number): Promise<Sandbox> {
    const key = String(chatId);
    const existing = this.sandboxes.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.sandbox;
    }

    const name = this.sandboxName(chatId);
    const daytona = this.client();
    let sandbox: Sandbox;
    try {
      sandbox = await daytona.get(name);
      if (sandbox.state !== "started") await sandbox.start();
    } catch (e) {
      if (!(e instanceof DaytonaNotFoundError)) throw e;
      log.info({ chatId, sandbox: name }, "Creating Daytona Sandbox");
      const common = {
        name,
        language: "typescript",
        labels: { chat: String(chatId), source: "skye-bot" },
        autoStopInterval: this.config.autoStopMinutes,
        autoArchiveInterval: this.config.autoArchiveMinutes,
        ephemeral: !this.config.persistent,
      };
      sandbox = this.config.snapshot
        ? await daytona.create({ ...common, snapshot: this.config.snapshot })
        : await daytona.create({
            ...common,
            image: this.config.image,
            resources: {
              cpu: this.config.cpu,
              memory: this.config.memoryGiB,
              disk: this.config.diskGiB,
            },
          });
    }

    this.sandboxes.set(key, {
      sandbox,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    return sandbox;
  }

  /**
   * Run a command inside the chat's sandbox and return stdout/stderr/exit code.
   */
  async runCommand(
    chatId: number,
    command: string,
    args: string[] = [],
    opts: { timeoutMs?: number; cwd?: string; env?: Record<string, string> } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    validateSandboxCommand(command, args, this.config.maxArgs, this.config.maxArgChars);
    const sandbox = await this.getOrCreate(chatId);
    const timeoutMs = Math.min(
      opts.timeoutMs ?? this.config.commandTimeoutMs,
      this.config.commandTimeoutMs
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid sandbox timeout");

    log.debug({ chatId, command, args, timeoutMs }, "Sandbox run command");

    const commandLine = [command, ...args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)].join(
      " "
    );
    const result = await sandbox.process.executeCommand(
      commandLine,
      sandboxPath(opts.cwd ?? "."),
      opts.env,
      Math.ceil(timeoutMs / 1000)
    );

    return {
      exitCode: result.exitCode,
      stdout: limitText(result.result, this.config.maxOutputChars),
      stderr: "",
    };
  }

  /**
   * Write a text file into the sandbox. Paths are relative to /home/daytona
   * unless absolute.
   */
  async writeFile(chatId: number, path: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, "utf8") > this.config.maxFileBytes) {
      throw new Error(`Sandbox file exceeds ${this.config.maxFileBytes} bytes`);
    }
    const sandbox = await this.getOrCreate(chatId);
    await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), sandboxPath(path));
  }

  /**
   * Read a text file from the sandbox. Returns null when the file does not exist.
   */
  async readFile(chatId: number, path: string): Promise<string | null> {
    const sandbox = await this.getOrCreate(chatId);
    try {
      const content = (await sandbox.fs.downloadFile(sandboxPath(path))).toString("utf8");
      if (Buffer.byteLength(content, "utf8") > this.config.maxFileBytes) {
        throw new Error(`Sandbox file exceeds ${this.config.maxFileBytes} bytes`);
      }
      return content;
    } catch (e) {
      if (e instanceof DaytonaNotFoundError) return null;
      throw e;
    }
  }

  /**
   * List files and directories at the given path.
   */
  async listFiles(chatId: number, path = SANDBOX_ROOT): Promise<string[]> {
    const sandbox = await this.getOrCreate(chatId);
    try {
      return (await sandbox.fs.listFiles(sandboxPath(path))).map((file) => file.name);
    } catch (e) {
      if (e instanceof DaytonaNotFoundError) return [];
      throw e;
    }
  }

  /**
   * Delete the chat's sandbox and its snapshots, then recreate a fresh one.
   */
  async reset(chatId: number): Promise<void> {
    const key = String(chatId);
    const existing = this.sandboxes.get(key);
    const name = this.sandboxName(chatId);

    if (existing) {
      this.sandboxes.delete(key);
      try {
        log.info({ chatId, sandbox: name }, "Deleting Daytona Sandbox");
        await existing.sandbox.delete();
      } catch (e) {
        log.warn({ chatId, err: e }, "Failed to delete sandbox during reset");
      }
    }

    await this.getOrCreate(chatId);
  }

  /**
   * Destroy the chat's sandbox permanently.
   */
  async destroy(chatId: number): Promise<void> {
    const key = String(chatId);
    const existing = this.sandboxes.get(key);
    if (!existing) return;

    this.sandboxes.delete(key);
    try {
      await existing.sandbox.delete();
    } catch (e) {
      log.warn({ chatId, err: e }, "Failed to delete sandbox");
    }
  }

  /**
   * Status information for the /sandbox_status command.
   */
  async status(chatId: number): Promise<{
    name: string;
    status: string;
    cpu: number;
    memoryGiB: number;
    diskGiB: number;
    autoStopMinutes?: number;
    persistent: boolean;
  } | null> {
    const key = String(chatId);
    const existing = this.sandboxes.get(key);
    if (!existing) return null;

    return {
      name: existing.sandbox.name,
      status: existing.sandbox.state ?? "unknown",
      cpu: existing.sandbox.cpu,
      memoryGiB: existing.sandbox.memory,
      diskGiB: existing.sandbox.disk,
      autoStopMinutes: existing.sandbox.autoStopInterval,
      persistent: this.config.persistent,
    };
  }

  /**
   * Stop and optionally delete all managed sandboxes on shutdown.
   */
  async shutdown(): Promise<void> {
    for (const [key, { sandbox }] of this.sandboxes) {
      try {
        if (this.config.persistent) {
          await sandbox.stop();
        } else {
          await sandbox.delete();
        }
      } catch (e) {
        log.warn({ chatId: key, err: e }, "Sandbox shutdown failed");
      }
    }
    this.sandboxes.clear();
  }
}
