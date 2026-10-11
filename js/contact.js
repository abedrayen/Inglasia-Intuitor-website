// Contact page — modes, message form / booking → thank-you popup
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
const emailInput = form ? form.querySelector('#email') : null;

// Ensure contact panel is visible (reveal can leave opacity: 0)
document.querySelectorAll('.contact [data-reveal]').forEach((el) => {
  el.classList.add('in');
});

function formatMeetingWhen(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date);

  return `${day} at ${time} (${timeZone.replace(/_/g, ' ')})`;
}

function meetingThankYouText(booking) {
  const when = booking && booking.start ? formatMeetingWhen(booking.start, booking.timezone) : null;
  const whenClause = when ? ` for ${when}` : '';
  const guestCount = booking && Array.isArray(booking.guests) ? booking.guests.length : 0;
  const inbox =
    (booking && booking.email ? booking.email : 'your inbox') +
    (guestCount ? ` and ${guestCount} guest${guestCount === 1 ? '' : 's'}` : '');

  return (
    `Your walkthrough is confirmed${whenClause}. ` +
    `Calendly is sending the invitation and meeting details to ${inbox}. ` +
    'Check your spam folder if it has not arrived within a few minutes.'
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

if (emailInput) {
  // Clear the custom error as soon as the person edits the field again.
  emailInput.addEventListener('input', () => {
    emailInput.setCustomValidity('');
  });
}

const WEB3FORMS_KEY = '486bfad2-e72a-40e1-b33d-333c8aeec43f';
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mkjwooey';

const STATICFORMS_KEY = 'sf_f9dc91fa5772e8dfdffb8289';
const STATICFORMS_ENDPOINT = 'https://api.staticforms.dev/submit';

// EmailJS (SendGrid service) — replace with your Public Key from
// EmailJS > Account > General.
const EMAILJS_PUBLIC_KEY = 'XcJx1DJo8s_3Nydg8';
const EMAILJS_SERVICE_ID = 'service_j1fp6m2';
const EMAILJS_TEMPLATE_ID = 'template_t62w9gh';

if (window.emailjs && EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY') {
  window.emailjs.init(EMAILJS_PUBLIC_KEY);
} else if (!window.emailjs) {
  console.warn('[contact] EmailJS SDK not loaded — add the script tag before contact.js');
}

async function submitViaEmailJS(formEl) {
  if (!window.emailjs) {
    throw new Error('EmailJS SDK not loaded');
  }

  const formData = new FormData(formEl);
  const params = {
    name: formData.get('name') || '',
    email: formData.get('email') || '',
    company: formData.get('company') || '',
    message: formData.get('message') || '',
  };

  console.log('[contact] trying EmailJS (SendGrid)...', params);
  try {
    const result = await window.emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      params
    );
    console.log('[contact] EmailJS SUCCESS', result);
  } catch (err) {
    console.error('[contact] EmailJS FAILED', err);
    throw new Error((err && err.text) || 'EmailJS failed');
  }
}

async function submitViaStaticForms(formEl) {
  const formData = new FormData(formEl);
  formData.append('apiKey', STATICFORMS_KEY);
  formData.append('subject', 'Helmi Khiari submission');

  console.log('[contact] trying StaticForms...');
  const response = await fetch(STATICFORMS_ENDPOINT, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[contact] StaticForms FAILED', {
      status: response.status,
      statusText: response.statusText,
      data,
    });
    throw new Error(data.message || data.error || 'StaticForms failed');
  }

  console.log('[contact] StaticForms SUCCESS', data);
}

async function submitViaWeb3Forms(formEl) {
  const formData = new FormData(formEl);
  formData.append('access_key', WEB3FORMS_KEY);

  console.log('[contact] trying Web3Forms...');
  const response = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[contact] Web3Forms FAILED', {
      status: response.status,
      statusText: response.statusText,
      data,
    });
    throw new Error(data.message || 'Web3Forms failed');
  }

  console.log('[contact] Web3Forms SUCCESS', data);
}

async function submitViaFormspree(formEl) {
  const formData = new FormData(formEl);

  console.log('[contact] trying Formspree (fallback)...');
  const response = await fetch(FORMSPREE_ENDPOINT, {
    method: 'POST',
    body: formData,
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[contact] Formspree FAILED', {
      status: response.status,
      statusText: response.statusText,
      data,
    });
    throw new Error(data.error || data.message || 'Formspree failed');
  }

  console.log('[contact] Formspree SUCCESS', data);
}

if (form && submitBtn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (emailInput && !isCompanyEmail(emailInput.value)) {
      emailInput.setCustomValidity(
        'Please use your company email address rather than a personal one.'
      );
      form.reportValidity();
      emailInput.focus();
      return;
    }
    if (emailInput) emailInput.setCustomValidity('');

    const originalText = submitBtn.textContent;

    submitBtn.textContent = 'Sending...';
    submitBtn.disabled = true;

    try {
      // Validated once here, so the check applies no matter which of the
      // two providers below ends up handling the submission.
      try {
        await submitViaEmailJS(form);
        console.log('[contact] final result: sent via EmailJS (SendGrid)');
      } catch (emailJsError) {
        console.warn('[contact] EmailJS failed, falling back to StaticForms', emailJsError);
        try {
          await submitViaStaticForms(form);
          console.log('[contact] final result: sent via StaticForms (fallback)');
        } catch (staticFormsError) {
          console.warn('[contact] StaticForms failed, falling back to Web3Forms', staticFormsError);
          try {
            await submitViaWeb3Forms(form);
            console.log('[contact] final result: sent via Web3Forms (fallback)');
          } catch (web3FormsError) {
            console.warn('[contact] Web3Forms failed, falling back to Formspree', web3FormsError);
            await submitViaFormspree(form);
            console.log('[contact] final result: sent via Formspree (fallback)');
          }
        }
      }
      openThankYou('message');
      form.reset();
    } catch (error) {
      console.error('[contact] BOTH providers failed', error);
      alert('Something went wrong. Please try again.');
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });
}

// ---- Booking confirmation (dispatched by booking.js once Calendly confirms) ----
document.addEventListener('booking:confirmed', (e) => {
  openThankYou('meeting', e.detail || null);
});
