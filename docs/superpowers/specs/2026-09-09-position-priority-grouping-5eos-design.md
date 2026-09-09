# Design — Priority, the 5eOS toggle, and grouping the positions list

| | |
|---|---|
| **Source** | Haider + Rebecca Pulse, 13 Aug 2026 — the positions-list segment |
| **Change requests** | **T18** (priority), **T25** (5eOS toggle), **T24** (sort/group) |
| **Decided with Haider** | Priority and urgency are **two separate fields** · the list **groups under headings**, it does not merely re-order · **T25 (5eOS) is deferred** — to be discussed with Rebecca · priority shows **everywhere it is needed** |
| **Status** | Design. Nothing implemented except the truncation fix in §2.2. |

> ### T25 is deferred, and that decides Engine
>
> Haider, 9 Sep: the 5eOS toggle waits for a conversation with Rebecca.
>
> **Consequence: Engine is not shown anywhere.** Rebecca removed it from the card
> herself — *"Engine doesn't need to be seen on this card"* — and reinstated it only
> *"unless we internally notate that this client is using 5eOS."* With no flag there is
> no "unless", so the default she asked for stands, and Haider's reason holds:
> *"it's just clutter if they're not using 5eOS."*
>
> So the group-by options are **None · Department · Priority**. Engine is a one-line
> addition to that list whenever T25 lands — the design leaves room for it and builds
> nothing speculative.

---

## 1. What she asked for, in her order

> *"Let's think about what this looks like when they have, they're hiring for 15 positions. We would want it to be able to be sorted at the top based on alphabetical department. Department, might as well add Engine in there as well. And Priority."*
>
> Haider: *"Priority matters."* — Rebecca: *"Priority definitely matters. **Priority would need to be seen on the card, preview card.**"*
>
> *"**Actually, let's have all of those things minus Engine. Engine doesn't need to be seen on this card.** **Unless** we internally notate that this client is using 5eOS, and then we toggle something… **including that Engine would be listed here as well**."*
>
> Haider: *"Because if not, it's just clutter if they're not using 5eOS."*

The correction mid-paragraph is the requirement, not an aside. She asks for Engine, then removes it, then reinstates it **conditionally**. So Engine is not a field we show — it is a field one client sees and another does not.

Two deliverables in this piece of work, and one deferred:

| | | State |
|---|---|---|
| **T18** | A `priority` field, shown on every surface in §4 and editable by admins | **Build.** Blocks T24 — nothing can group by a field that does not exist |
| **T24** | Group the CLIENT positions list by Department or Priority | **Build**, after T18 |
| **T25** | A per-client `uses_5eos` flag | **Deferred** — see the note above. Its only effect here was Engine, which is therefore hidden |

---

## 2. Two findings that change the work

### 2.1 The doc's central warning is right — about the other screen

`CHANGE-REQUESTS-2026-08-13.md` T24 says, marked **"Critical technical note"**:

> *"the list uses **cursor pagination with fixed filters**… Sorting MUST be applied server-side and become part of the cursor's fixed filter set — a client-side array sort will break pagination."*

There are **two** positions lists, and they are built differently:

| | Paginated? | |
|---|---|---|
| **Client** — `client-requisitions-page.tsx` | **No.** One fetch, whole array in memory | Rebecca's screen. Grouping here is **front-end only** |
| **Admin** — `requisitions-list-page.tsx` | **Yes** — `useCursorPagination`, a `DataTable` | The doc's warning applies here, exactly as written |

Rebecca's ask is unambiguously the client one — *"what this looks like when they have, they're hiring for 15 positions"* is a client looking at their own hires.

**Two consequences, and the second is the one that saves work later:**

1. **Grouping the client list needs no server change at all** — no query parameter, no repository change, no cursor redesign. That is the largest cost the doc attributes to T24 and it does not apply.
2. **A priority column on the ADMIN list must not be made sortable** without server-side sorting. A `DataTable` client-side sort over a cursor page sorts *the current page only* and looks like it works — the most expensive kind of wrong. So the admin column is **display-only** in this piece of work, and sortable admin columns are their own task.

