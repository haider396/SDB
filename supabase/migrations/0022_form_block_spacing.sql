-- 0022_form_block_spacing.sql
--
-- Give the seeded question blocks enough height, and enough gap, for the
-- content they actually contain.
--
-- 0021 laid every question out as `rowSpan: 8` (64px at the 8px row unit) with
-- rows 10 apart. That is fine for a bare label + input, but a question with
-- help text renders around 90px — so on the public form the NEXT field's label
-- sat on top of the previous field's input. Caught by looking at a rendered
-- form rather than at the data.
--
-- rowSpan 14 (112px) clears label + help + input, and a 16-row pitch leaves a
-- 2-row gap between blocks.
--
-- Scoped to the seeded signature — a question block at column 0, full width,
-- exactly 8 rows tall. A hand-authored block would have to match all four
-- values to be caught, and if it did, this spacing is still an improvement.
--
-- Forward-only: 0021 is already applied, so this corrects the data it wrote
-- rather than editing it. A fresh database runs 0021 then 0022 and lands in
-- the same place.

update candidate_form_blocks
   set layout = jsonb_set(
         jsonb_set(
           layout,
           '{desktop,rowSpan}',
           to_jsonb(14)
         ),
         '{desktop,row}',
         -- Re-pitch from the existing row so relative order is preserved:
         -- the seed used (ord - 1) * 10, so row / 10 recovers the index.
         to_jsonb(((layout -> 'desktop' ->> 'row')::int / 10) * 16)
       )
 where block_type = 'question'
   and (layout -> 'desktop' ->> 'col')::int = 0
   and (layout -> 'desktop' ->> 'colSpan')::int = 24
   and (layout -> 'desktop' ->> 'rowSpan')::int = 8;
