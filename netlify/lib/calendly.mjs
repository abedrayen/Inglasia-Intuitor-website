// Shared Calendly helpers for the booking functions (server-side only).
// The Personal Access Token is read here and never leaves this module:
// it is not returned in responses and not written to logs.

const API_BASE = 'https://api.calendly.com';
const TIMEOUT_MS = 10000;
const PLACEHOLDER_TOKEN = 'replace_with_real_token';
const EVENT_TYPE_URI_PATTERN = /^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9-]+$/;
const EVENT_TYPE_TTL_MS = 5 * 60 * 1000;

export class BookingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NOT_CONFIGURED_MESSAGE =
  'Online booking is temporarily unavailable. Please email info@inglasiaintuitor.com and we will arrange a time.';

function notConfigured() {
  return new BookingError(503, 'not_configured', NOT_CONFIGURED_MESSAGE);
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function errorResponse(err) {
  if (err instanceof BookingError) {
    return json(err.status, { error: { code: err.code, message: err.message } });
  }
  console.error('[booking] unexpected error', err && err.name, err && err.message);
  return json(500, {
    error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' },
  });
}

export function getConfig() {
  const token = (process.env.CALENDLY_PERSONAL_ACCESS_TOKEN || '').trim();
  const eventTypeUri = (process.env.CALENDLY_EVENT_TYPE_URI || '').trim();

  if (!token || token === PLACEHOLDER_TOKEN) {
    console.error('[booking] CALENDLY_PERSONAL_ACCESS_TOKEN is missing or still the placeholder');
    throw notConfigured();
  }
  if (!EVENT_TYPE_URI_PATTERN.test(eventTypeUri)) {
    console.error(
      '[booking] CALENDLY_EVENT_TYPE_URI must be the canonical API URI ' +
        '(https://api.calendly.com/event_types/<uuid>), not the public booking link'
    );
    throw notConfigured();
  }
  return { token, eventTypeUri };
}

// Calls the Calendly API. Network failures and timeouts become BookingErrors;
// HTTP error statuses are returned for the caller to interpret.
export async function calendlyRequest(token, pathOrUri, { method = 'GET', query, body } = {}) {
  const url = new URL(pathOrUri, API_BASE);
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error(`[booking] Calendly ${method} ${url.pathname} ${timedOut ? 'timed out' : 'network error'}`);
    throw new BookingError(
      timedOut ? 504 : 502,
      'upstream_unavailable',
      'The scheduling service did not respond. Please try again in a moment.'
    );
  }

  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Maps a non-2xx Calendly response to a safe BookingError. The upstream body
// is summarised in the server log only (title/message, never headers).
export function upstreamError(label, res) {
  const summary = res.data ? [res.data.title, res.data.message].filter(Boolean).join(' — ') : '';
  console.error(`[booking] Calendly ${label} failed with ${res.status}${summary ? `: ${summary}` : ''}`);

  if (res.status === 401) {
    console.error('[booking] token rejected — check it is valid and not revoked');
    return notConfigured();
  }
  if (res.status === 403) {
    console.error(
      '[booking] forbidden — check token scopes (event_types:read, availability:read, ' +
        'scheduled_events:write) and that the Calendly plan is Standard or above'
    );
    return notConfigured();
  }
  if (res.status === 404) {
    console.error('[booking] not found — check CALENDLY_EVENT_TYPE_URI');
    return notConfigured();
  }
  if (res.status === 429) {
    return new BookingError(503, 'rate_limited', 'The scheduling service is busy. Please try again in a minute.');
  }
  return new BookingError(
    502,
    'upstream_error',
    'The scheduling service returned an error. Please try again in a moment.'
  );
}

// ---- Event type --------------------------------------------------------------

const LOCATION_LABELS = {
  google_conference: 'Google Meet',
  zoom_conference: 'Zoom',
  microsoft_teams_conference: 'Microsoft Teams',
  webex_conference: 'Webex',
  gotomeeting_conference: 'GoTo Meeting',
  physical: 'In person',
  inbound_call: 'Phone call — you call us',
  outbound_call: 'Phone call — we call you',
  ask_invitee: 'A location you choose',
  custom: 'Details shared on confirmation',
};

// Kinds whose `location` string comes from the visitor rather than the host.
const VISITOR_LOCATION_INPUT = {
  outbound_call: 'phone',
  ask_invitee: 'text',
};

const SUPPORTED_QUESTION_TYPES = new Set(['string', 'text', 'phone_number', 'single_select', 'multi_select']);

let eventTypeCache = null;

export async function getEventType(config) {
  if (eventTypeCache && eventTypeCache.uri === config.eventTypeUri && eventTypeCache.expires > Date.now()) {
    return eventTypeCache.value;
  }

  const res = await calendlyRequest(config.token, config.eventTypeUri);
  if (!res.ok || !res.data || !res.data.resource) {
    throw upstreamError('GET event type', res);
  }

  const resource = res.data.resource;
  if (!resource.active) {
    console.error('[booking] the configured Calendly event type is inactive');
    throw notConfigured();
  }

  const unsupported = (resource.custom_questions || []).filter(
    (q) => q.enabled && q.required && !SUPPORTED_QUESTION_TYPES.has(q.type)
  );
  if (unsupported.length) {
    console.error('[booking] event type has required questions of unsupported type:', unsupported.map((q) => q.type));
    throw notConfigured();
  }

  eventTypeCache = { uri: config.eventTypeUri, expires: Date.now() + EVENT_TYPE_TTL_MS, value: resource };
  return resource;
}

function bookableLocations(eventType) {
  // Calendly: "Do not pass the location object for an EventType with a
  // round_robin pooling_type."
  if (eventType.pooling_type === 'round_robin') return [];
  return (eventType.locations || []).filter((loc) => loc && LOCATION_LABELS[loc.kind]);
}

export function enabledQuestions(eventType) {
  return (eventType.custom_questions || [])
    .filter((q) => q.enabled && SUPPORTED_QUESTION_TYPES.has(q.type))
    .sort((a, b) => a.position - b.position);
}

// The subset of the event type the browser needs. Host-only location strings
// (custom links, host phone numbers) are deliberately left out.
export function publicEventType(eventType) {
  return {
    name: eventType.name || 'Book a demo',
    duration: eventType.duration,
    description: eventType.description_plain || '',
    locations: bookableLocations(eventType).map((loc, index) => ({
      id: index,
      kind: loc.kind,
      label: LOCATION_LABELS[loc.kind],
      detail: loc.kind === 'physical' ? loc.location || '' : '',
      input: VISITOR_LOCATION_INPUT[loc.kind] || null,
    })),
    questions: enabledQuestions(eventType).map((q) => ({
      position: q.position,
      name: q.name,
      type: q.type,
      required: Boolean(q.required),
      choices: Array.isArray(q.answer_choices) ? q.answer_choices : [],
      includeOther: Boolean(q.include_other),
    })),
  };
}

// Builds the `location` object for POST /invitees so it matches the location
// configured on the event type. Returns null when no location may be sent.
export function buildLocation(eventType, locationId, visitorValue) {
  const locations = bookableLocations(eventType);
  if (!locations.length) return null;

  const id = locations.length === 1 && locationId == null ? 0 : Number(locationId);
  const chosen = Number.isInteger(id) ? locations[id] : undefined;
  if (!chosen) {
    throw new BookingError(400, 'invalid_location', 'Please choose how you would like to meet.');
  }

  const inputType = VISITOR_LOCATION_INPUT[chosen.kind];
  if (inputType) {
    const value = typeof visitorValue === 'string' ? visitorValue.trim() : '';
    const valid = inputType === 'phone' ? PHONE_PATTERN.test(value) : value.length > 0 && value.length <= 255;
    if (!valid) {
      throw new BookingError(
        400,
        'invalid_location',
        inputType === 'phone'
          ? 'Please enter a phone number with country code, e.g. +44 20 7692 5259.'
          : 'Please tell us where you would like to meet.'
      );
    }
    return { kind: chosen.kind, location: value };
  }

  if (chosen.kind === 'physical' || chosen.kind === 'custom') {
    return chosen.location ? { kind: chosen.kind, location: chosen.location } : { kind: chosen.kind };
  }
  return { kind: chosen.kind };
}

// ---- Validation helpers ------------------------------------------------------

export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
// Format check only — it cannot prove the visitor owns the address.
export const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;

// Personal/webmail domains refused for bookings. Mirrors js/company-email.js —
// keep the two lists in sync.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'outlook.fr', 'live.com', 'live.co.uk', 'msn.com',
  'aol.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
  'zoho.com',
  'fastmail.com', 'tutanota.com', 'hey.com',
  'inbox.com', 'rediffmail.com',
  'qq.com', '163.com', '126.com',
]);

