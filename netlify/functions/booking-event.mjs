// GET /api/booking/event — the demo event's public details (name, duration,
// meeting location options and booking-form questions) from Calendly.
import { errorResponse, getConfig, getEventType, json, publicEventType } from '../lib/calendly.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return json(405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  }

  try {
    const config = getConfig();
    const eventType = await getEventType(config);
    return json(200, { event: publicEventType(eventType) });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config = { path: '/api/booking/event' };
