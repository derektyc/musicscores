/* DT Music Scores runtime recovery marker v2026.10.03.1 */
(() => {
  function apply(){
    const version=document.getElementById('appVersion');
    if(version) version.textContent='v2026.10.03.1';
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(apply,0),{once:true});
  else setTimeout(apply,0);
})();
