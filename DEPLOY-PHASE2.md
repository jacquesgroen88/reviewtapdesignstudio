# Phase 2 deploy checklist (auth) — DO THESE IN ORDER

QR uptime rule applies: after EVERY step below, verify
`curl -sI https://link.reviewtap.co.za/r/Z6Ja6AD` → 302, bogus code → 404.

## 1. Netlify env vars (BEFORE deploying this code)
Site settings → Environment variables → add:

| Key | Value |
|---|---|
| `SUPABASE_SERVICE_KEY` | (service_role key from Supabase dashboard → Settings → API) |
| `VITE_SUPABASE_URL` | `https://urwqhjcocnclvhomuksm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (anon key from the same Supabase page) |

Optional: `PUBLIC_URL=https://link.reviewtap.co.za` (defaults to this anyway).

## 2. Supabase Auth settings (dashboard → Authentication → URL Configuration)
- Site URL: `https://link.reviewtap.co.za`
- Redirect URLs: add `https://link.reviewtap.co.za/welcome`
  (and `http://localhost:3000/welcome` for local dev)
- Email provider: enabled (default).

## 3. Bootstrap the first admin account
The Team invite flow needs one existing admin. Create Jacques's account
once (either via the Supabase dashboard → Authentication → Users → Add user
with email + password, then run the SQL below — or have Claude run the
seed script with an approved password):

```sql
insert into public.profiles (id, display_name, role)
values ('<auth user uuid>', 'Jacques', 'admin')
on conflict (id) do update set role = 'admin';
```

## 4. Deploy (git push) and verify
- Sign-in works, wrong password rejected.
- /orders, /designstudio, /qrcodes require login.
- QR redirect still 302s (step 0 check).
- Invite a second user from /team; magic link lands on /welcome.

## 5. ONLY AFTER step 4 passes: lock RLS
This closes the "anon key can read the whole DB" hole. The service role
bypasses RLS, so the app keeps working — but ONLY once the deployed
functions actually have SUPABASE_SERVICE_KEY (step 1 + 4).

```sql
-- Run in Supabase SQL editor (or have Claude apply it):
drop policy if exists "Allow all" on public.qr_codes;
drop policy if exists "Allow all" on public.designs;
drop policy if exists "Allow all" on public.order_status;
drop policy if exists "Allow all" on public.jobs;
drop policy if exists "Allow all" on public.fulfillment_runs;
drop policy if exists "Allow all" on public.order_designs;
-- List remaining policies to confirm nothing permissive is left:
select schemaname, tablename, policyname, qual from pg_policies where schemaname = 'public';
```
NOTE: the actual policy names may differ — list them first with the select,
then drop whatever `USING (true)` policies exist. RLS stays ENABLED on all
tables; with no permissive policies, anon/authenticated get nothing.

## 6. After lockdown
- Re-test the QR redirect immediately (it runs on the service key now).
- Verify the anon key really is locked out:
  `curl -s "https://urwqhjcocnclvhomuksm.supabase.co/rest/v1/qr_codes?select=id" -H "apikey: <anon key>"` → should return `[]` or an error, NOT data.
