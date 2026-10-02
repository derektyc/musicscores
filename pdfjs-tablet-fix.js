/* DT Music Scores - Open Setlist renderer (v2026.10.02.4)
   PDF.js canvas viewer + minimizable player + Automatic / Calibrated / Off score following. */
(() => {
  'use strict';

  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MANUAL_SCROLL_HOLD_MS = 7000;

  let dtmsViewerPdfBytes = null;
  let dtmsViewerPdfDoc = null;
  let dtmsRenderGeneration = 0;
  let dtmsRenderWidth = 0;
  let dtmsResizeTimer = null;
  let dtmsAutoScrollRaf = 0;
  let dtmsAutoScrollHoldUntil = 0;
  let dtmsPlayerMinimized = false;
  let dtmsLastTarget = null;

  function el(id){ return document.getElementById(id); }
  function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }
  function currentSong(){ return viewerSongs?.[viewerSongIndex] || null; }
  function currentScore(){
    const song = currentSong();
    return song ? library.find(x => x.id===song.scoreId) : null;
  }
  function scrollSettingsFor(song=currentSong()){
    if(!song) return {mode:'automatic',timings:[]};
    const score = library.find(x => x.id===song.scoreId);
    const raw = score?.scrollSettings || {};
    const mode = ['automatic','calibrated','off'].includes(raw.mode) ? raw.mode : 'automatic';
    return {mode,timings:Array.isArray(raw.timings)?raw.timings:[]};
  }
  async function saveScrollSettings(patch){
    const score = currentScore();
    if(!score) return;
    const prev = score.scrollSettings || {};
    score.scrollSettings = {
      mode:['automatic','calibrated','off'].includes(patch.mode) ? patch.mode : (['automatic','calibrated','off'].includes(prev.mode)?prev.mode:'automatic'),
      timings:Array.isArray(patch.timings) ? patch.timings : (Array.isArray(prev.timings)?prev.timings:[])
    };
    try{ await saveLocalState(); }catch(error){ console.error(error); }
  }

  function injectViewerStyles(){
    if(el('dtmsPdfJsTabletStyles')) return;
    const style = document.createElement('style');
    style.id = 'dtmsPdfJsTabletStyles';
    style.textContent = `
      .setlist-pdf-scroll{position:relative;flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:#20242a;padding:14px 10px 120px;scroll-behavior:auto}
      .setlist-pdf-pages{width:100%;display:flex;flex-direction:column;align-items:center;gap:14px}
      .setlist-pdf-page{position:relative;display:flex;justify-content:center;width:100%;scroll-margin-top:12px}
      .setlist-pdf-page canvas{display:block;max-width:100%;height:auto;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.35)}
      .setlist-pdf-status{position:sticky;top:8px;z-index:2;width:max-content;max-width:calc(100% - 16px);margin:0 auto 10px;padding:7px 10px;border-radius:999px;background:rgba(18,22,29,.9);border:1px solid #3b4655;color:#98a5b5;font-size:12px;backdrop-filter:blur(8px)}
      .setlist-pdf-status[hidden]{display:none!important}

      .dtms-player-tools{margin-left:auto;display:flex;align-items:center;gap:6px}
      .dtms-player-tools button{width:32px;height:28px;padding:0;border-radius:8px;background:#252c36;color:#f5f7fa;border:1px solid #3b4655;line-height:1}
      .dtms-mini-song{display:none;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5f7fa;font-size:12px;font-weight:700}

      .dtms-scroll-row{display:grid;grid-template-columns:auto minmax(120px,1fr) auto;align-items:center;gap:7px;margin:7px 2px 0;padding-top:7px;border-top:1px solid #313946;color:#98a5b5;font-size:12px}
      .dtms-scroll-row select{padding:7px 8px;margin:0;min-width:0}
      .dtms-scroll-row button{padding:7px 9px;white-space:nowrap}
      .dtms-scroll-state{grid-column:1/-1;color:#ffd77a;font-size:11px;min-height:14px}

      .dtms-calibration[hidden]{display:none!important}
      .dtms-calibration{position:fixed;inset:0;z-index:5400;background:rgba(5,7,10,.78);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(5px)}
      .dtms-calibration-card{width:min(620px,100%);max-height:min(760px,90vh);display:flex;flex-direction:column;background:#171b22;border:1px solid #3b4655;border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.55);overflow:hidden}
      .dtms-calibration-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid #313946}
      .dtms-calibration-head h3{margin:0 0 4px;font-size:16px}.dtms-calibration-head p{margin:0;color:#98a5b5;font-size:12px}
      .dtms-calibration-list{padding:12px 16px;overflow:auto;display:flex;flex-direction:column;gap:8px}
      .dtms-calibration-page{display:grid;grid-template-columns:74px minmax(90px,1fr) auto;align-items:center;gap:8px}
      .dtms-calibration-page input{padding:8px 9px}
      .dtms-calibration-page button{padding:8px 10px}
      .dtms-calibration-actions{padding:12px 16px;border-top:1px solid #313946;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .dtms-calibration-note{padding:0 16px 10px;color:#98a5b5;font-size:11px}

      .floating-track-player.dtms-minimized{width:min(320px,calc(100vw - 16px));padding:7px 9px}
      .floating-track-player.dtms-minimized #viewerSongSelect,
      .floating-track-player.dtms-minimized #viewerTrackName,
      .floating-track-player.dtms-minimized #viewerAudio,
      .floating-track-player.dtms-minimized .track-nav-row,
      .floating-track-player.dtms-minimized .dtms-scroll-row{display:none!important}
      .floating-track-player.dtms-minimized .track-player-drag{padding:2px 0;gap:7px}
      .floating-track-player.dtms-minimized .track-player-drag > .small{display:none!important}
      .floating-track-player.dtms-minimized .dtms-mini-song{display:block}

      @media(max-width:650px){
        .setlist-pdf-scroll{padding:8px 4px 120px}.setlist-pdf-pages{gap:8px}
        .floating-track-player.dtms-minimized{width:min(300px,calc(100vw - 16px))}
        .dtms-scroll-row{grid-template-columns:1fr 1.25fr}.dtms-scroll-row>span:first-child{display:none}.dtms-scroll-row button{grid-column:1/-1}
        .dtms-calibration{padding:8px}.dtms-calibration-page{grid-template-columns:60px minmax(75px,1fr) auto}
      }
    `;
    document.head.appendChild(style);
  }

  function removeOldPitchUi(){
    ['dtmsTransposeRow','dtmsTransposeStyles'].forEach(id => el(id)?.remove());
  }

  function prepareViewerDom(){
    injectViewerStyles();
    removeOldPitchUi();
    setupPlayerEnhancements();
    if(el('setlistPdfScroll')) return;
    const frame = el('setlistPdfFrame');
    if(!frame) return;
    const scroll = document.createElement('div');
    scroll.id = 'setlistPdfScroll';
    scroll.className = 'setlist-pdf-scroll';
    scroll.setAttribute('aria-label','Combined setlist PDF');
    scroll.innerHTML = '<div id="setlistPdfStatus" class="setlist-pdf-status" hidden>Preparing score…</div><div id="setlistPdfPages" class="setlist-pdf-pages"></div>';
    frame.replaceWith(scroll);

    const hold = () => { dtmsAutoScrollHoldUntil = performance.now() + MANUAL_SCROLL_HOLD_MS; updateScrollState(); };
    scroll.addEventListener('pointerdown',hold,{passive:true});
    scroll.addEventListener('touchstart',hold,{passive:true});
    scroll.addEventListener('wheel',hold,{passive:true});
  }

  function setStatus(text=''){
    const status = el('setlistPdfStatus');
    if(!status) return;
    status.textContent = text;
    status.hidden = !text;
  }

  function loadPdfJs(){
    if(window.pdfjsLib?.getDocument){ window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL; return Promise.resolve(window.pdfjsLib); }
    if(window.__dtmsPdfJsLoading) return window.__dtmsPdfJsLoading;
    window.__dtmsPdfJsLoading = new Promise((resolve,reject) => {
      const script=document.createElement('script');
      script.src=PDFJS_URL;script.async=true;
      script.onload=()=>{ if(!window.pdfjsLib?.getDocument) return reject(new Error('PDF.js loaded but did not initialise.')); window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL; resolve(window.pdfjsLib); };
      script.onerror=()=>reject(new Error('PDF.js could not be loaded. Open the app online once, then try again.'));
      document.head.appendChild(script);
    });
    return window.__dtmsPdfJsLoading;
  }

  function pageTop(pageNumber){
    const page=el(`setlistPdfPage-${pageNumber}`),scroller=el('setlistPdfScroll');
    if(!page||!scroller)return null;
    const sr=scroller.getBoundingClientRect();
    return page.getBoundingClientRect().top-sr.top+scroller.scrollTop;
  }
  function jumpToPage(pageNumber,behavior='smooth'){
    const scroller=el('setlistPdfScroll'),top=pageTop(Math.max(1,Number(pageNumber)||1));
    if(!scroller||top===null)return false;
    const target=Math.max(0,top-8);
    if(behavior==='smooth'){ try{scroller.scrollTo({top:target,behavior:'smooth'});}catch(_){scroller.scrollTop=target;} }
    else scroller.scrollTop=target;
    dtmsLastTarget=target;
    return true;
  }

  function easeInOut(t){ t=clamp(t,0,1); return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; }
  function pageFollowTarget(song,pageIndex,localProgress){
    const scroller=el('setlistPdfScroll');
    if(!song||!scroller)return null;
    const pageNumber=song.startPage+pageIndex;
    const page=el(`setlistPdfPage-${pageNumber}`);
    if(!page)return null;
    const sr=scroller.getBoundingClientRect(),pr=page.getBoundingClientRect();
    const maxScroll=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
    const pTop=pr.top-sr.top+scroller.scrollTop;
    const pBottom=pr.bottom-sr.top+scroller.scrollTop;
    const start=clamp(pTop-8,0,maxScroll);
    const readableEnd=clamp(Math.max(start,pBottom-scroller.clientHeight*.70),start,maxScroll);

    const moveProgress=easeInOut(clamp((localProgress-.12)/.68,0,1));
    let target=start+(readableEnd-start)*moveProgress;

    if(localProgress>.78 && pageIndex<song.pageCount-1){
      const next=el(`setlistPdfPage-${pageNumber+1}`);
      if(next){
        const nr=next.getBoundingClientRect();
        const nextTop=clamp(nr.top-sr.top+scroller.scrollTop-scroller.clientHeight*.12,0,maxScroll);
        const reveal=easeInOut(clamp((localProgress-.78)/.22,0,1));
        target=target+(nextTop-target)*reveal;
      }
    }
    return clamp(target,0,maxScroll);
  }

  function validCalibratedTimings(song,pref){
    const n=Math.max(1,Number(song?.pageCount)||1),timings=pref?.timings;
    if(!Array.isArray(timings)||timings.length<n)return false;
    let last=-1;
    for(let i=0;i<n;i++){
      const t=Number(timings[i]);
      if(!Number.isFinite(t)||t<0||t<=last)return false;
      last=t;
    }
    return true;
  }

  function targetForAutomatic(song,audio){
    const duration=audio.duration;
    if(!Number.isFinite(duration)||duration<=0)return null;
    const count=Math.max(1,Number(song.pageCount)||1);
    const startDelay=clamp(duration*.06,3,8);
    const endPad=clamp(duration*.04,2,6);
    const active=Math.max(1,duration-startDelay-endPad);
    const progress=clamp((audio.currentTime-startDelay)/active,0,1);
    const pos=progress*count;
    const pageIndex=Math.min(count-1,Math.floor(pos));
    const local=pageIndex===count-1&&progress>=1?1:clamp(pos-pageIndex,0,1);
    return pageFollowTarget(song,pageIndex,local);
  }

  function targetForCalibrated(song,audio,pref){
    if(!validCalibratedTimings(song,pref))return null;
    const timings=pref.timings.map(Number),count=Math.max(1,Number(song.pageCount)||1),t=audio.currentTime;
    let pageIndex=0;
    for(let i=1;i<count;i++){ if(t>=timings[i])pageIndex=i; else break; }
    const start=timings[pageIndex];
    const end=pageIndex<count-1?timings[pageIndex+1]:audio.duration;
    const local=Number.isFinite(end)&&end>start?clamp((t-start)/(end-start),0,1):0;
    return pageFollowTarget(song,pageIndex,local);
  }

  function updateScrollState(){
    const song=currentSong(),pref=scrollSettingsFor(song),state=el('dtmsAutoScrollState'),mode=el('dtmsScrollMode'),edit=el('dtmsEditTimings'),audio=el('viewerAudio');
    if(mode)mode.value=pref.mode;
    if(edit)edit.hidden=pref.mode!=='calibrated';
    if(!state)return;
    if(pref.mode==='off')state.textContent='Scrolling off';
    else if(!song?.trackId)state.textContent='Attach a backing track to use scrolling';
    else if(pref.mode==='calibrated'&&!validCalibratedTimings(song,pref))state.textContent='Calibrated mode: set page timings';
    else if(performance.now()<dtmsAutoScrollHoldUntil)state.textContent='Manual scroll — auto follow resumes shortly';
    else if(!audio||!Number.isFinite(audio.duration)||audio.duration<=0)state.textContent=pref.mode==='automatic'?'Automatic ready':'Calibrated ready';
    else state.textContent=audio.paused?(pref.mode==='automatic'?'Automatic ready':'Calibrated ready'):(pref.mode==='automatic'?'Automatic following':'Calibrated following');
  }

  function stopAutoScrollLoop(){ if(dtmsAutoScrollRaf){cancelAnimationFrame(dtmsAutoScrollRaf);dtmsAutoScrollRaf=0;} updateScrollState(); }
  function syncScrollToAudio({force=false,immediate=false}={}){
    const song=currentSong(),audio=el('viewerAudio'),scroller=el('setlistPdfScroll');
    if(!song||!audio||!scroller||!song.trackId)return;
    const pref=scrollSettingsFor(song);
    if(pref.mode==='off')return;
    if(!Number.isFinite(audio.duration)||audio.duration<=0)return;
    if(!force&&performance.now()<dtmsAutoScrollHoldUntil)return;

    const target=pref.mode==='calibrated'?targetForCalibrated(song,audio,pref):targetForAutomatic(song,audio);
    if(target===null||!Number.isFinite(target))return;
    const diff=target-scroller.scrollTop;
    if(immediate||Math.abs(diff)>scroller.clientHeight*2.25)scroller.scrollTop=target;
    else{
      const factor=Math.abs(diff)>scroller.clientHeight*.8?.14:.085;
      scroller.scrollTop+=diff*factor;
    }
    dtmsLastTarget=target;
  }
  function startAutoScrollLoop(){
    stopAutoScrollLoop();
    const audio=el('viewerAudio');
    if(!audio||audio.paused)return;
    const tick=()=>{
      dtmsAutoScrollRaf=0;
      if(audio.paused||audio.ended)return updateScrollState();
      syncScrollToAudio({force:false,immediate:false});
      dtmsAutoScrollRaf=requestAnimationFrame(tick);
    };
    updateScrollState();
    dtmsAutoScrollRaf=requestAnimationFrame(tick);
  }

  function formatTime(seconds){
    const s=Math.max(0,Math.round(Number(seconds)||0)),m=Math.floor(s/60),r=s%60;
    return `${m}:${String(r).padStart(2,'0')}`;
  }
  function parseTime(value){
    const text=String(value||'').trim();
    if(!text)return NaN;
    if(/^\d+(?:\.\d+)?$/.test(text))return Number(text);
    const parts=text.split(':').map(Number);
    if(parts.some(x=>!Number.isFinite(x)))return NaN;
    if(parts.length===2)return parts[0]*60+parts[1];
    if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
    return NaN;
  }

  function ensureCalibrationModal(){
    if(el('dtmsCalibrationModal'))return;
    const modal=document.createElement('div');
    modal.id='dtmsCalibrationModal';modal.className='dtms-calibration';modal.hidden=true;
    modal.innerHTML=`<div class="dtms-calibration-card">
      <div class="dtms-calibration-head"><div><h3 id="dtmsCalibrationTitle">Calibrate scrolling</h3><p>Set the time each PDF page begins in the backing track.</p></div><button class="secondary" id="dtmsCalibrationClose" type="button">Close</button></div>
      <div id="dtmsCalibrationList" class="dtms-calibration-list"></div>
      <div class="dtms-calibration-note">Tip: play the track, pause at the start of a page, then tap “Use current”. Page times must increase from top to bottom.</div>
      <div class="dtms-calibration-actions"><button class="secondary" id="dtmsCalibrationEstimate" type="button">Estimate timings</button><button class="primary" id="dtmsCalibrationSave" type="button">Save timings</button></div>
    </div>`;
    document.body.appendChild(modal);
    el('dtmsCalibrationClose').onclick=()=>{modal.hidden=true;};
    modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true;});
    el('dtmsCalibrationEstimate').onclick=()=>{
      const song=currentSong(),audio=el('viewerAudio');if(!song)return;
      const n=Math.max(1,Number(song.pageCount)||1),duration=Number(audio?.duration)||0;
      if(!duration)return alert('Play or load the backing track first so its duration is available.');
      const startDelay=clamp(duration*.06,3,8),usable=Math.max(1,duration-startDelay-clamp(duration*.04,2,6));
      [...el('dtmsCalibrationList').querySelectorAll('input')].forEach((input,i)=>{input.value=formatTime(i===0?0:startDelay+usable*(i/n));});
    };
    el('dtmsCalibrationSave').onclick=async()=>{
      const song=currentSong();if(!song)return;
      const values=[...el('dtmsCalibrationList').querySelectorAll('input')].map(x=>parseTime(x.value));
      let last=-1;
      for(let i=0;i<values.length;i++){
        if(!Number.isFinite(values[i])||values[i]<0||values[i]<=last)return alert(`Page ${i+1} needs a valid time later than the previous page.`);
        last=values[i];
      }
      await saveScrollSettings({mode:'calibrated',timings:values});
      modal.hidden=true;updateScrollControls();syncScrollToAudio({force:true,immediate:false});
    };
  }

  function openCalibration(){
    const song=currentSong();if(!song)return;
    ensureCalibrationModal();
    const modal=el('dtmsCalibrationModal'),list=el('dtmsCalibrationList'),audio=el('viewerAudio'),pref=scrollSettingsFor(song),n=Math.max(1,Number(song.pageCount)||1);
    el('dtmsCalibrationTitle').textContent=`Calibrate: ${song.name}`;
    list.innerHTML='';
    for(let i=0;i<n;i++){
      const row=document.createElement('div');row.className='dtms-calibration-page';
      const stored=Number(pref.timings?.[i]);
      row.innerHTML=`<strong>Page ${i+1}</strong><input type="text" inputmode="numeric" placeholder="${i===0?'0:00':'m:ss'}" value="${Number.isFinite(stored)?formatTime(stored):(i===0?'0:00':'')}"><button class="secondary" type="button">Use current</button>`;
      row.querySelector('button').onclick=()=>{row.querySelector('input').value=formatTime(Number(audio?.currentTime)||0);};
      list.appendChild(row);
    }
    modal.hidden=false;
  }

  function updateScrollControls(){
    const pref=scrollSettingsFor(),mode=el('dtmsScrollMode'),edit=el('dtmsEditTimings');
    if(mode)mode.value=pref.mode;
    if(edit)edit.hidden=pref.mode!=='calibrated';
    updateScrollState();
  }

  function toggleMiniPlay(event){
    event?.stopPropagation?.();const audio=el('viewerAudio');if(!audio||!audio.src)return;
    if(audio.paused)audio.play().catch(()=>{});else audio.pause();
  }
  function updateMiniPlayerText(){
    const miniSong=el('dtmsMiniSong'),miniPlay=el('dtmsMiniPlayBtn'),song=currentSong(),audio=el('viewerAudio');
    if(miniSong)miniSong.textContent=song?.name||'Backing Track';
    if(miniPlay)miniPlay.textContent=audio&&!audio.paused?'❚❚':'▶';
  }
  function clampPlayerIntoViewport(){
    const player=el('floatingTrackPlayer');if(!player)return;
    const rect=player.getBoundingClientRect(),maxLeft=Math.max(4,innerWidth-player.offsetWidth-4),maxTop=Math.max(58,innerHeight-player.offsetHeight-4);
    if(player.style.left){player.style.left=`${clamp(rect.left,4,maxLeft)}px`;player.style.top=`${clamp(rect.top,58,maxTop)}px`;}
  }
  function setPlayerMinimized(minimized){
    dtmsPlayerMinimized=!!minimized;const player=el('floatingTrackPlayer'),btn=el('dtmsPlayerMinBtn');
    if(player)player.classList.toggle('dtms-minimized',dtmsPlayerMinimized);
    if(btn){btn.textContent=dtmsPlayerMinimized?'▢':'—';btn.title=dtmsPlayerMinimized?'Expand player':'Minimize player';btn.setAttribute('aria-label',btn.title);}
    updateMiniPlayerText();requestAnimationFrame(clampPlayerIntoViewport);
  }

  function setupPlayerEnhancements(){
    const player=el('floatingTrackPlayer'),handle=el('trackPlayerDragHandle');if(!player||!handle)return;
    removeOldPitchUi();
    if(!el('dtmsPlayerMinBtn')){
      const tools=document.createElement('span');tools.className='dtms-player-tools';
      const miniSong=document.createElement('span');miniSong.id='dtmsMiniSong';miniSong.className='dtms-mini-song';
      const play=document.createElement('button');play.id='dtmsMiniPlayBtn';play.type='button';play.textContent='▶';play.title='Play / pause';
      const min=document.createElement('button');min.id='dtmsPlayerMinBtn';min.type='button';min.textContent='—';min.title='Minimize player';
      tools.append(play,min);const small=handle.querySelector('.small');if(small)handle.insertBefore(miniSong,small);else handle.appendChild(miniSong);handle.appendChild(tools);
      [play,min].forEach(button=>{button.addEventListener('pointerdown',e=>e.stopPropagation());button.addEventListener('click',e=>e.stopPropagation());});
      play.addEventListener('click',toggleMiniPlay);min.addEventListener('click',()=>setPlayerMinimized(!dtmsPlayerMinimized));
    }

    if(!el('dtmsScrollRow')){
      const row=document.createElement('div');row.id='dtmsScrollRow';row.className='dtms-scroll-row';
      row.innerHTML=`<span>Scroll</span><select id="dtmsScrollMode"><option value="automatic">Automatic</option><option value="calibrated">Calibrated</option><option value="off">Off</option></select><button id="dtmsEditTimings" class="secondary" type="button" hidden>Edit timings</button><span id="dtmsAutoScrollState" class="dtms-scroll-state">Automatic ready</span>`;
      const nav=player.querySelector('.track-nav-row');if(nav)player.insertBefore(row,nav);else player.appendChild(row);
      el('dtmsScrollMode').addEventListener('change',async e=>{
        const mode=e.target.value;await saveScrollSettings({mode});updateScrollControls();
        if(mode==='calibrated'&&!validCalibratedTimings(currentSong(),scrollSettingsFor()))openCalibration();
        if(mode==='off')stopAutoScrollLoop();else{syncScrollToAudio({force:true,immediate:false});startAutoScrollLoop();}
      });
      el('dtmsEditTimings').addEventListener('click',openCalibration);
      [el('dtmsScrollMode'),el('dtmsEditTimings')].filter(Boolean).forEach(node=>node.addEventListener('pointerdown',e=>e.stopPropagation()));
    }

    ensureCalibrationModal();
    const audio=el('viewerAudio');
    if(audio&&!audio.dataset.dtmsEnhancedV4){
      audio.dataset.dtmsEnhancedV4='1';
      audio.addEventListener('play',()=>{updateMiniPlayerText();syncScrollToAudio({force:true,immediate:false});startAutoScrollLoop();});
      audio.addEventListener('pause',()=>{updateMiniPlayerText();stopAutoScrollLoop();});
      audio.addEventListener('ended',()=>{syncScrollToAudio({force:true,immediate:false});updateMiniPlayerText();stopAutoScrollLoop();});
      audio.addEventListener('loadedmetadata',()=>{updateScrollControls();syncScrollToAudio({force:true,immediate:false});});
      audio.addEventListener('seeked',()=>syncScrollToAudio({force:true,immediate:false}));
      audio.addEventListener('timeupdate',()=>{if(audio.paused)syncScrollToAudio({force:true,immediate:false});});
    }
    setPlayerMinimized(dtmsPlayerMinimized);updateScrollControls();
  }

  async function renderCombinedPdf(bytes=dtmsViewerPdfBytes,{preserveSong=true}={}){
    prepareViewerDom();const pagesBox=el('setlistPdfPages'),scroller=el('setlistPdfScroll');
    if(!pagesBox||!scroller)throw new Error('The setlist PDF viewer could not be created.');
    if(!bytes?.length)throw new Error('The combined setlist PDF is empty.');
    const pdfjs=await loadPdfJs(),generation=++dtmsRenderGeneration,targetPage=preserveSong?(currentSong()?.startPage||1):1;
    pagesBox.innerHTML='';setStatus('Loading score…');
    if(dtmsViewerPdfDoc){try{await dtmsViewerPdfDoc.destroy();}catch(_){}dtmsViewerPdfDoc=null;}
    const task=pdfjs.getDocument({data:bytes.slice()}),doc=await task.promise;
    if(generation!==dtmsRenderGeneration){try{await doc.destroy();}catch(_){}return;}
    dtmsViewerPdfDoc=doc;const available=Math.max(280,Math.min(1200,scroller.clientWidth-20));dtmsRenderWidth=scroller.clientWidth;
    for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
      if(generation!==dtmsRenderGeneration)return;setStatus(`Rendering page ${pageNumber} of ${doc.numPages}…`);
      const page=await doc.getPage(pageNumber),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:available/base.width}),dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
      const wrap=document.createElement('div'),canvas=document.createElement('canvas'),context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('This browser could not create the PDF canvas.');
      wrap.className='setlist-pdf-page';wrap.id=`setlistPdfPage-${pageNumber}`;wrap.dataset.page=String(pageNumber);
      canvas.width=Math.max(1,Math.floor(viewport.width*dpr));canvas.height=Math.max(1,Math.floor(viewport.height*dpr));canvas.style.width=`${Math.floor(viewport.width)}px`;canvas.style.height=`${Math.floor(viewport.height)}px`;wrap.appendChild(canvas);pagesBox.appendChild(wrap);
      await page.render({canvasContext:context,viewport,transform:dpr===1?null:[dpr,0,0,dpr,0,0]}).promise;
    }
    if(generation!==dtmsRenderGeneration)return;setStatus('');jumpToPage(targetPage,'auto');syncScrollToAudio({force:true,immediate:true});
  }

  function scheduleRerender(){
    const viewer=el('setlistViewer'),scroller=el('setlistPdfScroll');if(!viewer||viewer.hidden||!dtmsViewerPdfBytes||!scroller)return;
    clearTimeout(dtmsResizeTimer);dtmsResizeTimer=setTimeout(()=>{clampPlayerIntoViewport();if(Math.abs(scroller.clientWidth-dtmsRenderWidth)>40)renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:true}).catch(console.error);},260);
  }

  window.selectViewerSong=async function(index,jumpPdf=true){
    stopAutoScrollLoop();if(!viewerSongs.length)return;
    viewerSongIndex=Math.max(0,Math.min(viewerSongs.length-1,Number(index)||0));const song=currentSong(),select=el('viewerSongSelect'),audio=el('viewerAudio'),label=el('viewerTrackName');
    if(select)select.value=String(viewerSongIndex);if(jumpPdf)jumpToPage(song.startPage,'smooth');
    if(viewerAudioUrl){URL.revokeObjectURL(viewerAudioUrl);viewerAudioUrl='';}if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
    updateMiniPlayerText();updateScrollControls();
    if(!song.trackId){if(label)label.textContent='No backing track attached';return;}
    const track=library.find(x=>x.id===song.trackId&&isAudioFile(x));if(!track){if(label)label.textContent='Backing track is missing';return;}
    const blob=await getLibraryBlob(track.id);if(!blob){if(label)label.textContent='Backing track is not available offline yet';return;}
    viewerAudioUrl=URL.createObjectURL(blob);if(audio){audio.src=viewerAudioUrl;audio.load();}if(label)label.textContent=track.name;updateMiniPlayerText();updateScrollControls();
  };
  window.viewerMoveSong=function(delta){if(!viewerSongs.length)return;return window.selectViewerSong(Math.max(0,Math.min(viewerSongs.length-1,viewerSongIndex+delta)),true);};
  window.closeSetlistViewer=function(){
    stopAutoScrollLoop();const viewer=el('setlistViewer'),audio=el('viewerAudio'),pages=el('setlistPdfPages');if(audio){audio.pause();audio.removeAttribute('src');audio.load();}if(viewer)viewer.hidden=true;
    dtmsRenderGeneration++;clearTimeout(dtmsResizeTimer);if(dtmsViewerPdfDoc){try{dtmsViewerPdfDoc.destroy();}catch(_){}dtmsViewerPdfDoc=null;}
    dtmsViewerPdfBytes=null;dtmsRenderWidth=0;dtmsAutoScrollHoldUntil=0;dtmsLastTarget=null;if(pages)pages.innerHTML='';setStatus('');if(viewerAudioUrl){URL.revokeObjectURL(viewerAudioUrl);viewerAudioUrl='';}
    viewerSongs=[];viewerSongIndex=0;el('dtmsCalibrationModal')&&(el('dtmsCalibrationModal').hidden=true);updateMiniPlayerText();updateScrollState();
  };

  window.openSetlistPerformance=async function(){
    const setlist=setlists.find(x=>x.id===activeSetlistId);if(!setlist?.items.length)return alert('This setlist has no songs yet.');
    if(!window.PDFLib?.PDFDocument)return alert('PDF merging is not available. Open the app online once so the PDF component can be cached, then try again.');
    prepareViewerDom();setupPlayerEnhancements();const viewer=el('setlistViewer');if(!viewer)return;
    try{
      await loadPdfJs();const merged=await PDFLib.PDFDocument.create();viewerSongs=[];let pageCursor=1;
      for(let i=0;i<setlist.items.length;i++){
        const item=setlist.items[i],file=library.find(x=>x.id===item.scoreId&&isScoreFile(x));if(!file)throw new Error(`Song ${i+1} is missing from the Score Library.`);
        const blob=await getScoreBlob(item.scoreId);if(!blob)throw new Error(`${file.name} is not available on this device. Connect Google Drive once to download it, or restore it from backup.`);
        let source;try{source=await PDFLib.PDFDocument.load(await blob.arrayBuffer());}catch(_){throw new Error(`Could not open ${file.name}. The PDF may be encrypted or damaged.`);}
        const count=source.getPageCount(),pages=await merged.copyPages(source,source.getPageIndices());pages.forEach(page=>merged.addPage(page));viewerSongs.push({scoreId:file.id,name:file.name,startPage:pageCursor,pageCount:count,trackId:file.backingTrackId||''});pageCursor+=count;
      }
      dtmsViewerPdfBytes=new Uint8Array(await merged.save());viewerSongIndex=0;el('setlistViewerTitle').textContent=setlist.name;el('viewerSongSelect').innerHTML=viewerSongs.map((song,i)=>`<option value="${i}">${i+1}. ${escapeHtml(song.name)}</option>`).join('');viewer.hidden=false;
      initTrackPlayerDrag();setupPlayerEnhancements();await window.selectViewerSong(0,false);await renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:false});jumpToPage(1,'auto');updateMiniPlayerText();updateScrollControls();
    }catch(error){console.error(error);window.closeSetlistViewer();alert(error?.message||'Could not build the setlist performance view.');}
  };
  window.openSetlistPdf=function(){return window.openSetlistPerformance();};
  window.addEventListener('resize',scheduleRerender);

  function init(){prepareViewerDom();setupPlayerEnhancements();removeOldPitchUi();const version=el('appVersion');if(version)version.textContent='v2026.10.02.4';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
