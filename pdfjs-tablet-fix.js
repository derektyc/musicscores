/* DT Music Scores - tablet-safe Open Setlist renderer (v2026.10.02.2)
   PDF.js canvas viewer + minimizable backing-track player + timed auto-scroll. */
(() => {
  'use strict';

  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  let dtmsViewerPdfBytes = null;
  let dtmsViewerPdfDoc = null;
  let dtmsRenderGeneration = 0;
  let dtmsRenderWidth = 0;
  let dtmsResizeTimer = null;
  let dtmsAutoScrollRaf = 0;
  let dtmsAutoScrollEnabled = true;
  let dtmsAutoScrollHoldUntil = 0;
  let dtmsPlayerMinimized = false;

  function el(id){ return document.getElementById(id); }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }
  function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

  function injectViewerStyles(){
    if(el('dtmsPdfJsTabletStyles')) return;
    const style = document.createElement('style');
    style.id = 'dtmsPdfJsTabletStyles';
    style.textContent = `
      .setlist-pdf-scroll{position:relative;flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:#20242a;padding:14px 10px 120px;scroll-behavior:smooth}
      .setlist-pdf-pages{width:100%;display:flex;flex-direction:column;align-items:center;gap:14px}
      .setlist-pdf-page{position:relative;display:flex;justify-content:center;width:100%;scroll-margin-top:12px}
      .setlist-pdf-page canvas{display:block;max-width:100%;height:auto;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.35)}
      .setlist-pdf-status{position:sticky;top:8px;z-index:2;width:max-content;max-width:calc(100% - 16px);margin:0 auto 10px;padding:7px 10px;border-radius:999px;background:rgba(18,22,29,.9);border:1px solid #3b4655;color:#98a5b5;font-size:12px;backdrop-filter:blur(8px)}
      .setlist-pdf-status[hidden]{display:none!important}

      .dtms-player-tools{margin-left:auto;display:flex;align-items:center;gap:6px}
      .dtms-player-tools button{width:32px;height:28px;padding:0;border-radius:8px;background:#252c36;color:#f5f7fa;border:1px solid #3b4655;line-height:1}
      .dtms-mini-song{display:none;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5f7fa;font-size:12px;font-weight:700}
      .dtms-autoscroll-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 2px 0;padding-top:7px;border-top:1px solid #313946;color:#98a5b5;font-size:12px}
      .dtms-autoscroll-row label{display:flex;align-items:center;gap:7px;cursor:pointer}
      .dtms-autoscroll-row input{width:auto!important;margin:0}
      .dtms-autoscroll-state{white-space:nowrap;color:#ffd77a}

      .floating-track-player.dtms-minimized{width:min(320px,calc(100vw - 16px));padding:7px 9px}
      .floating-track-player.dtms-minimized #viewerSongSelect,
      .floating-track-player.dtms-minimized #viewerTrackName,
      .floating-track-player.dtms-minimized #viewerAudio,
      .floating-track-player.dtms-minimized .track-nav-row,
      .floating-track-player.dtms-minimized .dtms-autoscroll-row{display:none!important}
      .floating-track-player.dtms-minimized .track-player-drag{padding:2px 0;gap:7px}
      .floating-track-player.dtms-minimized .track-player-drag > .small{display:none!important}
      .floating-track-player.dtms-minimized .dtms-mini-song{display:block}

      @media(max-width:650px){
        .setlist-pdf-scroll{padding:8px 4px 120px}
        .setlist-pdf-pages{gap:8px}
        .floating-track-player.dtms-minimized{width:min(300px,calc(100vw - 16px))}
      }
    `;
    document.head.appendChild(style);
  }

  function prepareViewerDom(){
    injectViewerStyles();
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

    const hold = () => { dtmsAutoScrollHoldUntil = performance.now() + 3500; };
    scroll.addEventListener('pointerdown', hold, {passive:true});
    scroll.addEventListener('touchstart', hold, {passive:true});
    scroll.addEventListener('wheel', hold, {passive:true});
  }

  function setStatus(text=''){
    const status = el('setlistPdfStatus');
    if(!status) return;
    status.textContent = text;
    status.hidden = !text;
  }

  function loadPdfJs(){
    if(window.pdfjsLib?.getDocument){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return Promise.resolve(window.pdfjsLib);
    }
    if(window.__dtmsPdfJsLoading) return window.__dtmsPdfJsLoading;
    window.__dtmsPdfJsLoading = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = PDFJS_URL;
      script.async = true;
      script.onload = () => {
        if(!window.pdfjsLib?.getDocument) return reject(new Error('PDF.js loaded but did not initialise.'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('PDF.js could not be loaded. Open the app online once, then try again.'));
      document.head.appendChild(script);
    });
    return window.__dtmsPdfJsLoading;
  }

  function jumpToPage(pageNumber, behavior='smooth'){
    const page = el(`setlistPdfPage-${Math.max(1,Number(pageNumber)||1)}`);
    const scroller = el('setlistPdfScroll');
    if(!page || !scroller) return false;
    const top = page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
    try{ scroller.scrollTo({top:Math.max(0,top),behavior}); }
    catch(_){ scroller.scrollTop = Math.max(0,top); }
    return true;
  }

  function songScrollBounds(song){
    const scroller = el('setlistPdfScroll');
    if(!song || !scroller) return null;
    const startPage = Math.max(1,Number(song.startPage)||1);
    const endPage = Math.max(startPage,startPage + Math.max(1,Number(song.pageCount)||1) - 1);
    const startEl = el(`setlistPdfPage-${startPage}`);
    const endEl = el(`setlistPdfPage-${endPage}`);
    if(!startEl || !endEl) return null;

    const sr = scroller.getBoundingClientRect();
    const startTop = startEl.getBoundingClientRect().top - sr.top + scroller.scrollTop - 8;
    const endBottom = endEl.getBoundingClientRect().bottom - sr.top + scroller.scrollTop;
    const maxScroll = Math.max(0,scroller.scrollHeight - scroller.clientHeight);
    const start = clamp(startTop,0,maxScroll);
    const end = clamp(Math.max(start,endBottom - scroller.clientHeight + 28),start,maxScroll);
    return {start,end};
  }

  function updateAutoScrollState(){
    const state = el('dtmsAutoScrollState');
    const toggle = el('dtmsAutoScrollToggle');
    const audio = el('viewerAudio');
    if(toggle) toggle.checked = dtmsAutoScrollEnabled;
    if(!state) return;
    if(!dtmsAutoScrollEnabled) state.textContent = 'Off';
    else if(!viewerSongs?.[viewerSongIndex]?.trackId) state.textContent = 'Needs track';
    else if(!audio || !Number.isFinite(audio.duration) || audio.duration<=0) state.textContent = 'Ready';
    else state.textContent = audio.paused ? 'Ready' : 'Scrolling';
  }

  function stopAutoScrollLoop(){
    if(dtmsAutoScrollRaf){
      cancelAnimationFrame(dtmsAutoScrollRaf);
      dtmsAutoScrollRaf = 0;
    }
    updateAutoScrollState();
  }

  function syncAutoScrollToAudio(force=false){
    if(!dtmsAutoScrollEnabled) return;
    const audio = el('viewerAudio');
    const song = viewerSongs?.[viewerSongIndex];
    const scroller = el('setlistPdfScroll');
    if(!audio || !song || !scroller || !song.trackId) return;
    if(!Number.isFinite(audio.duration) || audio.duration<=0) return;
    if(!force && performance.now() < dtmsAutoScrollHoldUntil) return;

    const bounds = songScrollBounds(song);
    if(!bounds) return;
    const ratio = clamp(audio.currentTime / audio.duration,0,1);
    const target = bounds.start + (bounds.end - bounds.start) * ratio;
    scroller.scrollTop = target;
  }

  function startAutoScrollLoop(){
    stopAutoScrollLoop();
    const audio = el('viewerAudio');
    if(!audio || !dtmsAutoScrollEnabled || audio.paused) return;

    const tick = () => {
      dtmsAutoScrollRaf = 0;
      if(!dtmsAutoScrollEnabled || audio.paused || audio.ended) return updateAutoScrollState();
      syncAutoScrollToAudio(false);
      dtmsAutoScrollRaf = requestAnimationFrame(tick);
    };
    updateAutoScrollState();
    dtmsAutoScrollRaf = requestAnimationFrame(tick);
  }

  function toggleMiniPlay(event){
    event?.stopPropagation?.();
    const audio = el('viewerAudio');
    if(!audio || !audio.src) return;
    if(audio.paused) audio.play().catch(()=>{});
    else audio.pause();
  }

  function updateMiniPlayerText(){
    const miniSong = el('dtmsMiniSong');
    const miniPlay = el('dtmsMiniPlayBtn');
    const song = viewerSongs?.[viewerSongIndex];
    const audio = el('viewerAudio');
    if(miniSong) miniSong.textContent = song?.name || 'Backing Track';
    if(miniPlay) miniPlay.textContent = audio && !audio.paused ? '❚❚' : '▶';
  }

  function clampPlayerIntoViewport(){
    const player = el('floatingTrackPlayer');
    if(!player) return;
    const rect = player.getBoundingClientRect();
    const maxLeft = Math.max(0,innerWidth - player.offsetWidth - 4);
    const maxTop = Math.max(58,innerHeight - player.offsetHeight - 4);
    if(player.style.left){
      player.style.left = `${clamp(rect.left,4,maxLeft)}px`;
      player.style.top = `${clamp(rect.top,58,maxTop)}px`;
    }
  }

  function setPlayerMinimized(minimized){
    dtmsPlayerMinimized = !!minimized;
    const player = el('floatingTrackPlayer');
    const btn = el('dtmsPlayerMinBtn');
    if(player) player.classList.toggle('dtms-minimized',dtmsPlayerMinimized);
    if(btn){
      btn.textContent = dtmsPlayerMinimized ? '▢' : '—';
      btn.title = dtmsPlayerMinimized ? 'Expand player' : 'Minimize player';
      btn.setAttribute('aria-label',btn.title);
    }
    updateMiniPlayerText();
    requestAnimationFrame(clampPlayerIntoViewport);
  }

  function setupPlayerEnhancements(){
    const player = el('floatingTrackPlayer');
    const handle = el('trackPlayerDragHandle');
    if(!player || !handle) return;

    if(!el('dtmsPlayerMinBtn')){
      const tools = document.createElement('span');
      tools.className = 'dtms-player-tools';

      const miniSong = document.createElement('span');
      miniSong.id = 'dtmsMiniSong';
      miniSong.className = 'dtms-mini-song';

      const play = document.createElement('button');
      play.id = 'dtmsMiniPlayBtn';
      play.type = 'button';
      play.textContent = '▶';
      play.title = 'Play / pause';
      play.setAttribute('aria-label','Play or pause backing track');

      const min = document.createElement('button');
      min.id = 'dtmsPlayerMinBtn';
      min.type = 'button';
      min.textContent = '—';
      min.title = 'Minimize player';
      min.setAttribute('aria-label','Minimize player');

      tools.append(play,min);
      const small = handle.querySelector('.small');
      if(small) handle.insertBefore(miniSong,small);
      else handle.appendChild(miniSong);
      handle.appendChild(tools);

      [play,min].forEach(button => {
        button.addEventListener('pointerdown',e => e.stopPropagation());
        button.addEventListener('click',e => e.stopPropagation());
      });
      play.addEventListener('click',toggleMiniPlay);
      min.addEventListener('click',() => setPlayerMinimized(!dtmsPlayerMinimized));
    }

    if(!el('dtmsAutoScrollRow')){
      const row = document.createElement('div');
      row.id = 'dtmsAutoScrollRow';
      row.className = 'dtms-autoscroll-row';
      row.innerHTML = '<label><input id="dtmsAutoScrollToggle" type="checkbox" checked> Auto-scroll with track</label><span id="dtmsAutoScrollState" class="dtms-autoscroll-state">Ready</span>';
      const nav = player.querySelector('.track-nav-row');
      if(nav) player.insertBefore(row,nav);
      else player.appendChild(row);

      el('dtmsAutoScrollToggle')?.addEventListener('change',e => {
        dtmsAutoScrollEnabled = !!e.target.checked;
        if(dtmsAutoScrollEnabled){
          syncAutoScrollToAudio(true);
          startAutoScrollLoop();
        }else{
          stopAutoScrollLoop();
        }
        updateAutoScrollState();
      });
    }

    const audio = el('viewerAudio');
    if(audio && !audio.dataset.dtmsEnhanced){
      audio.dataset.dtmsEnhanced = '1';
      audio.addEventListener('play',() => {
        updateMiniPlayerText();
        syncAutoScrollToAudio(true);
        startAutoScrollLoop();
      });
      audio.addEventListener('pause',() => {
        updateMiniPlayerText();
        stopAutoScrollLoop();
      });
      audio.addEventListener('ended',() => {
        syncAutoScrollToAudio(true);
        updateMiniPlayerText();
        stopAutoScrollLoop();
      });
      audio.addEventListener('loadedmetadata',() => {
        syncAutoScrollToAudio(true);
        updateAutoScrollState();
      });
      audio.addEventListener('seeked',() => syncAutoScrollToAudio(true));
      audio.addEventListener('timeupdate',() => {
        if(audio.paused) syncAutoScrollToAudio(true);
      });
    }

    setPlayerMinimized(dtmsPlayerMinimized);
    updateAutoScrollState();
  }

  async function renderCombinedPdf(bytes=dtmsViewerPdfBytes,{preserveSong=true}={}){
    prepareViewerDom();
    const pagesBox = el('setlistPdfPages');
    const scroller = el('setlistPdfScroll');
    if(!pagesBox || !scroller) throw new Error('The setlist PDF viewer could not be created.');
    if(!bytes?.length) throw new Error('The combined setlist PDF is empty.');

    const pdfjs = await loadPdfJs();
    const generation = ++dtmsRenderGeneration;
    const targetPage = preserveSong ? (viewerSongs[viewerSongIndex]?.startPage || 1) : 1;
    pagesBox.innerHTML = '';
    setStatus('Loading score…');

    if(dtmsViewerPdfDoc){
      try{ await dtmsViewerPdfDoc.destroy(); }catch(_){ }
      dtmsViewerPdfDoc = null;
    }

    const task = pdfjs.getDocument({data:bytes.slice()});
    const doc = await task.promise;
    if(generation !== dtmsRenderGeneration){ try{ await doc.destroy(); }catch(_){ } return; }
    dtmsViewerPdfDoc = doc;

    const available = Math.max(280,Math.min(1200,scroller.clientWidth - 20));
    dtmsRenderWidth = scroller.clientWidth;

    for(let pageNumber=1; pageNumber<=doc.numPages; pageNumber++){
      if(generation !== dtmsRenderGeneration) return;
      setStatus(`Rendering page ${pageNumber} of ${doc.numPages}…`);
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({scale:1});
      const viewport = page.getViewport({scale:available/base.width});
      const dpr = Math.min(2,Math.max(1,window.devicePixelRatio || 1));
      const wrap = document.createElement('div');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d',{alpha:false});
      if(!context) throw new Error('This browser could not create the PDF canvas.');

      wrap.className = 'setlist-pdf-page';
      wrap.id = `setlistPdfPage-${pageNumber}`;
      wrap.dataset.page = String(pageNumber);
      canvas.width = Math.max(1,Math.floor(viewport.width*dpr));
      canvas.height = Math.max(1,Math.floor(viewport.height*dpr));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      wrap.appendChild(canvas);
      pagesBox.appendChild(wrap);

      await page.render({
        canvasContext:context,
        viewport,
        transform:dpr === 1 ? null : [dpr,0,0,dpr,0,0]
      }).promise;
    }

    if(generation !== dtmsRenderGeneration) return;
    setStatus('');
    jumpToPage(targetPage,'auto');
    syncAutoScrollToAudio(true);
  }

  function scheduleRerender(){
    const viewer = el('setlistViewer');
    const scroller = el('setlistPdfScroll');
    if(!viewer || viewer.hidden || !dtmsViewerPdfBytes || !scroller) return;
    clearTimeout(dtmsResizeTimer);
    dtmsResizeTimer = setTimeout(() => {
      clampPlayerIntoViewport();
      if(Math.abs(scroller.clientWidth - dtmsRenderWidth) > 40){
        renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:true}).catch(console.error);
      }
    },260);
  }

  window.selectViewerSong = async function(index,jumpPdf=true){
    stopAutoScrollLoop();
    if(!viewerSongs.length) return;
    viewerSongIndex = Math.max(0,Math.min(viewerSongs.length-1,Number(index)||0));
    const song = viewerSongs[viewerSongIndex];
    const select = el('viewerSongSelect');
    const audio = el('viewerAudio');
    const label = el('viewerTrackName');
    if(select) select.value = String(viewerSongIndex);
    if(jumpPdf) jumpToPage(song.startPage,'smooth');

    if(viewerAudioUrl){ URL.revokeObjectURL(viewerAudioUrl); viewerAudioUrl=''; }
    if(audio){ audio.pause(); audio.removeAttribute('src'); audio.load(); }
    updateMiniPlayerText();

    if(!song.trackId){
      if(label) label.textContent='No backing track attached';
      updateAutoScrollState();
      return;
    }

    const track = library.find(x => x.id===song.trackId && isAudioFile(x));
    if(!track){
      if(label) label.textContent='Backing track is missing';
      updateAutoScrollState();
      return;
    }
    const blob = await getLibraryBlob(track.id);
    if(!blob){
      if(label) label.textContent='Backing track is not available offline yet';
      updateAutoScrollState();
      return;
    }

    viewerAudioUrl = URL.createObjectURL(blob);
    if(audio){ audio.src=viewerAudioUrl; audio.load(); }
    if(label) label.textContent=track.name;
    updateMiniPlayerText();
    updateAutoScrollState();
  };

  window.viewerMoveSong = function(delta){
    if(!viewerSongs.length) return;
    return window.selectViewerSong(Math.max(0,Math.min(viewerSongs.length-1,viewerSongIndex+delta)),true);
  };

  window.closeSetlistViewer = function(){
    stopAutoScrollLoop();
    const viewer = el('setlistViewer');
    const audio = el('viewerAudio');
    const pages = el('setlistPdfPages');
    if(audio){ audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if(viewer) viewer.hidden = true;
    dtmsRenderGeneration++;
    clearTimeout(dtmsResizeTimer);
    if(dtmsViewerPdfDoc){ try{ dtmsViewerPdfDoc.destroy(); }catch(_){ } dtmsViewerPdfDoc=null; }
    dtmsViewerPdfBytes = null;
    dtmsRenderWidth = 0;
    dtmsAutoScrollHoldUntil = 0;
    if(pages) pages.innerHTML='';
    setStatus('');
    if(viewerAudioUrl){ URL.revokeObjectURL(viewerAudioUrl); viewerAudioUrl=''; }
    viewerSongs=[];
    viewerSongIndex=0;
    updateMiniPlayerText();
    updateAutoScrollState();
  };

  window.openSetlistPerformance = async function(){
    const setlist = setlists.find(x => x.id===activeSetlistId);
    if(!setlist?.items.length) return alert('This setlist has no songs yet.');
    if(!window.PDFLib?.PDFDocument) return alert('PDF merging is not available. Open the app online once so the PDF component can be cached, then try again.');

    prepareViewerDom();
    setupPlayerEnhancements();
    const viewer = el('setlistViewer');
    if(!viewer) return;

    try{
      await loadPdfJs();
      const merged = await PDFLib.PDFDocument.create();
      viewerSongs=[];
      let pageCursor=1;

      for(let i=0;i<setlist.items.length;i++){
        const item=setlist.items[i];
        const file=library.find(x => x.id===item.scoreId && isScoreFile(x));
        if(!file) throw new Error(`Song ${i+1} is missing from the Score Library.`);
        const blob=await getScoreBlob(item.scoreId);
        if(!blob) throw new Error(`${file.name} is not available on this device. Connect Google Drive once to download it, or restore it from backup.`);
        let source;
        try{ source=await PDFLib.PDFDocument.load(await blob.arrayBuffer()); }
        catch(_){ throw new Error(`Could not open ${file.name}. The PDF may be encrypted or damaged.`); }
        const count=source.getPageCount();
        const pages=await merged.copyPages(source,source.getPageIndices());
        pages.forEach(page => merged.addPage(page));
        viewerSongs.push({scoreId:file.id,name:file.name,startPage:pageCursor,pageCount:count,trackId:file.backingTrackId||''});
        pageCursor+=count;
      }

      dtmsViewerPdfBytes = new Uint8Array(await merged.save());
      viewerSongIndex=0;
      el('setlistViewerTitle').textContent=setlist.name;
      el('viewerSongSelect').innerHTML=viewerSongs.map((song,i)=>`<option value="${i}">${i+1}. ${escapeHtml(song.name)}</option>`).join('');
      viewer.hidden=false;
      initTrackPlayerDrag();
      setupPlayerEnhancements();
      await window.selectViewerSong(0,false);
      await renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:false});
      jumpToPage(1,'auto');
      updateMiniPlayerText();
      updateAutoScrollState();
    }catch(error){
      console.error(error);
      window.closeSetlistViewer();
      alert(error?.message || 'Could not build the setlist performance view.');
    }
  };

  window.openSetlistPdf = function(){ return window.openSetlistPerformance(); };
  window.addEventListener('resize',scheduleRerender);

  function init(){
    prepareViewerDom();
    setupPlayerEnhancements();
    const version = el('appVersion');
    if(version) version.textContent='v2026.10.02.2';
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
