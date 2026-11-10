// POST /api/roi-report — emails the visitor's ROI PDF via SendGrid.
// Secrets stay in Netlify env vars; never expose them to the browser.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/=]+$/;
const MAX_PDF_BASE64 = 4_000_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function clean(value, max = 160) {
  return String(value || '')
    .replace(/[\r\n<>]/g, ' ')
    .trim()
    .slice(0, max);
}

function money(n, currency) {
  const symbol = { GBP: '£', EUR: '€', USD: '$' }[currency] || '';
  return symbol + Math.round(Number(n) || 0).toLocaleString('en-GB');
}

function isSameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

function getConfig() {
  const apiKey = (process.env.SENDGRID_API_KEY || '').trim();
  const fromEmail = (process.env.ROI_FROM_EMAIL || '').trim();
  const fromName = (process.env.ROI_FROM_NAME || 'Inglasia Intuitor').trim();
  const salesEmail = (process.env.ROI_SALES_EMAIL || '').trim();

  if (!apiKey || !fromEmail) {
    return null;
  }

  return { apiKey, fromEmail, fromName, salesEmail };
}

async function sendWithSendGrid(apiKey, message) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[roi-report] SendGrid error', res.status, detail.slice(0, 500));
    const err = new Error('sendgrid_failed');
    err.status = 502;
    throw err;
  }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return json(400, { error: 'Content-Type must be application/json' });
  }

  if (!isSameOrigin(req)) {
    return json(403, { error: 'Forbidden' });
  }

  const config = getConfig();
  if (!config) {
    console.error('[roi-report] missing SENDGRID_API_KEY or ROI_FROM_EMAIL');
    return json(503, { error: 'Report email is temporarily unavailable' });
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json(400, { error: 'Payload too large' });
    }
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const lead = body.lead || {};
  const results = body.results || {};
  const pdf = body.pdf || {};

  // Honeypot: client may still send website; treat non-empty as bot success.
  if (clean(lead.website, 40)) {
    return json(200, { ok: true });
  }

  const fullName = clean(lead.fullName, 120);
  const company = clean(lead.company);
  const role = clean(lead.role, 120);
  const email = clean(lead.email, 160).toLowerCase();

  if (!fullName || !company || !role || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: 'Missing or invalid lead fields' });
  }

  if (
    !pdf.base64 ||
    typeof pdf.base64 !== 'string' ||
    !BASE64_PATTERN.test(pdf.base64) ||
    pdf.base64.length > MAX_PDF_BASE64
  ) {
    return json(400, { error: 'Invalid PDF' });
  }

  const firstName = fullName.split(/\s+/)[0];
  const filename = clean(pdf.filename || 'Intuitor-ROI-Report.pdf', 100) || 'Intuitor-ROI-Report.pdf';
  const savings = money(results.annualSavings, results.currency);
  const hours = results.hoursSaved ?? 'n/a';
  const roi3 = results.roi3YearPct ?? 'n/a';

  const attachment = {
    content: pdf.base64,
    filename,
    type: 'application/pdf',
    disposition: 'attachment',
  };

  try {
    await sendWithSendGrid(config.apiKey, {
      personalizations: [
        {
          to: [{ email }],
          subject: `Your Inglasia Intuitor ROI report – ${company}`,
        },
      ],
      from: { email: config.fromEmail, name: config.fromName },
      reply_to: { email: config.fromEmail, name: config.fromName },
      content: [
        {
          type: 'text/plain',
          value:
            `Hi ${firstName},\n\n` +
            `Thank you for using the Inglasia Intuitor ROI calculator. Your personalised report is attached.\n\n` +
            `Estimated annual savings: ${savings}\n` +
            `Hours saved per year: ${hours}\n` +
            `3-year ROI: ${roi3}%\n\n` +
            `If you'd like to see these savings in your own processes, reply to this email to book a demonstration.\n\n` +
            `Inglasia Pharma Solutions`,
        },
      ],
      attachments: [attachment],
    });

    if (config.salesEmail && EMAIL_PATTERN.test(config.salesEmail)) {
      try {
        await sendWithSendGrid(config.apiKey, {
          personalizations: [
            {
              to: [{ email: config.salesEmail }],
              subject: `ROI lead: ${fullName} · ${company}`,
            },
          ],
          from: { email: config.fromEmail, name: config.fromName },
          content: [
            {
              type: 'text/plain',
              value:
                `New ROI calculator lead\n\n` +
                `Name: ${fullName}\n` +
                `Company: ${company}\n` +
                `Role: ${role}\n` +
                `Email: ${email}\n` +
                `Marketing opt-in: ${lead.marketingOptIn ? 'yes' : 'no'}\n\n` +
                `Estimated annual savings: ${savings}\n` +
                `Hours saved per year: ${hours}\n` +
                `3-year ROI: ${roi3}%\n`,
            },
          ],
        });
      } catch (salesErr) {
        // Visitor already received the report; do not fail the request.
        console.error('[roi-report] sales notify failed', salesErr && salesErr.message);
      }
    }

    return json(200, { ok: true });
  } catch (err) {
    if (err && err.status === 502) {
      return json(502, { error: 'Failed to send report email' });
    }
    console.error('[roi-report] unexpected error', err && err.message);
    return json(500, { error: 'Something went wrong on our side. Please try again.' });
  }
};

export const config = {
  path: '/api/roi-report',
};
