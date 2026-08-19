(function(){
  var root=document.documentElement;

  // Theme toggle (Dark <-> Light)
  try{
    var stored=localStorage.getItem('qap-theme');
    if(stored) root.setAttribute('data-qap-theme',stored);
  }catch(e){}
  var toggle=document.getElementById('qap-theme-toggle');
  if(toggle){
    toggle.addEventListener('click',function(){
      var cur=root.getAttribute('data-qap-theme')==='light'?'dark':'light';
      root.setAttribute('data-qap-theme',cur);
      try{localStorage.setItem('qap-theme',cur);}catch(e){}
    });
  }

  // Sticky nav shadow
  var nav=document.getElementById('qap-nav');
  var onScroll=function(){ if(!nav)return; nav.classList.toggle('is-scrolled',window.scrollY>10); };
  window.addEventListener('scroll',onScroll,{passive:true}); onScroll();

  // Burger
  var burger=document.getElementById('qap-burger');
  var mobile=document.getElementById('qap-mobile-nav');
  if(burger&&mobile){
    burger.addEventListener('click',function(){ mobile.classList.toggle('is-open'); });
    mobile.querySelectorAll('a').forEach(function(a){ a.addEventListener('click',function(){ mobile.classList.remove('is-open'); }); });
  }

  // Audience tabs
  document.querySelectorAll('[data-qap-tab]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var t=btn.getAttribute('data-qap-tab');
      document.querySelectorAll('[data-qap-tab]').forEach(function(b){ b.classList.toggle('is-active',b.getAttribute('data-qap-tab')===t); });
      document.querySelectorAll('[data-qap-panel]').forEach(function(p){ p.classList.toggle('is-active',p.getAttribute('data-qap-panel')===t); });
    });
  });
  document.querySelectorAll('[data-qap-tab-target]').forEach(function(a){
    a.addEventListener('click',function(){
      var t=a.getAttribute('data-qap-tab-target');
      setTimeout(function(){
        var btn=document.querySelector('[data-qap-tab="'+t+'"]');
        if(btn) btn.click();
      },80);
    });
  });

  // Dashboard tabs
  document.querySelectorAll('[data-qap-dtab]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var t=btn.getAttribute('data-qap-dtab');
      document.querySelectorAll('[data-qap-dtab]').forEach(function(b){ b.classList.toggle('is-active',b.getAttribute('data-qap-dtab')===t); });
      document.querySelectorAll('[data-qap-dpanel]').forEach(function(p){
        var on=p.getAttribute('data-qap-dpanel')===t;
        p.classList.toggle('is-active',on);
        if(on) runChartAnim(p);
      });
    });
  });

  // Price features (split newlines from data attr)
  document.querySelectorAll('[data-qap-features]').forEach(function(el){
    var raw=el.getAttribute('data-qap-features')||'';
    el.innerHTML=raw.split(/\n+/).filter(Boolean).map(function(l){return '<div>'+l.trim()+'</div>';}).join('');
  });

  // Year
  var y=document.getElementById('qap-year'); if(y) y.textContent=new Date().getFullYear();

  // Reveal + count-up + chart animations via IntersectionObserver
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  function animateCount(el){
    if(el.__done)return; el.__done=true;
    var tgt=parseInt(el.getAttribute('data-qap-target')||'0',10);
    var txt=el.getAttribute('data-qap-target-text');
    if(txt){ el.textContent=txt; return; }
    if(reduced||!isFinite(tgt)){ el.textContent=tgt; return; }
    var start=performance.now(),dur=1200;
    function step(t){
      var p=Math.min(1,(t-start)/dur);
      var v=Math.floor(tgt*(1-Math.pow(1-p,3)));
      el.textContent=v.toLocaleString('de-DE');
      if(p<1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function runChartAnim(panel){
    if(!panel||panel.__ran)return; panel.__ran=true;
    panel.classList.add('qap-run');
    panel.querySelectorAll('rect[data-qap-h]').forEach(function(r,i){
      var h=parseFloat(r.getAttribute('data-qap-h'))||0;
      setTimeout(function(){ r.setAttribute('height',h); r.setAttribute('y',160-h); }, i*80);
    });
    panel.querySelectorAll('.qap-count').forEach(animateCount);
  }

  var io=('IntersectionObserver' in window)?new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting)return;
      var t=e.target;
      t.classList.add('is-in');
      if(t.matches('.qap-count')) animateCount(t);
      if(t.matches('[data-qap-dpanel].is-active')) runChartAnim(t);
      if(t.matches('.qap-dash')) {
        var active=t.querySelector('.qap-dash-panel.is-active');
        if(active) runChartAnim(active);
        t.querySelectorAll('.qap-count').forEach(animateCount);
      }
      io.unobserve(t);
    });
  },{threshold:.15}):null;

  document.querySelectorAll('[data-qap-animate], .qap-count, .qap-dash').forEach(function(el){
    if(io) io.observe(el); else { el.classList.add('is-in'); if(el.matches('.qap-count')) animateCount(el); }
  });
})();
