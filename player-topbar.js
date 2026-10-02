/* DT Music Scores - top performance player layout (v2026.10.03.1)
   Keeps the backing-track controls above the score without blocking the UI. */
(() => {
  'use strict';

  function el(id){ return document.getElementById(id); }
  let applyQueued=false;

  function injectStyles(){
    if(el('dtmsTopbarPlayerStyles')) return;
    const style=document.createElement('style');
    style.id='dtmsTopbarPlayerStyles';
    style.textContent=`
      .setlist-viewer-bar.dtms-performance-topbar{
        height:auto!important;
        min-height:64px;
        display:grid!important;
        grid-template-columns:minmax(180px,240px) minmax(0,1fr) auto;
        align-items:center;
        gap:14px;
        padding:8px 14px!important;
      }
      .setlist-viewer-bar.dtms-performance-topbar > :first-child{min-width:0}
      .setlist-viewer-bar.dtms-performance-topbar > :first-child strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

      .floating-track-player.dtms-topbar-player{
        position:static!important;
        inset:auto!important;
        left:auto!important;
        right:auto!important;
        top:auto!important;
        bottom:auto!important;
        transform:none!important;
        width:100%!important;
        max-width:none!important;
        padding:0!important;
        margin:0!important;
        background:transparent!important;
        border:0!important;
        border-radius:0!important;
        box-shadow:none!important;
        backdrop-filter:none!important;
        -webkit-backdrop-filter:none!important;
        display:grid!important;
        grid-template-columns:120px minmax(180px,1.15fr) minmax(280px,1.55fr) minmax(215px,.95fr) 150px;
        align-items:center;
        gap:8px;
      }
      .floating-track-player.dtms-topbar-player .track-player-drag{
        margin:0!important;
        padding:0 4px!important;
        cursor:default!important;
        touch-action:auto!important;
        color:var(--accent2);
        white-space:nowrap;
        pointer-events:none;
      }
      .floating-track-player.dtms-topbar-player .track-player-drag > .small,
      .floating-track-player.dtms-topbar-player .dtms-player-tools,
      .floating-track-player.dtms-topbar-player .dtms-mini-song,
      .floating-track-player.dtms-topbar-player #dtmsPlayerMinBtn{
        display:none!important;
      }
      .floating-track-player.dtms-topbar-player #viewerSongSelect{margin:0!important;min-width:0}
      .floating-track-player.dtms-topbar-player #viewerTrackName{display:none!important}
      .floating-track-player.dtms-topbar-player #viewerAudio{width:100%!important;height:38px!important;margin:0!important}
      .floating-track-player.dtms-topbar-player .dtms-scroll-row{
        margin:0!important;
        padding:0!important;
        border-top:0!important;
        grid-template-columns:auto minmax(110px,1fr) auto!important;
        gap:6px!important;
      }
      .floating-track-player.dtms-topbar-player .dtms-scroll-state{font-size:10px!important;line-height:1.15!important}
      .floating-track-player.dtms-topbar-player .track-nav-row{margin:0!important;display:grid!important;grid-template-columns:1fr 1fr;gap:6px!important}
      .floating-track-player.dtms-topbar-player .track-nav-row button{min-width:0!important;padding:7px 6px!important}
      .floating-track-player.dtms-topbar-player.dtms-minimized{
        width:100%!important;
        padding:0!important;
      }
      .floating-track-player.dtms-topbar-player.dtms-minimized #viewerSongSelect,
      .floating-track-player.dtms-topbar-player.dtms-minimized #viewerAudio,
      .floating-track-player.dtms-topbar-player.dtms-minimized .track-nav-row,
      .floating-track-player.dtms-topbar-player.dtms-minimized .dtms-scroll-row{
        display:revert!important;
      }
      .setlist-pdf-scroll{padding-top:8px!important}

      @media(max-width:1350px){
        .setlist-viewer-bar.dtms-performance-topbar{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px}
        .floating-track-player.dtms-topbar-player{grid-column:1/-1;grid-row:2;grid-template-columns:110px minmax(160px,1fr) minmax(240px,1.4fr) minmax(210px,1fr) 150px}
      }
      @media(max-width:900px){
        .floating-track-player.dtms-topbar-player{grid-template-columns:100px minmax(150px,1fr) minmax(220px,1.5fr)}
        .floating-track-player.dtms-topbar-player .dtms-scroll-row{grid-column:1/3}
        .floating-track-player.dtms-topbar-player .track-nav-row{grid-column:3}
      }
      @media(max-width:650px){
        .setlist-viewer-bar.dtms-performance-topbar{padding:7px 8px!important}
        .floating-track-player.dtms-topbar-player{grid-template-columns:1fr 1fr;gap:6px}
        .floating-track-player.dtms-topbar-player .track-player-drag{grid-column:1/-1;display:none!important}
        .floating-track-player.dtms-topbar-player #viewerSongSelect{grid-column:1/-1}
        .floating-track-player.dtms-topbar-player #viewerAudio{grid-column:1/-1}
        .floating-track-player.dtms-topbar-player .dtms-scroll-row{grid-column:1/-1}
        .floating-track-player.dtms-topbar-player .track-nav-row{grid-column:1/-1}
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeHandle(handle){
    if(!handle) return;
    if(handle.dataset.ready!=='topbar') handle.dataset.ready='topbar';
    for(const node of [...handle.childNodes]){
      if(node.nodeType===Node.TEXT_NODE && /Backing Track/i.test(node.textContent||'')){
        if(node.textContent!=='Backing Track ') node.textContent='Backing Track ';
        break;
      }
    }
  }

  function applyTopbarLayout(){
    injectStyles();
    const viewer=el('setlistViewer');
    const player=el('floatingTrackPlayer');
    if(!viewer||!player) return false;
    const bar=viewer.querySelector('.setlist-viewer-bar');
    if(!bar) return false;

    if(!bar.classList.contains('dtms-performance-topbar')) bar.classList.add('dtms-performance-topbar');
    if(!player.classList.contains('dtms-topbar-player')) player.classList.add('dtms-topbar-player');
    if(player.classList.contains('dtms-minimized')) player.classList.remove('dtms-minimized');
    if(player.style.left) player.style.left='';
    if(player.style.right) player.style.right='';
    if(player.style.top) player.style.top='';
    if(player.style.bottom) player.style.bottom='';

    const close=[...bar.querySelectorAll('button')].find(btn=>/close/i.test(btn.textContent||''));
    if(player.parentElement!==bar){
      if(close) bar.insertBefore(player,close);
      else bar.appendChild(player);
    }else if(close && player.nextElementSibling!==close){
      bar.insertBefore(player,close);
    }

    normalizeHandle(el('trackPlayerDragHandle'));
    const min=el('dtmsPlayerMinBtn');
    if(min && !min.hidden) min.hidden=true;

    const version=el('appVersion');
    if(version && version.textContent!=='v2026.10.03.1') version.textContent='v2026.10.03.1';
    return true;
  }

  function queueApply(){
    if(applyQueued) return;
    applyQueued=true;
    requestAnimationFrame(()=>{
      applyQueued=false;
      applyTopbarLayout();
    });
  }

  function init(){
    applyTopbarLayout();
    // Only watch for newly inserted controls. Watching class/style mutations caused a feedback loop on some tablets.
    const observer=new MutationObserver(queueApply);
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',queueApply,{passive:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
