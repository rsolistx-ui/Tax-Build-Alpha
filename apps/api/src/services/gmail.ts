import { z } from "zod";

export const gmailSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

export type GmailConfig = z.infer<typeof gmailSchema>;

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    parts?: GmailMessagePart[];
  };
  sizeEstimate: number;
  historyId: string;
  internalDate: string;
};

export type GmailMessagePart = {
  mimeType: string;
  filename?: string;
  headers: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size: number };
  parts?: GmailMessagePart[];
};

export type GmailLabel = {
  id: string;
  name: string;
  messageListVisibility: "hide" | "show";
  labelListVisibility: "labelHide" | "labelShow";
  type: "user" | "system";
};

export type GmailDraft = {
  id: string;
  message: {
    raw: string;
    threadId: string;
    labelIds: string[];
  };
};

export type GmailSendResponse = {
  id: string;
  threadId: string;
  labelIds: string[];
  historyId: string;
  internalDate: string;
};

/** RFC 4648 base64url encoding for Gmail's raw-message API. */
function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getGmailAccessToken(config: GmailConfig): Promise<{ accessToken: string; expiresIn: number }> {
  const formData = new URLSearchParams({
    "client_id": config.clientId,
    "client_secret": config.clientSecret,
    "refresh_token": config.refreshToken,
    "grant_type": "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail auth failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function listGmailMessages(
  accessToken: string,
  query?: string,
  maxResults = 50,
): Promise<{ messages: GmailMessage[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    "maxResults": maxResults.toString(),
  });

  if (query) {
    params.set("q", query);
  }

  const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail messages list failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { messages?: GmailMessage[]; nextPageToken?: string };
  return {
    messages: data.messages || [],
    nextPageToken: data.nextPageToken,
  };
}

export async function getGmailMessage(
  accessToken: string,
  messageId: string,
  format: "full" | "metadata" | "minimal" | "raw" = "full",
): Promise<GmailMessage> {
  const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=${format}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail message fetch failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
  const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/labels", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail labels list failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { labels?: GmailLabel[] };
  return data.labels || [];
}

export async function createGmailDraft(
  accessToken: string,
  draft: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<GmailDraft> {
  const { to, subject, body, inReplyTo, references } = draft;

  const headers = [
    { name: "To", value: to },
    { name: "Subject", value: subject },
    { name: "Content-Type", value: "text/plain; charset=UTF-8" },
  ];

  if (inReplyTo) {
    headers.push({ name: "In-Reply-To", value: inReplyTo });
  }
  if (references) {
    headers.push({ name: "References", value: references });
  }

  const raw = headers
    .map((h) => `${h.name}: ${h.value}`)
    .join("\r\n")
    .concat("\r\n\r\n", body);

  const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw: base64UrlEncode(raw) } }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail draft creation failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

export async function sendGmailMessage(
  accessToken: string,
  message: {
    to: string;
    subject: string;
    body: string;
    from?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<GmailSendResponse> {
  const { to, subject, body, from, inReplyTo, references } = message;

  const headers = [
    { name: "To", value: to },
    { name: "Subject", value: subject },
    { name: "Content-Type", value: "text/plain; charset=UTF-8" },
  ];

  if (from) {
    headers.push({ name: "From", value: from });
  }
  if (inReplyTo) {
    headers.push({ name: "In-Reply-To", value: inReplyTo });
  }
  if (references) {
    headers.push({ name: "References", value: references });
  }

  const raw = headers
    .map((h) => `${h.name}: ${h.value}`)
    .join("\r\n")
    .concat("\r\n\r\n", body);

  const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64UrlEncode(raw) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail message send failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

export async function searchGmailMessages(
  accessToken: string,
  query: string,
): Promise<GmailMessage[]> {
  const allMessages: GmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const result = await listGmailMessages(accessToken, query, 500);
    allMessages.push(...result.messages);
    pageToken = result.nextPageToken;
  } while (pageToken);

  return allMessages;
}

export async function markGmailMessageRead(accessToken: string, messageId: string): Promise<void> {
  await updateGmailMessageLabels(accessToken, messageId, {
    addLabelIds: ["UNREAD"],
    removeLabelIds: [],
  });
}

export async function updateGmailMessageLabels(
  accessToken: string,
  messageId: string,
  labels: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(labels),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail message label update failed: ${response.status} ${errorText}`);
  }
}

export function createGmailDraftBody(clientName: string, requestTitle: string, requestDescription?: string, signature?: string): string {
  let body = `Hi ${clientName},\n\n`;
  
  if (requestDescription) {
    body += `${requestDescription}\n\n`;
  }
  
  body += `I'm following up on your ${requestTitle} request. Please let me know if you have any questions.\n\n`;
  
  if (signature) {
    body += `${signature}\n`;
  }
  
  return body;
}

export function createGmailThreadBody(messages: GmailMessage[], clientName: string): string {
  let body = `Thread with ${clientName}:\n\n`;
  
  for (const message of messages) {
    const fromHeader = message.payload.headers.find((h) => h.name.toLowerCase() === "from")?.value || "Unknown";
    const dateHeader = message.payload.headers.find((h) => h.name.toLowerCase() === "date")?.value || "Unknown date";
    
    body += `---\nFrom: ${fromHeader}\nDate: ${dateHeader}\n\n`;
    
    const textPart = findTextPart(message.payload as { mimeType?: string; body?: { data?: string }; parts?: any[] });
    if (textPart) {
      const decoded = atob(textPart.replace(/-/g, "+").replace(/_/g, "/"));
      body += `${decoded}\n\n`;
    } else {
      body += `[No text content]\n\n`;
    }
  }
  
  return body;
}

function findTextPart(part: { mimeType?: string; body?: { data?: string }; parts?: any[] }): string | null {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return part.body.data;
  }
  
  if (part.parts) {
    for (const subPart of part.parts) {
      const result = findTextPart(subPart);
      if (result) return result;
    }
  }
  
  return null;
}
