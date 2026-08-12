import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";
import { useMe } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";

export function TopBar() {
  const { data: me } = useMe();
  const navigate = useNavigate();

  async function handleSignOut() {
    try {
      await signOut();
      queryClient.clear();
      navigate("/login", { replace: true });
    } catch {
      toast.error("Could not sign you out. Please try again.");
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-surface-raised px-8">
      <div className="text-sm text-neutral-500">
        {me ? (
          <span>
            Signed in as{" "}
            <span className="font-medium text-neutral-800">
              {me.user.fullName || me.user.email}
            </span>
          </span>
        ) : null}
      </div>
      <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </header>
  );
}
