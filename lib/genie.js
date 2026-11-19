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

/* Oblačić (od 1.8.1): kad tekst ne staje u polje (npr. Rok izrade, Izdaje), pređi mišem preko polja →
   posle kratkog zadržavanja ceo tekst iskoči u oblačiću iznad polja (animacija 1 s). Radi u celoj aplikaciji. */
(function(){
  if(window.__mtTip)return;window.__mtTip=1;
  var tip=null,timer=null,cur=null,ctx=null;
  var SEL='input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]):not([type=date]):not([type=time]),select,textarea';
  function txt(el){if(el.tagName==='SELECT'){var o=el.options[el.selectedIndex];return o?o.text:''}return el.value||''}
  function cut(el){var t=txt(el);if(!t)return false;var cs=getComputedStyle(el);
    if(el.tagName==='SELECT'){ctx=ctx||document.createElement('canvas').getContext('2d');ctx.font=cs.font;return ctx.measureText(t).width>el.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-6}
    if(el.tagName==='TEXTAREA')return el.scrollHeight>el.clientHeight+2;
    return el.scrollWidth>el.clientWidth+1}
  function hide(){clearTimeout(timer);timer=null;cur=null;if(tip){var t=tip;tip=null;try{t.animate([{opacity:1},{opacity:0}],{duration:160}).onfinish=function(){t.remove()}}catch(e){t.remove()}setTimeout(function(){t.remove()},400)}}
  function show(el){
    var d=document.createElement('div');d.setAttribute('role','tooltip');d.setAttribute('data-no-genie','');
    d.style.cssText='position:fixed;z-index:2147483000;pointer-events:none;max-width:min(460px,calc(100vw - 16px));box-sizing:border-box;padding:9px 13px;border-radius:11px;background:#232B36;color:#fff;font:500 13.5px/1.45 '+getComputedStyle(document.body).fontFamily+';white-space:pre-wrap;word-break:break-word;box-shadow:0 12px 32px rgba(0,0,0,.28)';
    d.textContent=txt(el);var ar=document.createElement('span');ar.style.cssText='position:absolute;width:12px;height:12px;background:#232B36;transform:rotate(45deg)';d.appendChild(ar);
    document.body.appendChild(d);
    var r=el.getBoundingClientRect(),w=d.offsetWidth,h=d.offsetHeight,left=Math.min(Math.max(8,r.left),innerWidth-w-8),above=r.top>h+16,top=above?r.top-h-10:r.bottom+10;
    d.style.left=left+'px';d.style.top=top+'px';
    var ax=Math.min(Math.max(12,r.left+Math.min(28,r.width/2)-left),w-24);ar.style.left=ax+'px';if(above)ar.style.bottom='-5px';else ar.style.top='-5px';
    d.style.transformOrigin=(ax+6)+'px '+(above?'100%':'0');
    try{d.animate([{opacity:0,transform:'scale(.15)'},{opacity:1,transform:'scale(1.06)',offset:.55},{opacity:1,transform:'scale(.98)',offset:.8},{opacity:1,transform:'scale(1)'}],{duration:1000,easing:'cubic-bezier(.22,.8,.25,1)'})}catch(e){}
    tip=d}
  document.addEventListener('mouseover',function(e){var el=e.target;if(!el||!el.matches||!el.matches(SEL)||el===cur)return;hide();
    if(document.activeElement===el||!cut(el))return;cur=el;timer=setTimeout(function(){if(cur===el&&el.isConnected)show(el)},300)},true);
  document.addEventListener('mouseout',function(e){if(e.target===cur)hide()},true);
  ['focusin','keydown','pointerdown','wheel'].forEach(function(ev){addEventListener(ev,function(){if(cur||tip)hide()},true)});
  addEventListener('scroll',function(){if(cur||tip)hide()},true);
})();
