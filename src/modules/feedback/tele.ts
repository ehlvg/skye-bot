import type { Context as GrammyContext } from "grammy";
import type { TelegramCommand } from "../../core/module.js";
import type { AdminService } from "../admin/service.js";
import { sendRichReply } from "../telegram/helpers.js";
import type { FeedbackService, FeedbackStatsPeriod } from "./service.js";

function formatPeriod(label: string, stats: FeedbackStatsPeriod): string {
  const positiveShare = stats.total === 0 ? 0 : Math.round((stats.positive / stats.total) * 100);
  return [
    `### ${label}`,
    `- Всего оценок: **${stats.total}**`,
    `- 👍 Положительных: **${stats.positive}** (${positiveShare}%)`,
    `- 👎 Отрицательных: **${stats.negative}**`,
    `- Уникальных пользователей: **${stats.uniqueUsers}**`,
  ].join("\n");
}

export function buildFeedbackCommands(
  feedback: FeedbackService,
  admin: AdminService
): TelegramCommand[] {
  return [
    {
      name: "feedback_stats",
      description: "(admin) Show answer feedback statistics",
      public: true,
      handler: async (ctx: GrammyContext) => {
        if (!admin.isAdmin(ctx.from?.id)) {
          await sendRichReply(ctx, "🚫 Эта команда доступна только администраторам бота.");
          return;
        }

        const stats = feedback.stats();
        await sendRichReply(
          ctx,
          [
            "## Оценки ответов",
            "",
            formatPeriod("За последние 30 дней", stats.last30Days),
            "",
            formatPeriod("За всё время", stats.allTime),
            "",
            "_Сохраняются только Telegram ID чата, ответа и пользователя, оценка и время._",
          ].join("\n")
        );
      },
    },
  ];
}