### 2.2 The list silently truncated — fixed on the way

`ListRequisitionsQuerySchema` caps `limit` at 100. The hook asked for exactly 100 and kept what came back, so a client with 101 positions saw 100 — no counter, no control, nothing to suggest anything was missing.

**Already fixed** (`api.ts`, plus `tests/p5/requisitions-pagination.test.tsx`): the hook follows `meta.nextCursor` to the end, bounded at ten pages as a runaway-loop guard. The whole list stays in memory, which is what makes §2.1 hold.

---

## 3. Invariant check

None of the five in `CLAUDE.md` are touched.

- **Pipeline stage on `assignments`** — untouched; `priority` is a requisition attribute, not a stage.
- **`presented` visibility gate** — untouched. No candidate-scoped read changes.
- **PII gated in SQL** — untouched. Neither field is candidate data.
- **An `events` row per transition** — `priority` is an admin edit of a requisition, not a state transition, so it follows whatever the existing requisition-update path does. It must not invent a parallel audit trail; confirm what `PATCH /requisitions/:id` already writes and match it.
- **Browser never touches Postgres** — untouched.

One thing to flag in review rather than bury: **`priority` is SDB's internal ranking and Rebecca explicitly wants the client to see it.** That is her decision, but it means a field your team sets is visible to the customer it describes, so the wording of its values matters — `urgent` reads differently to a client than to a recruiter.

---

## 4. T18 — Priority

### The decision already made

**Priority and `urgency` are two separate fields.** `requisitions.urgency` is `text` and holds the **client's** stated timeline, captured as an intake answer. `priority` is **SDB's** operational ranking. They are allowed to disagree — a client saying "immediately" on a role whose job description is not written is exactly the disagreement worth seeing.

Because `urgency` is an intake answer it is also frozen in `question_snapshot`. Overwriting it would contradict AC-IF-11. That alone settles it.

### Shape

```
priority  requisition_priority  not null default 'normal'
```

A native Postgres enum, mirrored as a Zod enum in `packages/contracts` — the house rule for enums. Values: `low`, `normal`, `high`, `urgent`.

**Migration `0030_requisition_priority.sql`** — forward-only, additive, defaulted, so every existing row is valid the moment it applies and no backfill is needed.

### Who may set it

**Admin only.** It is your team's ranking of your own work. A client editing it would make the field meaningless — and the sort would then reflect what each client wants rather than what SDB has decided.

Enforced on the write path, not in the browser. `PATCH /requisitions/:id` already distinguishes admin and client callers; `priority` joins the admin-only field set beside the existing commercial fields.

### Where it shows — "everywhere it needs to be", enumerated

Haider asked for priority *"everywhere where it needs to be shown"*. That is a judgement per surface, not "all of them", so here is every screen that renders a position and the reason for each:

| Surface | Show | Why |
|---|---|---|
| **Client positions list** (card) | ✅ Chip | Rebecca asked by name: *"seen on the card, preview card"* |
| **Client position detail** | ✅ Chip in the rail | Having seen it on the card, its absence one click later reads as a bug |
| **Admin requisitions list** | ✅ Column, **not sortable** | Your team's queue — the field exists to rank work, so it belongs here. Sorting is blocked by §2.1 |
| **Admin position detail** | ✅ **Editable** | The only place it is *set*. Goes beside Urgency in `fields-card.tsx`, so the difference between the client's ask and SDB's ranking is visible in one glance |
| **Client dashboard** | ❌ No | It answers *"what needs me?"* and is already ordered by pending actions. Priority answers *"what matters most?"* — a second, competing signal in the same list makes both weaker. Revisit if asked |

### `normal` renders nothing

Not a grey "Normal" chip — **nothing at all**. If three quarters of positions carry a chip, the chip stops meaning anything and the two that say "Urgent" stop standing out. Absence is the signal. This applies on every surface above, the admin column included.

---

## 5. T25 — the 5eOS toggle · DEFERRED

```
uses_5eos  boolean  not null default false
```

on `clients`, admin-editable from the client detail page. **Migration `0031_client_uses_5eos.sql`.**

### The scope guard, stated plainly

