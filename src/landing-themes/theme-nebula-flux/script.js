(function(){
  // Accent override
  try{
    var acc = '{{accent_color}}';
    if(acc && /^#[0-9a-f]{3,8}$/i.test(acc)) document.documentElement.style.setProperty('--nf-accent',acc);
  }catch(e){}

  // Year
  var y = document.getElementById('nf-year');
  if(y) y.textContent = new Date().getFullYear();

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reveal
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); } });
    },{threshold:.12,rootMargin:'0px 0px -50px 0px'});
    document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });
  }

  // Counters
  function animateNum(el){
    var raw = (el.getAttribute('data-count') || el.textContent || '').replace(/[^\d.]/g,'');
    var target = parseFloat(raw); if(!isFinite(target)) return;
    var suffix = el.getAttribute('data-suffix') || '';
    var dur = 1600, start = performance.now();
    function tick(now){
      var p = Math.min(1,(now-start)/dur);
      var eased = 1 - Math.pow(1-p,3);
      var v = Math.floor(target*eased);
      el.textContent = v.toLocaleString('de-DE') + suffix;
      if(p<1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString('de-DE') + suffix;
    }
    requestAnimationFrame(tick);
  }
  if('IntersectionObserver' in window){
    var co = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ animateNum(e.target); co.unobserve(e.target); } });
    },{threshold:.4});
    document.querySelectorAll('[data-counter]').forEach(function(el){ co.observe(el); });
  }

  // Hero 3D parallax
  var scene = document.querySelector('.nf-scene');
  if(scene && !reduce){
    var mon = scene.querySelector('.nf-monitor');
    var ph  = scene.querySelector('.nf-phone');
    var tb  = scene.querySelector('.nf-tablet');
    scene.addEventListener('mousemove', function(e){
      var r = scene.getBoundingClientRect();
      var mx = (e.clientX - r.left)/r.width - .5;
      var my = (e.clientY - r.top)/r.height - .5;
      if(mon) mon.style.transform = 'rotateY('+(-12+mx*6)+'deg) rotateX('+(6-my*6)+'deg) translate('+(mx*10)+'px,'+(my*10)+'px)';
      if(tb)  tb.style.transform  = 'rotateY('+(-18-mx*6)+'deg) rotateX('+(8-my*6)+'deg) rotate(4deg) translate('+(mx*8)+'px,'+(my*14)+'px)';
      if(ph)  ph.style.transform  = 'rotateY('+(14+mx*8)+'deg) rotateX('+(-4-my*6)+'deg) rotate(-6deg) translate('+(-mx*14)+'px,'+(-my*10)+'px)';
    });
    scene.addEventListener('mouseleave', function(){
      [mon,ph,tb].forEach(function(el){ if(el) el.style.transform=''; });
    });
    window.addEventListener('scroll', function(){
      var y = Math.min(window.scrollY, 800);
      scene.style.transform = 'translateY('+(y*-.05)+'px)';
    },{passive:true});
  }

  // Dashboard chart bars randomise once visible
  var chart = document.querySelector('.nf-dash-chart');
  if(chart && 'IntersectionObserver' in window){
    var dc = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(!e.isIntersecting) return;
        e.target.querySelectorAll('span').forEach(function(s){
          var h = 30 + Math.random()*70;
          s.style.height = h + '%';
          s.style.transition = 'height 1.2s cubic-bezier(.2,.8,.2,1)';
        });
        dc.unobserve(e.target);
      });
    },{threshold:.3});
    dc.observe(chart);
  }
})();
