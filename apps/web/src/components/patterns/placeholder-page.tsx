/**
 * P0 placeholder for pages delivered in later phases. Uses the standard
 * PageHeader + states pattern so shells are complete and navigable now.
 */
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader, type Breadcrumb } from "@/components/patterns/page-header";

export interface PlaceholderPageProps {
  breadcrumbs?: Breadcrumb[];
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** e.g. "P2" — which build phase delivers this page. */
  phase: string;
  description: string;
}

export function PlaceholderPage({
  breadcrumbs,
  title,
  subtitle,
  icon,
  phase,
  description,
}: PlaceholderPageProps) {
  return (
    <div>
      <PageHeader breadcrumbs={breadcrumbs} title={title} subtitle={subtitle} />
      <EmptyState
        icon={icon}
        title={`${title} arrives in ${phase}`}
        description={description}
      />
    </div>
  );
}
