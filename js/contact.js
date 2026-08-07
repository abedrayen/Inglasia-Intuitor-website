// Contact page — modes + UI-only form
const tabs = document.querySelectorAll('.contact-mode');
const panes = {
  meeting: document.getElementById('panel-meeting'),
  message: document.getElementById('panel-message'),
};

function setMode(mode) {
  if (!panes[mode]) return;

  tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  Object.entries(panes).forEach(([key, pane]) => {
    const active = key === mode;
    pane.classList.toggle('is-active', active);
    pane.hidden = !active;
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

const form = document.getElementById('contactForm');
const success = document.getElementById('contactSuccess');
const resetBtn = document.getElementById('contactReset');

if (form && success) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    form.classList.add('is-sent');
    success.classList.add('is-visible');
  });
}

if (resetBtn && form && success) {
  resetBtn.addEventListener('click', () => {
    form.reset();
    form.classList.remove('is-sent');
    success.classList.remove('is-visible');
  });
}
