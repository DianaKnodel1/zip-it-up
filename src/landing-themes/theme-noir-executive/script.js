(function() {
  // Navigation Scroll Effect
  const nav = document.querySelector('.noir-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.classList.add('is-scrolled');
    } else {
      nav.classList.remove('is-scrolled');
    }
  });

  // Simple Scroll Observer for Animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.noir-fade-in').forEach(el => observer.observe(el));

  // Accordion Logic
  document.querySelectorAll('.noir-acc-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.parentElement;
      const isOpen = item.classList.contains('is-open');
      
      // Close all others
      document.querySelectorAll('.noir-acc-item').forEach(i => i.classList.remove('is-open'));
      
      if (!isOpen) {
        item.classList.add('is-open');
      }
    });
  });

  // Mobile Menu Toggle (Minimal)
  const toggle = document.querySelector('.noir-menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.querySelector('.noir-menu').classList.toggle('is-mobile-open');
    });
  }
})();
