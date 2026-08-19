/* Shared inline application form handler + success modal + Inline-Terminwahl. */
(function(){
  function fmtWa(num){var d=String(num||'').replace(/[^0-9]/g,'');if(!d)return '';return d.length>4?'+'+d.slice(0,2)+' '+d.slice(2,5)+' '+d.slice(5):'+'+d;}
  function spamHintBox(emailStatus){
    var s=document.createElement('div');
    var failed=emailStatus&&emailStatus.status==='failed';
    var skipped=emailStatus&&emailStatus.status==='skipped';
    var calendly=emailStatus&&emailStatus.reason==='calendly_handles_mail';
    var mailless=emailStatus&&emailStatus.reason==='mailless_mode';
    if(calendly){
      s.style.cssText='margin:14px 0 4px;padding:14px 16px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:8px;color:#065f46;font-size:13.5px;line-height:1.55;text-align:left;';
      s.innerHTML='Nach der Terminwahl erhalten Sie Ihre Bestätigung, den Kalendereintrag und Erinnerungen automatisch per E-Mail und SMS.';
      return s;
    }
    if(mailless){
      s.style.cssText='margin:14px 0 4px;padding:14px 16px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:8px;color:#065f46;font-size:13.5px;line-height:1.55;text-align:left;';
      s.innerHTML='Ihre Bewerbung ist eingegangen. Sie können direkt hier weitermachen – alle weiteren Schritte finden Sie jederzeit über diese Seite.';
      return s;
    }
    s.style.cssText='margin:14px 0 4px;padding:14px 16px;background:'+(failed?'#fee2e2':skipped?'#f1f5f9':'#fef3c7')+';border-left:4px solid '+(failed?'#ef4444':skipped?'#94a3b8':'#f59e0b')+';border-radius:8px;color:'+(failed?'#7f1d1d':skipped?'#334155':'#78350f')+';font-size:13.5px;line-height:1.55;text-align:left;';
    s.innerHTML=failed
      ? 'Ihre Bewerbung ist eingegangen. Die Bestätigungs-E-Mail konnte gerade nicht automatisch versendet werden – wir melden uns direkt bei Ihnen.'
      : skipped
        ? 'Ihre Bewerbung ist eingegangen. Falls Sie sich bereits beworben haben, verwenden wir Ihre bestehende Anfrage weiter.'
        : '💡 <strong>Wichtig:</strong> Falls Sie eine E-Mail erwarten, prüfen Sie bitte auch Ihren <strong>Spam-Ordner</strong> und markieren Sie uns als „Kein Spam".';
    return s;
  }

  // ── API-Base aus PORTAL_API ableiten ────────────────────────────────────
  function apiBase(){
    var p=String(window.PORTAL_API||'');
    // PORTAL_API zeigt auf .../api/public/applications → wir wollen die Origin.
    var m=p.match(/^(https?:\/\/[^/]+)/);
    return m ? m[1] : '';
  }
  function bookingUrl(action, params){
    var qs='action='+encodeURIComponent(action);
    if(params){for(var k in params){if(params[k]!=null)qs+='&'+encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}}
    return apiBase()+'/api/public/booking?'+qs;
  }

  // ── Datum-/Zeit-Formatter (IMMER deutsche Zeit) ─────────────────────────
  // Feste Zeitzone: Bewerber im Ausland sehen sonst andere Uhrzeiten als in
  // der Bestätigungsmail steht.
  var TZ = 'Europe/Berlin';
  function dtf(opts){
    try { return new Intl.DateTimeFormat('de-DE', Object.assign({timeZone:TZ}, opts)); }
    catch(_){ return new Intl.DateTimeFormat('de-DE', opts); }
  }
  var fmtDay = dtf({weekday:'short',day:'2-digit',month:'2-digit'});
  var fmtDayLong = dtf({weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  var fmtTime = dtf({hour:'2-digit',minute:'2-digit',hour12:false});
  var fmtYMD = (function(){
    try { return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}); }
    catch(_){ return null; }
  })();
  function toYMD(d){
    if(fmtYMD){ try { return fmtYMD.format(d); } catch(_){} }
    var y=d.getFullYear();var m=String(d.getMonth()+1).padStart(2,'0');var dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;
  }
  function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x;}
  function startOfDay(d){var x=new Date(d);x.setHours(0,0,0,0);return x;}

  // ── Inline-Booking-Renderer ─────────────────────────────────────────────
  function renderBookingInline(container, token, opts){
    opts=opts||{};
    container.innerHTML='';
    container.style.cssText='margin-top:18px;padding:22px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 30px -12px rgba(15,23,42,.15);color:#0f172a;font-family:inherit;';

    var RANGE_DAYS = 28;
    var state={schedule:null, rangeStart:startOfDay(new Date()), selectedDay:null, slotsByDay:{}, loadingSlots:false};

    var header=document.createElement('div');
    var h=document.createElement('h3');h.style.cssText='margin:0 0 6px;font-size:20px;font-weight:700;';h.textContent='Schritt 2 von 4: Wunschtermin wählen';
    var sub=document.createElement('p');sub.style.cssText='margin:0 0 4px;color:#475569;font-size:14px;line-height:1.5;';
    sub.textContent='Wir laden Ihren Kalender …';
    var hint=document.createElement('p');hint.style.cssText='margin:0 0 6px;color:#64748b;font-size:12.5px;';
    hint.textContent='Das Interview findet online statt – Bestätigung, Kalendereintrag und Erinnerungen kommen automatisch von Calendly. Alle Zeiten in deutscher Zeit (Europe/Berlin).';
    var priv=document.createElement('p');priv.style.cssText='margin:0 0 14px;color:#94a3b8;font-size:11.5px;line-height:1.5;';
    var dsUrl=window.LANDING_DATENSCHUTZ_URL||'datenschutz.html';
    priv.innerHTML='Ihre Daten werden ausschließlich zur Terminvereinbarung verwendet. Details in unserer <a href="'+dsUrl+'" target="_blank" rel="noopener" style="color:#64748b;text-decoration:underline;">Datenschutzerklärung</a>.';
    header.appendChild(h);header.appendChild(sub);header.appendChild(hint);header.appendChild(priv);
    container.appendChild(header);

    var body=document.createElement('div');container.appendChild(body);
    var errBox=document.createElement('div');errBox.style.cssText='display:none;margin-top:10px;padding:10px 12px;background:#fee2e2;border-left:4px solid #ef4444;color:#7f1d1d;border-radius:6px;font-size:13px;';
    container.appendChild(errBox);
    function showError(msg){errBox.style.display='block';errBox.textContent=msg;}
    function clearError(){errBox.style.display='none';errBox.textContent='';}

    function renderRange(){
      clearError();
      body.innerHTML='';
      var today=startOfDay(new Date());

      var title=document.createElement('div');
      title.style.cssText='font-size:13.5px;color:#475569;font-weight:500;margin:4px 0 10px;';
      title.textContent='Freie Termine in den nächsten 4 Wochen ('+fmtDay.format(state.rangeStart)+' – '+fmtDay.format(addDays(state.rangeStart,RANGE_DAYS-1))+')';
      body.appendChild(title);

      // 28 Tage: 4 Reihen × 7 Spalten
      var grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-bottom:14px;';
      for(var i=0;i<RANGE_DAYS;i++){
        (function(i){
          var d=addDays(state.rangeStart,i);
          var ymd=toYMD(d);
          var slots=state.slotsByDay[ymd]||[];
          var disabled = d<today || slots.length===0;
          var b=document.createElement('button');b.type='button';
          var active = state.selectedDay===ymd;
          b.style.cssText='padding:8px 2px;border-radius:10px;border:1.5px solid '+(active?'#0f172a':'#e2e8f0')+';background:'+(active?'#0f172a':disabled?'#f8fafc':'#fff')+';color:'+(active?'#fff':disabled?'#cbd5e1':'#0f172a')+';cursor:'+(disabled?'not-allowed':'pointer')+';font-size:12px;font-weight:600;text-align:center;line-height:1.25;';
          var parts=ymd.split('-');
          var wd=fmtDay.format(d).split(',')[0];
          b.innerHTML='<div style="font-size:10.5px;opacity:.7;">'+wd+'</div><div style="font-size:14px;margin-top:2px;">'+parts[2]+'.'+parts[1]+'</div><div style="font-size:10px;margin-top:2px;opacity:.75;">'+(slots.length?'frei':state.loadingSlots?'…':'—')+'</div>';
          if(!disabled){b.onclick=function(){state.selectedDay=ymd;renderRange();};}
          grid.appendChild(b);
        })(i);
      }
      body.appendChild(grid);

      // Zeit-Slots des ausgewählten Tages
      var slotBox=document.createElement('div');slotBox.style.cssText='min-height:60px;';
      if(state.loadingSlots){
        slotBox.innerHTML='<div style="text-align:center;color:#64748b;padding:20px;font-size:13.5px;">Lade freie Zeiten …</div>';
      } else if(!state.selectedDay){
        slotBox.innerHTML='<div style="text-align:center;color:#64748b;padding:16px;font-size:13.5px;">Bitte wählen Sie einen Tag aus.</div>';
      } else {
        var slots=state.slotsByDay[state.selectedDay]||[];
        if(slots.length===0){
          slotBox.innerHTML='<div style="text-align:center;color:#64748b;padding:16px;font-size:13.5px;">An diesem Tag sind keine Termine mehr frei.</div>';
        } else {
          var dLabel=document.createElement('div');dLabel.style.cssText='font-size:13.5px;font-weight:600;color:#0f172a;margin-bottom:8px;';
          dLabel.textContent=fmtDayLong.format(new Date(state.selectedDay+'T12:00:00'));
          slotBox.appendChild(dLabel);
          var sg=document.createElement('div');sg.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;';
          slots.forEach(function(s){
            var btn=document.createElement('button');btn.type='button';
            btn.textContent=fmtTime.format(new Date(s.start));
            btn.style.cssText='padding:10px;border:1.5px solid #0f172a;background:#fff;color:#0f172a;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;transition:all .12s;';
            btn.onmouseenter=function(){btn.style.background='#0f172a';btn.style.color='#fff';};
            btn.onmouseleave=function(){btn.style.background='#fff';btn.style.color='#0f172a';};
            btn.onclick=function(){bookSlot(s);};
            sg.appendChild(btn);
          });
          slotBox.appendChild(sg);
        }
      }
      body.appendChild(slotBox);
    }

    function loadRange(){
      state.loadingSlots=true;renderRange();
      var from=toYMD(state.rangeStart);
      var to=toYMD(addDays(state.rangeStart,RANGE_DAYS-1));
      fetch(bookingUrl('slots',{schedule_id:state.schedule.schedule_id, from:from, to:to}))
        .then(function(r){return r.json();})
        .then(function(res){
          state.loadingSlots=false;
          if(!res.ok){showError('Slots konnten nicht geladen werden.');return;}
          var byDay={};(res.slots||[]).forEach(function(s){
            var ymd=toYMD(new Date(s.start));
            (byDay[ymd]=byDay[ymd]||[]).push(s);
          });
          state.slotsByDay=byDay;
          if(!state.selectedDay){
            for(var i=0;i<RANGE_DAYS;i++){var y=toYMD(addDays(state.rangeStart,i));if((byDay[y]||[]).length){state.selectedDay=y;break;}}
          }
          renderRange();
        })
        .catch(function(){state.loadingSlots=false;showError('Netzwerkfehler beim Laden der Slots.');});
    }

    function bookSlot(s){
      clearError();
      body.innerHTML='<div style="text-align:center;color:#64748b;padding:30px;font-size:14px;">Termin wird gebucht …</div>';
      fetch(bookingUrl('book'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token, starts_at:s.start, applicant_timezone:TZ})})
        .then(function(r){return r.json().then(function(j){return {status:r.status, body:j};});})
        .then(function(res){
          if(!res.body||!res.body.ok){
            var err=res.body&&res.body.error;
            if(err==='already_scheduled'){
              renderRange();
              showError('Für diese Bewerbung ist bereits ein Termin gebucht. Bitte prüfen Sie Ihre Calendly-Terminbestätigung.');
              return;
            }
            if(res.status===409||err==='slot_taken'){
              loadRange();
              setTimeout(function(){showError('Dieser Termin wurde gerade schon vergeben. Bitte wählen Sie einen anderen.');},0);
              return;
            }
            renderRange();
            showError(err==='invalid_body'?'Die Terminzeit konnte nicht verarbeitet werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.':err==='no_schedule_configured'?'Kalender-Konfiguration konnte nicht gefunden werden. Bitte kontaktieren Sie uns.':'Buchung fehlgeschlagen. Bitte versuchen Sie es erneut.');
            return;
          }
          renderConfirmed(res.body);
        })
        .catch(function(){renderRange();showError('Netzwerkfehler bei der Buchung.');});
    }

    function renderConfirmed(bk){
      container.innerHTML='';
      var wrap=document.createElement('div');wrap.style.cssText='text-align:center;padding:12px 4px;';
      var chk=document.createElement('div');chk.style.cssText='width:56px;height:56px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;';
      chk.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      var h2=document.createElement('h3');h2.style.cssText='margin:0 0 8px;font-size:22px;font-weight:700;';h2.textContent='Termin bestätigt';
      var start=new Date(bk.starts_at), end=new Date(bk.ends_at);
      var when=document.createElement('p');when.style.cssText='margin:0 0 6px;font-size:16px;color:#0f172a;font-weight:600;';
      when.textContent=fmtDayLong.format(start)+' · '+fmtTime.format(start)+'–'+fmtTime.format(end)+' Uhr (deutsche Zeit)';
      var mail=document.createElement('p');mail.style.cssText='margin:6px 0 14px;color:#475569;font-size:13.5px;';
      mail.textContent='Ihre Bewerbung ist eingegangen. Alle weiteren Details finden Sie direkt hier im Portal.';
      wrap.appendChild(chk);wrap.appendChild(h2);wrap.appendChild(when);wrap.appendChild(mail);

      var next=document.createElement('div');
      next.style.cssText='margin:4px auto 0;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:left;font-size:13.5px;line-height:1.6;color:#0f172a;max-width:560px;';
      next.innerHTML='<strong>So geht es weiter:</strong>'
        + '<div style="margin-top:8px;">1. Den Termin im Kalender vormerken.</div>'
        + '<div style="margin-top:4px;">2. Zur vereinbarten Zeit über den Button hier im Portal am Gespräch teilnehmen.</div>'
        + '<div style="margin-top:4px;">3. Bei einer Zusage schließen Sie Ihre Registrierung direkt im Anschluss ab.</div>'
        + '<div style="margin-top:10px;color:#475569;">Sollten Sie den Termin nicht wahrnehmen können, geben Sie uns bitte rechtzeitig über das Portal Bescheid.</div>';
      wrap.appendChild(next);

      if(state.schedule && state.schedule.event_description){
        var desc=document.createElement('div');
        desc.style.cssText='margin:12px auto 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:left;font-size:13.5px;line-height:1.55;color:#0f172a;max-width:560px;';
        // event_description kann HTML enthalten (aus dem Portal-Editor).
        desc.innerHTML=state.schedule.event_description;
        wrap.appendChild(desc);
      }
      container.appendChild(wrap);
    }

    // ── Start: Schedule laden ────────────────────────────────────────────
    fetch(bookingUrl('schedule',{token:token}))
      .then(function(r){return r.json().then(function(j){return {status:r.status, body:j};});})
      .then(function(res){
        if(!res.body||!res.body.ok){
          sub.textContent='';
          if(res.status===404){showError('Ihr Buchungslink ist ungültig oder abgelaufen. Bitte kontaktieren Sie uns.');}
          else{showError('Terminwahl konnte nicht geladen werden.');}
          return;
        }
        state.schedule=res.body;
        var greet='Wählen Sie jetzt einen freien Termin für Ihr Online-Interview (ca. 15 Minuten).';
        if(res.body.applicant_first_name){
          greet='Hallo '+res.body.applicant_first_name+', wählen Sie jetzt einen freien Termin für Ihr Online-Interview (ca. 15 Minuten).';
        }
        sub.textContent=greet;
        loadRange();
      })
      .catch(function(){sub.textContent='';showError('Netzwerkfehler beim Laden des Kalenders.');});
  }

  function showModal(opts){
    opts=opts||{};var isFast=!!opts.fast;var broker=opts.broker||null;var wa=String(opts.whatsapp||'').replace(/[^0-9]/g,'');
    var redirectUrl=opts.redirectUrl||'';var emailStatus=opts.emailStatus||null;var bookingError=opts.bookingError||'';
    var isBooking=/\/buchen\//.test(redirectUrl);

    // NEU: Bei Buchung kein Modal — direkt inline unter dem Formular rendern.
    if(isBooking){
      var tokenMatch=redirectUrl.match(/\/buchen\/([^/?#]+)/);
      var token=tokenMatch?tokenMatch[1]:null;
      if(token){
        var form=document.getElementById('application-form');
        var statusEl=document.getElementById('form-status');
        var host=document.getElementById('booking-inline-host');
        if(!host){
          host=document.createElement('div');host.id='booking-inline-host';
          (form&&form.parentNode?form.parentNode:document.body).insertBefore(host, form?form.nextSibling:null);
        }
        if(form)form.style.display='none';
        if(statusEl)statusEl.style.display='none';
        host.scrollIntoView({behavior:'smooth',block:'start'});
        renderBookingInline(host, token, {emailStatus:emailStatus});
        return;
      }
      // Fallback: alte Modal-Variante mit Fenster-Link
    }

    var ov=document.createElement('div');ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');
    ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(2px);';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;color:#0f172a;max-width:520px;width:100%;border-radius:14px;padding:32px 28px;box-shadow:0 20px 60px -10px rgba(0,0,0,.35);font-family:inherit;position:relative;text-align:center;';
    var cls=document.createElement('button');cls.type='button';cls.innerHTML='&times;';cls.setAttribute('aria-label','Schließen');
    cls.style.cssText='position:absolute;top:10px;right:14px;background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:#64748b;';
    cls.onclick=function(){ov.remove();};
    var chk=document.createElement('div');chk.style.cssText='width:64px;height:64px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;';
    chk.innerHTML='<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var h=document.createElement('h3');h.style.cssText='margin:0 0 10px;font-size:24px;font-weight:700;line-height:1.25;';
    var p=document.createElement('p');p.style.cssText='margin:0 0 16px;color:#475569;font-size:15px;line-height:1.55;';
    box.appendChild(cls);box.appendChild(chk);box.appendChild(h);box.appendChild(p);

    if(broker){
      // Einheitlicher Text auf ALLEN Landing Pages – nur das Design variiert.
      h.textContent='Fast geschafft!';
      p.textContent='Um Ihre Bewerbung abzuschließen, wählen Sie bitte jetzt Ihren Termin für das Erstgespräch aus.';
      var pc=document.createElement('div');pc.style.cssText='background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:0 0 22px;';
      if(broker.partner_logo){var lg=document.createElement('img');lg.src=broker.partner_logo;lg.alt=broker.partner_name||'';lg.style.cssText='max-height:36px;margin:0 auto 10px;display:block;';pc.appendChild(lg);}
      var pl=document.createElement('div');pl.textContent='Wir verbinden Sie mit';pl.style.cssText='font-size:13px;color:#475569;margin-bottom:6px;';
      var pn=document.createElement('div');pn.textContent=broker.partner_name||'unserem Partnerunternehmen';pn.style.cssText='font-size:17px;font-weight:700;color:#0f172a;';
      pc.appendChild(pl);pc.appendChild(pn);box.appendChild(pc);
      var hr=document.createElement('hr');hr.style.cssText='border:0;border-top:1px solid #e2e8f0;margin:18px 0;';box.appendChild(hr);
      var nextH=document.createElement('h4');nextH.textContent='Wie geht es jetzt weiter?';nextH.style.cssText='margin:0 0 8px;font-size:17px;font-weight:700;';
      var nextP=document.createElement('p');nextP.textContent='Um den Prozess zu beschleunigen, laden wir Sie herzlich zu einem kurzen Online-Bewerbungsgespräch ein.';nextP.style.cssText='margin:0 0 16px;color:#475569;font-size:14px;line-height:1.55;';
      box.appendChild(nextH);box.appendChild(nextP);
      // Calendly sitzt IMMER vor dem Termin. Kein Portal-/Fallback-Link mehr –
      // fehlt der Calendly-Link, ist die Landing Page falsch konfiguriert.
      var bookHref=broker.calendly_url||'';
      if(bookHref){var cta2=document.createElement('a');cta2.href=bookHref;cta2.target='_blank';cta2.rel='noopener';cta2.textContent='Jetzt Termin buchen  →';
        cta2.style.cssText='display:inline-block;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px;font-size:16px;box-shadow:0 6px 20px -6px rgba(34,197,94,.55);';box.appendChild(cta2);
        var hint2=document.createElement('p');hint2.textContent='Es öffnet sich ein neues Fenster zur Terminauswahl.';hint2.style.cssText='margin:12px 0 0;font-size:12px;color:#94a3b8;';box.appendChild(hint2);}
      else{var hint3=document.createElement('p');hint3.textContent='Die Terminbuchung ist gerade nicht verfügbar. Bitte kontaktieren Sie uns kurz – wir vereinbaren den Termin persönlich mit Ihnen.';hint3.style.cssText='margin:4px 0 0;font-size:13px;color:#64748b;';box.appendChild(hint3);
        try{console.error('[landing] broker.calendly_url fehlt – Landing Page ohne Calendly-Link konfiguriert');}catch(e){}}
    } else if(isFast){
      h.textContent='Fast geschafft!';
      p.textContent='Klicken Sie jetzt auf den Button, um Ihren Termin zu buchen.';
      if(redirectUrl){var gn=document.createElement('button');gn.type='button';gn.textContent='Jetzt zum Portal →';
        gn.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;border:0;padding:14px 18px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:12px;';
        var ri=document.createElement('p');ri.style.cssText='margin:0 0 12px;font-size:13px;color:#64748b;';var sec=10;ri.textContent='Automatische Weiterleitung in '+sec+' Sekunden …';
        box.appendChild(gn);box.appendChild(ri);var go=function(){window.location.href=redirectUrl;};gn.onclick=go;
        var t=setInterval(function(){sec-=1;if(sec<=0){clearInterval(t);go();return;}ri.textContent='Automatische Weiterleitung in '+sec+' Sekunden …';},1000);}
      box.appendChild(spamHintBox(emailStatus));
    } else if(redirectUrl){
      // KI-Interview / sonstige Redirects
      h.textContent='Vielen Dank!';
      p.textContent='Ihre Daten wurden erfolgreich übermittelt.';
      var cta=document.createElement('a');cta.href=redirectUrl;cta.textContent='Weiter  →';
      cta.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;text-align:center;text-decoration:none;font-weight:600;padding:16px 24px;border-radius:10px;font-size:16px;margin-bottom:6px;box-sizing:border-box;';
      box.appendChild(cta);
      box.appendChild(spamHintBox(emailStatus));
    } else {
      h.textContent='Vielen Dank!';
      p.innerHTML=bookingError==='internal_schedule_missing'
        ? 'Wir haben Ihre Daten erfolgreich erhalten. Die Terminwahl ist aktuell nicht verfügbar. Wir senden Ihnen den Termin-Link per E-Mail oder melden uns direkt bei Ihnen.'
        : 'Wir haben Ihre Daten erfolgreich erhalten. Wir melden uns zeitnah per E-Mail oder Telefon bei Ihnen.';
      if(wa){
        var c=document.createElement('div');c.style.cssText='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;text-align:left;';
        c.innerHTML='<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px;">SCHNELLER KONTAKT</div><p style="margin:0 0 12px;font-size:14px;color:#475569;line-height:1.5;">Melden Sie sich bei WhatsApp unter <strong>'+fmtWa(wa)+'</strong>, um auf dem neusten Stand zu bleiben.</p><a href="https://wa.me/'+wa+'?text='+encodeURIComponent('Hallo, ich habe gerade meine Bewerbung abgeschickt.')+'" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:12px 16px;border-radius:8px;font-size:15px;">WhatsApp-Chat starten</a>';
        box.appendChild(c);
      }
    }
    var cb=document.createElement('button');cb.type='button';cb.textContent='Schließen';
    cb.style.cssText='background:#fff;border:1px solid #cbd5e1;color:#0f172a;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;margin-top:6px;';
    cb.onclick=function(){ov.remove();};box.appendChild(cb);ov.appendChild(box);
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});document.body.appendChild(ov);
  }
  // ── Ablauf-Erklärung über dem Formular ────────────────────────────────
  // Bewerber sollen VOR dem Absenden wissen, dass direkt danach ein Termin
  // gewählt wird und das Gespräch online stattfindet.
  function injectProcessSteps(form){
    if(!form || document.getElementById('lv-process-steps')) return;
    var box=document.createElement('div');
    box.id='lv-process-steps';
    box.style.cssText='margin:0 0 18px;padding:16px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;text-align:left;color:#0f172a;font-size:13.5px;line-height:1.55;';
    var steps=[
      ['1','Formular ausfüllen','dauert ca. 2 Minuten'],
      ['2','Termin direkt auswählen','freie Zeiten erscheinen sofort auf dieser Seite'],
      ['3','Interview führen','online über den Link aus Ihrer Calendly-Terminbestätigung, ca. 15 Minuten'],
      ['4','Bei Zusage registrieren','Sie schließen Ihre Anmeldung direkt im Anschluss ab'],
    ];
    var html='<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:10px;">SO LÄUFT ES AB</div>';
    steps.forEach(function(s){
      html+='<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">'
        + '<span style="flex:0 0 22px;height:22px;border-radius:50%;background:#0f172a;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">'+s[0]+'</span>'
        + '<span><strong>'+s[1]+'</strong> – '+s[2]+'</span>'
        + '</div>';
    });
    box.innerHTML=html;
    form.parentNode.insertBefore(box, form);
  }

  // ── DSGVO-Consent + Datenschutz-Kurzfassung ins Formular injizieren ────
  function injectPrivacyBlock(form){
    if(!form || form.querySelector('.lv-privacy-block')) return;
    var submit = form.querySelector('button[type=submit], input[type=submit]');
    if(!submit) return;
    var firm = window.LANDING_FIRMENNAME || 'wir';
    var dsUrl = window.LANDING_DATENSCHUTZ_URL || 'datenschutz.html';
    var mail = window.LANDING_CONTACT_EMAIL || '';
    var wrap = document.createElement('div');
    wrap.className = 'lv-privacy-block';
    wrap.style.cssText = 'margin:14px 0 12px;font-size:13px;line-height:1.55;color:#475569;text-align:left;';
    wrap.innerHTML =
      '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">'
      + '<input type="checkbox" id="lv-dsgvo-consent" required style="margin-top:3px;flex-shrink:0;width:16px;height:16px;accent-color:#0f172a;">'
      + '<span>Ich habe die <a href="'+dsUrl+'" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline;">Datenschutzerklärung</a> zur Kenntnis genommen und willige in die Verarbeitung meiner Daten zum Zweck der Bewerbung ein. Diese Einwilligung kann ich jederzeit widerrufen'
      + (mail?' (per E-Mail an <a href="mailto:'+mail+'" style="color:#2563eb;">'+mail+'</a>)':'')
      + '.</span>'
      + '</label>'
      + '<details style="margin-top:8px;">'
      + '<summary style="cursor:pointer;font-size:12.5px;color:#64748b;padding:4px 2px;">Ihre Daten werden vertraulich behandelt – Details anzeigen</summary>'
      + '<div style="margin-top:8px;padding:10px 12px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:6px;font-size:12.5px;color:#475569;">'
      + '<strong>Verantwortlich:</strong> '+firm+'.<br>'
      + '<strong>Zweck:</strong> Durchführung des Bewerbungsverfahrens (Art. 6 Abs. 1 lit. b DSGVO, § 26 BDSG).<br>'
      + '<strong>Empfänger:</strong> Nur '+firm+' bzw. – bei Vermittlungsprozessen – die von Ihnen zur Weiterleitung freigegebenen Partnerunternehmen.<br>'
      + '<strong>Speicherdauer:</strong> Bis zu 6 Monate nach Abschluss des Verfahrens, danach Löschung.<br>'
      + '<strong>Ihre Rechte:</strong> Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Widerruf – jederzeit'
      + (mail?' an <a href="mailto:'+mail+'" style="color:#2563eb;">'+mail+'</a>':'')+'.'
      + '</div>'
      + '</details>';
    submit.parentNode.insertBefore(wrap, submit);
  }

  document.addEventListener('DOMContentLoaded',function(){
    var form=document.getElementById('application-form');var status=document.getElementById('form-status');if(!form)return;
    injectProcessSteps(form);
    injectPrivacyBlock(form);
    // Theme-eigene Status-Klasse behalten (z. B. ttsb-form-status) und nur den
    // Zustand ergänzen — sonst sind Meldungen im Theme unsichtbar.
    var baseStatusClass=(status&&status.className?status.className:'lv-form-status');
    if(baseStatusClass.indexOf('lv-form-status')===-1)baseStatusClass=(baseStatusClass+' lv-form-status').trim();
    function setStatus(state,text){
      if(!status)return;
      status.className=baseStatusClass+(state?' '+state:'');
      status.style.display='';
      status.textContent=text;
    }
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var consent=form.querySelector('#lv-dsgvo-consent');
      if(consent && !consent.checked){
        setStatus('error','Bitte bestätigen Sie die Datenschutz-Einwilligung, um fortzufahren.');
        try{consent.focus();}catch(_){}
        return;
      }
      setStatus('','Wird gesendet…');
      var raw=Object.fromEntries(new FormData(form).entries());
      var first=(raw.first_name||'').toString().trim();var last=(raw.last_name||'').toString().trim();var street=(raw.street||'').toString().trim();
      var data={first_name:first||null,last_name:last||null,full_name:(first+' '+last).trim(),email:raw.email,phone:raw.phone||null,
        postal_code:raw.postal_code||null,city:raw.city||null,message:street?'Adresse: '+street:null};
      data.domain=(window.location&&window.location.hostname?window.location.hostname:'').replace(/^www\./,'');
      data.flow_type=window.FLOW_TYPE||'classic';
      if(window.TENANT_ID)data.tenant_id=window.TENANT_ID;
      if(window.PORTAL_URL)data.portal_url=window.PORTAL_URL;
      if(window.SOURCE_SLUG)data.source_slug=window.SOURCE_SLUG;
      data.dsgvo_consent=true;
      data.consent_timestamp=new Date().toISOString();
      fetch(window.PORTAL_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){
          return r.text().then(function(txt){
            var body=null;try{body=txt?JSON.parse(txt):null;}catch(_){}
            if(!r.ok){
              var msg='';
              if(body&&body.details&&body.details.fieldErrors){
                var fe=body.details.fieldErrors;var parts=[];
                for(var k in fe){if(Object.prototype.hasOwnProperty.call(fe,k))parts.push(k);}
                if(parts.length)msg='Bitte prüfen Sie diese Felder: '+parts.join(', ')+'.';
              }
              if(!msg&&body&&body.error)msg=String(body.error);
              var err=new Error(msg||('HTTP '+r.status));
              err.userMessage=msg;
              throw err;
            }
            return body||{};
          });
        })
        .then(function(res){form.reset();setStatus('success','Bewerbung erfolgreich gesendet.');
          showModal({fast:(window.FLOW_TYPE||'classic')==='fast',whatsapp:window.WHATSAPP_NUMBER||'',redirectUrl:(res&&res.redirect_url)||'',broker:(res&&res.broker)||null,emailStatus:(res&&res.email_status)||null,bookingError:(res&&res.booking_error)||''});})
        .catch(function(err){
          setStatus('error',(err&&err.userMessage)?err.userMessage:'Da ist etwas schiefgelaufen. Bitte später erneut versuchen.');
          try{status.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}
        });
    });
  });
})();
