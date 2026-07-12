import { describe, expect, it, vi } from "vitest";
import { sandboxTools } from "../tools.js";
import type { SandboxService } from "../service.js";
import type { TenantContext } from "../../../core/tenant.js";

const makeService = (overrides?: Partial<SandboxService>): SandboxService =>
  ({
    isEnabled: () => true,
    runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("hello"),
    listFiles: vi.fn().mockResolvedValue(["a.txt", "b.txt"]),
    reset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as SandboxService;

const tenant: TenantContext = {
  chatId: 123,
  chatType: "private",
  userId: 456,
};

describe("sandbox tools", () => {
  it("exposes the expected tool names", () => {
    const tools = sandboxTools(makeService());
    expect(tools.map((t) => t.name)).toEqual([
      "sandbox_run_command",
      "sandbox_write_file",
      "sandbox_read_file",
      "sandbox_list_files",
      "sandbox_reset",
    ]);
  });

  it("runs a command and returns exit code and output", async () => {
    const service = makeService();
    const tools = sandboxTools(service);
    const run = tools.find((t) => t.name === "sandbox_run_command")!;
    const result = await run.execute({ command: "echo", args: ["hi"] }, tenant);
    expect(service.runCommand).toHaveBeenCalledWith(123, "echo", ["hi"], {
      cwd: undefined,
      timeoutMs: undefined,
    });
    expect(result).toContain("exit_code: 0");
    expect(result).toContain("ok");
  });

  it("writes a file", async () => {
    const service = makeService();
    const tools = sandboxTools(service);
    const write = tools.find((t) => t.name === "sandbox_write_file")!;
    const result = await write.execute({ path: "test.txt", content: "data" }, tenant);
    expect(service.writeFile).toHaveBeenCalledWith(123, "test.txt", "data");
    expect(result).toBe("Wrote test.txt");
  });

  it("reads a file and returns content", async () => {
    const service = makeService();
    const tools = sandboxTools(service);
    const read = tools.find((t) => t.name === "sandbox_read_file")!;
    const result = await read.execute({ path: "test.txt" }, tenant);
    expect(service.readFile).toHaveBeenCalledWith(123, "test.txt");
    expect(result).toBe("hello");
  });

  it("returns an error when reading a missing file", async () => {
    const service = makeService({ readFile: vi.fn().mockResolvedValue(null) });
    const tools = sandboxTools(service);
    const read = tools.find((t) => t.name === "sandbox_read_file")!;
    const result = await read.execute({ path: "missing.txt" }, tenant);
    expect(result).toBe("File not found: missing.txt");
  });

  it("lists files", async () => {
    const service = makeService();
    const tools = sandboxTools(service);
    const list = tools.find((t) => t.name === "sandbox_list_files")!;
    const result = await list.execute({ path: "/home/daytona" }, tenant);
    expect(service.listFiles).toHaveBeenCalledWith(123, "/home/daytona");
    expect(result).toBe("a.txt\nb.txt");
  });

  it("truncates long output", async () => {
    const longOutput = "a".repeat(10000);
    const service = makeService({
      runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: longOutput, stderr: "" }),
    });
    const tools = sandboxTools(service);
    const run = tools.find((t) => t.name === "sandbox_run_command")!;
    const result = await run.execute({ command: "cat", args: ["big.txt"] }, tenant);
    expect(result.length).toBeLessThan(longOutput.length);
    expect(result).toContain("[truncated");
  });
});
