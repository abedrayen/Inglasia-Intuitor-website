// POST /api/booking — books the demo through Calendly's direct-booking
// endpoint (POST https://api.calendly.com/invitees).
import {
  BookingError,
  EMAIL_PATTERN,
  PHONE_PATTERN,
  buildLocation,
  calendlyRequest,
  cleanText,
  enabledQuestions,
  errorResponse,
  fetchAvailableTimes,
  getConfig,
  getEventType,
  hasControlChars,
  isCompanyEmail,
  isSameOrigin,
  isValidTimeZone,
  json,
  parseFutureDate,
  upstreamError,
} from '../lib/calendly.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const MIN_LEAD_MS = 60 * 1000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
// Calendly allows 10, but every guest receives an invitation from our account,
// so keep the cap low to limit invitation abuse. Mirrored in js/booking.js.
const MAX_GUESTS = 3;

function invalid(field, message) {
  const err = new BookingError(400, 'invalid_input', message);
  err.field = field;
  return err;
}

function validateAnswers(eventType, rawAnswers) {
  const byPosition = new Map();
  (Array.isArray(rawAnswers) ? rawAnswers : []).forEach((item) => {
    if (item && Number.isInteger(item.position)) byPosition.set(item.position, item.answer);
  });

  const answers = [];
  enabledQuestions(eventType).forEach((question) => {
    const raw = byPosition.get(question.position);
    const field = `question-${question.position}`;
    const max = question.type === 'text' ? 10000 : 1000;
    let answer = '';

    if (question.type === 'multi_select') {
      const values = (Array.isArray(raw) ? raw : [])
        .map((value) => cleanText(value, 1000))
        .filter(Boolean);
      const unknown = values.filter((value) => !question.answer_choices.includes(value));
      if (unknown.length > (question.include_other ? 1 : 0)) {
        throw invalid(field, `Please choose from the listed options for "${question.name}".`);
      }
      answer = values.join('\n');
    } else {
      answer = cleanText(raw, max);
      if (typeof raw === 'string' && raw.trim().length > max) {
        throw invalid(field, `Your answer to "${question.name}" is too long.`);
      }
      if (answer && question.type === 'single_select' && !question.include_other &&
          !question.answer_choices.includes(answer)) {
        throw invalid(field, `Please choose one of the listed options for "${question.name}".`);
      }
      if (answer && question.type === 'phone_number' && !PHONE_PATTERN.test(answer)) {
        throw invalid(field, 'Please enter a phone number with country code, e.g. +44 20 7692 5259.');
      }
    }

    if (!answer) {
      if (question.required) throw invalid(field, `Please answer "${question.name}".`);
      return;
    }
    answers.push({ question: question.name, answer, position: question.position });
  });

  return answers;
}

// Guests may use any valid address; only the person booking needs a company email.
function validateGuests(rawGuests, inviteeEmail) {
  if (rawGuests == null) return [];
  if (!Array.isArray(rawGuests)) throw invalid('guests', 'Guest emails could not be read.');

  const guests = [];
  rawGuests.forEach((value) => {
    const email = cleanText(value, 254).toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) {
      throw invalid('guests', 'Please check the guest email addresses.');
    }
    if (email !== inviteeEmail && !guests.includes(email)) guests.push(email);
  });

  if (guests.length > MAX_GUESTS) throw invalid('guests', `You can add up to ${MAX_GUESTS} guests.`);
  return guests;
}

