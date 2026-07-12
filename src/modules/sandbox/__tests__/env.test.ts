import { describe, expect, it } from "vitest";
import { sandboxEnvSchema } from "../env.js";

describe("sandbox env schema", () => {
  it("parses defaults", () => {
    const parsed = sandboxEnvSchema.parse({});
    expect(parsed.SANDBOX_ENABLED).toBe(true);
    expect(parsed.SANDBOX_IMAGE).toBe("node:24-bookworm");
    expect(parsed.SANDBOX_CPU).toBe(1);
    expect(parsed.SANDBOX_MEMORY_GIB).toBe(1);
    expect(parsed.SANDBOX_DISK_GIB).toBe(3);
    expect(parsed.SANDBOX_AUTO_STOP_MINUTES).toBe(15);
    expect(parsed.SANDBOX_PERSISTENT).toBe(false);
    expect(parsed.SANDBOX_COMMAND_TIMEOUT_MS).toBe(60000);
    expect(parsed.SANDBOX_MAX_OUTPUT_CHARS).toBe(64000);
    expect(parsed.SANDBOX_MAX_FILE_BYTES).toBe(1000000);
  });

  it("rejects oversized resource and file limits", () => {
    expect(() => sandboxEnvSchema.parse({ SANDBOX_CPU: 5 })).toThrow();
    expect(() => sandboxEnvSchema.parse({ SANDBOX_MAX_FILE_BYTES: 100_000_000 })).toThrow();
  });

  it("parses boolean flags from strings", () => {
    const parsed = sandboxEnvSchema.parse({
      SANDBOX_ENABLED: "false",
      SANDBOX_PERSISTENT: "1",
    });
    expect(parsed.SANDBOX_ENABLED).toBe(false);
    expect(parsed.SANDBOX_PERSISTENT).toBe(true);
  });

  it("parses numeric values from strings", () => {
    const parsed = sandboxEnvSchema.parse({
      SANDBOX_AUTO_STOP_MINUTES: "60",
      SANDBOX_CPU: "4",
      SANDBOX_COMMAND_TIMEOUT_MS: "120000",
    });
    expect(parsed.SANDBOX_AUTO_STOP_MINUTES).toBe(60);
    expect(parsed.SANDBOX_CPU).toBe(4);
    expect(parsed.SANDBOX_COMMAND_TIMEOUT_MS).toBe(120000);
  });

  it("captures Daytona credentials when present", () => {
    const parsed = sandboxEnvSchema.parse({
      DAYTONA_API_KEY: "dtn_xxx",
      DAYTONA_API_URL: "https://daytona.example/api",
      DAYTONA_TARGET: "us",
    });
    expect(parsed.DAYTONA_API_KEY).toBe("dtn_xxx");
    expect(parsed.DAYTONA_API_URL).toBe("https://daytona.example/api");
    expect(parsed.DAYTONA_TARGET).toBe("us");
  });
});
