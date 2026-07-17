#!/usr/bin/env tsx
/**
 * Validate config.yaml against the composed module config schemas.
 *
 * Uses the same loading + parsing path the bot uses at startup, so a
 * passing run here means a passing boot. Exits non-zero on any issue.
 *
 *   pnpm validate-config                  # validates ./config.yaml
 *   SKYE_CONFIG=other.yaml pnpm validate-config
 */
import { existsSync } from "fs";
import { join } from "path";
import { load as parseYaml } from "js-yaml";
import { readFileSync } from "fs";

import { composeSchema } from "../src/core/config.js";
import { modules } from "../src/modules.js";

function main(): void {
  const configPath = process.env.SKYE_CONFIG ?? join(process.cwd(), "config.yaml");

  if (!existsSync(configPath)) {
    console.error(`✖ No config file at ${configPath}`);
    console.error("  Set SKYE_CONFIG or create config.yaml from config.example.yaml.");
    process.exit(2);
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.error(`✖ Failed to parse YAML at ${configPath}:`, e);
    process.exit(2);
  }

  const schema = composeSchema(modules);
  const result = schema.safeParse(raw);
  if (!result.success) {
    console.error(`✖ ${configPath}: invalid configuration\n`);
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "(root)";
      console.error(`  ✖ ${path}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Cross-field sanity checks that Zod can't express inline.
  const cfg = result.data as {
    models?: Array<{ provider?: string }>;
    perplexity_api_key?: string;
    voice?: { provider: string; yc_api_key: string };
  };
  const warnings: string[] = [];

  const perplexityUsed = cfg.models?.some((m) => m.provider === "perplexity") ?? false;
  if (perplexityUsed && !cfg.perplexity_api_key) {
    console.error('✖ a model uses provider: "perplexity" but perplexity_api_key is unset');
    process.exit(1);
  }

  if (cfg.voice?.provider === "yandex" && !cfg.voice.yc_api_key) {
    warnings.push("voice.provider=yandex but voice.yc_api_key is unset");
  }

  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  console.log(`✓ ${configPath}: valid (${warnings.length} warning(s))`);
}

main();