import { describe, expect, test, vi } from "vitest";
import { userConfigService } from "../../userConfig/service.js";
import {
  ConnectorService,
  isPrivateNetworkAddress,
  parseCustomConnectorConfig,
} from "../service.js";

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

describe("managed connector catalog", () => {
  test("paginates toolkit requests within Composio's 50-item limit", async () => {
    const toolkits = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ slug: "gmail", name: "Gmail", connection: { isActive: true } }],
        cursor: "next-page",
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{ slug: "github", name: "GitHub", connection: { isActive: false } }],
        totalPages: 2,
      });
    const service = new ConnectorService({
      userConfig: userConfigService,
      composioApiKey: "",
      allowedToolkits: ["gmail", "github"],
      disableDestructiveTools: true,
      customEnabled: false,
      maxCustomPerUser: 0,
      allowPrivateCustomServers: false,
      maxToolOutputChars: 64_000,
    });
    Object.assign(service, {
      composio: {},
      managedSessions: new Map([[123, { toolkits }]]),
    });

    const catalog = await service.managedCatalog(123);

    expect(toolkits).toHaveBeenNthCalledWith(1, {
      toolkits: ["gmail", "github"],
      limit: 50,
    });
    expect(toolkits).toHaveBeenNthCalledWith(2, {
      toolkits: ["gmail", "github"],
      cursor: "next-page",
      limit: 50,
    });
    expect(catalog.connectors).toEqual([
      expect.objectContaining({ slug: "gmail", connected: true }),
      expect.objectContaining({ slug: "github", connected: false }),
    ]);
  });
});
