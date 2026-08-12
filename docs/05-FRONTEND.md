# 05 — Front End

## 1. Stack

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Framework | React | 18.3 | Client requirement |
| Language | TypeScript | 5.5+, `strict: true` | |
| Build | Vite | 5.x | Fast, no framework-level server needed since the API is separate |
| Routing | React Router | 6.x, data router API | File-based routing is unnecessary for an SPA behind an API |
| Server state | TanStack Query | 5.x | Caching, invalidation, optimistic updates. Do not hand-roll fetch state |
| Client state | Zustand | 4.x | Only for genuine cross-cutting UI state (sidebar, active filters). Not a data store |
| Forms | React Hook Form + Zod | 7.x / 3.x | Schemas imported from `packages/contracts` — one definition, validated on both sides |
| Styling | Tailwind CSS | 3.4 | |
| Components | shadcn/ui | latest | Copied in, not a dependency. Owned and themeable |
| Icons | lucide-react | 0.4x | |
| Charts | Recharts | 2.x | Only for the admin stats view |
| Tables | TanStack Table | 8.x | Headless. Sorting, column visibility, pagination for candidate and requisition lists |
| Dates | date-fns + date-fns-tz | 3.x | No moment.js |
| Drag & drop | dnd-kit | latest | Question and category reordering |
| Toasts | sonner | latest | |
| Testing | Vitest + Testing Library + Playwright | | Unit, component, and the E2E flows in `07` §7 |

**Not permitted:** Next.js, Redux, MUI, Bootstrap, Chakra, styled-components, moment.js, jQuery, `localStorage` for tokens, Create React App.

---

## 2. Application structure

```
apps/web/src/
├── main.tsx
├── router.tsx
├── routes/
│   ├── public/            # intake form, invitation acceptance
│   ├── admin/             # attention queue, clients, requisitions, candidates, questions, settings
│   └── client/            # dashboard, requisitions, candidate review
├── features/
│   ├── intake-form/       # dynamic renderer — the most complex feature
│   ├── question-manager/
│   ├── candidates/
│   ├── pipeline/
│   ├── requisitions/
│   └── clients/
├── components/
│   ├── ui/                # shadcn primitives
│   └── patterns/          # PageHeader, DataTable, EmptyState, StatusBadge, StageTracker
├── lib/
│   ├── api-client.ts      # typed fetch wrapper, injects bearer token, normalises errors
│   ├── auth.ts            # Supabase client, session handling
│   ├── permissions.ts     # can(permissionKey) helper from /auth/me
│   └── format.ts          # currency, rate-with-unit, relative dates, timezone labels
└── styles/
    ├── globals.css
    └── tokens.css         # THE ONLY FILE CONTAINING BRAND VALUES
```

### 2.1 Route protection

Three route guards, composed:

- `RequireAuth` — redirects to login when unauthenticated
- `RequirePermission({ permission })` — renders a 403 page rather than redirecting, so the URL stays inspectable
- `RequireClientContext` — resolves `clientId` from `/auth/me`; renders a "no access yet" state when the user has no active client membership

Admin and client route trees are separate. There is no shared layout, and no runtime branching on role inside a page component.

---

## 3. Branding

### 3.1 Source and confidence

The palette below was **extracted by pixel sampling** from three screenshots of the live Business Done Better / Staffing Done Better properties: the staffing homepage, a 5E quiz step, and the quiz results page. Values marked **sampled** are exact hex values read from the rendered UI, with the pixel counts that support them. Values marked **derived** are not present in the source and were computed for a purpose the marketing site does not cover (accessible text variants, hover states, neutral ramp steps).

The single most load-bearing value is the primary navy `#1E2B67` — it accounts for roughly 10% of all pixels across both application screenshots and is used for every piece of chrome.

> **Naming note.** Staffing Done Better presents as a sub-brand of Business Done Better and shares its palette. The logo lock-up reads "BUSINESS DONE BETTER" even on `staffingdonebetter.com`. Product chrome should use the shared palette; if a distinct Staffing Done Better mark is produced later, only the logo asset changes.

### 3.2 Sampled brand values

