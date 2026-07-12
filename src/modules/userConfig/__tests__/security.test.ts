import { beforeEach, describe, expect, test } from "vitest";
import { getDb } from "../../../core/db.js";
import { userConfigService } from "../service.js";

beforeEach(() => {
  getDb().exec("DELETE FROM user_mcp_inputs; DELETE FROM user_mcp_servers;");
});

describe("MCP ownership", () => {
  test("cannot delete another user's inputs", () => {
    const id = userConfigService.addMcpServer(1, "victim", {
      type: "http",
      url: "https://mcp.example.com",
    });
    userConfigService.setMcpInput(id, "TOKEN", "secret");
    expect(userConfigService.deleteMcpServer(id, 2)).toBe(false);
    expect(userConfigService.getMcpServer(id, 1)).not.toBeNull();
    expect(userConfigService.getMcpInputs(id)).toEqual({ TOKEN: "secret" });
  });
});
