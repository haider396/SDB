-- 0026_form_block_content_heights.sql
--
-- Give every existing form block enough height for what it actually renders,
-- and re-pitch the plain stacks so nothing sits on top of anything else.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
-- The canvas grid has FIXED 8px rows (form-canvas.css `grid-auto-rows: 8px`)
-- and every block is placed at an explicit grid row, so a block taller than
-- `rowSpan × 8px` does not push the next one down — it renders on top of it.
--
-- 0022 corrected the seeded rows to a flat 14 (112px), which clears a label,
-- help text and a text input. It does NOT clear a question that renders as a
-- list of radio buttons: `english_spoken_level` has four choices and help
-- text, and renders 159px tall. On the built form served at /f/:slug that
-- field has been sitting on top of the one below it ever since. (`/register`
-- is unaffected — it is served by the legacy category renderer, which stacks
-- fields in normal flow and never reads these rectangles.)
--
-- Nothing repaired the CODE that writes new blocks either — it created every
-- block 8 rows tall whatever it contained — so every form built in the app
-- inherited the same fault. That half is fixed in
-- apps/web/src/features/form-builder/block-height.ts; this migration repairs
-- the rows already in the database.
--
-- ── The height model ───────────────────────────────────────────────────────
-- Mirrors block-height.ts, which documents where each number comes from:
--   label 21px (text-sm × 1.5), help text 18px per line, 6px between the
--   shell's children, an h-9 control 36px, one radio/checkbox row 21px with
--   8px between them, a segmented control 42px, a 3-row textarea 73px, the
--   currency range 138px, the file drop zone 160px, plus 6px of slack.
-- A select shows radio buttons at five choices or fewer and a checkbox group
-- at eight or fewer; above those it collapses to a single control, which is
-- why 251 countries is not 251 rows tall.
--
-- ── Scope ──────────────────────────────────────────────────────────────────
-- Heights are corrected everywhere, and only ever upward: a block an admin
-- deliberately dragged taller keeps its height.
--
-- Rows are re-pitched only on pages where EVERY block is full width at column
-- zero — a plain stack, where "what comes next" is unambiguous. A page with
-- fields placed side by side keeps its rows; growing a block there changes no
-- pixels on its own (the content was already overflowing), and the builder now
-- offers "Tidy layout" for those, which understands side-by-side rows.
--
-- One statement, so height and position land together: two updates touching
-- the same row would have to be two statements, and the second could not see
-- the first.
--
-- Forward-only: this corrects the data 0021 and 0022 wrote rather than editing
-- them. A fresh database runs 0021, 0022 and then this, and lands in the same
-- place.