`docs/README.md` excludes *"5eOS module reuse or shared architecture — Explicitly de-scoped. Build standalone."*

This adds **a boolean display flag and nothing else**: no shared code, no imported module, no API call to 5EOS, no schema borrowed from it. It stays within the exclusion's intent, but it is adjacent to a locked exclusion and therefore wants an explicit sign-off rather than a quiet build.

### What it gates

When `false` — the default, and the case for every client today — **Engine does not appear anywhere in that client's portal**: not on the card, not in the group-by control, not as a heading. Haider's reason is the requirement: *"it's just clutter if they're not using 5eOS."*

A hidden group-by option is the subtle part. Offering "Group by Engine" to a client who has never heard of Engines is exactly the clutter he objected to, so the **control itself** must be conditional, not merely its output.

---

## 6. T24 — grouping the list

### Group, not sort

Positions collect under headings — "Executive Assistance", "Client Experience" — with a count per heading. At fifteen positions this is what makes the screen readable, and *"sorted at the top based on alphabetical department"* is a description of headings.

### The control

A single **Group by** picker: **None · Department · Priority** — plus **Engine** only when `uses_5eos` is true.

Persisted per user in the existing Zustand UI store, beside the candidate-view preference added for T22. `05-FRONTEND.md` §1 permits Zustand for cross-cutting UI state and this is exactly that.

**Default: None.** A client with three positions gains nothing from headings, and a control that silently reorganises the page on first visit is disorienting. The picker is always visible so it is discoverable.

### Ordering

- **Department / Engine** — alphabetical by label, as she asked. Positions with no department collect under a final "Other" group, never dropped.
- **Priority** — `urgent → high → normal → low`, the meaningful order, not alphabetical. Anything else puts "high" above "urgent" and the grouping actively misleads.
- **Within a group** — keep the list's existing order, so grouping changes only the arrangement and never the sequence a client has learned.

### Where it does not apply

The **dashboard** keeps its "needs your attention first" ordering. That page answers a different question and grouping it by department would bury the thing a client came for.

---

## 7. Failure states

| | |
|---|---|
| **Empty** | Existing empty state, unchanged. The Group-by control is hidden with nothing to group. |
| **One group** | Render the heading anyway. A heading that appears only above a certain count reads as a rendering fault. |
| **Missing department** | An "Other" heading. A position must never vanish because a field is null — that is the failure mode that makes a list untrustworthy. |
| **Loading / error** | Unchanged; grouping is a pure transform of loaded data and adds no request. |

## 8. Accessibility

Each group is a `<section>` with its heading as the accessible name, so a screen-reader user can move between departments by heading rather than hearing fifteen cards in one run. The Group-by picker is a labelled `<select>`, not an icon menu. Changing it announces the new arrangement — *"Grouped by department, 4 groups"* — into a polite live region; without that, a keyboard user gets no confirmation anything happened.

## 9. Testing

Pure grouping logic in its own module, unit-tested: alphabetical departments, priority in rank order, the "Other" bucket, and stability within a group. Component tests for: Engine absent when `uses_5eos` is false — **in the picker as well as the cards** — and present when true; a `normal` priority rendering no chip; the choice surviving a remount.

## 10. Build order

**T18 → T25 → T24.** Each is independently shippable and each unblocks the next. T18 and T25 are one small migration apiece plus a display; T24 is front-end only and lands last, when both fields it depends on exist.

## 11. Deliberately not building

Sort **and** group as separate controls (she asked for one arrangement, not a matrix) · the card/table toggle and field checklist (T23, a different request) · grouping the admin positions list · any Engine feature beyond showing the label · reading anything from the real 5EOS product · a priority field on candidates or assignments · reordering within a group by drag.

## 12. Open for Haider

1. **Priority values.** `low / normal / high / urgent` is my proposal, not her words — she never named the levels. Worth confirming, since a client reads them.
2. **Does the client see priority on the dashboard too**, or only on the positions list? She said *"the card, preview card"*, which is the list.
3. **The 5eOS exclusion sign-off** (§5). A boolean flag stays within its intent, but the exclusion is in a locked document.
