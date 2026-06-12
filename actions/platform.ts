"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { providerSettings } from "@/db/schema";
import { encryptSecret, isProviderKeyConfigError } from "@/lib/ai/crypto";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { AppActionError, err, fromZod, guard, ok, type Result } from "@/lib/errors";

/**
 * Platform-owner AI provider configuration (D5). provider_settings is
 * platform-scoped (RLS requires app.is_platform, which scoped() sets only for
 * the platform role). Keys are encrypted before they touch the database.
 *
 * BYO-key-per-company is explicitly out of scope (PLAN §9): one central
 * provider config drives every tenant.
 */

const requirePlatform = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role !== "platform") {
    throw new AppActionError("forbidden", "Platform-owner access only.");
  }
  return auth;
};

export type ProviderSettingsView = {
  provider: "openclaw" | "direct" | null;
  endpoint: string;
  model: string;
  alertThresholdUsd: number | null;
  hasKey: boolean;
};

export const getProviderSettingsView = async (): Promise<Result<ProviderSettingsView>> =>
  guard<ProviderSettingsView>(async () => {
    const auth = await requirePlatform();

    return scoped<Result<ProviderSettingsView>>(auth, async (tx) => {
      const row = await tx.query.providerSettings.findFirst();
      if (!row) {
        return ok({
          provider: null,
          endpoint: "",
          model: "",
          alertThresholdUsd: null,
          hasKey: false,
        });
      }
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      return ok({
        provider: (row.provider as "openclaw" | "direct") ?? null,
        endpoint: String(settings.endpoint ?? settings.baseUrl ?? ""),
        model: String(settings.model ?? ""),
        alertThresholdUsd: row.alertThresholdUsd ? Number(row.alertThresholdUsd) : null,
        hasKey: Boolean(row.encryptedKey),
      });
    });
  });

const upsertSchema = z.object({
  provider: z.enum(["openclaw", "direct"]),
  endpoint: z.string().trim().url().max(500),
  model: z.string().trim().min(1).max(120),
  // Optional: leave blank to keep the existing key.
  apiKey: z.string().trim().max(500).optional(),
  alertThresholdUsd: z.number().nonnegative().max(100000).optional(),
});

export const upsertProviderSettings = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = upsertSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requirePlatform();
    const { provider, endpoint, model, apiKey, alertThresholdUsd } = parsed.data;

    let encryptedKey: string | undefined;
    if (apiKey) {
      try {
        encryptedKey = encryptSecret(apiKey);
      } catch (error) {
        if (isProviderKeyConfigError(error)) {
          return err(
            "conflict",
            "Set the PROVIDER_KEY_SECRET environment variable before saving a provider key."
          );
        }
        throw error;
      }
    }

    return scoped<Result<null>>(auth, async (tx) => {
      const existing = await tx.query.providerSettings.findFirst();

      // This provider becomes the single active one.
      const settings = { active: true, endpoint, model };

      if (existing) {
        await tx
          .update(providerSettings)
          .set({
            provider,
            settings,
            ...(encryptedKey ? { encryptedKey } : {}),
            ...(alertThresholdUsd !== undefined
              ? { alertThresholdUsd: String(alertThresholdUsd) }
              : {}),
            updatedAt: new Date(),
          })
          .where(sql`${providerSettings.id} = ${existing.id}`);
      } else {
        if (!encryptedKey) {
          return err("validation", "An API key is required to configure a provider.");
        }
        await tx.insert(providerSettings).values({
          provider,
          settings,
          encryptedKey,
          alertThresholdUsd:
            alertThresholdUsd !== undefined ? String(alertThresholdUsd) : null,
        });
      }

      revalidatePath("/platform/settings");
      return ok(null);
    });
  });