with recursive base as (
  select b.id,
         b.form_version_id,
         b.page_index,
         b.block_type,
         (b.layout -> 'desktop' ->> 'col')::int     as col,
         (b.layout -> 'desktop' ->> 'row')::int     as row,
         (b.layout -> 'desktop' ->> 'colSpan')::int as col_span,
         (b.layout -> 'desktop' ->> 'rowSpan')::int as row_span,
         coalesce(b.label_override, q.label, '')     as label,
         coalesce(b.help_text_override, q.help_text) as help_text,
         q.question_type,
         q.validation,
         coalesce(b.props ->> 'text', '')            as block_text,
         coalesce((b.props ->> 'level')::int, 2)     as heading_level,
         -- `.sdb-canvas-node` carries 6px of padding on each side.
         greatest(
           80,
           round(
             ((b.layout -> 'desktop' ->> 'colSpan')::int / 24.0)
             * greatest(
                 240,
                 coalesce((v.theme ->> 'maxWidthPx')::int, 880)
                 - coalesce((v.theme -> 'padding' ->> 'left')::int, 24)
                 - coalesce((v.theme -> 'padding' ->> 'right')::int, 24)
               )
           )::int - 12
         ) as width_px,
         -- Choices the candidate is shown: the per-form subset when one is
         -- set, otherwise every active choice in the library.
         coalesce(
           array_length(b.option_value_overrides, 1),
           (select count(*)::int
              from question_options o
             where o.question_id = q.id
               and o.is_active),
           0
         ) as option_count
    from candidate_form_blocks b
    join candidate_form_versions v on v.id = b.form_version_id
    left join questions q on q.id = b.question_id
),
wrapped as (
  select base.*,
         -- Wrapped line counts, at roughly 0.55em per character.
         greatest(
           1,
           ceil(char_length(label)::numeric / greatest(1, floor(width_px / 7.7)))::int
         ) as label_lines,
         case
           when help_text is null or help_text = '' then 0
           else greatest(
                  1,
                  ceil(char_length(help_text)::numeric / greatest(1, floor(width_px / 6.6)))::int
                )
         end as help_lines,
         greatest(
           1,
           ceil(char_length(block_text)::numeric / greatest(1, floor(width_px / 7.7)))::int
         ) as text_lines
    from base
),
heights as (
  select wrapped.*,
         case block_type
           when 'question' then
             label_lines * 21
             + case when help_lines = 0 then 0 else 6 + help_lines * 18 end
             + 6
             + case question_type
                 when 'long_text' then
                   73 + case when validation ->> 'maxLength' is not null then 24 else 0 end
                 when 'single_select' then
                   case when option_count <= 5
                        then greatest(21, option_count * 21 + greatest(0, option_count - 1) * 8)
                        else 36 end
                 when 'multi_select' then
                   case when option_count <= 8
                        then greatest(21, option_count * 21 + greatest(0, option_count - 1) * 8)
                        else 36 end
                 when 'yes_no' then 42
                 when 'scale' then
                   42 + case when validation ->> 'scaleMinLabel' is not null
                              or validation ->> 'scaleMaxLabel' is not null
                             then 24 else 0 end
                 when 'currency_range' then 138
                 when 'file_upload' then 160
                 else 36
               end
             + 6
           when 'heading' then
             ceil(
               text_lines
               * case heading_level when 1 then 30 when 3 then 20 when 4 then 18 else 24 end
               * 1.25
             )::int + 6
           when 'paragraph' then ceil(text_lines * 14 * 1.625)::int + 6
           when 'divider' then 17
           -- A spacer IS its row span, and an image has no knowable size.
           else null
         end as content_px
    from wrapped
),
spans as (
  select heights.*,
         -- Only ever grow. An author who dragged a field taller meant it.
         greatest(
           row_span,
           coalesce(ceil(content_px / 8.0)::int, row_span),
           4
         ) as new_row_span
    from heights
),
stacked_pages as (
  select form_version_id, page_index
    from spans
   group by form_version_id, page_index
  having bool_and(col = 0 and col_span = 24)
),
ordered as (
  select s.id,
         s.form_version_id,
         s.page_index,
         s.row,
         s.new_row_span,
         row_number() over (
           partition by s.form_version_id, s.page_index
           order by s.row, s.id
         ) as ord
    from spans s
    join stacked_pages p
      on p.form_version_id = s.form_version_id
     and p.page_index = s.page_index
),
walk as (
  select id, form_version_id, page_index, ord, new_row_span, row as new_row
    from ordered
   where ord = 1
  union all
  -- Push down to clear the block above, with a two-row gutter — never pull up,
  -- so whitespace an admin left on purpose survives.
  select o.id,
         o.form_version_id,
         o.page_index,
         o.ord,
         o.new_row_span,
         greatest(o.row, w.new_row + w.new_row_span + 2) as new_row
    from ordered o
    join walk w
      on w.form_version_id = o.form_version_id
     and w.page_index = o.page_index
     and w.ord = o.ord - 1
),
final as (
  select s.id,
         s.row,
         s.row_span,
         s.new_row_span,
         coalesce(w.new_row, s.row) as new_row
    from spans s
    left join walk w on w.id = s.id
)
update candidate_form_blocks b
   set layout = jsonb_set(
         jsonb_set(b.layout, '{desktop,rowSpan}', to_jsonb(f.new_row_span)),
         '{desktop,row}',
         to_jsonb(f.new_row)
       )
  from final f
 where f.id = b.id
   and (f.new_row_span <> f.row_span or f.new_row <> f.row);
