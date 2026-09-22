/**
 * HyperFormula executes in the browser, so its licensed key is build-time
 * configuration rather than a server secret. Local test/development retains
 * the upstream GPL key; the production release must set the commercial key.
 */
export const HYPERFORMULA_LICENSE_KEY = import.meta.env.VITE_HYPERFORMULA_LICENSE_KEY || "gpl-v3";

export const HYPERFORMULA_COMMERCIAL_KEY_CONFIGURED = Boolean(import.meta.env.VITE_HYPERFORMULA_LICENSE_KEY);
