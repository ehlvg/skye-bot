import { beforeEach, describe, expect, test } from "vitest";
import { getDb } from "../../../core/db.js";
import { userConfigService } from "../service.js";

beforeEach(() => {
  getDb().exec("DELETE FROM user_connector_inputs; DELETE FROM user_custom_connectors;");
});

describe("custom connector ownership", () => {
  test("cannot delete another user's inputs", () => {
    const id = userConfigService.addCustomConnector(1, "victim", {
      type: "http",
      url: "https://mcp.example.com",
    });
    userConfigService.setConnectorInput(id, "TOKEN", "secret");
    expect(userConfigService.deleteCustomConnector(id, 2)).toBe(false);
    expect(userConfigService.getCustomConnector(id, 1)).not.toBeNull();
    expect(userConfigService.getConnectorInputs(id)).toEqual({ TOKEN: "secret" });
  });
});
