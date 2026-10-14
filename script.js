(() => {
  const body = document.body;
  const header = document.querySelector('.site-header');
  const progress = document.querySelector('.progress-bar');
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  const langButtons = document.querySelectorAll('[data-lang]');

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Private browsing can disable storage. */ } }
  };

  const refreshOpenAnswers = () => {
    document.querySelectorAll('.faq-item.open .faq-answer').forEach((answer) => {
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    });
  };

  const setLanguage = (lang) => {
    const selected = lang === 'tr' ? 'tr' : 'ru';
    document.documentElement.lang = selected;
    storage.set('zenit-language', selected);

    document.querySelectorAll('[data-ru][data-tr]').forEach((element) => {
      const value = element.dataset[selected];
      if (element.matches('input, textarea')) {
        element.placeholder = value;
      } else if (element.tagName === 'OPTION') {
        element.textContent = value;
      } else {
        element.textContent = value;
      }
    });

    langButtons.forEach((button) => {
      const isActive = button.dataset.lang === selected;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    refreshOpenAnswers();
  };

  langButtons.forEach((button) => {
    button.addEventListener('click', () => setLanguage(button.dataset.lang));
  });

  setLanguage(storage.get('zenit-language') || 'ru');

  const updateScroll = () => {
    const scrollTop = window.scrollY;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    header?.classList.toggle('scrolled', scrollTop > 18);
    if (progress) {
      progress.style.width = `${scrollable > 0 ? (scrollTop / scrollable) * 100 : 0}%`;
    }
  };

  updateScroll();
  window.addEventListener('scroll', updateScroll, { passive: true });

  if (nav) {
    nav.id ||= 'site-navigation';
    menuToggle?.setAttribute('aria-controls', nav.id);
  }

  const closeMenu = () => {
    nav?.classList.remove('open');
    menuToggle?.classList.remove('active');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.classList.toggle('active');
    nav?.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav?.classList.contains('open')) {
      closeMenu();
      menuToggle?.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (nav?.classList.contains('open') && !nav.contains(event.target) && !menuToggle?.contains(event.target)) closeMenu();
  });

  const mobileQuery = window.matchMedia('(max-width: 1040px)');
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', closeMenu);
  else mobileQuery.addListener(closeMenu);
  window.addEventListener('resize', refreshOpenAnswers, { passive: true });

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    revealObserver.observe(element);
  });

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const target = Number(element.dataset.count || 0);
      const suffix = element.dataset.suffix || '';
      const start = performance.now();
      const duration = 1000;

      const tick = (now) => {
        const progressValue = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progressValue, 3);
        element.textContent = `${Math.floor(target * eased)}${suffix}`;
        if (progressValue < 1) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
      counterObserver.unobserve(element);
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('[data-count]').forEach((element) => counterObserver.observe(element));

  document.querySelectorAll('.schedule-tab').forEach((tab) => {
    tab.setAttribute('role', 'tab');
    tab.id = `schedule-tab-${tab.dataset.group}`;
    tab.setAttribute('aria-controls', `schedule-panel-${tab.dataset.group}`);
    tab.addEventListener('click', () => {
      const group = tab.dataset.group;
      document.querySelectorAll('.schedule-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.schedule-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.group === group);
      });
    });
  });

  document.querySelectorAll('.schedule-panel').forEach((panel) => {
    panel.id = `schedule-panel-${panel.dataset.group}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `schedule-tab-${panel.dataset.group}`);
  });

  document.querySelectorAll('.faq-question').forEach((question) => {
    question.addEventListener('click', () => {
      const item = question.closest('.faq-item');
      const answer = item?.querySelector('.faq-answer');
      const willOpen = !item?.classList.contains('open');

      document.querySelectorAll('.faq-item.open').forEach((openItem) => {
        if (openItem !== item) {
          openItem.classList.remove('open');
          const openAnswer = openItem.querySelector('.faq-answer');
          if (openAnswer) openAnswer.style.maxHeight = '0px';
          openItem.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
        }
      });

      item?.classList.toggle('open', willOpen);
      question.setAttribute('aria-expanded', String(willOpen));
      if (answer) answer.style.maxHeight = willOpen ? `${answer.scrollHeight}px` : '0px';
    });
  });

  const form = document.querySelector('#signup-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const lang = document.documentElement.lang;
    const name = String(data.get('name') || '').trim();
    const age = String(data.get('age') || '').trim();
    const group = String(data.get('group') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    const note = String(data.get('note') || '').trim();

    const message = lang === 'tr'
      ? `Merhaba! Zenit Alanya futbol okuluna kayıt olmak istiyoruz.\nÇocuğun adı: ${name}\nYaş: ${age}\nGrup: ${group}\nTelefon: ${phone}${note ? `\nNot: ${note}` : ''}`
      : `Здравствуйте! Хотим записаться в футбольную школу Zenit Alanya.\nИмя ребёнка: ${name}\nВозраст: ${age}\nГруппа: ${group}\nТелефон: ${phone}${note ? `\nКомментарий: ${note}` : ''}`;

    window.open(`https://wa.me/905388899272?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  });

  document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = new Date().getFullYear();
  });

  window.addEventListener('load', () => body.classList.add('loaded'));
  requestAnimationFrame(() => body.classList.add('loaded'));
})();
