import { z } from "zod";

export const proactiveEnvSchema = z.object({
  // Master switch for proactive reactions in groups.
  PROACTIVE_ENABLED: z.coerce.boolean().default(true),
  // Probability (0..1) that any given group message triggers a proactive
  // reaction attempt. The model itself decides whether to react, so this
  // only gates how often we even ask it.
  PROACTIVE_PROBABILITY: z.coerce.number().min(0).max(1).default(0.06),
  // Minimum messages that must have been seen in a chat before Skye ever
  // reacts proactively. Avoids Skye reacting to the very first message.
  PROACTIVE_WARMUP: z.coerce.number().int().min(0).default(8),
  // Minimum seconds between two proactive reactions in the same chat.
  PROACTIVE_MIN_INTERVAL_SEC: z.coerce.number().int().min(0).default(180),
  // How many recent group messages to feed the model when picking a target.
  PROACTIVE_CONTEXT_SIZE: z.coerce.number().int().min(2).max(60).default(20),
});

export type ProactiveEnv = z.infer<typeof proactiveEnvSchema>;