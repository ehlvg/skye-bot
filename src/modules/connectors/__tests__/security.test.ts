import { describe, expect, test } from "vitest";
import { isPrivateNetworkAddress, parseCustomConnectorConfig } from "../service.js";

describe("custom connector configuration", () => {
  test("accepts a strict HTTPS remote connector", () => {
    expect(
      parseCustomConnectorConfig({
        type: "http",
        url: "https://connector.example.com/mcp",
        headers: { Authorization: "${input:TOKEN}" },
      })
    ).toMatchObject({ type: "http" });
  });

  test.each([
    { type: "stdio", command: "/bin/sh" },
    { command: "/bin/sh" },
    { type: "http", url: "http://localhost:3000" },
    { type: "http", url: "https://connector.example.com/mcp", command: "/bin/sh" },
    {
      type: "http",
      url: "https://connector.example.com/mcp",
      headers: { Authorization: "Bearer plaintext-secret" },
    },
    { type: "http", url: "https://user:secret@connector.example.com/mcp" },
  ])("rejects unsafe config %#", (config) => {
    expect(() => parseCustomConnectorConfig(config)).toThrow();
  });

  test.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.1.1",
    "::1",
    "fd00::1",
  ])("recognizes private or local address %s", (address) =>
    expect(isPrivateNetworkAddress(address)).toBe(true)
  );

  test.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("allows public address %s", (address) =>
    expect(isPrivateNetworkAddress(address)).toBe(false)
  );
});
