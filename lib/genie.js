/* Martinov aplikacija – „duh iz lampe“ (od 1.8.0)
   Svaki prozor preko celog ekrana (dijalog, list, pregled) izlazi iz dugmeta koje ga je otvorilo i vraća se u njega.
   Radi sam: prati klikove i prozore koji se pojave (hidden → vidljiv, ili dodat u stranicu), bez izmena u ostalom kodu.
   Preskače: prozore koji već imaju svoju animaciju, elemente sa data-no-genie i kad je u sistemu uključeno „manje pokreta“. */
(function(){
  if(window.__mtGenie)return;window.__mtGenie=1;
  var last=null,lastT=0;
  addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('button,a,.chip,.titem,.rbtn,[role=button]');if(b){last=b;lastT=Date.now()}},true);
  function noMotion(){try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){return false}}
  function isOverlay(el){
    if(!(el instanceof HTMLElement)||el.hidden||el.hasAttribute('data-no-genie')||el.closest('[data-no-genie]'))return false;
    var cs=getComputedStyle(el);if(cs.position!=='fixed'||cs.display==='none'||cs.visibility==='hidden')return false;
    var r=el.getBoundingClientRect();return r.width>=innerWidth*.9&&r.height>=innerHeight*.9&&el.children.length>0;
  }
  function polys(r){
    var W=innerWidth,H=innerHeight,up=r.top+r.height/2<H/2;
    var by=up?H-r.bottom:r.top,bh=r.height,bcx=r.left+r.width/2,bw=Math.max(r.width,24);
    function lerp(a,c,t){return a+(c-a)*t}
    function lv(yk,cx,hw){return[0,1,2,3].map(function(k){return{y:yk(k),cx:cx(k),hw:hw(k)}})}
    var S=lv(function(k){return by+bh*k/3},function(){return bcx},function(){return bw/2}),
        E=lv(function(k){return H*k/3},function(){return W/2},function(){return W/2}),
        M=lv(function(k){return lerp(H*.03,by+bh,k/3)},function(k){return lerp(W/2,bcx,Math.pow(k/3,1.4))},function(k){return lerp(W*.47,bw/2,Math.pow(k/3,1.7))});
    function poly(L){var p=[[L[0].cx-L[0].hw,L[0].y],[L[0].cx+L[0].hw,L[0].y],[L[1].cx+L[1].hw,L[1].y],[L[2].cx+L[2].hw,L[2].y],[L[3].cx+L[3].hw,L[3].y],[L[3].cx-L[3].hw,L[3].y],[L[2].cx-L[2].hw,L[2].y],[L[1].cx-L[1].hw,L[1].y]];
      return 'polygon('+p.map(function(q){return q[0].toFixed(1)+'px '+(up?H-q[1]:q[1]).toFixed(1)+'px'}).join(',')+')'}
    return[poly(S),poly(M),poly(E)];
  }
  function rectOf(b){if(!b||!b.isConnected||!b.getClientRects().length)return null;var r=b.getBoundingClientRect();return r.width&&r.height?r:null}
  function open(el){
    if(noMotion()||!el.animate||(el.getAnimations&&el.getAnimations().length))return;
    if(Date.now()-lastT>1500)return;var r=rectOf(last);if(!r)return;
    el.__gR=r;el.__gB=last;var p=polys(r);
    el.animate([{clipPath:p[0],opacity:.5},{clipPath:p[1],opacity:1,offset:.45},{clipPath:p[2]}],{duration:460,easing:'cubic-bezier(.3,.7,.2,1)'});
  }
  function close(el){
    if(!el.__gR||noMotion())return;var r=rectOf(el.__gB)||el.__gR;el.__gR=null;
    try{/* kopija prozora (ista izgleda, ne reaguje na klik) se uvuče u dugme; pravi prozor je već zatvoren */
      var c=el.cloneNode(true);c.hidden=false;c.setAttribute('aria-hidden','true');c.setAttribute('data-no-genie','');c.style.pointerEvents='none';
      (el.parentNode&&el.isConnected?el.parentNode:document.body).appendChild(c);
      var p=polys(r);var a=c.animate([{clipPath:p[2]},{clipPath:p[1],offset:.55},{clipPath:p[0],opacity:.4}],{duration:340,easing:'cubic-bezier(.5,0,.75,.4)'});
      a.onfinish=a.oncancel=function(){c.remove()};setTimeout(function(){c.remove()},900);
    }catch(e){}
  }
  function scan(n){if(n.nodeType!==1||Date.now()-lastT>1500)return;if(isOverlay(n))open(n)}
  var mo=new MutationObserver(function(list){
    list.forEach(function(m){
      if(m.type==='attributes'){var el=m.target;if(!(el instanceof HTMLElement))return;
        if(m.oldValue!==null&&!el.hidden)scan(el);/* hidden skinut → otvoren */
        else if(m.oldValue===null&&el.hidden)close(el);/* hidden stavljen → zatvoren */
      }else{
        if(m.target!==document.body)return;/* novi prozori se dodaju direktno u stranicu */
        m.addedNodes.forEach(scan);
        m.removedNodes.forEach(function(n){if(n.nodeType===1&&n.__gR)close(n)});
      }
    });
  });
  function start(){mo.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden'],attributeOldValue:true})}
  window.__mtGenieOpen=open;window.__mtGenieClose=close;
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
})();
