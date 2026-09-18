import { z } from "zod";
import type { Db } from "../db";

export const docuSignSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  integratorKey: z.string().min(1),
  userId: z.string().min(1),
  baseUrl: z.string().url(),
  accountId: z.string().min(1),
});

export type DocuSignConfig = z.infer<typeof docuSignSchema>;

export type DocuSignEnvelope = {
  envelopeId: string;
  status: string;
  documents: Array<{ documentId: string; name: string; pages?: number }>;
  recipients: Array<{ email: string; name: string; roleName: string; status: string; sent: string; completed?: string }>;
  created: string;
  sent: string;
  completed?: string;
};

export type DocuSignDocument = {
  documentId: string;
  name: string;
  documentBase64: string;
  fileExtension: string;
  documentType?: string;
};

export type DocuSignSigner = {
  email: string;
  name: string;
  roleName: string;
  clientUserId?: string;
  tabs?: {
    signHereTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }>;
    fullNameTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }>;
    dateSignedTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }>;
  };
};

export type DocuSignTemplate = {
  templateId: string;
  name: string;
  description: string;
  documents: Array<{ documentId: string; name: string }>;
  recipients: Record<string, Array<{ recipientId: string; roleName: string }>>;
};

export async function getDocuSignAccessToken(config: DocuSignConfig): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch("https://account.docusign.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      "grant_type": "client_credentials",
      "scope": "signature impersonation",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign auth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function createDocuSignEnvelope(
  config: DocuSignConfig,
  accessToken: string,
  envelope: {
    templateId?: string;
    documents: Array<{ documentId: string; name: string; documentBase64: string; fileExtension: string }>;
    signers: Array<{ email: string; name: string; roleName: string; clientUserId?: string; tabs?: { signHereTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }>; fullNameTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }>; dateSignedTabs?: Array<{ pageNumber: number; xPosition: number; yPosition: number }> } }>;
    subject: string;
    emailBlurb: string;
    customFields?: {
      textCustomFields?: Array<{ name: string; required: string; show: string; value: string }>;
    };
  },
): Promise<DocuSignEnvelope> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  
  const requestBody: Record<string, any> = {
    emailSubject: envelope.subject,
    emailBlurb: envelope.emailBlurb,
    documents: envelope.documents.map((doc, i) => ({
      documentId: (i + 1).toString(),
      name: doc.name,
      documentBase64: doc.documentBase64,
    })),
    recipients: {
      signers: envelope.signers.map((signer, i) => ({
        email: signer.email,
        name: signer.name,
        roleName: signer.roleName,
        clientUserId: signer.clientUserId || `client_${i + 1}`,
        tabs: signer.tabs || {},
      })),
    },
  };

  if (envelope.customFields?.textCustomFields) {
    requestBody.customFields = envelope.customFields;
  }

  if (envelope.templateId) {
    delete (requestBody as any).documents;
    delete (requestBody as any).recipients;
    (requestBody as any).emailSubject = envelope.subject;
    (requestBody as any).emailBlurb = envelope.emailBlurb;
    (requestBody as any).templateId = envelope.templateId;
    (requestBody as any).templateRoles = envelope.signers.map((signer) => ({
      email: signer.email,
      name: signer.name,
      roleName: signer.roleName,
      clientUserId: signer.clientUserId,
    }));
  }

  const response = await fetch(`${baseUrl}/restapi/v2.1/accounts/${config.accountId}/envelopes`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign envelope creation failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    envelopeId: string;
    status: string;
    documentsMetadata?: { documents?: Array<{ documentId: string; name: string; pagesCount?: number }> };
    recipients?: { signers?: Array<{ email: string; name: string; roleName: string; status: string; sent: string; completed?: string }> };
    created: string;
    sent: string;
    completed?: string;
  };

  return {
    envelopeId: data.envelopeId,
    status: data.status,
    documents: data.documentsMetadata?.documents?.map((d) => ({
      documentId: d.documentId,
      name: d.name,
      pages: d.pagesCount,
    })) || [],
    recipients: data.recipients?.signers?.map((r) => ({
      email: r.email,
      name: r.name,
      roleName: r.roleName,
      status: r.status,
      sent: r.sent,
      completed: r.completed,
    })) || [],
    created: data.created,
    sent: data.sent,
    completed: data.completed,
  };
}

