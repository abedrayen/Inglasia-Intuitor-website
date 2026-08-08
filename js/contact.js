// Contact page — modes, form/Calendly → thank-you popup
console.log('[contact] script loaded');

const tabs = document.querySelectorAll('.contact-mode');
const panes = {
  meeting: document.getElementById('panel-meeting'),
  message: document.getElementById('panel-message'),
};

const overlay = document.getElementById('thankyouOverlay');
const eyebrow = document.getElementById('thankyouEyebrow');
const accent = document.getElementById('thankyouAccent');
const lead = document.getElementById('thankyouLead');
const form = document.getElementById('form');
const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

// Ensure contact panel is visible (reveal can leave opacity: 0)
document.querySelectorAll('.contact [data-reveal]').forEach((el) => {
  el.classList.add('in');
});

let lastSelectedSlot = null;

function findIsoDate(node, depth) {
  if (node == null || depth > 8) return null;
  if (typeof node === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(node)) return node;
    return null;
  }
  if (typeof node !== 'object') return null;
  const preferred = ['start_time', 'startTime', 'begin_at', 'date_time', 'datetime', 'start'];
  for (const key of preferred) {
    if (typeof node[key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(node[key])) {
      return node[key];
    }
  }
  for (const value of Object.values(node)) {
    const found = findIsoDate(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function formatMeetingWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'Europe/London',
  }).format(date);
  const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Europe/London',
  }).format(date);

  return `${weekday} ${dayMonthYear} at ${time}`;
}

function meetingThankYouText(payload) {
  const iso = findIsoDate(payload, 0) || lastSelectedSlot;
  const when = iso ? formatMeetingWhen(iso) : null;
  const whenClause = when ? ` for ${when}` : ' for the time you selected';

  return (
    `Your meeting is confirmed${whenClause}. ` +
    'A calendar invitation has been sent to your email by Calendly. ' +
    'Check your inbox and spam folder if needed.'
  );
}

function setThankYouCopy(from, payload) {
  if (from === 'meeting') {
    if (eyebrow) eyebrow.textContent = 'Walkthrough booked';
    if (accent) accent.textContent = "We'll see you there.";
    if (lead) lead.textContent = meetingThankYouText(payload);
  } else {
    if (eyebrow) eyebrow.textContent = 'Message received';
    if (accent) accent.textContent = "We'll reply soon.";
    if (lead) {
      lead.textContent =
        'Your message is with the Inglasia team. A specialist will follow up by email.';
    }
  }
}

function openThankYou(from, payload) {
  console.log('[contact] openThankYou', from, payload || null);
  setThankYouCopy(from, payload);
  if (!overlay) {
    console.error('[contact] thankyouOverlay missing');
    return;
  }
  overlay.hidden = false;
  overlay.removeAttribute('hidden');
  overlay.classList.add('is-open');
  document.body.classList.add('thankyou-open');
}

function setMode(mode) {
  console.log('[contact] setMode', mode);
  if (!panes[mode]) return;

  tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  Object.entries(panes).forEach(([key, pane]) => {
    const active = key === mode;
    pane.classList.toggle('is-active', active);
    if (active) {
      pane.hidden = false;
      pane.removeAttribute('hidden');
    } else {
      pane.hidden = true;
    }
  });

  const hash = mode === 'message' ? '#message' : '#meeting';
  if (location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

const initial =
  location.hash === '#message' || location.hash === '#form'
    ? 'message'
    : 'meeting';
setMode(initial);

window.addEventListener('hashchange', () => {
  if (location.hash === '#message' || location.hash === '#form') setMode('message');
  else if (location.hash === '#meeting' || location.hash === '#panel') setMode('meeting');
});

const WEB3FORMS_KEY = '486bfad2-e72a-40e1-b33d-333c8aeec43f';
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mkjwooey';

async function submitViaWeb3Forms(formEl) {
  const formData = new FormData(formEl);
  formData.append('access_key', WEB3FORMS_KEY);

  const response = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Web3Forms failed');
  }
}

async function submitViaFormspree(formEl) {
  const formData = new FormData(formEl);

  const response = await fetch(FORMSPREE_ENDPOINT, {
    method: 'POST',
    body: formData,
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Formspree failed');
  }
}

if (form && submitBtn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const originalText = submitBtn.textContent;

    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    try {
      try {
        await submitViaWeb3Forms(form);
      } catch {
        await submitViaFormspree(form);
      }
      openThankYou('message');
      form.reset();
    } catch (error) {
      alert('Something went wrong. Please try again.');
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });
}
function parseCalendlyData(data) {
  if (!data) return null;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return null; }
  }
  return typeof data === 'object' ? data : null;
}

window.addEventListener('message', (e) => {
  const fromCalendly =
    e.origin === 'https://calendly.com' ||
    e.origin === 'https://www.calendly.com';
  if (!fromCalendly) return;

  const data = parseCalendlyData(e.data);
  if (!data || typeof data.event !== 'string') return;

  const slot = findIsoDate(data.payload || data, 0);
  if (slot) {
    lastSelectedSlot = slot;
    console.log('[contact] calendly slot cached', slot);
  }

  if (data.event === 'calendly.event_scheduled') {
    console.log('[contact] calendly.event_scheduled', data.payload);
    openThankYou('meeting', data.payload || null);
  }
});
