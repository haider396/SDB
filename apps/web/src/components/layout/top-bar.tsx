import { LogOut, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";
import { useMe } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";

export interface TopBarProps {
  /** Opens the <lg navigation drawer; renders the hamburger when provided. */
  onOpenNav?: () => void;
}

export function TopBar({ onOpenNav }: TopBarProps) {
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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-surface-raised px-4 md:px-8">
      {onOpenNav !== undefined ? (
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={onOpenNav}
        >
          <Menu aria-hidden="true" />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1 text-sm text-neutral-500">
        {me ? (
          <p className="truncate font-medium text-neutral-800">
            {me.user.fullName || me.user.email}
          </p>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => void handleSignOut()}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </header>
  );
}