export async function getDocuSignEnvelopeStatus(
  config: DocuSignConfig,
  accessToken: string,
  envelopeId: string,
): Promise<DocuSignEnvelope> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  
  const response = await fetch(`${baseUrl}/restapi/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign envelope status fetch failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    envelopeId: string;
    status: string;
    documentsMetadata?: { documents?: Array<{ documentId: string; name: string; pagesCount?: number }> };
    recipients?: { signers?: Array<{ email: string; name: string; roleName: string; status: string; sent: string; completed?: string }> };
    created: string;
    sent: string;
    completed?: string;
  };

  return {
    envelopeId: data.envelopeId,
    status: data.status,
    documents: data.documentsMetadata?.documents?.map((d) => ({
      documentId: d.documentId,
      name: d.name,
      pages: d.pagesCount,
    })) || [],
    recipients: data.recipients?.signers?.map((r) => ({
      email: r.email,
      name: r.name,
      roleName: r.roleName,
      status: r.status,
      sent: r.sent,
      completed: r.completed,
    })) || [],
    created: data.created,
    sent: data.sent,
    completed: data.completed,
  };
}

export async function getDocuSignEnvelopeDocuments(
  config: DocuSignConfig,
  accessToken: string,
  envelopeId: string,
): Promise<Array<{ documentId: string; name: string; base64: string }>> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  
  const response = await fetch(`${baseUrl}/restapi/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}/documents`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/pdf",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign envelope documents fetch failed: ${response.status} ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return [{ documentId: "combined", name: "Complete Envelope", base64 }];
}

export async function getDocuSignTemplates(
  config: DocuSignConfig,
  accessToken: string,
): Promise<DocuSignTemplate[]> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  
  const response = await fetch(`${baseUrl}/restapi/v2.1/accounts/${config.accountId}/templates`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DocuSign templates fetch failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    envelopeTemplates?: Array<{
      templateId: string;
      name: string;
      description?: string;
      documents?: Array<{ documentId: string; name: string }>;
      recipients?: Record<string, Array<{ recipientId: string; roleName: string }>>;
    }>;
  };

  return data.envelopeTemplates?.map((t) => ({
    templateId: t.templateId,
    name: t.name,
    description: t.description || "",
    documents: t.documents?.map((d) => ({
      documentId: d.documentId,
      name: d.name,
    })) || [],
    recipients: t.recipients || {},
  })) || [];
}

export async function refreshDocuSignAccessToken(
  config: DocuSignConfig,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const basic = typeof Buffer !== "undefined"
    ? Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")
    : btoa(`${config.clientId}:${config.clientSecret}`);
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error(`DocuSign token refresh failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

/**
 * Resolves a firm's stored DocuSign config into a config + live access token,
 * refreshing it first if it is missing or within 60 seconds of expiry.
 * Returns null when the firm has never configured DocuSign (a legitimate
 * "not using e-signature yet" state, not an error).
 */
export async function getValidDocuSignConfig(
  db: Db,
  firmId: string,
): Promise<(DocuSignConfig & { accessToken: string }) | null> {
  const [row] = await db.query<{
    client_id: string; client_secret: string; integrator_key: string; user_id: string;
    base_url: string; account_id: string; access_token: string | null; refresh_token: string | null;
    access_token_expires_at: string | null;
  }>(
    `SELECT client_id, client_secret, integrator_key, user_id, base_url, account_id, access_token, refresh_token, access_token_expires_at FROM docu_sign_config WHERE firm_id = $1`,
    [firmId],
  );
  if (!row) return null;

  const config: DocuSignConfig = {
    clientId: row.client_id,
    clientSecret: row.client_secret,
    integratorKey: row.integrator_key,
    userId: row.user_id,
    baseUrl: row.base_url,
    accountId: row.account_id,
  };

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  const needsRefresh = !row.access_token || expiresAt - Date.now() < 60_000;

  if (!needsRefresh) {
    return { ...config, accessToken: row.access_token! };
  }
  if (!row.refresh_token) {
    throw new Error("DocuSign access token expired and no refresh token is stored for this firm");
  }

  const refreshed = await refreshDocuSignAccessToken(config, row.refresh_token);
  await db.query(
    `UPDATE docu_sign_config SET access_token=$1, refresh_token=$2, access_token_expires_at = NOW() + ($3 || ' seconds')::interval, updated_at=NOW() WHERE firm_id=$4`,
    [refreshed.accessToken, refreshed.refreshToken, String(refreshed.expiresIn), firmId],
  );
  return { ...config, accessToken: refreshed.accessToken };
}

export async function voidDocuSignEnvelope(
  config: DocuSignConfig,
  accessToken: string,
  envelopeId: string,
  voidReason: string,
): Promise<void> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/restapi/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "voided", voidedReason: voidReason }),
  });
  if (!response.ok) {
    throw new Error(`DocuSign void failed: ${response.status} ${await response.text()}`);
  }
}
