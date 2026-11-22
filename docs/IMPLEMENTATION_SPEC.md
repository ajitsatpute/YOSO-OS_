# YOSO OS – Rectified Implementation Specification

## Purpose
Standalone agency operations application implementing the three assignment features with synthetic data, ordered PostgreSQL migrations, strict Row-Level Security (RLS), and automated tests.

## Required stack
- Node.js 22
- Next.js App Router and React
- TypeScript
- Supabase Auth and PostgreSQL
- PostgreSQL Row Level Security (RLS)
- Supabase Realtime for message and reaction updates
- Supabase Storage private bucket (`voice-notes`)

## Feature A – Chat upgrade (15%)
1. **Channel List & Thread View:** `/api/chat/channels` lists accessible channels via RLS; users can browse channels, post messages, jump directly from search results into message context, and receive live updates via Supabase Realtime.
2. **Search:** Search message body and sender name across channels the signed-in user belongs to. Uses PostgreSQL generated `tsvector` + GIN index (`chat_messages_search_idx`) with safe `ilike` fallback for partial matches.
3. **Reactions:** Add/remove emoji reactions via `/api/chat/reactions`. Unique constraint on `(message_id, user_id, emoji)` prevents race-condition duplicates; RLS prevents reacting in inaccessible channels.
4. **Voice notes:** Browser `MediaRecorder` captures audio up to 120 seconds, selects supported codecs (`audio/webm` on Chrome/Android, `audio/mp4` on iOS Safari), uploads to private Storage (`<channel-id>/<user-id>/<idempotency-key>.<ext>`), and issues short-lived signed URLs via `/api/chat/voice/[id]`. Failed uploads retain the Blob and idempotency key for safe retry without duplicate messages.

## Feature B – Client health score (30%)
1. **Sample Data & Adapter:** 12 fictional clients with 90 days of bilingual/Hinglish messages (including edits and tombstoned deletions). All external chat ingestion flows through `lib/chat-adapter.ts` and idempotent upsert logic in `lib/chat-importer.ts`.
2. **Scoring & IST Business Hours:** Weekly score (0–100) with labels `Healthy` (80–100), `Watch` (50–79), and `At risk` (0–49). Reply times and unanswered thresholds count only Monday–Friday, 09:00–18:00 IST.
3. **Versioning, Evidence & Alerts:** Immutable weekly snapshots keyed by `(client_id, week_start, rule_version)`. Account managers inspect cited source messages; founders see urgency-sorted client scores and signal rules without private message text. Downgrade alerts (`Healthy -> Watch`, `Watch -> At risk`) are deduplicated per client, transition, week, and rule version.
4. **Data Boundary:** No external LLM is called; `redactForExternal()` is provided in `lib/health.ts` to strip emails, phone numbers, and URLs if an external classifier is ever integrated.

## Feature C – Capacity planner (35%)
1. **Plan Engine:** Topological dependency sort followed by due-date prioritization across a 4-week horizon. Respects craft, tier effort multipliers (`intern` 1.35x to `senior` 0.85x), weekly hours, leave weeks, due dates, and sealed pod boundaries.
2. **Minimal Reshuffle:** Existing assignees in their scheduled week are evaluated first so localized changes do not unnecessarily reassign unrelated work.
3. **What-If Simulator:** Stateless `POST /api/planner` computes before/after pod utilisation, individual fragile capacity (`>= 90%`), missed due dates, and concrete smallest-fix recommendations without persisting writes. Pod leads are restricted to simulating their own pod.
4. **Revision Accounting:** `estimated_hours` covers initial production plus standard 4 review passes (`review_passes = 4`). Client-caused revisions (`client_revision_hours`) are tracked separately and never penalized against creator capacity.

## Migrations
Run in order:
1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_assignment_hardening.sql`
3. `supabase/migrations/003_rectifications.sql`