async function isSlotStillAvailable(config, start) {
  try {
    const slots = await fetchAvailableTimes(
      config,
      new Date(Math.max(Date.now() + MIN_LEAD_MS, start.getTime() - 60 * 60 * 1000)),
      new Date(start.getTime() + 60 * 60 * 1000)
    );
    return slots.includes(start.toISOString());
  } catch {
    return true; // Unknown — fall back to the generic failure message.
  }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  }

  // Requiring JSON forces a CORS preflight for cross-site browser requests
  // (which we never approve), and a foreign Origin is refused outright, so
  // other websites cannot make their visitors' browsers create bookings.
  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return json(415, { error: { code: 'unsupported_media_type', message: 'The request could not be read.' } });
  }
  if (!isSameOrigin(req)) {
    return json(403, { error: { code: 'forbidden_origin', message: 'The booking could not be completed.' } });
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) throw invalid(null, 'The request is too large.');

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw invalid(null, 'The request could not be read.');
    }
    if (!body || typeof body !== 'object') throw invalid(null, 'The request could not be read.');

    // Honeypot: real visitors never see or fill this field.
    if (typeof body.website === 'string' && body.website.trim()) {
      throw invalid(null, 'The booking could not be completed.');
    }

    const name = cleanText(body.name, 100);
    if (!name || hasControlChars(name)) throw invalid('name', 'Please enter your full name.');

    const email = cleanText(body.email, 254).toLowerCase();
    if (!email || !EMAIL_PATTERN.test(email)) throw invalid('email', 'Please enter a valid email address.');
    if (!isCompanyEmail(email)) {
      throw invalid('email', 'Please use your company email address rather than a personal one.');
    }

    const guests = validateGuests(body.guests, email);

    if (!isValidTimeZone(body.timezone)) throw invalid('timezone', 'Please choose a valid time zone.');

    const start = parseFutureDate(body.start);
    if (!start || start.getTime() < Date.now() + MIN_LEAD_MS || start.getTime() > Date.now() + MAX_AHEAD_MS) {
      throw new BookingError(409, 'slot_unavailable', 'That time is no longer available. Please choose another.');
    }

    const config = getConfig();
    const eventType = await getEventType(config);

    const answers = validateAnswers(eventType, body.answers);
    let location;
    try {
      location = buildLocation(eventType, body.locationId, body.locationValue);
    } catch (err) {
      if (err instanceof BookingError) err.field = 'location';
      throw err;
    }

    const payload = {
      event_type: config.eventTypeUri,
      start_time: start.toISOString(),
      invitee: {
        name,
        email,
        timezone: body.timezone,
      },
    };
    if (location) payload.location = location;
    if (answers.length) payload.questions_and_answers = answers;
    if (guests.length) payload.event_guests = guests;

    const res = await calendlyRequest(config.token, '/invitees', { method: 'POST', body: payload });

    if (!res.ok) {
      if (res.status === 400 || res.status === 409 || res.status === 422) {
        // Calendly does not document a distinct "slot taken" error, so check
        // the slot directly before choosing what to tell the visitor.
        const details = Array.isArray(res.data && res.data.details) ? res.data.details : [];
        console.error(
          `[booking] Calendly rejected the booking (${res.status})`,
          details.map((d) => `${d.parameter || '?'}:${d.code || '?'}`).join(', ')
        );
        if (!(await isSlotStillAvailable(config, start))) {
          throw new BookingError(409, 'slot_unavailable', 'That time was just taken. Please choose another.');
        }
        throw new BookingError(
          400,
          'booking_rejected',
          'We could not confirm that booking. Please check your details and try again.'
        );
      }
      throw upstreamError('POST invitees', res);
    }

    const invitee = res.data && res.data.resource;
    if (!invitee || !invitee.uri) {
      console.error('[booking] unexpected create-invitee response shape');
      throw new BookingError(502, 'upstream_error', 'The scheduling service returned an unexpected response.');
    }

    const end = new Date(start.getTime() + (Number(eventType.duration) || 0) * 60 * 1000);
    return json(201, {
      booking: {
        eventName: eventType.name || 'Book a demo',
        start: start.toISOString(),
        end: end.toISOString(),
        timezone: invitee.timezone || body.timezone,
        email: invitee.email || email,
        guests,
        cancelUrl: invitee.cancel_url || null,
        rescheduleUrl: invitee.reschedule_url || null,
      },
    });
  } catch (err) {
    if (err instanceof BookingError && err.field) {
      return json(err.status, { error: { code: err.code, message: err.message, field: err.field } });
    }
    return errorResponse(err);
  }
};

// Netlify rate limiting (per visitor IP): blocks booking floods with a 429
// before the function runs. Can take up to ~10 s to start enforcing.
export const config = {
  path: '/api/booking',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