| Token | Hex | Where observed | Confidence |
|---|---|---|---|
| Primary navy | `#1E2B67` | App header bars, quiz chrome, results header. ~29k sampled px | **Sampled — high** |
| Deep navy | `#020C2E` | Homepage stats band background | **Sampled — high** |
| Ink navy | `#101627` | Question headings, primary body text | **Sampled — high** |
| Accent blue | `#356AB0` | Selected option tile, "BRAND ENGINE" label, metric values, links | **Sampled — high** |
| Bright blue | `#5B7FE5` | Large stat figures on the dark band (150+, 92%) | **Sampled — high** |
| Slate blue | `#314F7D` | Secondary headline lines, muted headline weight | **Sampled — high** |
| Teal accent | `#62C1D3` | Progress bar fill, eyebrow text on gradient cards | **Sampled — high** |
| Teal bright | `#72D5EC` | Homepage hero graphic highlights | **Sampled — medium** |
| Success green | `#5EC26A` | "Strong" legend dot on results page | **Sampled — high** |
| Warning amber | `#E9A23B` | "Needs work" legend dot | **Sampled — high** |
| Page background | `#F1F5FE` | App page background. ~35% of results-page pixels | **Sampled — high** |
| Subtle surface | `#ECF0F9` | Metric card fills, chip backgrounds | **Sampled — high** |
| Border | `#B7C2D7` | Card and input borders | **Sampled — medium** |

Two gradients are used consistently and must be reproduced as tokens rather than re-invented per component:

- **Brand gradient** (buttons, hero cards): navy → accent blue. Sampled ramp `#20306E → #28498A → #3161A6`, expressed as `linear-gradient(135deg, #1E2B67 0%, #356AB0 100%)`
- **Progress gradient** (progress bars): `linear-gradient(90deg, #356AB0 0%, #62C1D3 100%)`

### 3.3 Typography

**Cannot be verified from screenshots and must not be guessed.** Observation only: the marketing headline uses a heavy condensed display face, and body and UI text use a geometric sans consistent with Poppins or Montserrat — both common on this platform. The exact families are unconfirmed.

**Recommendation, independent of the above:** the marketing display face is the wrong choice for a data-dense application. Use **Inter** for all product UI — it has the tabular numeral support required by §4.2 and holds up at 14px in tables, which a geometric display sans does not. Match the marketing face only if a marketing surface is added later, which is out of scope.

`TODO(client)` — optional, non-blocking: confirm the body font family with Rebecca if exact marketing parity is wanted anywhere in the product.

### 3.4 `styles/tokens.css`

This is the only file in the codebase permitted to contain a colour literal.

```css
:root {
  /* ===== BRAND — sampled from live BDB/SDB properties ===== */
  --brand-navy:         #1E2B67;  /* primary. all chrome */
  --brand-navy-deep:    #020C2E;  /* dark bands, inverse surfaces */
  --brand-navy-ink:     #101627;  /* primary text */
  --brand-blue:         #356AB0;  /* interactive, links, selected */
  --brand-blue-bright:  #5B7FE5;  /* figures on dark surfaces */
  --brand-slate:        #314F7D;  /* secondary headings */
  --brand-teal:         #62C1D3;  /* progress, accent detail */
  --brand-teal-bright:  #72D5EC;  /* highlight */
  --brand-on-dark:      #FFFFFF;

  /* derived — hover/active states, not present in source */
  --brand-navy-hover:   #18234F;
  --brand-blue-hover:   #2C598F;
  --brand-navy-subtle:  #E8ECF7;
  --brand-blue-subtle:  #E9F0F9;

  --gradient-brand:     linear-gradient(135deg, #1E2B67 0%, #356AB0 100%);
  --gradient-progress:  linear-gradient(90deg, #356AB0 0%, #62C1D3 100%);

  /* ===== SURFACES — sampled ===== */
  --surface-page:       #F1F5FE;
  --surface-raised:     #FFFFFF;
  --surface-subtle:     #ECF0F9;
  --surface-inverse:    #1E2B67;
  --border-default:     #B7C2D7;

  /* derived neutral ramp, hue-aligned to the sampled blue-tinted greys */
  --neutral-50:  #F7F9FD;
  --neutral-100: #ECF0F9;
  --neutral-200: #DCE3EF;
  --neutral-300: #B7C2D7;
  --neutral-400: #8E9BB5;
  --neutral-500: #6A7793;
  --neutral-600: #4E5A75;
  --neutral-700: #364159;
  --neutral-800: #212B40;
  --neutral-900: #101627;

  /* ===== SEMANTIC =====
     Dot/fill values are sampled from the results-page legend.
     *-text values are derived to meet 4.5:1 on white; the sampled
     fills do not pass AA as text and must not be used for text. */
  --success:        #5EC26A;  /* sampled — fills, dots, bars */
  --success-text:   #2F7D3C;  /* derived — text, icons */
  --success-subtle: #E9F7EC;
  --warning:        #E9A23B;  /* sampled */
  --warning-text:   #8A5A0B;  /* derived */
  --warning-subtle: #FDF3E3;
  --danger:         #C0392B;  /* derived — no red in source */
  --danger-text:    #96271C;
  --danger-subtle:  #FBEAE8;
  --info:           #356AB0;  /* = accent blue */
  --info-subtle:    #E9F0F9;

  /* ===== TYPE ===== */
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --text-xs:0.75rem;  --text-sm:0.875rem; --text-base:1rem;
  --text-lg:1.125rem; --text-xl:1.25rem;  --text-2xl:1.5rem;
  --text-3xl:1.875rem; --text-4xl:2.25rem;
  --leading-tight:1.25; --leading-normal:1.5; --leading-relaxed:1.625;
  --tracking-tight:-0.011em;

  /* ===== SPACE — 4px base, 8px rhythm ===== */
  --space-1:0.25rem; --space-2:0.5rem;  --space-3:0.75rem; --space-4:1rem;
  --space-5:1.25rem; --space-6:1.5rem;  --space-8:2rem;    --space-10:2.5rem;
  --space-12:3rem;   --space-16:4rem;

  /* ===== RADIUS & ELEVATION =====
     Source UI uses generously rounded cards (~12-16px) and soft shadows. */
  --radius-sm:0.375rem; --radius-md:0.5rem; --radius-lg:0.75rem; --radius-xl:1rem;
  --shadow-xs:0 1px 2px rgba(16,22,39,.05);
  --shadow-sm:0 1px 3px rgba(16,22,39,.08), 0 1px 2px rgba(16,22,39,.04);
  --shadow-md:0 4px 12px rgba(16,22,39,.08), 0 2px 4px rgba(16,22,39,.04);
  --shadow-lg:0 12px 32px rgba(16,22,39,.10), 0 4px 8px rgba(16,22,39,.04);

  /* ===== MOTION ===== */
  --ease-out: cubic-bezier(.16,1,.3,1);
  --duration-fast:120ms; --duration-base:200ms; --duration-slow:320ms;
}
```

