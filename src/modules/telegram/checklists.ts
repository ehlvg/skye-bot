import type { Context as GrammyContext } from "grammy";
import type { InputChecklist, ReplyParameters } from "grammy/types";

export function replyParametersFor(ctx: GrammyContext): ReplyParameters | undefined {
  const messageId = ctx.message?.message_id;
  return messageId == null ? undefined : { message_id: messageId };
}

export function shouldPreferChecklist(inputText: string, outputText: string): boolean {
  const wantsChecklist = /(чеклист|список дел|todo|to-do|tasks|checklist|план|шаги|steps)/i.test(
    inputText
  );
  return wantsChecklist && extractChecklist(outputText) != null;
}

export function extractChecklist(text: string): InputChecklist | undefined {
  const lines = text.split("\n").map((line) => line.trim());
  const title =
    lines
      .find((line) => line.startsWith("#"))
      ?.replace(/^#+\s*/, "")
      .slice(0, 255) || "Checklist";

  const tasks = lines
    .map((line) => {
      const match = line.match(/^(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+)(.+)$/);
      return match?.[1].trim();
    })
    .filter((line): line is string => Boolean(line))
    .filter((line) => line.length >= 3 && line.length <= 100)
    .slice(0, 30)
    .map((line, index) => ({ id: index + 1, text: line }));

  if (tasks.length < 2) return undefined;
  return {
    title,
    tasks,
    others_can_add_tasks: true,
    others_can_mark_tasks_as_done: true,
  };
}
