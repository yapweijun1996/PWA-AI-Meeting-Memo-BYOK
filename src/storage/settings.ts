import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { z } from "zod";

const Selection = z
  .object({
    provider: z.enum(["openai", "openrouter"]),
    model: z.string().min(1).max(100),
  })
  .strict();
const StoredSettings = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    keys: z
      .object({
        openai: z.string().max(4096),
        openrouter: z.string().max(4096),
      })
      .strict(),
    speech: Selection,
    memo: Selection,
    speechRate: z.number().finite().min(0).max(10).nullable(),
    uiLanguage: z.enum(["en", "zh-CN"]).optional(),
    speechRateContext: z.object({ source: z.string().min(1).max(300), date: z.iso.date(), provider: Selection.shape.provider, model: Selection.shape.model }).strict().nullable().optional(),
  })
  .strict();
export type SettingsRecord = z.infer<typeof StoredSettings>;
interface SettingsDB extends DBSchema {
  settings: { key: string; value: SettingsRecord };
}
let pending: Promise<IDBPDatabase<SettingsDB>> | undefined;
function db() {
  pending ??= openDB<SettingsDB>("meeting-memo-settings-v1", 1, {
    upgrade(database) {
      database.createObjectStore("settings");
    },
    blocking() {
      void pending?.then((database) => database.close());
      pending = undefined;
    },
    terminated() {
      pending = undefined;
    },
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
export async function readSettings(): Promise<SettingsRecord | null> {
  const value = await (await db()).get("settings", "current");
  return value === undefined ? null : StoredSettings.parse(value);
}
export async function writeSettings(
  value: SettingsRecord,
  expectedRevision: number,
): Promise<SettingsRecord> {
  const next = StoredSettings.parse({
    ...value,
    version: 1,
    revision: expectedRevision + 1,
  });
  const transaction = (await db()).transaction("settings", "readwrite");
  try {
    const previous = await transaction.store.get("current");
    const actual =
      previous === undefined ? 0 : StoredSettings.parse(previous).revision;
    if (actual !== expectedRevision) {
      transaction.abort();
      await transaction.done.catch(() => {});
      throw new Error(
        "Settings changed in another tab. Copy any unsaved changes, then reload before saving.",
      );
    }
    await transaction.store.put(next, "current");
    await transaction.done;
    return next;
  } catch (error) {
    await transaction.done.catch(() => {});
    throw error;
  }
}