### 3.5 Application rules

- Tailwind config maps these tokens to utility names. **No component may contain a raw hex value or an arbitrary Tailwind colour such as `bg-[#1E2B67]`.** Enforced by ESLint (AC-UI-01)
- App chrome — sidebar, top bar, page headers — uses `--brand-navy`, matching the observed quiz and results chrome
- Primary buttons use `--gradient-brand`; secondary buttons are outlined in `--border-default` on `--surface-raised`
- Progress and completion indicators use `--gradient-progress`
- `--brand-blue-bright` is for figures on dark surfaces only. It fails AA on white and must never be used as text on a light background
- Cards sit on `--surface-page` at `--radius-lg` with `--shadow-sm`, matching the source UI's rounded, softly elevated card language

### 3.6 Stage and status badges

Badge colour maps to semantic tokens, never to brand tokens, so pipeline state is never confused with chrome:

| Stage group | Text | Background |
|---|---|---|
| Internal (sourced, screened, vetted) | `--neutral-600` | `--neutral-100` |
| Presented, client reviewing | `--info` | `--info-subtle` |
| Interview scheduled, interviewed | `--warning-text` | `--warning-subtle` |
| Offer, placed | `--success-text` | `--success-subtle` |
| Rejected, withdrawn, closed | `--danger-text` | `--danger-subtle` |

Every badge carries text as well as colour (AC-UI-03).

---

## 4. UI/UX standard

The client's requirement is enterprise-grade, and explicitly not "traditionally built software." That is a real constraint, so here is what it means concretely. The build agent is accountable to these, not to a vibe.

### 4.1 Layout and density
- Persistent left sidebar, 264 px expanded, 64 px collapsed, state remembered per user
- Content max-width 1440 px, centred, with 32 px gutters at ≥1024 px
- Every page uses the `PageHeader` pattern: breadcrumb, H1, subtitle, right-aligned primary action. No page invents its own header
- Data-dense views use 40 px table rows and 14 px body text. Not 60 px rows with 16 px text — this is a work tool, and screen real estate is the scarce resource
- Detail pages use a two-column split at ≥1280 px: primary content left, metadata and actions in a sticky right rail

