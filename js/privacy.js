// Privacy page — section scroll-spy + mobile jump accordion
(function () {
  const sections = Array.from(document.querySelectorAll('[data-privacy-section]'));
  const indexLinks = Array.from(document.querySelectorAll('.privacy-index a'));
  const jump = document.getElementById('privacyJump');
  const jumpLinks = Array.from(document.querySelectorAll('.privacy-jump-nav a'));

  if (!sections.length) return;

  function setActive(id) {
    indexLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visible.length) return;
      setActive(visible[0].target.id);
    },
    {
      root: null,
      rootMargin: '-20% 0px -55% 0px',
      threshold: [0, 0.1, 0.25, 0.5],
    }
  );

  sections.forEach((section) => observer.observe(section));

  if (sections[0]) setActive(sections[0].id);

  function closeJump() {
    if (jump && jump.open) jump.open = false;
  }

  jumpLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeJump();
    });
  });

  indexLinks.forEach((link) => {
    link.addEventListener('click', () => {
      const id = link.getAttribute('href')?.slice(1);
      if (id) setActive(id);
    });
  });
})();
