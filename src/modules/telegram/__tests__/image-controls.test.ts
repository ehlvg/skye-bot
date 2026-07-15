import { describe, expect, test } from "vitest";
import { IMAGE_CONTROL_TTL_MS, imageControlKey, imageKeyboard } from "../image-controls.js";

describe("image controls", () => {
  test("uses an unambiguous chat and message key", () => {
    expect(imageControlKey(-100123, 456)).toBe("-100123:456");
  });

  test("expires controls after fifteen minutes", () => {
    expect(IMAGE_CONTROL_TTL_MS).toBe(15 * 60 * 1000);
  });

  test("preserves callback data used by registered handlers", () => {
    expect(imageKeyboard().inline_keyboard).toEqual([
      [
        { text: "Variation", callback_data: "img:var" },
        { text: "Prompt+", callback_data: "img:prompt" },
      ],
      [
        { text: "Square", callback_data: "img:square" },
        { text: "Wide", callback_data: "img:wide" },
      ],
    ]);
  });
});
