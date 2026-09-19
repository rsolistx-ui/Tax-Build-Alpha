import type { Env } from "../env";

export interface RuleAlertPayload {
  ticketNumber: string;
  firmName: string;
  userName: string;
  userEmail: string;
  ruleTitle: string;
  ruleType: string;
  directiveText: string;
  markdownContent: string;
  clientName?: string | null;
}

export interface SupportContactPayload {
  ticketNumber: string;
  firmName: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  category?: string;
}

export interface EmailDispatchResult {
  success: boolean;
  delivered: boolean;
  simulated: boolean;
  ticketNumber: string;
  emailId?: string;
  draftReply: string;
  error?: string;
}

export class EmailDispatcherService {
  constructor(private env: Env) {}

  /** Generates human-friendly, professional copy-paste Gmail reply for the admin. */
  buildRuleReplyDraft(payload: RuleAlertPayload): string {
    const firstName = payload.userName.split(" ")[0] || "there";
    const targetScope = payload.clientName ? ` for ${payload.clientName}` : "";
    return `Hi ${firstName},

Our engineering team received your directive regarding "${payload.ruleTitle}"${targetScope}.

We have reviewed your request, verified the underlying accounting logic, and deployed the rule into your firm's compliance engine. Your client ledgers and receipt categorizations are now reflecting this adjustment accurately.

Please let us know if you'd like us to tweak or fine-tune how this is applied.

Best regards,
The Platform Engineering Team`;
  }

  buildSupportReplyDraft(payload: SupportContactPayload): string {
    const firstName = payload.userName.split(" ")[0] || "there";
    return `Hi ${firstName},

Thanks for reaching out to our team regarding "${payload.subject}".

We received your note and are looking into this right now. We will follow up shortly once we have verified everything on our end.

Best regards,
The Platform Engineering Team`;
  }

  /**
   * Notifies the platform admin (via personal Gmail / Resend) when a user dictates
   * or requests a custom rule, providing context and an instant copy-paste reply.
   */
  async notifyAdminOfRuleRequest(payload: RuleAlertPayload): Promise<EmailDispatchResult> {
    const draftReply = this.buildRuleReplyDraft(payload);
    const adminEmail = this.env.ADMIN_NOTIFICATION_EMAIL || this.env.OWNER_EMAIL;

    const subject = `[Engineering Desk] Rule Directive: "${payload.ruleTitle}" (Ref #${payload.ticketNumber})`;
    const text = `=== FOLIO PRACTICE ENGINEERING DESK ===
Ticket: #${payload.ticketNumber}
Firm: ${payload.firmName}
Submitted By: ${payload.userName} (${payload.userEmail})
Target Client: ${payload.clientName || "Global (All Clients)"}
Rule Type: ${payload.ruleType}

DIRECTIVE / PROMPT:
"${payload.directiveText}"

STAGED COMPLIANCE RULE:
${payload.markdownContent}

==================================================
SUGGESTED GMAIL REPLY (Copy & paste to ${payload.userEmail}):
==================================================
${draftReply}
==================================================`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 16px;">⚡ Practice Engineering Desk — Rule Directive</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;">Ticket #${payload.ticketNumber} · ${payload.firmName}</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p><strong>Submitted by:</strong> ${payload.userName} (<a href="mailto:${payload.userEmail}">${payload.userEmail}</a>)</p>
          <p><strong>Target:</strong> ${payload.clientName || "Global (All Clients)"} · <strong>Type:</strong> ${payload.ruleType}</p>
          
          <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold;">Original Practitioner Directive</p>
            <p style="margin: 0; font-style: italic;">"${payload.directiveText}"</p>
          </div>

          <div style="background: #f1f5f9; padding: 12px; margin: 16px 0; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">
${payload.markdownContent}
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: bold; color: #047857;">Suggested Copy-Paste Gmail Reply:</p>
            <div style="background: #ecfdf5; border: 1px dashed #059669; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap;">${draftReply}</div>
          </div>
        </div>
      </div>
    `;

    return this.sendOutboundEmail({
      to: adminEmail ? [adminEmail] : [],
      subject,
      text,
      html,
      ticketNumber: payload.ticketNumber,
      draftReply,
    });
  }

  /**
   * Notifies admin when practitioner uses the "Reach out to the team" concierge feature.
   */
  async notifyAdminOfSupportContact(payload: SupportContactPayload): Promise<EmailDispatchResult> {
    const draftReply = this.buildSupportReplyDraft(payload);
    const adminEmail = this.env.ADMIN_NOTIFICATION_EMAIL || this.env.OWNER_EMAIL;

    const subject = `[Concierge Support] ${payload.subject} — ${payload.userName} (Ref #${payload.ticketNumber})`;
    const text = `=== FOLIO PRACTICE CONCIERGE DESK ===
Ticket: #${payload.ticketNumber}
Firm: ${payload.firmName}
From: ${payload.userName} (${payload.userEmail})
Category: ${payload.category || "General"}

MESSAGE:
"${payload.message}"

==================================================
SUGGESTED GMAIL REPLY (Copy & paste to ${payload.userEmail}):
==================================================
${draftReply}
==================================================`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 16px;">💬 Concierge Desk Inquiry</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;">Ticket #${payload.ticketNumber} · ${payload.firmName}</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p><strong>Practitioner:</strong> ${payload.userName} (<a href="mailto:${payload.userEmail}">${payload.userEmail}</a>)</p>
          <p><strong>Subject:</strong> ${payload.subject}</p>
          
          <div style="background: #f8fafc; border-left: 4px solid #8b5cf6; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 13px; white-space: pre-wrap;">${payload.message}</p>
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: bold; color: #047857;">Suggested Copy-Paste Gmail Reply:</p>
            <div style="background: #ecfdf5; border: 1px dashed #059669; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap;">${draftReply}</div>
          </div>
        </div>
      </div>
    `;

    return this.sendOutboundEmail({
      to: adminEmail ? [adminEmail] : [],
      subject,
      text,
      html,
      ticketNumber: payload.ticketNumber,
      draftReply,
    });
  }

  private async sendOutboundEmail({
    to,
    subject,
    text,
    html,
    ticketNumber,
    draftReply,
  }: {
    to: string[];
    subject: string;
    text: string;
    html: string;
    ticketNumber: string;
    draftReply: string;
  }): Promise<EmailDispatchResult> {
    const apiKey = this.env.RESEND_API_KEY;
    const sender = this.env.SENDER_EMAIL || "Folio Engineering <onboarding@resend.dev>";

    // If Resend API key is not configured or no recipients, safely mock and log
    if (!apiKey || to.length === 0) {
      console.log(`[EmailDispatcher:Mock] Ticket #${ticketNumber} — ${subject}\nTo: ${to.join(", ") || "(no admin email set)"}`);
      return {
        success: true,
        delivered: false,
        simulated: true,
        ticketNumber,
        draftReply,
      };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: sender,
          to,
          subject,
          text,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EmailDispatcher:Error] Resend failed HTTP ${response.status}: ${errorText}`);
        return {
          success: false,
          delivered: false,
          simulated: false,
          ticketNumber,
          draftReply,
          error: `Resend HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as { id?: string };
      return {
        success: true,
        delivered: true,
        simulated: false,
        ticketNumber,
        emailId: data.id,
        draftReply,
      };
    } catch (err: any) {
      console.error(`[EmailDispatcher:Exception]`, err);
      return {
        success: false,
        delivered: false,
        simulated: false,
        ticketNumber,
        draftReply,
        error: err?.message || String(err),
      };
    }
  }
}
