// Finds the canonical Calendly API URI for the public "Book a demo" link.
//
//   CALENDLY_PERSONAL_ACCESS_TOKEN=... node netlify/scripts/resolve-event-type.mjs [public-url]
//
// Needs the users:read and event_types:read scopes. Prints the URI to put in
// CALENDLY_EVENT_TYPE_URI. The token is never printed.

const DEFAULT_PUBLIC_URL = 'https://calendly.com/d/dvt9-fs2-2s4/book-a-demo-inglasia-intuitor';
const API = 'https://api.calendly.com';

const token = (process.env.CALENDLY_PERSONAL_ACCESS_TOKEN || '').trim();
if (!token || token === 'replace_with_real_token') {
  console.error('Set CALENDLY_PERSONAL_ACCESS_TOKEN in the environment first.');
  process.exit(1);
}

const target = new URL(process.argv[2] || DEFAULT_PUBLIC_URL);
const targetPath = target.pathname.replace(/\/+$/, '');

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = data ? [data.title, data.message].filter(Boolean).join(' — ') : res.statusText;
    throw new Error(`${res.status} from ${new URL(url).pathname}: ${reason}`);
  }
  return data;
}

async function listEventTypes(param, value) {
  const found = [];
  let url = `${API}/event_types?${new URLSearchParams({ [param]: value, count: '100' })}`;
  while (url) {
    const page = await get(url);
    found.push(...page.collection);
    url = page.pagination && page.pagination.next_page;
  }
  return found;
}

const me = (await get(`${API}/users/me`)).resource;
console.log(`Authenticated as ${me.name} (${me.slug})`);

const candidates = [];
for (const [param, value] of [['organization', me.current_organization], ['user', me.uri]]) {
  try {
    candidates.push(...(await listEventTypes(param, value)));
  } catch (err) {
    console.warn(`Could not list event types by ${param}: ${err.message}`);
  }
}

// Share links (/d/<code>/<slug>) are identified by the code; the slug in a
// public link can differ from the event's current slug.
const shareCode = (path) => (path.match(/^\/d\/([^/]+)/) || [])[1];
const matches = new Map();
candidates.forEach((et) => {
  const path = new URL(et.scheduling_url).pathname.replace(/\/+$/, '');
  if (path === targetPath || (shareCode(targetPath) && shareCode(path) === shareCode(targetPath))) {
    matches.set(et.uri, et);
  }
});

if (!matches.size) {
  console.error(`No event type found with scheduling_url ${target.origin}${targetPath}.`);
  console.error(`Checked ${candidates.length} event types. Ensure the token belongs to the event's owner or an org admin.`);
  process.exit(2);
}

for (const et of matches.values()) {
  console.log('');
  console.log(`Name:            ${et.name}`);
  console.log(`Active:          ${et.active}`);
  console.log(`Scheduling URL:  ${et.scheduling_url}`);
  console.log(`Duration:        ${et.duration} min`);
  console.log(`Locations:       ${(et.locations || []).map((l) => l.kind).join(', ') || 'none'}`);
  console.log(`Questions:       ${(et.custom_questions || []).filter((q) => q.enabled).map((q) => `${q.name}${q.required ? ' (required)' : ''}`).join('; ') || 'none'}`);
  console.log('');
  console.log(`CALENDLY_EVENT_TYPE_URI=${et.uri}`);
}
