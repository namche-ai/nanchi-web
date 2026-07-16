(() => {
  const menuButton = document.querySelector('[data-menu-button]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  const modal = document.querySelector('[data-modal]');
  const dialog = document.querySelector('[data-dialog]');
  const form = document.querySelector('[data-demo-form]');
  const formContent = document.querySelector('[data-form-content]');
  const success = document.querySelector('[data-success]');
  const formError = document.querySelector('[data-form-error]');
  const submitButton = form.querySelector('.form-submit');
  const submitLabel = form.querySelector('[data-submit-label]');
  let lastFocused = null;
  let submitting = false;
  let activeSubmissionController = null;

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
    activeSubmissionController?.abort();
    activeSubmissionController = null;
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
    formContent.hidden = false;
    success.classList.remove('visible');
    form.reset();
    formError.hidden = true;
    formError.textContent = '';
    submitting = false;
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
    submitLabel.textContent = '提交预约';
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('[data-open-demo]').forEach((button) => button.addEventListener('click', openModal));
  document.querySelectorAll('[data-close-demo]').forEach((button) => button.addEventListener('click', closeModal));
  modal.addEventListener('mousedown', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;

    submitting = true;
    formError.hidden = true;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitLabel.textContent = '正在提交…';

    const formData = new FormData(form);
    const params = new URLSearchParams(window.location.search);
    const payload = {
      name: formData.get('name'),
      company: formData.get('company'),
      contact: formData.get('contact'),
      role: formData.get('role'),
      scene: formData.get('scene'),
      systems: formData.get('systems'),
      note: formData.get('note'),
      website: formData.get('website'),
      consent: formData.get('consent') === 'on',
      sourceUrl: window.location.href,
      utm: {
        source: params.get('utm_source') || '',
        medium: params.get('utm_medium') || '',
        campaign: params.get('utm_campaign') || '',
        content: params.get('utm_content') || '',
        term: params.get('utm_term') || '',
      },
    };

    const controller = new AbortController();
    activeSubmissionController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Lead submission failed with ${response.status}`);

      formContent.hidden = true;
      success.classList.add('visible');
      form.reset();
    } catch (error) {
      if (activeSubmissionController !== controller) return;
      formError.textContent = error.name === 'AbortError'
        ? '提交等待时间较长，请检查网络后重试。'
        : '提交暂时未成功，请稍后重试。你的填写内容仍保留在页面中。';
      formError.hidden = false;
    } finally {
      window.clearTimeout(timeout);
      if (activeSubmissionController !== controller) return;
      activeSubmissionController = null;
      submitting = false;
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitLabel.textContent = '提交预约';
    }
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
