import type { Env } from "../env";
import { TelegramNotifierService } from "./telegram-notifier";

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

  /** Generates human-friendly, professional copy-paste reply for the admin. */
  buildRuleReplyDraft(payload: RuleAlertPayload): string {
    const firstName = payload.userName.split(" ")[0] || "there";
    const targetScope = payload.clientName ? ` for ${payload.clientName}` : "";
    return `Hi ${firstName},

Our operations team received your directive regarding "${payload.ruleTitle}"${targetScope}.

We have reviewed your request, verified the underlying accounting logic, and deployed the rule into your firm's compliance engine. Your client ledgers and receipt categorizations are now reflecting this adjustment accurately.

Please let us know if you'd like us to tweak or fine-tune how this is applied.

Best regards,
Truepost Operations Desk`;
  }

  buildSupportReplyDraft(payload: SupportContactPayload): string {
    const firstName = payload.userName.split(" ")[0] || "there";
    return `Hi ${firstName},

Thanks for reaching out to our team regarding "${payload.subject}".

We received your note and our systems desk has reviewed your account telemetry. We will follow up shortly once we have verified everything on our end.

Best regards,
Truepost Operations Desk`;
  }

  /**
   * Builds the immediate, reassuring auto-response email sent to the client/practitioner
   * so they never feel left hanging.
   */
  buildClientSupportAutoResponse(payload: SupportContactPayload): { subject: string; text: string; html: string } {
    const firstName = payload.userName.split(" ")[0] || "there";
    const subject = `[Truepost Ticket #${payload.ticketNumber}] We received your inquiry: ${payload.subject}`;
    
    const text = `Hi ${firstName},

Thank you for reaching out to Truepost. This is an automated confirmation that your request has been logged and assigned tracking reference #${payload.ticketNumber}.

Summary of Inquiry:
• Subject: ${payload.subject}
• Category: ${payload.category || "General Inquiry"}
• Firm: ${payload.firmName}

Status: Our Sentinel system has triaged your request. A member of our dedicated practice desk is actively reviewing your issue. If your request is urgent, our priority queue is actively monitoring this thread.

You can reply directly to this email at any time to provide additional context or screenshots.

Warm regards,
Truepost Client Concierge Desk
https://truepost.app`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 20px 24px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #10b981;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: #10b981; color: #0f172a; font-weight: 900; font-size: 14px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;">T</span>
            <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff;">Truepost</span>
            <span style="margin-left: auto; font-size: 11px; background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">Ticket #${payload.ticketNumber}</span>
          </div>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${firstName},</p>
          <p style="color: #334155; font-size: 14px;">
            Thank you for contacting Truepost. Your inquiry has been securely logged with our operations desk under tracking reference <strong>#${payload.ticketNumber}</strong>.
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; padding: 14px 16px; margin: 18px 0; border-radius: 6px;">
            <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.05em;">Inquiry Details</p>
            <p style="margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #0f172a;">${payload.subject}</p>
            <p style="margin: 0; font-size: 13px; color: #475569; font-style: italic;">"${payload.message.slice(0, 200)}${payload.message.length > 200 ? "…" : ""}"</p>
          </div>

          <p style="color: #475569; font-size: 13px;">
            <strong>Immediate Action Taken:</strong> Our AI Sentinel has triaged your note and verified system telemetry. A specialist is reviewing your account to ensure your books and workflows remain uninterrupted.
          </p>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">Truepost Operations Desk · Verified Double-Entry &amp; Practice OS</p>
          </div>
        </div>
      </div>
    `;

    return { subject, text, html };
  }

  /**
   * Dispatches an immediate auto-response to the customer when they submit a ticket.
   */
  async sendClientAutoResponse(payload: SupportContactPayload): Promise<EmailDispatchResult> {
    const { subject, text, html } = this.buildClientSupportAutoResponse(payload);
    return this.sendOutboundEmail({
      to: [payload.userEmail],
      subject,
      text,
      html,
      ticketNumber: payload.ticketNumber,
      draftReply: text,
    });
  }

  /**
   * Dispatches an immediate confirmation to the customer when they submit a rule directive request.
   */
  async sendClientRuleRequestAutoResponse(payload: {
    ticketNumber: string;
    userName: string;
    userEmail: string;
    firmName: string;
    clientName?: string | null;
    directiveText: string;
  }): Promise<EmailDispatchResult> {
    const firstName = payload.userName.split(" ")[0] || "there";
    const subject = `[Truepost Directive #${payload.ticketNumber}] Custom Rule Request Queued: ${payload.clientName || "Practice Rule"}`;
    
    const text = `Hi ${firstName},

Thank you for submitting a custom bookkeeping directive for ${payload.clientName || "your firm"}.

Your directive has been assigned reference #${payload.ticketNumber}:
"${payload.directiveText}"

Status: Queued for RuleForge Compilation. Our operations desk is formatting this rule against standard IRS Schedule C / GAAP compliance guidelines and will push it live to your active ledgers shortly.

Best regards,
Truepost Operations Desk`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 20px 24px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #8b5cf6;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: #8b5cf6; color: #ffffff; font-weight: 900; font-size: 14px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;">T</span>
            <span style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff;">Truepost</span>
            <span style="margin-left: auto; font-size: 11px; background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; color: #cbd5e1;">Directive #${payload.ticketNumber}</span>
          </div>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p style="font-size: 15px; margin-top: 0;">Hi ${firstName},</p>
          <p style="color: #334155; font-size: 14px;">
            Your custom rule request for <strong>${payload.clientName || "your firm"}</strong> has been securely logged with our operations desk under tracking reference <strong>#${payload.ticketNumber}</strong>.
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #8b5cf6; padding: 14px 16px; margin: 18px 0; border-radius: 6px;">
            <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.05em;">Requested Rule Directive</p>
            <p style="margin: 0; font-size: 13px; color: #1e293b; font-style: italic;">"${payload.directiveText}"</p>
          </div>

          <p style="color: #475569; font-size: 13px;">
            <strong>Next Step:</strong> Our team is compiling this directive into an active, deterministic rulebook. Once compiled and verified against historical reconciliation batches, this rule will automatically apply to all incoming bank and receipt feeds.
          </p>
        </div>
      </div>
    `;

    return this.sendOutboundEmail({
      to: [payload.userEmail],
      subject,
      text,
      html,
      ticketNumber: payload.ticketNumber,
      draftReply: text,
    });
  }

  /** Confirms a completed, scoped rule activation without overstating its reach. */
  async sendScopedRuleActivationConfirmation(payload: {
    ticketNumber: string;
    userName: string;
    userEmail: string;
    clientName?: string | null;
    summary: string;
  }): Promise<EmailDispatchResult> {
    const firstName = payload.userName.split(" ")[0] || "there";
    const scope = payload.clientName || "the selected client";
    const subject = `[Truepost Directive #${payload.ticketNumber}] Active for future intake`;
    const text = `Hi ${firstName},\n\nYour requested rule for ${scope} has been validated and is now active for future receipt and transaction suggestions.\n\nWhat changed: ${payload.summary}\n\nNothing historical was changed automatically. Existing records remain available for your review.\n\nBest regards,\nTruepost Operations Desk`;
    return this.sendOutboundEmail({
      to: [payload.userEmail], subject, text, html: `<p>${text.replace(/\n/g, "<br />")}</p>`,
      ticketNumber: payload.ticketNumber, draftReply: text,
    });
  }

  /**
   * Notifies the platform admin when a user dictates or requests a custom rule.
   */
  async notifyAdminOfRuleRequest(payload: RuleAlertPayload): Promise<EmailDispatchResult> {
    const draftReply = this.buildRuleReplyDraft(payload);
    const adminEmail = this.env.ADMIN_NOTIFICATION_EMAIL || this.env.OWNER_EMAIL;

    const subject = `[Truepost Admin] Rule Directive: "${payload.ruleTitle}" (Ref #${payload.ticketNumber})`;
    const text = `=== TRUEPOST PRACTICE OPERATIONS DESK ===
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
SUGGESTED REPLY (Copy & paste to ${payload.userEmail}):
==================================================
${draftReply}
==================================================`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 16px;">⚡ Truepost Operations Desk — Rule Directive</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;">Ticket #${payload.ticketNumber} · ${payload.firmName}</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p><strong>Submitted by:</strong> ${payload.userName} (<a href="mailto:${payload.userEmail}">${payload.userEmail}</a>)</p>
          <p><strong>Target:</strong> ${payload.clientName || "Global (All Clients)"} · <strong>Type:</strong> ${payload.ruleType}</p>
          
          <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold;">Practitioner Directive</p>
            <p style="margin: 0; font-style: italic;">"${payload.directiveText}"</p>
          </div>

          <div style="background: #f1f5f9; padding: 12px; margin: 16px 0; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap;">
${payload.markdownContent}
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: bold; color: #047857;">Suggested Reply:</p>
            <div style="background: #ecfdf5; border: 1px dashed #059669; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap;">${draftReply}</div>
          </div>
        </div>
      </div>
    `;

    void new TelegramNotifierService(this.env)
      .notifyRuleDirective({
        userName: payload.userName,
        title: payload.ruleTitle,
        directiveText: payload.directiveText,
        clientName: payload.clientName,
      })
      .catch(() => {});

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

    const subject = `[Truepost Concierge] ${payload.subject} — ${payload.userName} (Ref #${payload.ticketNumber})`;
    const text = `=== TRUEPOST CONCIERGE DESK ===
Ticket: #${payload.ticketNumber}
Firm: ${payload.firmName}
From: ${payload.userName} (${payload.userEmail})
Category: ${payload.category || "General"}

MESSAGE:
"${payload.message}"

==================================================
SUGGESTED REPLY (Copy & paste to ${payload.userEmail}):
==================================================
${draftReply}
==================================================`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 16px;">💬 Truepost Concierge Inquiry</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;">Ticket #${payload.ticketNumber} · ${payload.firmName}</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <p><strong>Practitioner:</strong> ${payload.userName} (<a href="mailto:${payload.userEmail}">${payload.userEmail}</a>)</p>
          <p><strong>Subject:</strong> ${payload.subject}</p>
          
          <div style="background: #f8fafc; border-left: 4px solid #8b5cf6; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 13px; white-space: pre-wrap;">${payload.message}</p>
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: bold; color: #047857;">Suggested Reply:</p>
            <div style="background: #ecfdf5; border: 1px dashed #059669; padding: 12px; border-radius: 6px; font-size: 13px; white-space: pre-wrap;">${draftReply}</div>
          </div>
        </div>
      </div>
    `;

    void new TelegramNotifierService(this.env)
      .sendMessage(
        `💬 <b>Truepost Concierge Support Request</b>\n\n<b>From:</b> ${payload.userName} (${payload.userEmail})\n<b>Subject:</b> ${payload.subject}\n<b>Message:</b>\n<i>${payload.message}</i>\n🕒 <code>${new Date().toLocaleString("en-US", { hour12: true })}</code>`
      )
      .catch(() => {});

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
   * Admin can send a direct follow-up or reply from the Admin Console to a customer.
   */
  async sendAdminReplyToClient({
    to,
    ticketNumber,
    subject,
    replyMessage,
  }: {
    to: string;
    ticketNumber: string;
    subject: string;
    replyMessage: string;
  }): Promise<EmailDispatchResult> {
    const fullSubject = subject.includes(ticketNumber) ? subject : `[Truepost #${ticketNumber}] Update: ${subject}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #1e293b;">
        <div style="background: #0f172a; color: #f8fafc; padding: 18px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 16px; color: #ffffff;">Truepost Practice Operations</h2>
          <p style="margin: 4px 0 0; font-size: 12px; color: #94a3b8;">Ticket #${ticketNumber}</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; background: #ffffff;">
          <div style="font-size: 14px; color: #1e293b; white-space: pre-wrap;">${replyMessage}</div>
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8;">
            Truepost Operations Desk · You can reply directly to this email to continue the thread.
          </div>
        </div>
      </div>
    `;
    return this.sendOutboundEmail({
      to: [to],
      subject: fullSubject,
      text: replyMessage,
      html,
      ticketNumber,
      draftReply: replyMessage,
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
    const sender = this.env.SENDER_EMAIL || "Truepost Concierge <onboarding@resend.dev>";

    // If Resend API key is not configured or no recipients, safely mock and log
    if (!apiKey || to.length === 0) {
      console.log(`[EmailDispatcher:Mock] Ticket #${ticketNumber} — ${subject}\nTo: ${to.join(", ") || "(no recipients)"}`);
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
