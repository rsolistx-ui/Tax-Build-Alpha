import { describe, it, expect } from "vitest";
import { EmailDispatcherService } from "./email-dispatcher";
import type { Env } from "../env";

describe("EmailDispatcherService", () => {
  it("formats human-friendly reply drafts with practitioner's first name and rule scope", () => {
    const service = new EmailDispatcherService({} as Env);
    const draft = service.buildRuleReplyDraft({
      ticketNumber: "ENG-4819",
      firmName: "Miller Accounting LLC",
      userName: "Phyllis Vance",
      userEmail: "phyllis@vancerefrigeration.com",
      ruleTitle: "De Minimis Expensing under $2,500",
      ruleType: "tax_deduction",
      directiveText: "Always categorize building materials under $2,500 as supplies safe harbor",
      markdownContent: "### Rule\nSafe harbor under $2,500.",
      clientName: "Acme Industrial",
    });

    expect(draft).toContain("Hi Phyllis,");
    expect(draft).toContain('directive regarding "De Minimis Expensing under $2,500" for Acme Industrial.');
    expect(draft).toContain("The Platform Engineering Team");
    expect(draft).not.toContain("LLM");
    expect(draft).not.toContain("prompt");
  });

  it("safely handles unconfigured Resend API key by returning simulated dispatch", async () => {
    const service = new EmailDispatcherService({
      ADMIN_NOTIFICATION_EMAIL: "admin@taxbuild.com",
    } as Env);

    const result = await service.notifyAdminOfRuleRequest({
      ticketNumber: "ENG-1024",
      firmName: "Miller Tax",
      userName: "Phyllis Vance",
      userEmail: "phyllis@millertax.com",
      ruleTitle: "Mileage Threshold",
      ruleType: "categorization",
      directiveText: "Standard mileage deduction rate",
      markdownContent: "Apply 67 cents/mile",
    });

    expect(result.success).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.ticketNumber).toBe("ENG-1024");
    expect(result.draftReply).toContain("Hi Phyllis,");
  });

  it("handles concierge support contact emails gracefully", async () => {
    const service = new EmailDispatcherService({} as Env);
    const result = await service.notifyAdminOfSupportContact({
      ticketNumber: "ENG-9901",
      firmName: "Miller Tax",
      userName: "Phyllis",
      userEmail: "phyllis@millertax.com",
      subject: "Help setting up New York MCTMT add-back",
      message: "Can someone help me confirm the rate for Zone 1?",
    });

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.draftReply).toContain("Hi Phyllis,");
    expect(result.draftReply).toContain('regarding "Help setting up New York MCTMT add-back"');
  });
});
