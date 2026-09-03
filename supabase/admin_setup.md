# Quiz admin dashboard — setup

The dashboard (`quiz-admin-login.html` + `quiz-admin.html`) reads from the
same `quiz_results` table and Supabase project as the public quiz. These are
the one-time steps to finish wiring it up — none of this can be done from
the frontend code alone.

## 1. Database + RLS

Already covered by `supabase/quiz_results.sql` (run it if you haven't yet).
Its policies already match what the dashboard needs:

- `anon` role: insert only (the public quiz).
- `authenticated` role: select only (the dashboard).
- No update/delete policy for anyone — denied by default once RLS is on.

No changes needed here for the dashboard to work.

## 2. Create an admin user

There is no self-service sign-up (by design — the login page never calls
`signUp()`). Create each admin's account yourself, in the Supabase dashboard:

**Authentication → Users → Add user** (set "Auto Confirm User" so they don't
need to click an email link), or invite them via **Authentication → Users →
Invite**. Give them the email + password (or invite link) directly.

## 3. Turn off public sign-ups (defense in depth)

Even though the app never exposes a sign-up form, Supabase's Auth REST API
is still publicly reachable — someone could call the `signup` endpoint
directly with the anon key from devtools. Since this can't be blocked from
HTML/CSS/JS, disable it at the project level:

**Authentication → Providers → Email → turn off "Allow new users to sign
up"** (or the equivalent "Enable email signup" toggle in newer Supabase
Studio versions).

Signing in (`signInWithPassword`) is unaffected by this — only new account
creation is blocked.

## 4. Fill in the config placeholders

`js/supabase-config.js` is shared by both admin pages:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both with your project's real URL and **anon/publishable** key
(Project Settings → API). Never put the service-role/secret key here — it
must never appear in frontend code.

This is a separate, standalone config from the one inside
`quality-system-quiz.html` (which was left untouched) — make sure both get
pointed at the same Supabase project.
