/* DT Music Scores - tablet-safe Open Setlist PDF renderer (v2026.10.02.1)
   Replaces the browser's embedded blob-PDF iframe with PDF.js canvases. */
(() => {
  'use strict';

  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  let dtmsViewerPdfBytes = null;
  let dtmsViewerPdfDoc = null;
  let dtmsRenderGeneration = 0;
  let dtmsRenderWidth = 0;
  let dtmsResizeTimer = null;

  function el(id){ return document.getElementById(id); }
  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

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
      @media(max-width:650px){.setlist-pdf-scroll{padding:8px 4px 120px}.setlist-pdf-pages{gap:8px}}
    `;
    document.head.appendChild(style);
  }

  function prepareViewerDom(){
    injectViewerStyles();
    if(el('setlistPdfScroll')) return;
    const frame = el('setlistPdfFrame');
    if(!frame) return;
    const scroll = document.createElement('div');
    scroll.id = 'setlistPdfScroll';
    scroll.className = 'setlist-pdf-scroll';
    scroll.setAttribute('aria-label','Combined setlist PDF');
    scroll.innerHTML = '<div id="setlistPdfStatus" class="setlist-pdf-status" hidden>Preparing score…</div><div id="setlistPdfPages" class="setlist-pdf-pages"></div>';
    frame.replaceWith(scroll);
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
  }

  function scheduleRerender(){
    const viewer = el('setlistViewer');
    const scroller = el('setlistPdfScroll');
    if(!viewer || viewer.hidden || !dtmsViewerPdfBytes || !scroller) return;
    clearTimeout(dtmsResizeTimer);
    dtmsResizeTimer = setTimeout(() => {
      if(Math.abs(scroller.clientWidth - dtmsRenderWidth) > 40){
        renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:true}).catch(console.error);
      }
    },260);
  }

  window.selectViewerSong = async function(index,jumpPdf=true){
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
    if(!song.trackId){ if(label) label.textContent='No backing track attached'; return; }

    const track = library.find(x => x.id===song.trackId && isAudioFile(x));
    if(!track){ if(label) label.textContent='Backing track is missing'; return; }
    const blob = await getLibraryBlob(track.id);
    if(!blob){ if(label) label.textContent='Backing track is not available offline yet'; return; }
    viewerAudioUrl = URL.createObjectURL(blob);
    if(audio){ audio.src=viewerAudioUrl; audio.load(); }
    if(label) label.textContent=track.name;
  };

  window.viewerMoveSong = function(delta){
    if(!viewerSongs.length) return;
    return window.selectViewerSong(Math.max(0,Math.min(viewerSongs.length-1,viewerSongIndex+delta)),true);
  };

  window.closeSetlistViewer = function(){
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
    if(pages) pages.innerHTML='';
    setStatus('');
    if(viewerAudioUrl){ URL.revokeObjectURL(viewerAudioUrl); viewerAudioUrl=''; }
    viewerSongs=[];
    viewerSongIndex=0;
  };

  window.openSetlistPerformance = async function(){
    const setlist = setlists.find(x => x.id===activeSetlistId);
    if(!setlist?.items.length) return alert('This setlist has no songs yet.');
    if(!window.PDFLib?.PDFDocument) return alert('PDF merging is not available. Open the app online once so the PDF component can be cached, then try again.');

    prepareViewerDom();
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
      await window.selectViewerSong(0,false);
      await renderCombinedPdf(dtmsViewerPdfBytes,{preserveSong:false});
      jumpToPage(1,'auto');
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
    const version = el('appVersion');
    if(version) version.textContent='v2026.10.02.1';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
