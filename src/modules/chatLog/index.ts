import type { SkyeModule } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { chatLogService, type ChatLogService } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    chatLog: ChatLogService;
  }
}

export const chatLogModule: SkyeModule = {
  name: "chatLog",
  migrations,
  init() {
    return { service: chatLogService };
  },
};
