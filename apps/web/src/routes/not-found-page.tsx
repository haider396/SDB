import { SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-content items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <EmptyState
          icon={SearchX}
          title="404 — Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Button asChild variant="secondary">
              <Link to="/">Go home</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
