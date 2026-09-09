/**
 * The job description, folded down to a preview.
 *
 * Rebecca, 13 Aug, on the same breath as the collapsed candidate views:
 * *"OK, brief. Yeah, I think that's just a cosmetic thing. Click to pop out
 * the full brief."*
 *
 * It used to render at full length inline, so a long description pushed the
 * candidates — the thing a client actually came to do — below the fold. Now it
 * shows the opening and pops out on demand.
 *
 * A short description is not clamped and gets no button: a "Read full
 * description" control on three lines that are already all of it is a lie.
 * The threshold is on the SOURCE length rather than a measured height, because
 * measuring would mean a layout effect and a re-render, and getting it wrong
 * costs nothing here.
 */
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SimpleMarkdown } from "@/lib/simple-markdown";

/** Roughly six lines at the card's width — below this, nothing is gained. */
const CLAMP_ABOVE_CHARS = 420;

export function JobDescriptionCard({ description }: { description: string }) {
  const [open, setOpen] = useState(false);
  const isLong = description.length > CLAMP_ABOVE_CHARS;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <FileText aria-hidden="true" className="h-4 w-4 text-neutral-500" />
          <CardTitle className="text-base">Job description</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The clamp is on a wrapper, not on SimpleMarkdown's own output, so
              the markdown keeps rendering headings and bullets normally and
              only the visible height is constrained. */}
          <div className={isLong ? "line-clamp-6" : undefined}>
            <SimpleMarkdown source={description} />
          </div>
          {isLong ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setOpen(true)}
            >
              Read full description
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Radix returns focus to the trigger on close, so a keyboard user lands
          back on "Read full description" rather than at the top of the page. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Job description</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <SimpleMarkdown source={description} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
