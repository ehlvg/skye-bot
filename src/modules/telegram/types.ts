import type { EventBus } from "../../core/events.js";
import type { AdminService } from "../admin/service.js";
import type { AuditService } from "../audit/service.js";
import type { BillingService } from "../billing/service.js";
import type { ChannelService } from "../channel/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { LlmClient } from "../llm/client.js";
import type { McpService } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ProactiveService } from "../proactive/service.js";
import type { RemindersService } from "../reminders/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { SpeechService } from "../speech/service.js";
import type { UserConfigService } from "../userConfig/service.js";

/** Runtime services and configuration used by Telegram transport handlers. */
export interface TelegramDeps {
  llm: LlmClient;
  mcp: McpService;
  memory: MemoryService;
  chatLog: ChatLogService;
  chatConfig: ChatConfigService;
  userConfig: UserConfigService;
  speech: SpeechService;
  audit: AuditService;
  sandbox?: SandboxService;
  proactive?: ProactiveService;
  reminders?: RemindersService;
  channel?: ChannelService;
  events?: EventBus;
  billing: BillingService;
  admin: AdminService;
  botToken: string;
  maxAttachmentBytes: number;
  webappUrl: string;
  defaultModelId: string;
  owner?: { name: string; tag: string };
}
