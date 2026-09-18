import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type RequestMessage = {
  id: string;
  firm_id: string;
  request_id: string;
  client_id: string;
  author_type: "professional" | "client" | "system";
  author_user_id: string | null;
  body: string;
  created_at: string;
};

type RequestThreadProps = {
  requestId: string;
  clientId: string;
};

export function RequestThread({ requestId, clientId }: RequestThreadProps) {
  const [messages, setMessages] = useState<RequestMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMessages() {
    try {
      const data = await api<{ messages: RequestMessage[] }>(`/api/clients/${clientId}/requests/${requestId}/messages`);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api(`/api/clients/${clientId}/requests/${requestId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-sm">Request thread</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-md p-3 text-sm ${
                  msg.author_type === "professional"
                    ? "bg-muted"
                    : msg.author_type === "client"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="text-[10px]">
                    {msg.author_type === "professional" ? "You" : msg.author_type === "client" ? "Client" : "System"}
                  </Badge>
                  <span className="text-xs opacity-70">
                    {new Date(msg.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{msg.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2 border-t">
          <input
            className="flex-1 h-9 rounded-md border bg-transparent px-3 text-sm"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply..."
          />
          <Button size="sm" onClick={sendReply} disabled={!reply.trim() || loading}>
            {loading ? "Sending..." : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
