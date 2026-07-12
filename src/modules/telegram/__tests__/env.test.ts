import { describe, expect, it } from "vitest";
import { telegramEnvSchema } from "../env.js";

describe("telegram env security limits", () => {
  it("defaults attachment downloads to 25 MiB", () => {
    expect(telegramEnvSchema.parse({ BOT_TOKEN: "token" }).TELEGRAM_MAX_ATTACHMENT_BYTES).toBe(
      25 * 1024 * 1024
    );
  });

  it("rejects attachment limits above 50 MiB", () => {
    expect(() =>
      telegramEnvSchema.parse({
        BOT_TOKEN: "token",
        TELEGRAM_MAX_ATTACHMENT_BYTES: 51 * 1024 * 1024,
      })
    ).toThrow();
  });
});
