/* DT Music Scores - backing-track transpose controls (v2026.10.02.3)
   Adds +/- semitone pitch shifting to the Open Setlist player while keeping tempo unchanged. */
(() => {
  'use strict';

  const TONE_URL = 'https://cdn.jsdelivr.net/npm/tone@14.8.49/build/Tone.js';
  const STORAGE_KEY = 'DTMS_TRACK_TRANSPOSE_V1';
  const MIN_SEMITONES = -12;
  const MAX_SEMITONES = 12;

  let toneLoading = null;
  let pitchShift = null;
  let mediaSource = null;
  let pitchEngineReady = false;
  let currentSemitones = 0;

  function el(id){ return document.getElementById(id); }
  function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

  function readPrefs(){
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}') || {}; }
    catch(_){ return {}; }
  }

  function writePrefs(prefs){
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(prefs)); }catch(_){ }
  }

  function currentScoreKey(){
    const idx = Math.max(0,Number(el('viewerSongSelect')?.value)||0);
    return window.viewerSongs?.[idx]?.scoreId || '';
  }

  function savedSemitones(){
    const key = currentScoreKey();
    if(!key) return 0;
    const prefs = readPrefs();
    return clamp(Number(prefs[key])||0,MIN_SEMITONES,MAX_SEMITONES);
  }

  function saveSemitones(value){
    const key = currentScoreKey();
    if(!key) return;
    const prefs = readPrefs();
    if(value===0) delete prefs[key];
    else prefs[key] = value;
    writePrefs(prefs);
  }

  function loadTone(){
    if(window.Tone?.PitchShift) return Promise.resolve(window.Tone);
    if(toneLoading) return toneLoading;
    toneLoading = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = TONE_URL;
      script.async = true;
      script.onload = () => window.Tone?.PitchShift ? resolve(window.Tone) : reject(new Error('Pitch engine failed to initialise.'));
      script.onerror = () => reject(new Error('Pitch engine could not be loaded. Open the app online once, then try again.'));
      document.head.appendChild(script);
    });
    return toneLoading;
  }

  async function ensurePitchEngine(){
    const audio = el('viewerAudio');
    if(!audio) throw new Error('Backing-track player is unavailable.');
    if(pitchEngineReady && pitchShift) return pitchShift;

    const Tone = await loadTone();
    try{ await Tone.start(); }catch(_){ }

    const context = Tone.getContext ? Tone.getContext() : Tone.context;
    const raw = context?.rawContext || context;
    if(!raw?.createMediaElementSource) throw new Error('This browser does not support live track transposition.');

    mediaSource = raw.createMediaElementSource(audio);
    pitchShift = new Tone.PitchShift({pitch:0,windowSize:0.08}).toDestination();
    Tone.connect(mediaSource,pitchShift);
    pitchShift.wet.value = 0;
    pitchEngineReady = true;
    return pitchShift;
  }

  function formatValue(value){
    const n = Number(value)||0;
    return n===0 ? '0 st' : `${n>0?'+':''}${n} st`;
  }

  function updateUi(){
    const value = el('dtmsTransposeValue');
    const row = el('dtmsTransposeRow');
    const hasTrack = !!el('viewerAudio')?.src;
    if(value) value.textContent = formatValue(currentSemitones);
    if(row) row.classList.toggle('dtms-disabled',!hasTrack);
    ['dtmsTransposeDown','dtmsTransposeReset','dtmsTransposeUp'].forEach(id => {
      const button = el(id);
      if(button) button.disabled = !hasTrack;
    });
  }

  async function applyTranspose(value,{save=true,quiet=false}={}){
    currentSemitones = clamp(Math.round(Number(value)||0),MIN_SEMITONES,MAX_SEMITONES);
    if(save) saveSemitones(currentSemitones);
    updateUi();

    const audio = el('viewerAudio');
    if(!audio?.src) return;

    try{
      const shifter = await ensurePitchEngine();
      shifter.pitch = currentSemitones;
      if(shifter.wet?.value !== undefined) shifter.wet.value = currentSemitones===0 ? 0 : 1;
      const Tone = window.Tone;
      const context = Tone?.getContext ? Tone.getContext() : Tone?.context;
      if(context?.state === 'suspended') await context.resume?.();
    }catch(error){
      console.error(error);
      if(!quiet) alert(error?.message || 'Track transposition is not available on this device.');
    }
  }

  async function changeTranspose(delta){
    await applyTranspose(currentSemitones + delta,{save:true,quiet:false});
  }

  function injectStyles(){
    if(el('dtmsTransposeStyles')) return;
    const style = document.createElement('style');
    style.id = 'dtmsTransposeStyles';
    style.textContent = `
      .dtms-transpose-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 2px 0;padding-top:7px;border-top:1px solid #313946;color:#98a5b5;font-size:12px}
      .dtms-transpose-controls{display:flex;align-items:center;gap:6px}
      .dtms-transpose-controls button{min-width:38px;height:32px;padding:0 9px;border-radius:8px;background:#252c36;color:#f5f7fa;border:1px solid #3b4655;font-weight:800}
      .dtms-transpose-controls #dtmsTransposeValue{min-width:64px;color:#ffd77a}
      .dtms-transpose-row.dtms-disabled{opacity:.5}
      .dtms-transpose-controls button:disabled{cursor:not-allowed;filter:none}
      .floating-track-player.dtms-minimized .dtms-transpose-row{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function setupControls(){
    injectStyles();
    const player = el('floatingTrackPlayer');
    if(!player || el('dtmsTransposeRow')) return;

    const row = document.createElement('div');
    row.id = 'dtmsTransposeRow';
    row.className = 'dtms-transpose-row';
    row.innerHTML = `
      <span>Transpose</span>
      <div class="dtms-transpose-controls">
        <button id="dtmsTransposeDown" type="button" title="Down 1 semitone">−</button>
        <button id="dtmsTransposeValue" type="button" title="Reset transpose">0 st</button>
        <button id="dtmsTransposeUp" type="button" title="Up 1 semitone">+</button>
      </div>`;

    const autoRow = el('dtmsAutoScrollRow');
    const nav = player.querySelector('.track-nav-row');
    if(autoRow) player.insertBefore(row,autoRow);
    else if(nav) player.insertBefore(row,nav);
    else player.appendChild(row);

    el('dtmsTransposeDown')?.addEventListener('click',() => changeTranspose(-1));
    el('dtmsTransposeUp')?.addEventListener('click',() => changeTranspose(1));
    el('dtmsTransposeValue')?.addEventListener('click',() => applyTranspose(0,{save:true,quiet:false}));

    [el('dtmsTransposeDown'),el('dtmsTransposeUp'),el('dtmsTransposeValue')].filter(Boolean).forEach(button => {
      button.addEventListener('pointerdown',e => e.stopPropagation());
    });

    currentSemitones = savedSemitones();
    updateUi();
  }

  async function syncForCurrentSong(){
    currentSemitones = savedSemitones();
    updateUi();
    if(currentSemitones!==0 && el('viewerAudio')?.src){
      await applyTranspose(currentSemitones,{save:false,quiet:true});
    }else if(pitchEngineReady && pitchShift){
      pitchShift.pitch = 0;
      if(pitchShift.wet?.value !== undefined) pitchShift.wet.value = 0;
    }
  }

  function patchViewerFunctions(){
    if(window.__dtmsTransposePatched) return;
    window.__dtmsTransposePatched = true;

    const originalSelect = window.selectViewerSong;
    if(typeof originalSelect === 'function'){
      window.selectViewerSong = async function(index,jumpPdf=true){
        const result = await originalSelect.call(this,index,jumpPdf);
        setupControls();
        await syncForCurrentSong();
        return result;
      };
    }

    const originalClose = window.closeSetlistViewer;
    if(typeof originalClose === 'function'){
      window.closeSetlistViewer = function(){
        if(pitchShift){
          pitchShift.pitch = 0;
          if(pitchShift.wet?.value !== undefined) pitchShift.wet.value = 0;
        }
        currentSemitones = 0;
        return originalClose.call(this);
      };
    }
  }

  function bindAudio(){
    const audio = el('viewerAudio');
    if(!audio || audio.dataset.dtmsTransposeBound) return;
    audio.dataset.dtmsTransposeBound = '1';
    audio.addEventListener('play',async () => {
      if(currentSemitones!==0) await applyTranspose(currentSemitones,{save:false,quiet:true});
    });
    audio.addEventListener('loadedmetadata',() => updateUi());
    audio.addEventListener('emptied',() => updateUi());
  }

  function init(){
    setupControls();
    patchViewerFunctions();
    bindAudio();
    const version = el('appVersion');
    if(version) version.textContent='v2026.10.02.3';
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
