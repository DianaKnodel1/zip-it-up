(function () {
  // Year
  var y = document.getElementById('ep-year');
  if (y) y.textContent = new Date().getFullYear();

  // Footer link expansion (pipe-separated)
  document.querySelectorAll('.ep-foot-links[data-list]').forEach(function (el) {
    var raw = (el.getAttribute('data-list') || '').trim();
    if (!raw) return;
    el.innerHTML = raw.split('|').map(function (item) {
      var t = item.trim();
      if (!t) return '';
      return '<a href="#">' + t + '</a>';
    }).join('');
  });

  // Reveal on scroll
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  // Number counter
  function animateCount(el) {
    var target = parseFloat(el.getAttribute('data-to')) || 0;
    var duration = 1800;
    var start = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var val = Math.round(target * eased);
      el.textContent = val.toLocaleString('de-DE');
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if (!reduced && 'IntersectionObserver' in window) {
    var countIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          animateCount(e.target);
          countIo.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('.ep-count').forEach(function (el) { countIo.observe(el); });
  } else {
    document.querySelectorAll('.ep-count').forEach(function (el) {
      el.textContent = (parseFloat(el.getAttribute('data-to')) || 0).toLocaleString('de-DE');
    });
  }

  // Parallax scroll
  if (!reduced) {
    var parallaxEls = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
    var floatEls = Array.prototype.slice.call(document.querySelectorAll('.ep-float[data-float]'));
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var vh = window.innerHeight;
        parallaxEls.forEach(function (el) {
          var rect = el.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > vh) return;
          var amt = parseFloat(el.getAttribute('data-parallax')) || 0.1;
          var offset = (rect.top - vh / 2) * amt * -1;
          el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
        });
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Mouse move on hero floats
    var hero = document.querySelector('.ep-hero');
    if (hero && floatEls.length) {
      hero.addEventListener('mousemove', function (e) {
        var r = hero.getBoundingClientRect();
        var mx = (e.clientX - r.left) / r.width - 0.5;
        var my = (e.clientY - r.top) / r.height - 0.5;
        floatEls.forEach(function (el) {
          var f = parseFloat(el.getAttribute('data-float')) || 1;
          el.style.transform = 'translate3d(' + (mx * 14 * f).toFixed(1) + 'px,' + (my * 14 * f).toFixed(1) + 'px,0)';
        });
      });
      hero.addEventListener('mouseleave', function () {
        floatEls.forEach(function (el) { el.style.transform = ''; });
      });
    }
  }
})();
