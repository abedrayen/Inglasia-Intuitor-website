// Nav scroll state + compact/mobile menu
(function () {
  const year = String(new Date().getFullYear());
  document.querySelectorAll('.js-year').forEach((el) => {
    el.textContent = year;
  });

  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navPanel = document.getElementById('navPanel');
  if (!nav || !navToggle || !navPanel) return;

  const forceScrolled =
    document.body.classList.contains('page-contact') ||
    document.body.classList.contains('page-privacy');

  // Keep in sync with css/nav.css compact breakpoint
  const compactQuery = window.matchMedia('(max-width: 1200px)');

  function isCompactNav() {
    return compactQuery.matches;
  }

  function syncPanelA11y(open) {
    const compact = isCompactNav();
    navPanel.setAttribute('aria-hidden', compact ? (open ? 'false' : 'true') : 'false');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    navToggle.hidden = !compact;
  }

  function setNavOpen(open) {
    const next = Boolean(open) && isCompactNav();
    nav.classList.toggle('is-open', next);
    syncPanelA11y(next);
    if (next || forceScrolled || window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else if (!forceScrolled) {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', () => {
    if (forceScrolled || window.scrollY > 40 || nav.classList.contains('is-open')) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }, { passive: true });

  navToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setNavOpen(!nav.classList.contains('is-open'));
  });

  navPanel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setNavOpen(false));
  });

  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(e.target)) return;
    setNavOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setNavOpen(false);
  });

  function onViewportChange() {
    setNavOpen(false);
  }

  if (typeof compactQuery.addEventListener === 'function') {
    compactQuery.addEventListener('change', onViewportChange);
  } else if (typeof compactQuery.addListener === 'function') {
    compactQuery.addListener(onViewportChange);
  }

  window.addEventListener('resize', () => {
    if (!isCompactNav()) setNavOpen(false);
    else syncPanelA11y(nav.classList.contains('is-open'));
  });

  setNavOpen(false);
})();
