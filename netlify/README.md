# Netlify Functions

Shared: `/netlify/*` is blocked from public download by a redirect in
`netlify.toml`. Secrets live in Netlify env vars (Functions scope only).

## Booking API (Calendly)

The contact page's "Book a meeting" scheduler (`js/booking.js`) talks only to
these Netlify Functions. They hold the Calendly token and call the Calendly API
on the visitor's behalf.

| Route | Function | Calendly call |
|---|---|---|
| `GET /api/booking/event` | `functions/booking-event.mjs` | `GET /event_types/{uuid}`: name, duration, locations, booking questions |
| `GET /api/booking/availability?start=&end=` | `functions/booking-availability.mjs` | `GET /event_type_available_times` (split into ≤ 30-day requests) |
| `POST /api/booking` | `functions/booking-create.mjs` | `POST /invitees` (direct booking) |

Shared code is in `lib/calendly.mjs`.

## ROI report email (SendGrid)

The ROI calculator (`intuitor-roi-calculator.html`) builds the PDF in the
browser, then POSTs lead details + PDF base64 to:

| Route | Function | Role |
|---|---|---|
| `POST /api/roi-report` | `functions/roi-report.mjs` | Validate payload; email PDF to the visitor via SendGrid; optionally notify sales |

Abuse protection (no Netlify `rateLimit` rule — Free/Starter already uses both
slots on booking):

- Same-site only: requires `Content-Type: application/json` and refuses a
  foreign `Origin`.
- Validates lead fields, honeypot, and PDF base64 size/shape.
- Returns `503` when `SENDGRID_API_KEY` or `ROI_FROM_EMAIL` is missing.

## Abuse protection

- **Rate limits** (Netlify code-based rules, per visitor IP, in each function's
  `config.rateLimit`): `POST /api/booking` allows 5 requests a minute and
  `/api/booking/availability` allows 30. Over the limit, Netlify answers `429`
  before the function runs, and the page shows "Too many requests". Free and
  Starter plans allow 2 rules per project; both are used here. Valid rules
  are listed in the deploy log.
- **Same-site only**: `POST /api/booking` requires `Content-Type:
  application/json` and refuses a foreign `Origin`, so other websites cannot
  submit bookings through their visitors' browsers.
- **Guests**: at most 3 per booking (Calendly allows 10), because each guest
  receives an invitation from our Calendly account.
- **Honeypot**: the hidden `website` field rejects naive bots.

## Environment variables

Set these in **Netlify → Site configuration → Environment variables**. Scope
them to **Functions**; they must never be exposed to the browser.

| Variable | Value |
|---|---|
| `CALENDLY_PERSONAL_ACCESS_TOKEN` | A Calendly Personal Access Token (Calendly → Integrations → API & Webhooks) |
| `CALENDLY_EVENT_TYPE_URI` | The canonical event type URI, `https://api.calendly.com/event_types/<uuid>` |
| `SENDGRID_API_KEY` | SendGrid API key (Mail Send permission) |
| `ROI_FROM_EMAIL` | Verified SendGrid sender used for the visitor report |
| `ROI_FROM_NAME` | Optional from display name (default `Inglasia Intuitor`) |
| `ROI_SALES_EMAIL` | Optional internal address for lead notifications |

The public link `https://calendly.com/d/dvt9-fs2-2s4/book-a-demo-inglasia-intuitor`
is **not** the API URI. To find the URI, run:

```sh
CALENDLY_PERSONAL_ACCESS_TOKEN=... node netlify/scripts/resolve-event-type.mjs
```

### Local development

```sh
cp .env.example .env      # fill in real values; .env is git-ignored
npx netlify dev           # serves the site + functions on http://localhost:8888
```

## Token requirements

The token needs these scopes:

- `event_types:read`: event details and the available-times endpoint. The scopes
  page lists this scope for available times.
- `availability:read`: the available-times endpoint's own reference page lists
  this scope instead, so grant both.
- `scheduled_events:write`: `POST /invitees`.
- `users:read`: only used by the resolver script.

Direct booking (`POST /invitees`) is available only on paid plans, **Standard
and above**. On the Free plan it returns 403.

If the token is missing, still the placeholder, revoked, missing a scope, or the
URI is wrong, the functions return `503 not_configured`. The page then shows
"Online booking is temporarily unavailable" with the contact email. The
function log gives the exact cause (401/403/404 and which setting to check).
