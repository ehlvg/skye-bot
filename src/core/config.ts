import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { load as parseYaml } from "js-yaml";

let cachedConfig: Record<string, string> | null = null;

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const flatKey = (prefix ? `${prefix}_${key}` : key).toUpperCase();
    if (value === null) {
      result[flatKey] = "";
    } else if (Array.isArray(value)) {
      // Arrays are flattened to a JSON string so Zod schemas can parse them
      // back into structured values (e.g. the model catalog, token packs).
      result[flatKey] = JSON.stringify(value);
    } else if (typeof value === "object") {
      Object.assign(result, flatten(value as Record<string, unknown>, flatKey));
    } else {
      result[flatKey] = String(value);
    }
  }
  return result;
}

export function loadConfig(): Record<string, string> {
  if (cachedConfig) return cachedConfig;

  const configPath = process.env.SKYE_CONFIG ?? join(process.cwd(), "config.yaml");

  if (!existsSync(configPath)) {
    console.warn(`[skye] No config.yaml found at ${configPath} — falling back to environment variables only`);
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown>;
    cachedConfig = flatten(parsed);
  } catch (e) {
    console.error(`[skye] Failed to parse config.yaml at ${configPath}:`, e);
    throw e;
  }

  for (const [key, value] of Object.entries(cachedConfig)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  console.info(`[skye] Configuration loaded from ${configPath} (${Object.keys(cachedConfig).length} keys)`);
  return cachedConfig;
}

loadConfig();