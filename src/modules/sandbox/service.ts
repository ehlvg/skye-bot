import { Sandbox } from "@vercel/sandbox";
import type { CommandFinished } from "@vercel/sandbox";
import { log } from "../../utils/log.js";

export interface SandboxServiceConfig {
  enabled: boolean;
  token?: string;
  teamId?: string;
  projectId?: string;
  runtime: string;
  timeoutMs: number;
  vcpus: number;
  persistent: boolean;
  commandTimeoutMs: number;
}

interface ActiveSandbox {
  sandbox: Sandbox;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Manages one Vercel Sandbox per Telegram chat. Each sandbox is isolated,
 * has internet access by default, and can run arbitrary commands, read/write
 * files, and expose ports.
 *
 * Sandboxes are named `skye-chat-<chatId>` so they can be resumed by name.
 * When persistence is disabled (the default) the filesystem is discarded
 * whenever the VM stops, giving every session a fresh environment.
 */
export class SandboxService {
  private sandboxes = new Map<string, ActiveSandbox>();
  private config: SandboxServiceConfig;

  constructor(config: SandboxServiceConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  private credentials(): { token: string; teamId: string; projectId: string } | undefined {
    if (!this.config.token || !this.config.projectId) return undefined;
    return {
      token: this.config.token,
      projectId: this.config.projectId,
      teamId: this.config.teamId ?? "",
    };
  }

  private sandboxName(chatId: number): string {
    // Group chat IDs are negative; replace the leading minus so the name is a
    // valid Vercel sandbox identifier.
    const safeId = String(chatId).replace(/^-/, "g_");
    return `skye-chat-${safeId}`;
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
    const creds = this.credentials();

    log.info({ chatId, sandbox: name }, "Creating Vercel Sandbox");

    const sandbox = await Sandbox.getOrCreate({
      name,
      runtime: this.config.runtime,
      timeout: this.config.timeoutMs,
      persistent: this.config.persistent,
      resources: { vcpus: this.config.vcpus },
      networkPolicy: "allow-all",
      tags: { chat: String(chatId), source: "skye-bot" },
      ...(creds ? creds : {}),
    });

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
    const sandbox = await this.getOrCreate(chatId);
    const timeoutMs = opts.timeoutMs ?? this.config.commandTimeoutMs;

    log.debug({ chatId, command, args, timeoutMs }, "Sandbox run command");

    const result = (await sandbox.runCommand({
      cmd: command,
      args,
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs,
    })) as CommandFinished;

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    return {
      exitCode: result.exitCode ?? -1,
      stdout,
      stderr,
    };
  }

  /**
   * Write a text file into the sandbox. Paths are relative to /vercel/sandbox
   * unless absolute.
   */
  async writeFile(chatId: number, path: string, content: string): Promise<void> {
    const sandbox = await this.getOrCreate(chatId);
    await sandbox.fs.writeFile(path, content);
  }

  /**
   * Read a text file from the sandbox. Returns null when the file does not exist.
   */
  async readFile(chatId: number, path: string): Promise<string | null> {
    const sandbox = await this.getOrCreate(chatId);
    try {
      return await sandbox.fs.readFile(path, "utf8");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw e;
    }
  }

  /**
   * List files and directories at the given path.
   */
  async listFiles(chatId: number, path = "/vercel/sandbox"): Promise<string[]> {
    const sandbox = await this.getOrCreate(chatId);
    try {
      return await sandbox.fs.readdir(path);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return [];
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
        log.info({ chatId, sandbox: name }, "Deleting Vercel Sandbox");
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
    runtime?: string;
    timeout?: number;
    persistent: boolean;
  } | null> {
    const key = String(chatId);
    const existing = this.sandboxes.get(key);
    if (!existing) return null;

    return {
      name: existing.sandbox.name,
      status: existing.sandbox.status,
      runtime: existing.sandbox.runtime,
      timeout: existing.sandbox.timeout,
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
