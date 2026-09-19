import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readExistingConfig } from "../config/storage.ts";
import { redactSecrets } from "../redaction.ts";

export type JevKeySource = "bun-secrets" | "env" | "advisor-json";

export interface JevKeyResolution {
  key?: string;
  /** Present whenever a key resolved. */
  source?: JevKeySource;
}

export interface JevKeyStoreResult {
  message: string;
  ok: boolean;
}

export interface JevSecretEntry {
  name: string;
  service: string;
}

export interface JevSecretsLike {
  delete: (options: JevSecretEntry) => Promise<unknown>;
  get: (options: JevSecretEntry) => Promise<string | null | undefined>;
  set: (options: JevSecretEntry & { value: string }) => Promise<void>;
}

export interface JevKeyStoreDeps {
  env?: Record<string, string | undefined>;
  readAdvisorJson?: () => Record<string, unknown>;
  /** Inject `null` to simulate a runtime without a secret store. */
  secrets?: JevSecretsLike | null;
}

export const TYPESAFE_KEY_ENV_VAR = "TYPESAFE_API_KEY";
export const TYPESAFE_KEY_SERVICE = "pi-advisor";
export const TYPESAFE_KEY_NAME = "typesafe-api-key";
export const TYPESAFE_KEY_CONFIG_FIELD = "typesafe_api_key";

const runtimeSecrets = (): JevSecretsLike | undefined =>
  (globalThis as { Bun?: { secrets?: JevSecretsLike } }).Bun?.secrets;

const normalizeKey = (value: string | null | undefined): string | undefined =>
  value?.trim() || undefined;

const readAdvisorJsonConfig = (): Record<string, unknown> =>
  readExistingConfig(join(getAgentDir(), "advisor.json"));

const messageOf = (error: unknown) =>
  redactSecrets(error instanceof Error ? error.message : String(error));

/** Resolves the TypeSafe API key: Bun.secrets → env var → hand-placed
 * advisor.json string (read-only). Never throws; no key means undefined. */
export const resolveTypeSafeKey = async (
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyResolution> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (secrets) {
    try {
      const stored = normalizeKey(
        await secrets.get({
          name: TYPESAFE_KEY_NAME,
          service: TYPESAFE_KEY_SERVICE,
        })
      );
      if (stored) {
        return { key: stored, source: "bun-secrets" };
      }
    } catch {
      // An unavailable secret store falls through to the next source.
    }
  }
  const env = deps.env ?? process.env;
  const fromEnv = normalizeKey(env[TYPESAFE_KEY_ENV_VAR]);
  if (fromEnv) {
    return { key: fromEnv, source: "env" };
  }
  const config = (deps.readAdvisorJson ?? readAdvisorJsonConfig)();
  const staged = config[TYPESAFE_KEY_CONFIG_FIELD];
  if (typeof staged === "string") {
    const fromConfig = normalizeKey(staged);
    if (fromConfig) {
      return { key: fromConfig, source: "advisor-json" };
    }
  }
  return {};
};

/** Stores the key in Bun.secrets only; pi-advisor never writes a key file. */
export const writeKeyTypeSafeKey = async (
  key: string,
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return { message: "The key is empty.", ok: false };
  }
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (!secrets) {
    return {
      message: `Bun.secrets is unavailable in this runtime. Set the ${TYPESAFE_KEY_ENV_VAR} environment variable in your shell profile instead.`,
      ok: false,
    };
  }
  try {
    await secrets.set({
      name: TYPESAFE_KEY_NAME,
      service: TYPESAFE_KEY_SERVICE,
      value: normalized,
    });
    return { message: "Key stored in Bun.secrets.", ok: true };
  } catch (error) {
    return {
      message: `Storing the key in Bun.secrets failed: ${messageOf(error)}. Alternatively set the ${TYPESAFE_KEY_ENV_VAR} environment variable in your shell profile.`,
      ok: false,
    };
  }
};

/** Removes a previously stored Bun.secrets entry; never touches env or config. */
export const clearKeyTypeSafeKey = async (
  deps: JevKeyStoreDeps = {}
): Promise<JevKeyStoreResult> => {
  const secrets = deps.secrets === undefined ? runtimeSecrets() : deps.secrets;
  if (!secrets) {
    return {
      message: `No Bun.secrets store is active in this runtime; pi-advisor stored nothing. Unset ${TYPESAFE_KEY_ENV_VAR} yourself if you use it.`,
      ok: false,
    };
  }
  try {
    await secrets.delete({
      name: TYPESAFE_KEY_NAME,
      service: TYPESAFE_KEY_SERVICE,
    });
    return { message: "Stored key cleared.", ok: true };
  } catch (error) {
    return {
      message: `Clearing the stored key failed: ${messageOf(error)}.`,
      ok: false,
    };
  }
};

let warnedPlaintextKey = false;

/** Returns the plaintext-key warning once so callers can notify without spam. */
export const consumePlaintextKeyWarning = (): string | undefined => {
  if (warnedPlaintextKey) {
    return undefined;
  }
  warnedPlaintextKey = true;
  return `Advisor is using a plaintext ${TYPESAFE_KEY_CONFIG_FIELD} from advisor.json; this is not recommended. Open /advisor-settings → Jev consultation filter to migrate it, or use the ${TYPESAFE_KEY_ENV_VAR} environment variable.`;
};

/** Test-only: re-arms the one-time plaintext warning. */
export const resetPlaintextKeyWarning = () => {
  warnedPlaintextKey = false;
};
