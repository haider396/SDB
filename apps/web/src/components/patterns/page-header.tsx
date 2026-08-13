/**
 * Every page uses this header: breadcrumb, one H1, subtitle, right-aligned
 * primary action (05-FRONTEND.md §4.1). No page invents its own header.
 */
import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "@/lib/use-page-title";

export interface Breadcrumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  breadcrumbs?: Breadcrumb[];
  title: string;
  subtitle?: string;
  /**
   * Meta row under the subtitle: mono references, related links.
   * Subtitles ration middots to one per line — overflow goes here.
   */
  meta?: ReactNode;
  /** Right-aligned action slot, usually a primary <Button>. */
  actions?: ReactNode;
}

export function PageHeader({
  breadcrumbs,
  title,
  subtitle,
  meta,
  actions,
}: PageHeaderProps) {
  // The document title follows the page's H1 (UX 1.10).
  usePageTitle(title);
  return (
    <header className="mb-8">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center gap-1 text-sm text-neutral-500">
            {breadcrumbs.map((crumb, index) => (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 ? (
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                ) : null}
                <li>
                  {crumb.to ? (
                    <Link
                      to={crumb.to}
                      className="rounded-sm hover:text-brand-blue hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy-ink">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
          ) : null}
          {meta ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
