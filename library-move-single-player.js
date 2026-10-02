/* DT Music Scores - folder picker + individual score player (v2026.10.02.6)
   Replaces folder-ID prompts with a visual picker and opens individual PDFs in-app with their backing track player. */
(() => {
  'use strict';

  const PDFJS_URL='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  let moveIds=[];
  let moveBrowseId='root';
  let moveExcluded=new Set();
  let singlePdfDoc=null;
  let singlePdfBytes=null;
  let singleRenderGeneration=0;
  let singleRenderWidth=0;
  let singleResizeTimer=null;
  let originalOpenFile=null;
  let originalCloseViewer=null;
  let originalOpenSetlist=null;

  function el(id){return document.getElementById(id)}
  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))}

  function injectStyles(){
    if(el('dtmsMoveSingleStyles'))return;
    const style=document.createElement('style');
    style.id='dtmsMoveSingleStyles';
    style.textContent=`
      .dtms-move-overlay{position:fixed;inset:0;z-index:6500;background:rgba(5,7,10,.72);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(5px)}
      .dtms-move-overlay[hidden]{display:none!important}
      .dtms-move-card{width:min(620px,100%);max-height:min(760px,92vh);display:flex;flex-direction:column;background:#171b22;border:1px solid #3b4655;border-radius:17px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden}
      .dtms-move-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 16px;border-bottom:1px solid #313946}
      .dtms-move-head h3{margin:0 0 4px;font-size:17px}.dtms-move-head p{margin:0;color:#98a5b5;font-size:12px}
      .dtms-move-close{background:#252c36;color:#f5f7fa;border:1px solid #3b4655;padding:8px 11px;border-radius:9px}
      .dtms-move-breadcrumb{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:11px 16px;border-bottom:1px solid #313946;color:#98a5b5;font-size:12px}
      .dtms-move-breadcrumb button{background:none;color:#ffd77a;padding:3px 4px;border:0}
      .dtms-move-list{padding:12px 16px;overflow:auto;display:flex;flex-direction:column;gap:7px;min-height:180px}
      .dtms-move-folder{display:flex;align-items:center;gap:10px;width:100%;padding:12px;background:#10141a;color:#f5f7fa;border:1px solid #2b333f;border-radius:11px;text-align:left}
      .dtms-move-folder:hover{border-color:#f2b84b}.dtms-move-folder .folder-icon{font-size:19px}.dtms-move-folder .folder-name{font-weight:750;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dtms-move-folder .folder-arrow{margin-left:auto;color:#98a5b5}
      .dtms-move-empty{padding:22px;text-align:center;color:#98a5b5;border:1px dashed #2b333f;border-radius:11px}
      .dtms-move-actions{padding:12px 16px;border-top:1px solid #313946;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dtms-move-actions .move-here{margin-left:auto}
      .dtms-single-score #viewerSongSelect,.dtms-single-score .track-nav-row{display:none!important}
      .dtms-single-score .setlist-viewer-bar>div:first-child .small{display:none}
      @media(max-width:650px){.dtms-move-overlay{padding:8px}.dtms-move-actions .move-here{margin-left:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureMoveModal(){
    injectStyles();
    if(el('dtmsMoveOverlay'))return;
    const modal=document.createElement('div');
    modal.id='dtmsMoveOverlay';
    modal.className='dtms-move-overlay';
    modal.hidden=true;
    modal.innerHTML=`
      <div class="dtms-move-card" role="dialog" aria-modal="true" aria-labelledby="dtmsMoveTitle">
        <div class="dtms-move-head">
          <div><h3 id="dtmsMoveTitle">Move to folder</h3><p id="dtmsMoveSubtitle">Choose a destination.</p></div>
          <button id="dtmsMoveClose" class="dtms-move-close" type="button">Cancel</button>
        </div>
        <div id="dtmsMoveBreadcrumb" class="dtms-move-breadcrumb"></div>
        <div id="dtmsMoveList" class="dtms-move-list"></div>
        <div class="dtms-move-actions">
          <button id="dtmsMoveNewFolder" class="secondary" type="button">+ New Folder</button>
          <button id="dtmsMoveRoot" class="secondary" type="button">Library Root</button>
          <button id="dtmsMoveHere" class="primary move-here" type="button">Move Here</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    el('dtmsMoveClose').addEventListener('click',closeMoveModal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeMoveModal()});
    el('dtmsMoveRoot').addEventListener('click',()=>{moveBrowseId='root';renderMoveModal()});
    el('dtmsMoveNewFolder').addEventListener('click',createFolderInMoveModal);
    el('dtmsMoveHere').addEventListener('click',finishMove);
  }

  function folderById(id){return library.find(x=>x.type==='folder'&&x.id===id)||null}
  function folderTrail(id){
    const result=[];let cur=id;const seen=new Set();
    while(cur&&cur!=='root'&&!seen.has(cur)){
      seen.add(cur);const f=folderById(cur);if(!f)break;result.unshift(f);cur=f.parentId||'root';
    }
    return result;
  }
  function allowedFolder(id){return id==='root'||(!!folderById(id)&&!moveExcluded.has(id))}

  function renderMoveModal(){
    const modal=el('dtmsMoveOverlay');if(!modal)return;
    if(!allowedFolder(moveBrowseId))moveBrowseId='root';
    const trail=folderTrail(moveBrowseId);
    el('dtmsMoveBreadcrumb').innerHTML=`<button type="button" data-folder="root">Library</button>`+trail.map(f=>`<span>›</span><button type="button" data-folder="${f.id}">${escapeHtml(f.name)}</button>`).join('');
    el('dtmsMoveBreadcrumb').querySelectorAll('button[data-folder]').forEach(btn=>btn.addEventListener('click',()=>{moveBrowseId=btn.dataset.folder;renderMoveModal()}));

    const folders=library.filter(x=>x.type==='folder'&&(x.parentId||'root')===moveBrowseId&&!moveExcluded.has(x.id)).sort((a,b)=>a.name.localeCompare(b.name));
    el('dtmsMoveList').innerHTML=folders.length?folders.map(f=>`<button type="button" class="dtms-move-folder" data-folder="${f.id}"><span class="folder-icon">📁</span><span class="folder-name">${escapeHtml(f.name)}</span><span class="folder-arrow">›</span></button>`).join(''):`<div class="dtms-move-empty">No subfolders here.<br>You can move the item here or create a new folder.</div>`;
    el('dtmsMoveList').querySelectorAll('.dtms-move-folder').forEach(btn=>btn.addEventListener('click',()=>{moveBrowseId=btn.dataset.folder;renderMoveModal()}));

    const destination=moveBrowseId==='root'?'Library Root':folderById(moveBrowseId)?.name||'Folder';
    el('dtmsMoveHere').textContent=`Move Here · ${destination}`;
  }

  function openMoveModal(ids){
    ensureMoveModal();
    moveIds=[...new Set(ids)].filter(id=>library.some(x=>x.id===id));
    if(!moveIds.length)return;
    moveExcluded=collectDescendantIds(moveIds);
    moveBrowseId='root';
    const names=moveIds.map(id=>library.find(x=>x.id===id)?.name).filter(Boolean);
    el('dtmsMoveTitle').textContent=moveIds.length===1?'Move item':'Move selected items';
    el('dtmsMoveSubtitle').textContent=moveIds.length===1?names[0]:`${moveIds.length} items selected`;
    el('dtmsMoveOverlay').hidden=false;
    renderMoveModal();
  }

  function closeMoveModal(){const modal=el('dtmsMoveOverlay');if(modal)modal.hidden=true;moveIds=[];moveBrowseId='root';moveExcluded=new Set()}

  async function createFolderInMoveModal(){
    const name=prompt('New folder name:','New Folder');
    if(!name?.trim())return;
    const parent=allowedFolder(moveBrowseId)?moveBrowseId:'root';
    const existing=library.find(x=>x.type==='folder'&&(x.parentId||'root')===parent&&x.name.trim().toLowerCase()===name.trim().toLowerCase());
    if(existing){moveBrowseId=existing.id;renderMoveModal();return}
    const folder={id:uid(),type:'folder',name:name.trim(),parentId:parent,driveFolderId:'',cloudDirty:true};
    library.push(folder);
    await saveLocalState();
    moveBrowseId=folder.id;
    renderAll();
    renderMoveModal();
  }

  async function finishMove(){
    const target=allowedFolder(moveBrowseId)?moveBrowseId:'root';
    const items=moveIds.map(id=>library.find(x=>x.id===id)).filter(Boolean);
    if(!items.length)return closeMoveModal();
    if(items.some(x=>x.type==='folder'&&moveExcluded.has(target)))return alert('A folder cannot be moved inside itself.');
    items.forEach(item=>{item.parentId=target;item.cloudDirty=true;selectedLibraryIds.delete(item.id)});
    await saveLocalState();
    renderAll();
    closeMoveModal();
  }

  function patchMoveFunctions(){
    window.moveItem=function(id){const item=library.find(x=>x.id===id);if(!item)return;openMoveModal([id])};
    window.bulkMoveSelected=function(){if(!selectedLibraryIds.size)return alert('Select at least one item.');openMoveModal([...selectedLibraryIds])};
  }

  function setPdfStatus(text=''){
    const status=el('setlistPdfStatus');if(!status)return;status.textContent=text;status.hidden=!text;
  }

  async function ensurePdfJs(){
    if(window.pdfjsLib?.getDocument){window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;return window.pdfjsLib}
    if(window.__dtmsPdfJsLoading)return window.__dtmsPdfJsLoading;
    window.__dtmsPdfJsLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=PDFJS_URL;script.async=true;
      script.onload=()=>{if(!window.pdfjsLib?.getDocument)return reject(new Error('PDF.js loaded but did not initialise.'));window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;resolve(window.pdfjsLib)};
      script.onerror=()=>reject(new Error('PDF.js could not be loaded. Open the app online once, then try again.'));
      document.head.appendChild(script);
    });
    return window.__dtmsPdfJsLoading;
  }

  async function renderSinglePdf(bytes,{preserveScroll=false}={}){
    const pagesBox=el('setlistPdfPages'),scroller=el('setlistPdfScroll');
    if(!pagesBox||!scroller)throw new Error('The PDF viewer is not ready.');
    const pdfjs=await ensurePdfJs();
    const generation=++singleRenderGeneration;
    const oldRatio=preserveScroll&&scroller.scrollHeight>scroller.clientHeight?scroller.scrollTop/(scroller.scrollHeight-scroller.clientHeight):0;
    pagesBox.innerHTML='';setPdfStatus('Loading score…');
    if(singlePdfDoc){try{await singlePdfDoc.destroy()}catch(_){}singlePdfDoc=null}
    const task=pdfjs.getDocument({data:bytes.slice()});
    const doc=await task.promise;if(generation!==singleRenderGeneration){try{await doc.destroy()}catch(_){}return}
    singlePdfDoc=doc;
    const available=Math.max(280,Math.min(1200,scroller.clientWidth-20));singleRenderWidth=scroller.clientWidth;
    for(let pageNumber=1;pageNumber<=doc.numPages;pageNumber++){
      if(generation!==singleRenderGeneration)return;
      setPdfStatus(`Rendering page ${pageNumber} of ${doc.numPages}…`);
      const page=await doc.getPage(pageNumber),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:available/base.width}),dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
      const wrap=document.createElement('div'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw new Error('This browser could not create the PDF canvas.');
      wrap.className='setlist-pdf-page';wrap.id=`setlistPdfPage-${pageNumber}`;wrap.dataset.page=String(pageNumber);
      canvas.width=Math.max(1,Math.floor(viewport.width*dpr));canvas.height=Math.max(1,Math.floor(viewport.height*dpr));canvas.style.width=`${Math.floor(viewport.width)}px`;canvas.style.height=`${Math.floor(viewport.height)}px`;
      wrap.appendChild(canvas);pagesBox.appendChild(wrap);
      await page.render({canvasContext:ctx,viewport,transform:dpr===1?null:[dpr,0,0,dpr,0,0]}).promise;
    }
    if(generation!==singleRenderGeneration)return;
    setPdfStatus('');
    if(preserveScroll){const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight);scroller.scrollTop=max*oldRatio}else scroller.scrollTop=0;
  }

  async function openSingleScore(id){
    const file=library.find(x=>x.id===id&&isScoreFile(x));if(!file)return;
    const blob=await getScoreBlob(id);if(!blob)return alert('This score is not available on this device yet.');
    const viewer=el('setlistViewer'),pagesBox=el('setlistPdfPages'),scroller=el('setlistPdfScroll');
    if(!viewer||!pagesBox||!scroller){
      if(originalOpenFile)return originalOpenFile(id);
      return alert('The in-app PDF viewer is not ready. Please reopen the app and try again.');
    }
    try{
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const pdfjs=await ensurePdfJs();
      const previewTask=pdfjs.getDocument({data:bytes.slice()}),previewDoc=await previewTask.promise,count=previewDoc.numPages;try{await previewDoc.destroy()}catch(_){}
      singlePdfBytes=bytes;
      viewerSongs.length=0;
      viewerSongs.push({scoreId:file.id,name:file.name,startPage:1,pageCount:count,trackId:file.backingTrackId||''});
      viewerSongIndex=0;
      el('setlistViewerTitle').textContent=file.name;
      el('viewerSongSelect').innerHTML=`<option value="0">${escapeHtml(file.name)}</option>`;
      viewer.classList.add('dtms-single-score');viewer.hidden=false;
      await window.selectViewerSong?.(0,false);
      await renderSinglePdf(singlePdfBytes,{preserveScroll:false});
    }catch(error){console.error(error);alert(error?.message||'Could not open this score.')}
  }

  function patchIndividualPlayer(){
    if(!originalOpenFile)originalOpenFile=window.openFile;
    window.openFile=async function(id){
      const item=library.find(x=>x.id===id);
      if(item&&isScoreFile(item))return openSingleScore(id);
      return originalOpenFile?.(id);
    };

    if(!originalCloseViewer)originalCloseViewer=window.closeSetlistViewer;
    if(typeof originalCloseViewer==='function'){
      window.closeSetlistViewer=function(){
        singleRenderGeneration++;
        clearTimeout(singleResizeTimer);
        if(singlePdfDoc){try{singlePdfDoc.destroy()}catch(_){}singlePdfDoc=null}
        singlePdfBytes=null;singleRenderWidth=0;
        el('setlistViewer')?.classList.remove('dtms-single-score');
        return originalCloseViewer.call(this);
      };
    }

    if(!originalOpenSetlist)originalOpenSetlist=window.openSetlistPerformance;
    if(typeof originalOpenSetlist==='function'){
      window.openSetlistPerformance=async function(){
        el('setlistViewer')?.classList.remove('dtms-single-score');
        singleRenderGeneration++;
        if(singlePdfDoc){try{await singlePdfDoc.destroy()}catch(_){}singlePdfDoc=null}
        singlePdfBytes=null;
        return originalOpenSetlist.call(this);
      };
      window.openSetlistPdf=function(){return window.openSetlistPerformance()};
    }
  }

  function handleSingleResize(){
    const viewer=el('setlistViewer'),scroller=el('setlistPdfScroll');
    if(!viewer||viewer.hidden||!viewer.classList.contains('dtms-single-score')||!singlePdfBytes||!scroller)return;
    clearTimeout(singleResizeTimer);
    singleResizeTimer=setTimeout(()=>{if(Math.abs(scroller.clientWidth-singleRenderWidth)>40)renderSinglePdf(singlePdfBytes,{preserveScroll:true}).catch(console.error)},260);
  }

  function init(){
    injectStyles();ensureMoveModal();patchMoveFunctions();patchIndividualPlayer();
    window.addEventListener('resize',handleSingleResize);
    const version=el('appVersion');if(version)version.textContent='v2026.10.02.6';
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
