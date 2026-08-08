// Demo button — live signature receipt (new UUID + UTC time each click)
(function () {
  const approveBtn = document.getElementById('approveBtn');
  const demoReceipt = document.getElementById('demoReceipt');
  const demoSignTime = document.getElementById('demoSignTime');
  const demoSignUuid = document.getElementById('demoSignUuid');
  if (!approveBtn || !demoReceipt || !demoSignTime || !demoSignUuid) return;

  let resetTimer = null;

  function formatUtc(date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mon = months[date.getUTCMonth()];
    const yyyy = date.getUTCFullYear();
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${dd}-${mon}-${yyyy} ${hh}:${mm} UTC`;
  }

  approveBtn.addEventListener('click', () => {
    const now = new Date();
    const full = crypto.randomUUID().replace(/-/g, '');
    const uuid = `${full.slice(0, 4)}-${full.slice(4, 8)}`;

    demoSignTime.textContent = formatUtc(now);
    demoSignUuid.textContent = uuid;

    approveBtn.classList.add('pressed');
    approveBtn.textContent = '✓ Signed';
    demoReceipt.classList.add('visible');

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      approveBtn.classList.remove('pressed');
      approveBtn.textContent = 'Approve';
      demoReceipt.classList.remove('visible');
    }, 4500);
  });
})();
