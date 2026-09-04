-- 0016_candidate_registration_enums.sql
--
-- Enum additions for the public candidate registration form
-- (docs/CHANGE-REQUESTS-2026-08-13.md T38).
--
-- Split from 0017 deliberately: Postgres forbids USING a new enum value in the
-- same transaction that adds it, so the values land here and everything that
-- references them lives in 0017.
--
-- `question_audience` gains 'candidate' so the question engine can serve a
-- second library (T32) without forking the renderer. `submission_channel`
-- gains 'self_registration' so a candidate who registered themselves is
-- distinguishable from a manual entry or a webhook push.
--
-- `candidate_source` already carries 'inbound', which is the correct source
-- for a self-registration — no addition needed there.

alter type question_audience add value if not exists 'candidate';

alter type submission_channel add value if not exists 'self_registration';
