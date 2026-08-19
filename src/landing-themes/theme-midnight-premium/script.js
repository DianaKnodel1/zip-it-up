(function () {
  // Year
  var y = document.getElementById('mp-year');
  if (y) y.textContent = new Date().getFullYear();

  // Sticky nav shadow on scroll
  var nav = document.getElementById('mp-nav');
  var top = document.getElementById('mp-top');
  function onScroll() {
    var s = window.scrollY || 0;
    if (nav) nav.classList.toggle('is-scrolled', s > 12);
    if (top) top.classList.toggle('is-visible', s > 480);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Back to top
  if (top) top.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Mobile burger
  var burger = document.getElementById('mp-burger');
  var mnav = document.getElementById('mp-mobile-nav');
  if (burger && mnav) {
    burger.addEventListener('click', function () { mnav.classList.toggle('is-open'); });
    mnav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { mnav.classList.remove('is-open'); });
    });
  }

  // Reveal on scroll (IntersectionObserver)
  var animEls = document.querySelectorAll('[data-mp-animate]');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    animEls.forEach(function (el) { io.observe(el); });
  } else {
    animEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  // Subtle parallax on hero orbs (respect reduced motion)
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    var orbs = document.querySelectorAll('.mp-orb');
    var heroCard = document.querySelector('.mp-hero-card');
    window.addEventListener('scroll', function () {
      var s = window.scrollY || 0;
      orbs.forEach(function (o, i) {
        var speed = (i + 1) * 0.06;
        o.style.transform = 'translate3d(0,' + (s * speed) + 'px,0)';
      });
      if (heroCard && s < 900) {
        heroCard.style.transform = 'perspective(1200px) rotateY(' + (-6 + s * 0.008) + 'deg) rotateX(' + (4 - s * 0.006) + 'deg) translateY(' + (s * -0.04) + 'px)';
      }
    }, { passive: true });
  }

  // Smooth-scroll for in-page anchors (skip modal trigger)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href === '#' || href.indexOf('#bewerbung-form') !== -1) return;
    var el = document.querySelector(href);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  // Bild-Hintergründe nur setzen, wenn eine echte URL hinterlegt ist —
  // sonst bleibt der Verlaufs-Fallback aus der CSS sichtbar.
  Array.prototype.forEach.call(document.querySelectorAll('[data-mp-bg]'), function (el) {
    var url = (el.getAttribute('data-mp-bg') || '').trim();
    el.removeAttribute('data-mp-bg');
    if (!url || url.indexOf('{{') !== -1) return;
    el.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')";
  });

  // Logo-Bild: nur zeigen, wenn ein Upload vorhanden ist.
  Array.prototype.forEach.call(document.querySelectorAll('[data-mp-logo]'), function (img) {
    var src = (img.getAttribute('src') || '').trim();
    if (!src || src.indexOf('{{') !== -1) { img.remove(); return; }
    img.parentNode.classList.add('has-logo');
    img.addEventListener('error', function () { img.parentNode.classList.remove('has-logo'); img.remove(); });
  });
})();
