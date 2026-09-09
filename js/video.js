// Video triggers (hero button + floating FAB) zoom in place from wherever
// they were clicked into the expanded player, and reverse on close.
(function () {
  const VIDEO_SRC = "assets/Inglasia Intuitor - eQMS Platform - Quality at it's core.mp4";
  const VIDEO_TITLE = "Inglasia Intuitor - eQMS Platform - Quality at it's core";
  const VIDEO_THUMB = 'assets/og-image.png';

  const triggers = Array.from(document.querySelectorAll('[data-video-trigger]'));
  const expanded = document.getElementById('videoExpanded');
  const panel = document.getElementById('videoExpandedPanel');
  const media = document.getElementById('videoExpandedMedia');
  const closeBtn = document.getElementById('videoExpandedClose');
  if (!triggers.length || !expanded || !panel || !media || !closeBtn) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let isOpen = false;
  let isAnimating = false;
  let activeTrigger = triggers[0];

  // Reserves extra room above the panel (beyond the plain side/bottom
  // margin) so the close button — placed just above the panel — never
  // lands on top of the site's fixed nav bar on shorter viewports.
  const TOP_CLEARANCE = 96;
  const SIDE_MARGIN = 24;
  const BOTTOM_MARGIN = 24;

  function targetRect() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let width = Math.min(960, vw - SIDE_MARGIN * 2);
    let height = width * 9 / 16;
    const maxHeight = vh - TOP_CLEARANCE - BOTTOM_MARGIN;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * 16 / 9;
    }
    return {
      left: (vw - width) / 2,
      top: TOP_CLEARANCE + Math.max(0, (maxHeight - height) / 2),
      width,
      height
    };
  }

  function thumbImage() {
    const img = document.createElement('img');
    img.src = VIDEO_THUMB;
    img.alt = '';
    return img;
  }

  // Anchor the scale animation exactly at the trigger's own on-screen
  // position (in pixels, relative to the panel's fixed box — CSS allows
  // transform-origin outside the element's own bounds). Because the panel
  // never moves, that pixel stays put for the whole animation, so the
  // video visibly grows out of the exact spot that was clicked.
  function setCornerOrigin(source, target) {
    const sourceCenterX = source.left + source.width / 2;
    const sourceCenterY = source.top + source.height / 2;
    const originX = sourceCenterX - target.left;
    const originY = sourceCenterY - target.top;
    panel.style.transformOrigin = `${originX}px ${originY}px`;
  }

  // Runs `fn` once the panel's transition finishes, or after a fallback
  // timeout if the browser never fires transitionend (e.g. nothing changed).
  function afterPanelTransition(fn) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      panel.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      fn();
    };
    const onEnd = (e) => {
      if (e.target === panel) finish();
    };
    panel.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, 1100);
  }

  function open(trigger) {
    if (isOpen || isAnimating) return;
    isAnimating = true;
    activeTrigger = trigger || triggers[0];

    const source = activeTrigger.getBoundingClientRect();
    const target = targetRect();

    panel.style.width = target.width + 'px';
    panel.style.height = target.height + 'px';
    panel.style.top = target.top + 'px';
    panel.style.left = target.left + 'px';
    media.innerHTML = '';
    media.appendChild(thumbImage());

    expanded.hidden = false;
    document.body.style.overflow = 'hidden';

    if (reduceMotion.matches) {
      panel.style.transform = 'none';
      requestAnimationFrame(() => expanded.classList.add('is-open'));
      afterPanelTransition(onOpenSettled);
      return;
    }

    setCornerOrigin(source, target);

    panel.style.transition = 'none';
    panel.style.transform = 'scale(0.001)';
    // Force layout so the starting transform takes effect before we animate.
    panel.getBoundingClientRect();
    panel.style.transition = '';

    requestAnimationFrame(() => {
      expanded.classList.add('is-open');
      panel.style.transform = 'scale(1)';
    });

    afterPanelTransition(onOpenSettled);
  }

  // A real <video> element, entirely ours: no iframe, no YouTube chrome,
  // no branding. Native controls (play/pause, seek, volume, fullscreen)
  // handle playback — simpler and more capable than a custom overlay.
  function addVideoPlayer() {
    const video = document.createElement('video');
    video.src = VIDEO_SRC;
    video.poster = VIDEO_THUMB;
    video.controls = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';

    media.innerHTML = '';
    media.appendChild(video);
  }

  function onOpenSettled() {
    isAnimating = false;
    isOpen = true;
    addVideoPlayer();
    closeBtn.focus();
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    if (!isOpen || isAnimating) return;
    isAnimating = true;
    document.removeEventListener('keydown', onKeydown);

    // Stop playback immediately, before animating back.
    media.innerHTML = '';
    media.appendChild(thumbImage());

    const source = activeTrigger.getBoundingClientRect();
    const target = targetRect();

    if (reduceMotion.matches) {
      expanded.classList.remove('is-open');
      afterPanelTransition(finishClose);
      return;
    }

    setCornerOrigin(source, target);

    requestAnimationFrame(() => {
      expanded.classList.remove('is-open');
      panel.style.transform = 'scale(0.001)';
    });

    afterPanelTransition(finishClose);
  }

  function finishClose() {
    isAnimating = false;
    isOpen = false;
    expanded.hidden = true;
    document.body.style.overflow = '';
    panel.style.transform = '';
    media.innerHTML = '';
    activeTrigger.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', () => open(trigger));
  });
  closeBtn.addEventListener('click', close);
  expanded.querySelector('.video-expanded-backdrop').addEventListener('click', close);

  // The FAB is fixed, so a different section's background scrolls behind
  // it constantly. Sample that background's luminance (same approach as
  // scrollbar.js) and flip the tooltip to "white mode" whenever it's dark,
  // so it never blends into a navy/blue section.
  const fab = document.getElementById('videoFabTrigger');
  if (fab) {
    function parseRgb(value) {
      if (!value || value === 'transparent') return null;
      const m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (!m) return null;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.15) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
    }
    function luminance({ r, g, b }) {
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    function backgroundBehind(el) {
      let node = el;
      while (node && node !== document.documentElement) {
        if (node.nodeType === 1) {
          const rgb = parseRgb(getComputedStyle(node).backgroundColor);
          if (rgb) return rgb;
        }
        node = node.parentElement;
      }
      return parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 250, g: 247, b: 242 };
    }

    let ticking = false;
    function updateFabTheme() {
      ticking = false;
      const rect = fab.getBoundingClientRect();
      // Sample just to the left of the FAB — where the tooltip itself
      // sits — rather than the FAB's own coordinates, so the hit-test
      // lands on the page section behind it, not the button.
      const x = Math.max(1, rect.left - 30);
      const y = rect.top + rect.height / 2;
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const isDark = luminance(backgroundBehind(el)) < 0.42;
      fab.classList.toggle('tooltip-on-dark', isDark);
    }
    function requestFabThemeUpdate() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateFabTheme);
    }

    requestFabThemeUpdate();
    window.addEventListener('scroll', requestFabThemeUpdate, { passive: true });
    window.addEventListener('resize', requestFabThemeUpdate);
  }
})();
