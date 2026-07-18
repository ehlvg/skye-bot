import { readFileSync } from "fs";
import { join } from "path";

let cachedVersion: string | undefined;

export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version?: unknown;
    };
    cachedVersion = typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

export function appCommit(): string | undefined {
  const value = process.env.SKYE_COMMIT?.trim();
  return value && /^[0-9a-f]{7,40}$/i.test(value) ? value : undefined;
}