### 4.2 Type and hierarchy
- One H1 per page. Section headings at `--text-lg`, semibold, `--tracking-tight`
- Body text `--text-sm` in dense views, `--text-base` in reading views
- Numerals tabular (`font-variant-numeric: tabular-nums`) in every table and metric — misaligned digits are the fastest way to look amateur
- Labels above inputs, never floating placeholders as labels

### 4.3 States — all four, every time
Every data surface implements four states. A component that only handles success is incomplete and will be rejected in review.

| State | Requirement |
|---|---|
| Loading | Skeletons that match the final layout's shape and row count. Never a centred spinner on a full page |
| Empty | Illustration or icon, a sentence explaining what belongs here, and the primary action to create it. Never the word "No data" alone |
| Error | Plain-language message, the `requestId` in small mono text, and a Retry button |
| Partial | When some data loaded and some failed, show what loaded and inline-flag the rest |

### 4.4 Forms
- Inline validation on blur, not on every keystroke
- Submit disabled only while in flight, never because of validation state — let people submit and show them what is wrong
- Errors summarised at the top with anchor links to each field for long forms
- Destructive actions require a typed confirmation of the object name, not just an "Are you sure" dialog
- Unsaved-changes guard on navigation away from any dirty form
- Multi-step intake shows a progress indicator with named steps and allows backward navigation without data loss

### 4.5 Feedback and motion
- Optimistic updates on stage advances and toggles, with rollback and a toast on failure
- Toasts for background success, inline messages for form outcomes. Never a toast for something the user is looking at
- Transitions 120–200 ms, `--ease-out`. Only `opacity` and `transform` animate. Respect `prefers-reduced-motion`
- Any action over 400 ms shows progress; over 2 s shows a determinate indicator or a description of what is happening

### 4.6 Accessibility — WCAG 2.1 AA
- Every interactive element reachable and operable by keyboard; visible focus ring using `--brand-primary` at 2 px offset
- Modals trap focus and restore it on close
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries
- Status is never conveyed by colour alone — badges carry text
- Tables use proper `<th scope>`; sortable headers announce sort state
- `aria-live="polite"` region for async result announcements

### 4.7 Signature interactions
Three places where the interaction quality is the product, and generic implementations are not acceptable:

**The pipeline board.** Kanban by stage per requisition, drag to advance, with invalid target columns visually disabled during drag rather than rejecting the drop afterwards. Candidate cards show photo, display name, country flag, English and accent chips, and days-in-stage.

**Candidate presentation.** Multi-select from the vetted column, a review sheet showing exactly what the client will see including which PII is withheld, then one confirm. The admin should never have to guess what the client sees.

**Question management.** Two-pane layout: categories left with drag reorder, questions right with drag reorder. Live preview panel rendering the actual client form, updating as you edit. Answer counts shown per question so nothing is deactivated blindly.

---

## 5. Intake form renderer

The most complex front-end component. Requirements:

1. Fetch the form definition from `GET /api/v1/intake-form` on mount and on role-category change
2. Build a Zod schema dynamically from the returned question definitions, so the client-side validation mirrors the server's without duplicating the rules
3. Render one field component per `question_type`. Map is exhaustive and type-checked — a `never` exhaustiveness guard on the switch, so adding a question type is a compile error until the renderer handles it
4. Evaluate conditional visibility reactively from current form values. Hidden fields are excluded from submission, not submitted as null
5. Group by category, one step per category, with named progress steps
6. Persist in-progress answers to memory only. **No `localStorage`** — the form is public and may be completed on a shared machine
7. On submit, send only visible, answered questions in the shape defined in `03` §3.3
8. Map server field errors back onto the correct fields by `questionKey` and scroll to the first error
9. Confirmation screen shows the requisition reference and what happens next. No account creation prompt

Field component mapping:

| question_type | Component |
|---|---|
| `short_text`, `email`, `phone` | `<Input>` with the appropriate `type` and `inputMode` |
| `long_text` | `<Textarea>`, auto-growing, character counter when `maxLength` is set |
| `number` | `<Input type="number">`, tabular numerals |
| `currency_range` | Paired min/max inputs plus a unit selector (hourly/monthly). Renders the unit prominently — this is the field that causes the most expensive misunderstanding in the business |
| `single_select` | `<RadioGroup>` at ≤5 options, `<Select>` above that |
| `multi_select` | Checkbox group at ≤8 options, multi-combobox with search above that |
| `yes_no` | Segmented two-option control |
| `date` | Date picker, ISO on the wire, localised display |
| `scale` | Discrete 1–n segmented control with min and max labels |
| `file_upload` | Drop zone with type and size hints, progress bar, per-file remove |
