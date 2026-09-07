import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DocumentReviewPage } from "@/pages/document-review";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiUrl: (path: string) => `http://localhost${path}`,
}));

const DOC_A = {
  id: "doc_a",
  clientId: "cli_1",
  clientName: "Acme LLC",
  filename: "statement-jan.pdf",
  contentType: "application/pdf",
  documentType: "bank_statement",
  taxYear: 2026,
  status: "needs_review",
  duplicateWarning: false,
  duplicateOfDocumentId: null,
  checklistMatch: null,
  uploadedAt: new Date().toISOString(),
};
const DOC_B = { ...DOC_A, id: "doc_b", filename: "receipt-b.pdf", clientId: "cli_2", clientName: "Beta Co" };

function renderAtFocus(focusId: string | null) {
  const path = focusId ? `/documents/review?focus=${focusId}` : "/documents/review";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/documents/review" element={<DocumentReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocumentReviewPage", () => {
  it("shows an authenticated source link for each document in the queue", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === "/api/documents/review") return { documents: [DOC_A] };
      if (path === "/api/clients") return { clients: [{ id: "cli_1", name: "Acme LLC" }] };
      return {};
    });
    renderAtFocus(null);
    const link = await screen.findByRole("link", { name: /statement-jan\.pdf/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("/api/clients/cli_1/documents/doc_a/source"));
  });

  it("brings the focused document from a deep link into view ahead of the others", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === "/api/documents/review") return { documents: [DOC_A, DOC_B] };
      if (path === "/api/clients") return { clients: [{ id: "cli_1", name: "Acme LLC" }, { id: "cli_2", name: "Beta Co" }] };
      return {};
    });
    renderAtFocus("doc_b");
    const filenames = (await screen.findAllByRole("link", { name: /\.pdf/i })).map((el) => el.textContent);
    expect(filenames[0]).toContain("receipt-b.pdf");
  });

  it("shows a tax-year assignment control so a document's year can be corrected in review", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path === "/api/documents/review") return { documents: [DOC_A] };
      if (path === "/api/clients") return { clients: [{ id: "cli_1", name: "Acme LLC" }] };
      return {};
    });
    renderAtFocus(null);
    expect(await screen.findByPlaceholderText("Tax year")).toBeInTheDocument();
    expect(await screen.findByText("Reassign client...")).toBeInTheDocument();
  });
});

describe("DocumentReviewPage nonterminal vs terminal actions", () => {
  it("keeps a document visible with refreshed data after a nonterminal correction", async () => {
    const { api } = await import("@/lib/api");
    const patchCalls: Array<[string, unknown]> = [];
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/api/documents/review") return { documents: [DOC_A] };
      if (path === "/api/clients") return { clients: [{ id: "cli_1", name: "Acme LLC" }] };
      if (path === "/api/documents/review/doc_a" && init?.method === "PATCH") {
        patchCalls.push([path, init.body]);
        return {
          ok: true,
          terminal: false,
          document: { ...DOC_A, documentType: "receipt" },
        };
      }
      return {};
    });
    renderAtFocus(null);
    await screen.findByRole("link", { name: /statement-jan\.pdf/i });

    const [select] = await screen.findAllByDisplayValue("bank statement");
    fireEvent.change(select, { target: { value: "receipt" } });

    // The document must still be in the queue - assign_document_type is a
    // correction, not a resolution.
    expect(await screen.findByRole("link", { name: /statement-jan\.pdf/i })).toBeInTheDocument();
    expect(patchCalls).toHaveLength(1);
  });

  it("removes a document from the queue after a terminal Confirm", async () => {
    const { api } = await import("@/lib/api");
    (api as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/documents/review") return { documents: [DOC_A] };
      if (path === "/api/clients") return { clients: [{ id: "cli_1", name: "Acme LLC" }] };
      if (path === "/api/documents/review/doc_a" && init?.method === "PATCH") {
        return { ok: true, terminal: true, document: null };
      }
      return {};
    });
    renderAtFocus(null);
    const confirmButton = await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /statement-jan\.pdf/i })).not.toBeInTheDocument();
    });
  });
});
