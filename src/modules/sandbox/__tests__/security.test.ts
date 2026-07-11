import { describe, expect, it } from "vitest";
import { sandboxPath, validateSandboxCommand } from "../service.js";

describe("sandbox security boundaries", () => {
  it("keeps relative paths inside the sandbox root", () => {
    expect(sandboxPath("workspace/file.txt")).toBe("/vercel/sandbox/workspace/file.txt");
    expect(sandboxPath("workspace/../file.txt")).toBe("/vercel/sandbox/file.txt");
  });

  it("rejects absolute paths and traversal outside the sandbox", () => {
    expect(() => sandboxPath("../../etc/passwd")).toThrow();
    expect(() => sandboxPath("/etc/passwd")).toThrow();
  });

  it("rejects shell syntax and oversized command input", () => {
    expect(() => validateSandboxCommand("sh -c", [], 4, 20)).toThrow();
    expect(() => validateSandboxCommand("node", ["a", "b", "c"], 2, 20)).toThrow();
    expect(() => validateSandboxCommand("node", ["x".repeat(21)], 4, 20)).toThrow();
    expect(() => validateSandboxCommand("node", ["--version"], 4, 20)).not.toThrow();
  });
});
