import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REASON_MESSAGES: Record<string, string> = {
  BETA_EXPIRED: "Beta access has expired. Contact the provider to restore access.",
  BETA_REVOKED: "Beta access has been revoked. Contact the provider to restore access.",
  BETA_REQUIRED: "Beta access has not been activated for this account. Contact the provider for an invitation.",
};

export function LockedScreen({ reason }: { reason: string | null }) {
  const message = (reason && REASON_MESSAGES[reason]) || REASON_MESSAGES.BETA_REQUIRED;
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Access locked</CardTitle>
            <CardDescription>Your financial records remain safe and unchanged.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{message}</p>
            <Button className="w-full" variant="outline" onClick={() => void authClient.signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
