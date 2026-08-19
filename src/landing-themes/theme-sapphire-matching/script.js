(function(){
  // Sanftes Scrollen fuer Anker-Links (ausser Bewerbungs-Modal).
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if(!a) return;
    var id = a.getAttribute('href');
    if(!id || id === '#' || id.indexOf('bewerbung-form') > -1) return;
    var el = document.querySelector(id);
    if(el){ e.preventDefault(); el.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
})();
