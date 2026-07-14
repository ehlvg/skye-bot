import type { SkyeModule } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { feedbackService, type FeedbackService } from "./service.js";
import { buildFeedbackCommands } from "./tele.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    feedback: FeedbackService;
  }
}

export const feedbackModule: SkyeModule = {
  name: "feedback",
  migrations,
  init(ctx) {
    ctx.services.set("feedback", feedbackService);
    return {
      service: feedbackService,
      commands: buildFeedbackCommands(feedbackService, ctx.services.get("admin")),
    };
  },
};
