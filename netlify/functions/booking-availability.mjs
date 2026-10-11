// GET /api/booking/availability?start=<ISO>&end=<ISO> — real open slots for
// the demo event, via Calendly's event_type_available_times endpoint.
import {
  BookingError,
  errorResponse,
  fetchAvailableTimes,
  getConfig,
  json,
  parseFutureDate,
} from '../lib/calendly.mjs';

const MIN_LEAD_MS = 60 * 1000;
// One calendar month plus timezone margin on either side; the shared helper
// splits it into requests within Calendly's 31-day limit.
const MAX_RANGE_MS = 45 * 24 * 60 * 60 * 1000;

export default async (req) => {
  if (req.method !== 'GET') {
    return json(405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  }

  try {
    const params = new URL(req.url).searchParams;
    const requestedStart = parseFutureDate(params.get('start'));
    const end = parseFutureDate(params.get('end'));

    if (!requestedStart || !end || end <= requestedStart) {
      throw new BookingError(400, 'invalid_range', 'A valid start and end time are required.');
    }
    if (end - requestedStart > MAX_RANGE_MS) {
      throw new BookingError(400, 'invalid_range', 'The requested date range is too long.');
    }

    // Calendly rejects past start times, so clamp to just ahead of now.
    const earliest = new Date(Date.now() + MIN_LEAD_MS);
    const start = requestedStart > earliest ? requestedStart : earliest;
    if (end <= start) {
      return json(200, { slots: [] });
    }

    const config = getConfig();
    const slots = await fetchAvailableTimes(config, start, end);
    return json(200, { slots });
  } catch (err) {
    return errorResponse(err);
  }
};

// Netlify rate limiting (per visitor IP): each request costs up to two Calendly
// API calls, so cap it to protect the shared Calendly quota. Normal browsing
// is about one request per month viewed.
export const config = {
  path: '/api/booking/availability',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
