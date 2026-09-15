import { useState } from "react";
import { MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FeedbackPanel() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("feature");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ category, message, page: page || undefined, severity }),
      });
      setSent(true);
      setMessage("");
      setPage("");
      setTimeout(() => setSent(false), 3000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <Card className="w-80 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Send Feedback</CardTitle>
            <CardDescription className="text-xs">Help us improve Folio. Your feedback goes straight to the team.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Category</Label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  >
                    <option value="bug">Bug</option>
                    <option value="feature">Feature</option>
                    <option value="ux">UX</option>
                    <option value="performance">Performance</option>
                    <option value="integration">Integration</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Severity</Label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Page (optional)</Label>
                <Input
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  placeholder="e.g. /clients/abc/overview"
                />
              </div>
              <div>
                <Label className="text-xs">Message</Label>
                <textarea
                  value={message}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                  placeholder="What would you like to see improved?"
                  rows={3}
                  className="h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={sending || !message.trim()}>
                  <Send className="h-3.5 w-3.5" /> {sending ? "Sending..." : "Send"}
                </Button>
                {sent && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sent — thank you!</span>}
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button size="sm" variant="outline" className="shadow-lg" onClick={() => setOpen(true)}>
          <MessageSquare className="h-3.5 w-3.5" /> Feedback
        </Button>
      )}
    </div>
  );
}
