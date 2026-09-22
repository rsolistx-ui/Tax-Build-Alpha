/**
 * Forms 8878 and 8879 are IRS e-file authorizations, not ordinary contracts.
 * We deliberately keep them outside the native signing path until the full
 * IRS remote-signature control set is implemented and independently validated.
 */
export function isIrsEfileAuthorization(formType: string | null | undefined): boolean {
  return /^887(?:8|9)(?:[-\s]|$)/i.test(formType?.trim() ?? "");
}

export const IRS_EFILE_SIGNATURE_PROVIDER_MESSAGE =
  "IRS Forms 8878 and 8879 must be signed through the firm's validated e-file provider. Truepost preserves the return-ready evidence and signature status, but does not treat a native or manually completed signature as IRS e-file authorization.";
