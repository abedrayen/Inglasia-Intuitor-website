// Demo button interaction
const approveBtn = document.getElementById('approveBtn');
const demoReceipt = document.getElementById('demoReceipt');
if (approveBtn && demoReceipt) {
  approveBtn.addEventListener('click', () => {
    approveBtn.classList.add('pressed');
    approveBtn.textContent = '✓ Signed';
    demoReceipt.classList.add('visible');
    setTimeout(() => {
      approveBtn.classList.remove('pressed');
      approveBtn.textContent = 'Approve';
      demoReceipt.classList.remove('visible');
    }, 4500);
  });
}
