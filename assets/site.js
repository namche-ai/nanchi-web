(() => {
  const menuButton = document.querySelector('[data-menu-button]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  const modal = document.querySelector('[data-modal]');
  const dialog = document.querySelector('[data-dialog]');
  const form = document.querySelector('[data-demo-form]');
  const formContent = document.querySelector('[data-form-content]');
  const success = document.querySelector('[data-success]');
  let lastFocused = null;

  function closeMenu() {
    mobileNav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', '打开导航');
  }

  menuButton.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  });
  mobileNav.querySelectorAll('a, button').forEach((item) => item.addEventListener('click', closeMenu));

  function openModal() {
    lastFocused = document.activeElement;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    window.setTimeout(() => dialog.focus(), 20);
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
    formContent.hidden = false;
    success.classList.remove('visible');
    form.reset();
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('[data-open-demo]').forEach((button) => button.addEventListener('click', openModal));
  document.querySelectorAll('[data-close-demo]').forEach((button) => button.addEventListener('click', closeModal));
  modal.addEventListener('mousedown', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    formContent.hidden = true;
    success.classList.add('visible');
  });

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.13 }) : null;

  document.querySelectorAll('.reveal').forEach((element) => {
    if (observer) observer.observe(element);
    else element.classList.add('is-visible');
  });
})();
