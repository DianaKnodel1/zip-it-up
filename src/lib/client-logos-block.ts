// Baut die Auftraggeber-Logoleiste (Fast-Track-Standard).
// Wird sowohl vom ZIP-Generator als auch vom Live-Renderer (über
// /api/public/landing-server-files/client-logos.html) verwendet.

import { CLIENT_LOGOS } from "./client-logos";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

export function buildClientLogosBlock(accent = "#2563eb"): string {
  const slides = CLIENT_LOGOS.map(
    (l) => `<div class="lv-cl-item"><img src="${l.src}" alt="${esc(l.name)}" loading="lazy" /></div>`,
  ).join("");
  const arrow = (dir: string, path: string) =>
    `<button type="button" class="lv-cl-nav lv-cl-${dir}" aria-label="${dir === "prev" ? "Zurück" : "Weiter"}">` +
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="${path}"/></svg></button>`;
  return `
<section class="lv-client-logos" aria-label="Auftraggeber">
  <div class="lv-cl-wrap">
    <div class="lv-cl-eyebrow">Vertrauen von führenden Unternehmen</div>
    <div class="lv-cl-rail-outer">
      ${arrow("prev", "15 18 9 12 15 6")}
      <div class="lv-cl-rail">${slides}${slides}</div>
      ${arrow("next", "9 18 15 12 9 6")}
    </div>
  </div>
</section>
<style>
.lv-client-logos{background:#fff;padding:44px 20px;border-top:1px solid #e9edf3;border-bottom:1px solid #e9edf3;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}
.lv-cl-wrap{max-width:1120px;margin:0 auto;}
.lv-cl-eyebrow{text-align:center;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8;margin-bottom:26px;}
.lv-cl-rail-outer{position:relative;display:flex;align-items:center;gap:8px;}
.lv-cl-rail{display:flex;gap:44px;align-items:center;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:4px 8px;}
.lv-cl-rail::-webkit-scrollbar{display:none;}
.lv-cl-item{flex:0 0 auto;height:44px;display:flex;align-items:center;}
.lv-cl-item img{height:100%;max-width:170px;object-fit:contain;filter:grayscale(1);opacity:.62;transition:filter .2s ease,opacity .2s ease;}
.lv-cl-item img:hover{filter:none;opacity:1;}
.lv-cl-nav{flex:0 0 auto;width:36px;height:36px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:${accent};display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px -4px rgba(15,23,42,.35);}
.lv-cl-nav:hover{border-color:${accent};}
@media(max-width:640px){.lv-cl-nav{display:none;}.lv-cl-rail{gap:28px;}.lv-cl-item{height:34px;}}
</style>
<script>
(function(){
  var rail=document.querySelector('.lv-cl-rail');if(!rail)return;
  var half=function(){return rail.scrollWidth/2;};
  var step=200,paused=false;
  var p=document.querySelector('.lv-cl-prev'),n=document.querySelector('.lv-cl-next');
  if(p)p.onclick=function(){paused=true;rail.scrollLeft-=step*2;};
  if(n)n.onclick=function(){paused=true;rail.scrollLeft+=step*2;};
  rail.addEventListener('pointerdown',function(){paused=true;});
  setInterval(function(){
    if(paused)return;
    rail.scrollLeft+=1;
    if(rail.scrollLeft>=half())rail.scrollLeft-=half();
  },28);
})();
</script>`;
}
