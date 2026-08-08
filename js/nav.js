// Nav scroll state + mobile menu
(function () {
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navPanel = document.getElementById('navPanel');
  if (!nav || !navToggle || !navPanel) return;

  const forceScrolled =
    document.body.classList.contains('page-contact') ||
    document.body.classList.contains('page-privacy');

  function isMobileNav() {
    return window.matchMedia('(max-width: 960px)').matches;
  }

  function setNavOpen(open) {
    const next = Boolean(open) && isMobileNav();
    nav.classList.toggle('is-open', next);
    navPanel.setAttribute('aria-hidden', next ? 'false' : 'true');
    if (next || forceScrolled || window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else if (!forceScrolled) {
      nav.classList.remove('scrolled');
    }
    navToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    navToggle.setAttribute('aria-label', next ? 'Close menu' : 'Open menu');
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

  window.addEventListener('resize', () => {
    if (!isMobileNav()) setNavOpen(false);
  });

  setNavOpen(false);
})();
