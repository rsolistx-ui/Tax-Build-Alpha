# Native E-Sign Status

## Current release

Folio can create and retain an in-house signed PDF for ordinary business documents. The signer records consent, chooses a drawn or typed mark, and the completed PDF is stored in R2 with an audit event containing its SHA-256 digest, signer name, signer email, timestamp, IP address, and user agent.

This is not an IRS remote-signature implementation for Forms 8878 or 8879. The API rejects those forms in the native flow.

## Why Forms 8878 and 8879 are blocked

IRS remote-signature guidance requires identity verification for each signing event (subject to narrow in-person/multi-year exceptions), prescribed evidence capture, tamper-proof access-controlled record storage, and retention/retrieval controls. The current release does not yet provide the required taxpayer identity-verification workflow or an immutable-retention control plane.

## Product decision

Do not describe the current native feature as "IRS compliant", "UETA compliant", "ESIGN compliant", or a replacement for DocuSign. It is an in-house ordinary-document signing feature.

Before enabling remote Form 8878/8879 signing, implement and independently validate: verified client authentication, per-event identity verification and KBA failure handling, PIN and form-specific authorization data, sealed/immutable retention with a three-year policy, authorized retrieval/reproduction, an audit export/verifier, and the applicable ERO/e-file operating controls.