export function isCompanyEmail(email) {
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
  return Boolean(domain) && !FREE_EMAIL_DOMAINS.has(domain);
}
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return '';
  return trimmed;
}

// True when the request has no Origin header (non-browser clients) or its
// Origin matches the host the request was sent to. Browsers always send
// Origin on cross-site POSTs, so this refuses requests from other websites.
export function isSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false; // e.g. "null" from sandboxed frames
  }
}

export function hasControlChars(value) {
  return CONTROL_CHARS.test(value);
}

export function parseFutureDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---- Availability ------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
// Calendly caps each request at 31 days; stay just under it.
const CHUNK_MS = 30 * DAY_MS;

export async function fetchAvailableTimes(config, start, end) {
  const chunks = [];
  for (let from = start.getTime(); from < end.getTime(); from += CHUNK_MS) {
    chunks.push([new Date(from), new Date(Math.min(from + CHUNK_MS, end.getTime()))]);
  }

  const responses = await Promise.all(
    chunks.map(([from, to]) =>
      calendlyRequest(config.token, '/event_type_available_times', {
        query: {
          event_type: config.eventTypeUri,
          start_time: from.toISOString(),
          end_time: to.toISOString(),
        },
      })
    )
  );

  const seen = new Set();
  const slots = [];
  responses.forEach((res) => {
    if (!res.ok) throw upstreamError('GET available times', res);
    if (!res.data || !Array.isArray(res.data.collection)) {
      console.error('[booking] unexpected available-times response shape');
      throw new BookingError(502, 'upstream_error', 'The scheduling service returned an unexpected response.');
    }
    res.data.collection.forEach((item) => {
      if (!item || item.status !== 'available' || typeof item.start_time !== 'string') return;
      if (typeof item.invitees_remaining === 'number' && item.invitees_remaining <= 0) return;
      const date = new Date(item.start_time);
      if (Number.isNaN(date.getTime())) return;
      const iso = date.toISOString();
      if (seen.has(iso)) return;
      seen.add(iso);
      slots.push(iso);
    });
  });

  return slots.sort();
}
