/**
 * Vitest setup: bring the DB up in :memory: and apply all module migrations so
 * tests can exercise services that hit `getDb()` directly.
 */
import { getDb, runMigrations } from "../core/db.js";

// Make sure no test accidentally writes to the real on-disk DB.
process.env.DB_PATH = ":memory:";

// Touch all module migrations. Importing the modules brings their migration
// arrays into scope; we collect them here without invoking init().
import { auditModule } from "../modules/audit/index.js";
import { chatConfigModule } from "../modules/chatConfig/index.js";
import { chatLogModule } from "../modules/chatLog/index.js";
import { memoryModule } from "../modules/memory/index.js";
import { remindersModule } from "../modules/reminders/index.js";
import { userConfigModule } from "../modules/userConfig/index.js";

runMigrations(getDb(), [
  memoryModule,
  chatConfigModule,
  chatLogModule,
  auditModule,
  userConfigModule,
  remindersModule,
]);
