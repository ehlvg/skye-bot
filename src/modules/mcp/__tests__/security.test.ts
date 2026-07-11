import { describe, expect, test } from "vitest";
import { parseUserMcpConfig } from "../service.js";

describe("user MCP configuration", () => {
  test("accepts strict HTTPS remote servers", () => {
    expect(
      parseUserMcpConfig({
        type: "http",
        url: "https://mcp.example.com",
        headers: { Authorization: "${input:TOKEN}" },
      })
    ).toMatchObject({ type: "http" });
  });

  test.each([
    { type: "stdio", command: "/bin/sh" },
    { command: "/bin/sh" },
    { type: "http", url: "http://localhost:3000" },
    { type: "http", url: "https://mcp.example.com", command: "/bin/sh" },
  ])("rejects unsafe config %#", (config) => {
    expect(() => parseUserMcpConfig(config)).toThrow();
  });
});
