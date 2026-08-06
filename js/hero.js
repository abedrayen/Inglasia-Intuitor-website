// Cursor-tracking spotlight on hero mark
const heroMark = document.getElementById('heroMark');
if (heroMark) {
  heroMark.addEventListener('mousemove', (e) => {
    const rect = heroMark.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const frame = heroMark.querySelector('.hero-mark-frame');
    frame.style.setProperty('--mx', x + '%');
    frame.style.setProperty('--my', y + '%');
  });
}
