(function () {
  const root = document.getElementById('values');
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const panels = Array.from(root.querySelectorAll('[role="tabpanel"]'));
  const lotus = root.querySelector('.values-lotus');
  const tablist = root.querySelector('[role="tablist"]');
  const details = root.querySelector('.values-details');

  let activeIdx = 0;
  let rotation = 0;

  function revealDetailsIfNeeded() {
    if (!details || window.matchMedia('(min-width: 1025px)').matches) return;
    const rect = details.getBoundingClientRect();
    const inView = rect.top >= 72 && rect.bottom <= window.innerHeight;
    if (!inView) {
      details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setActive(nextIdx, { focus = false } = {}) {
    if (nextIdx === activeIdx && !focus) return;
    if (nextIdx < 0 || nextIdx >= tabs.length) return;

    tabs.forEach((tab, i) => {
      const on = i === nextIdx;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });

    panels.forEach((panel, i) => {
      const on = i === nextIdx;
      panel.classList.toggle('is-active', on);
      panel.setAttribute('aria-hidden', on ? 'false' : 'true');
    });

    if (lotus && nextIdx !== activeIdx) {
      rotation += 360;
      lotus.style.transform = `rotate(${rotation}deg)`;
    }

    activeIdx = nextIdx;
    if (focus) tabs[nextIdx].focus();
    revealDetailsIfNeeded();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setActive(i));
  });

  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const key = e.key;
      let next = null;

      if (key === 'ArrowRight' || key === 'ArrowDown') {
        next = (activeIdx + 1) % tabs.length;
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        next = (activeIdx - 1 + tabs.length) % tabs.length;
      } else if (key === 'Home') {
        next = 0;
      } else if (key === 'End') {
        next = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      setActive(next, { focus: true });
    });
  }

  // Initialise ARIA / tabindex without spinning the lotus
  tabs.forEach((tab, i) => {
    const on = tab.classList.contains('is-active');
    tab.tabIndex = on ? 0 : -1;
    if (on) activeIdx = i;
  });
  panels.forEach((panel, i) => {
    const on = i === activeIdx;
    panel.setAttribute('aria-hidden', on ? 'false' : 'true');
    panel.classList.toggle('is-active', on);
  });
})();
