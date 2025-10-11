document.addEventListener("DOMContentLoaded", () => {
  let startY = 0;
  let isPulling = false;

  const ptr = document.createElement('div');
  ptr.id = 'pullToRefresh';
  ptr.innerHTML = `
    <div class="ptr-icon">⟳</div>
    <div class="ptr-text">Pull to refresh</div>
  `;
  document.body.prepend(ptr);

  const ptrIcon = ptr.querySelector('.ptr-icon');
  const ptrText = ptr.querySelector('.ptr-text');

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  });

  document.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const distance = e.touches[0].clientY - startY;
    if (distance > 50) {
      ptr.style.top = '0';
      ptrText.textContent = 'Release to refresh';
    }
  });

  document.addEventListener('touchend', () => {
    if (ptr.style.top === '0px') {
      ptrText.textContent = 'Refreshing...';
      ptrIcon.style.display = 'inline-block';
      // Simulate refresh
      setTimeout(() => {
        location.reload();
      }, 800);
    } else {
      ptr.style.top = '-60px';
    }
    isPulling = false;
  });
});
