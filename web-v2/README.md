# FairShare v2 — Next.js + Supabase

The "share it with the families" build. Supersedes the localStorage prototype
(v1 in `../web`). Weighted group bill-splitting: snap a receipt, split by family
& age, settle up.

## Stack
- **Next.js 14** (App Router, server actions)
- **Supabase** — auth (email+pw, magic link, TOTP), Postgres, Storage (receipts)
- Ported **split engine** (`lib/split.mjs`) + **receipt parser** (`lib/receipt.mjs`)

## Setup
```bash
cd web-v2
npm install
# env: copy the real values into web-v2/.env.local (gitignored). Needs:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_PASSWORD, OPENAI_API_KEY
npm run dev            # http://localhost:3000
```

## Database
Schema + RLS live in `supabase/migrations/0001_init.sql`. Apply either way:
- **Supabase SQL editor:** paste the file, run.
- **CLI:** `supabase link --project-ref tjtarayabyppkrgsengf && supabase db push`

Also create a **Storage bucket** named `receipts` (private) for uploaded photos.

## Model (see fairshare-v2-spec.md)
A group splits across **participants** — each a solo user *or* a family (bundle of
weighted members). Weights make different family sizes/ages fair. Tables:
`profiles, families, family_members, groups, group_participants, events,
expenses, expense_items, receipts, settlements, activity_log`.

## Security notes
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — server-only, never `NEXT_PUBLIC_`.
- All three secrets were pasted into a chat during setup → **rotate the DB
  password and the service-role key** in the Supabase dashboard.

## Status (2026-07-24) — first cut
Done: auth (signup/login/confirm), create/join group, one-tap "I paid" tally,
weighted balances + settle-up, activity feed, receipt-parse API.
Next: receipt photo → itemized UI, families/members CRUD, payment links,
reminders, game-y settle-up confetti.
