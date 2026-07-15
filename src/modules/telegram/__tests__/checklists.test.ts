import { describe, expect, test } from "vitest";
import { extractChecklist, shouldPreferChecklist } from "../checklists.js";

describe("extractChecklist", () => {
  test("extracts a title and mixed task markers", () => {
    expect(extractChecklist("# Release plan\n- [ ] Run tests\n2. Publish build")).toEqual({
      title: "Release plan",
      tasks: [
        { id: 1, text: "Run tests" },
        { id: 2, text: "Publish build" },
      ],
      others_can_add_tasks: true,
      others_can_mark_tasks_as_done: true,
    });
  });

  test("requires at least two valid tasks", () => {
    expect(extractChecklist("# Notes\n- Only one task")).toBeUndefined();
  });

  test("limits Telegram checklists to thirty tasks", () => {
    const text = Array.from({ length: 35 }, (_, index) => `- Task ${index + 1}`).join("\n");
    expect(extractChecklist(text)?.tasks).toHaveLength(30);
  });
});

describe("shouldPreferChecklist", () => {
  const output = "- First useful task\n- Second useful task";

  test("requires an explicit checklist-style request", () => {
    expect(shouldPreferChecklist("Сделай чеклист", output)).toBe(true);
    expect(shouldPreferChecklist("Расскажи подробнее", output)).toBe(false);
  });

  test("rejects output that cannot form a Telegram checklist", () => {
    expect(shouldPreferChecklist("Give me a todo list", "One plain paragraph")).toBe(false);
  });
});
