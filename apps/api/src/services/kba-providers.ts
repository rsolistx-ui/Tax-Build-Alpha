import type { Env } from "../env";

/**
 * Knowledge-based authentication (KBA) providers for remote IRS Form 8878/8879
 * electronic signatures (Publication 1345: NIST SP 800-63 level 2 plus KBA,
 * record check against credit bureaus or similar databases, 3 attempts max).
 *
 * The credit-history data behind KBA questions exists only at the bureaus, so
 * this step cannot be built in-house. Each vendor plugs in through this
 * interface. Remote signing stays off until EFILE_KBA_PROVIDER names a vendor
 * whose adapter is implemented and whose credentials are present.
 */
export type KbaProviderId = "lexisnexis" | "experian";

export type KbaSubject = {
  firstName: string;
  lastName: string;
  ssn: string;
  dateOfBirth: string;
  address: { line1: string; city: string; state: string; postalCode: string };
};

export type KbaQuestion = { id: string; prompt: string; choices: Array<{ id: string; label: string }> };

export interface KbaProvider {
  readonly id: KbaProviderId;
  readonly displayName: string;
  /** False until the vendor's API contract is coded against. */
  readonly implemented: boolean;
  startQuiz(env: Env, subject: KbaSubject): Promise<{ sessionRef: string; questions: KbaQuestion[] }>;
  scoreQuiz(env: Env, sessionRef: string, answers: Record<string, string>): Promise<{ passed: boolean; providerReference: string }>;
}

export class KbaUnavailableError extends Error {
  readonly code = "KBA_PROVIDER_DISABLED";
}

function contractRequired(name: string): never {
  throw new KbaUnavailableError(`${name} KBA is not connected. The API specification is issued with the vendor contract.`);
}

// Vendor adapters. Their request/response mapping is written once the vendor
// issues API credentials and documentation; until then they refuse to run.
const lexisNexis: KbaProvider = {
  id: "lexisnexis",
  displayName: "LexisNexis Risk Solutions",
  implemented: false,
  startQuiz: async () => contractRequired("LexisNexis"),
  scoreQuiz: async () => contractRequired("LexisNexis"),
};

const experian: KbaProvider = {
  id: "experian",
  displayName: "Experian",
  implemented: false,
  startQuiz: async () => contractRequired("Experian"),
  scoreQuiz: async () => contractRequired("Experian"),
};

export const KBA_PROVIDERS: Record<KbaProviderId, KbaProvider> = { lexisnexis: lexisNexis, experian };

export type KbaStatus =
  | { enabled: true; provider: KbaProvider }
  | { enabled: false; reason: string; providers: Array<{ id: KbaProviderId; displayName: string; implemented: boolean }> };

export function resolveKbaProvider(
  env: Pick<Env, "EFILE_KBA_PROVIDER" | "EFILE_KBA_API_KEY">,
  registry: Record<string, KbaProvider> = KBA_PROVIDERS,
): KbaStatus {
  const providers = Object.values(registry).map(({ id, displayName, implemented }) => ({ id, displayName, implemented }));
  const selected = env.EFILE_KBA_PROVIDER?.trim().toLowerCase();
  if (!selected) return { enabled: false, reason: "No identity-verification vendor is selected.", providers };
  const provider = registry[selected];
  if (!provider) return { enabled: false, reason: `Unknown identity-verification vendor "${selected}".`, providers };
  if (!provider.implemented) return { enabled: false, reason: `${provider.displayName} is selected but its adapter is not connected yet.`, providers };
  if (!env.EFILE_KBA_API_KEY) return { enabled: false, reason: `${provider.displayName} credentials are not set.`, providers };
  return { enabled: true, provider };
}

export const KBA_MAX_ATTEMPTS = 3;
