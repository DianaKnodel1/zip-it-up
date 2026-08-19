(function(){
  // Year
  var y = document.getElementById('qt-year');
  if (y) y.textContent = new Date().getFullYear();

  // Accent color from data or default
  try {
    var accent = '{{accent_color}}';
    if (accent && /^#[0-9a-f]{3,8}$/i.test(accent)) {
      document.documentElement.style.setProperty('--qt-accent', accent);
    }
  } catch(e){}

  // Reveal on scroll
  var reveals = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, {threshold:0.12, rootMargin:'0px 0px -60px 0px'});
    reveals.forEach(function(el){ io.observe(el); });
  } else {
    reveals.forEach(function(el){ el.classList.add('is-in'); });
  }

  // Number counters
  function animateCounter(el){
    var raw = (el.textContent || '').replace(/[^\d.]/g,'');
    var target = parseFloat(raw); if (!isFinite(target)) return;
    var suffix = el.getAttribute('data-suffix') || '';
    var duration = 1600; var start = performance.now();
    function tick(now){
      var p = Math.min(1, (now - start)/duration);
      var eased = 1 - Math.pow(1-p, 3);
      var v = Math.floor(target * eased);
      el.textContent = v.toLocaleString('de-DE') + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString('de-DE') + suffix;
    }
    requestAnimationFrame(tick);
  }
  var counters = document.querySelectorAll('[data-counter]');
  if ('IntersectionObserver' in window){
    var co = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ animateCounter(e.target); co.unobserve(e.target); }
      });
    }, {threshold:0.4});
    counters.forEach(function(el){ co.observe(el); });
  }

  // Hero parallax + mouse tracking on scene
  var scene = document.querySelector('[data-parallax]');
  if (scene && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    scene.addEventListener('mousemove', function(e){
      var r = scene.getBoundingClientRect();
      var mx = (e.clientX - r.left) / r.width - 0.5;
      var my = (e.clientY - r.top) / r.height - 0.5;
      var mon = scene.querySelector('.qt-monitor');
      var ph = scene.querySelector('.qt-phone');
      var tb = scene.querySelector('.qt-tablet');
      if (mon) mon.style.transform = 'rotateY('+(-12 + mx*6)+'deg) rotateX('+(6 - my*6)+'deg) translate('+(mx*10)+'px,'+(my*10)+'px)';
      if (ph) ph.style.transform = 'rotateY('+(14 + mx*8)+'deg) rotateX('+(-4 - my*6)+'deg) rotate(-6deg) translate('+(-mx*14)+'px,'+(-my*10)+'px)';
      if (tb) tb.style.transform = 'rotateY('+(-18 - mx*6)+'deg) rotateX('+(8 - my*6)+'deg) rotate(4deg) translate('+(mx*8)+'px,'+(my*14)+'px)';
    });
    scene.addEventListener('mouseleave', function(){
      var mon = scene.querySelector('.qt-monitor');
      var ph = scene.querySelector('.qt-phone');
      var tb = scene.querySelector('.qt-tablet');
      if (mon) mon.style.transform = '';
      if (ph) ph.style.transform = '';
      if (tb) tb.style.transform = '';
    });

    // Scroll parallax on scene
    window.addEventListener('scroll', function(){
      var y = window.scrollY;
      scene.style.transform = 'translateY('+ (y * -0.05) +'px)';
    }, {passive:true});
  }

  // Service card cursor glow
  document.querySelectorAll('.qt-svc').forEach(function(card){
    card.addEventListener('mousemove', function(e){
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX-r.left)/r.width*100)+'%');
      card.style.setProperty('--my', ((e.clientY-r.top)/r.height*100)+'%');
    });
  });
})();
