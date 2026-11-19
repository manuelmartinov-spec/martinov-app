/* Martinov aplikacija – „duh iz lampe“ (od 1.8.0; 1.8.2: 1 sekunda; 1.8.3: pravo savijanje kao tečnost – vidi warp)
   Svaki prozor preko celog ekrana (dijalog, list, pregled) izađe iz onoga na šta si kliknuo – kao duh iz Aladinove lampe:
   pojavi se kao dim iz ikone, izdigne se, naduva (malo preko mere) i smiri. Pri zatvaranju se uvuče nazad.
   Radi sam: prati klikove i prozore koji se pojave (hidden → vidljiv, ili dodat u stranicu), bez izmena u ostalom kodu.
   Preskače samo elemente sa data-no-genie. (Namerno radi i kad je u Windows-u isključeno „Animacije“ – Manuel ga želi.) */
(function(){
  if(window.__mtGenie)return;window.__mtGenie=1;
  var last=null,lastT=0,OPEN=1000,CLOSE=560;
  /* izvor = ono na šta je kliknuto: dugme, red, kartica… (najbliži element sa rukicom miša) */
  addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
    var b=t.closest('button,a,.chip,.titem,.rbtn,[role=button],[onclick]');
    if(!b){var n=t;for(var i=0;i<6&&n&&n!==document.body;i++,n=n.parentElement){if(getComputedStyle(n).cursor==='pointer'){b=n;break}}}
    last=b||t;lastT=Date.now()},true);
  function isOverlay(el){
    if(!(el instanceof HTMLElement)||el.hidden||el.hasAttribute('data-no-genie')||el.closest('[data-no-genie]'))return false;
    var cs=getComputedStyle(el);if(cs.position!=='fixed'||cs.display==='none'||cs.visibility==='hidden')return false;
    var r=el.getBoundingClientRect();return r.width>=innerWidth*.9&&r.height>=innerHeight*.9&&el.children.length>0;
  }
  /* prozor u prozoru (npr. bela kutija na zatamnjenoj pozadini) – najveće dete, ako ne pokriva skoro ceo ekran */
  function vis(r){var L=Math.max(r.left,0),T=Math.max(r.top,0),R=Math.min(r.right,innerWidth),Bm=Math.min(r.bottom,innerHeight);return{left:L,top:T,width:Math.max(0,R-L),height:Math.max(0,Bm-T)}}
  function boxOf(el){var best=null,ba=0;for(var i=0;i<el.children.length;i++){var c=el.children[i];if(c.hidden)continue;var v=vis(c.getBoundingClientRect()),a=v.width*v.height;if(a>ba){ba=a;best=c}}
    return best&&ba<innerWidth*innerHeight*.85?best:null}/* (vidljivi deo – kutija može biti duža od ekrana) */
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
  /* kutija: dim iz ikone → izdigne se uzan i visok → naduva se malo preko mere → smiri se */
  function boxFrames(B,r){
    var dx=(r.left+r.width/2)-(B.left+B.width/2),dy=(r.top+r.height/2)-(B.top+B.height/2);
    var sx=Math.max(r.width/B.width,.04),sy=Math.max(r.height/B.height,.03),sk=dx>0?-9:9;
    return[
      {transform:'translate('+dx+'px,'+dy+'px) scale('+sx+','+sy+')',opacity:.15,filter:'blur(12px)',offset:0,easing:'ease-in-out'},
      {transform:'translate('+(dx*.5)+'px,'+(dy*.6)+'px) skewX('+sk+'deg) scale('+Math.max(sx*1.4,.16)+',.5)',opacity:.7,filter:'blur(7px)',offset:.35,easing:'cubic-bezier(.2,.7,.3,1)'},
      {transform:'translate(0,0) skewX(0deg) scale(1.08,.94)',opacity:1,filter:'blur(0px)',offset:.68,easing:'ease-in-out'},
      {transform:'scale(.97,1.04)',offset:.82,easing:'ease-in-out'},
      {transform:'scale(1.01,.99)',offset:.93,easing:'ease-out'},
      {transform:'none',opacity:1,filter:'blur(0px)',offset:1}];
  }
  /* PRAVI duh iz lampe (1.8.3, kao macOS „genie“ / genie-gallery): prozor se savija kao tečnost – deo bliži ikoni se suzi u vrat
     koji ulazi u ikonu, a dalji deo se raširi. Prozor se iseče na tanke vodoravne trake (kopije prozora), a svaka traka 60 puta
     u sekundi dobije svoju visinu, položaj i širinu po glatkoj krivoj. Prozor se vidi ceo i oštar, bez slike-snimka. */
  function sstep(a,b,x){x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x)}
  function lerp(a,b,t){return a+(b-a)*t}
  function syncVals(src,dst){/* upisane vrednosti polja (value) prepiši u atribute da ih kopije zadrže */
    var a=src.querySelectorAll('input,textarea,select'),b=dst.querySelectorAll('input,textarea,select');
    for(var i=0;i<a.length&&i<b.length;i++){var s=a[i],d=b[i];
      if(s.tagName==='TEXTAREA')d.textContent=s.value;
      else if(s.tagName==='SELECT'){var o=d.options[s.selectedIndex];if(o)o.setAttribute('selected','')}
      else if(s.type==='checkbox'||s.type==='radio'){if(s.checked)d.setAttribute('checked','');else d.removeAttribute('checked')}
      else d.setAttribute('value',s.value)}}
  function warp(el,r,closing,done){
    var box=boxOf(el),tgt=box||el;
    if(tgt.querySelector('iframe,video,embed,object'))return false;
    var n=tgt.getElementsByTagName('*').length;if(n>3000)return false;
    var B0=tgt.getBoundingClientRect(),B=vis(B0);if(B.width<40||B.height<40)return false;
    var N=Math.max(16,Math.min(72,Math.round(B.height/7),Math.floor(50000/(n+20))));
    var self=!box,host=self?document.body:el,hr=self?{left:0,top:0}:el.getBoundingClientRect();
    var wrap=document.createElement('div');wrap.setAttribute('data-no-genie','');wrap.setAttribute('aria-hidden','true');
    wrap.style.cssText='position:'+(self?'fixed':'absolute')+';left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147482000;opacity:0';
    var base=tgt.cloneNode(true);base.removeAttribute('hidden');base.removeAttribute('data-no-genie');syncVals(tgt,base);
    /* „lepljiva“ zaglavlja/dna (sticky) bi se u svakoj traci zalepila – u kopijama ih vrati u običan raspored */
    var oa=tgt.getElementsByTagName('*'),ca=base.getElementsByTagName('*');for(var i=0;i<oa.length;i++){if(getComputedStyle(oa[i]).position==='sticky'&&ca[i])ca[i].style.setProperty('position','relative','important')}
    var sh=B.height/N,strips=[];
    for(var k=0;k<N;k++){var s=document.createElement('div');
      s.style.cssText='position:absolute;overflow:hidden;transform-origin:0 0;will-change:transform;left:'+(B.left-hr.left)+'px;top:'+(B.top-hr.top+k*sh)+'px;width:'+B.width+'px;height:'+(sh+1.5)+'px';
      var c=k===N-1?base:base.cloneNode(true),cs=c.style;
      [['position','absolute'],['left',(B0.left-B.left)+'px'],['top',(B0.top-B.top-k*sh)+'px'],['right','auto'],['bottom','auto'],['width',B0.width+'px'],['height',B0.height+'px'],
       ['max-width','none'],['max-height','none'],['min-height','0'],['margin','0'],['transform','none'],['animation','none'],['transition','none'],['visibility','visible'],['opacity','1'],['clip-path','none']]
        .forEach(function(q){cs.setProperty(q[0],q[1],'important')});
      s.appendChild(c);wrap.appendChild(s);strips.push(s)}
    host.appendChild(wrap);
    var po=tgt.style.getPropertyValue('opacity'),pp=tgt.style.getPropertyPriority('opacity');tgt.style.setProperty('opacity','0','important');
    /* geometrija: „daleka“ ivica prozora (dalje od ikone) i „bliska“ (kod ikone) */
    var up=r.top+r.height/2<B.top+B.height/2,
        farF=up?B.top+B.height:B.top,nearF=up?B.top:B.top+B.height,far0=up?r.top+r.height:r.top,near0=up?r.top:r.top+r.height,
        rl=r.left,rr=r.left+r.width,bl=B.left,br=B.left+B.width;
    function rowY(u,p){var d=up?1-u:u;return lerp(lerp(far0,farF,sstep(0,.6,p)),lerp(near0,nearF,sstep(.4,1,p)),d)}
    function rowK(u,p){var d=up?1-u:u;return sstep(0,1,(1-d)*1.7*sstep(0,.6,p)+sstep(.42,1,p))}
    function frame(p){
      for(var k=0;k<N;k++){var u0=k/N,u1=(k+1)/N,y0=rowY(u0,p),y1=rowY(u1,p),k0=rowK(u0,p),k1=rowK(u1,p),
          L0=lerp(rl,bl,k0),R0=lerp(rr,br,k0),L1=lerp(rl,bl,k1),R1=lerp(rr,br,k1),L=Math.min(L0,L1),R=Math.max(R0,R1),sx=Math.max((R-L)/B.width,.001),st=strips[k].style;
        st.transform='translate('+(L-B.left).toFixed(2)+'px,'+(y0-(B.top+k*sh)).toFixed(2)+'px) scale('+sx.toFixed(4)+','+Math.max((y1-y0)/sh,.001).toFixed(4)+')';
        /* kose ivice trake (gornja i donja širina) → glatka kriva bez stepenica */
        st.clipPath=Math.abs(L0-L1)+Math.abs(R0-R1)<.5?'none':'polygon('+((L0-L)/sx).toFixed(1)+'px 0,'+((R0-L)/sx).toFixed(1)+'px 0,'+((R1-L)/sx).toFixed(1)+'px 100%,'+((L1-L)/sx).toFixed(1)+'px 100%)'}
      wrap.style.opacity=String(Math.min(1,p*6));
      var bl_=p<.55?(1-p/.55)*5:0;wrap.style.filter=bl_>.2?'blur('+bl_.toFixed(1)+'px)':'none';/* dim na početku */
    }
    var bg=box?getComputedStyle(el).backgroundColor:null;
    if(box&&!closing)try{el.animate([{backgroundColor:'rgba(0,0,0,0)'},{backgroundColor:bg}],{duration:OPEN*.55,easing:'ease-out'})}catch(e){}
    if(box&&closing)try{el.animate([{backgroundColor:bg},{backgroundColor:'rgba(0,0,0,0)'}],{duration:CLOSE,easing:'ease-in',fill:'forwards'})}catch(e){}
    var dur=closing?CLOSE:OPEN,t0=performance.now(),fin=false;
    function ease(t){return closing?t*t*(3-2*t):(t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2)}
    function end(){if(fin)return;fin=true;wrap.remove();if(po)tgt.style.setProperty('opacity',po,pp);else tgt.style.removeProperty('opacity');if(done)done()}
    frame(closing?1:0);
    (function tick(now){var t=Math.min(1,(now-t0)/dur),e=ease(t),p=closing?1-e:e;frame(p);if(t<1)requestAnimationFrame(tick);else end()})(t0);
    setTimeout(end,dur+600);/* sigurnost (npr. kartica u pozadini) */
    return true}
  function rectOf(b){if(!b||!b.isConnected||!b.getClientRects().length)return null;var r=b.getBoundingClientRect();return r.width&&r.height?r:null}
  function play(el,r,closing){
    var box=boxOf(el);
    if(box){var B0=box.getBoundingClientRect(),B=vis(B0),f=boxFrames(B,r),bg=getComputedStyle(el).backgroundColor;
      var po=box.style.transformOrigin;box.style.transformOrigin=(B.left-B0.left+B.width/2)+'px '+(B.top-B0.top+B.height/2)+'px';
      if(closing){f=[f[0],f[1],f[2],f[5]].reverse().map(function(k,i){var o={};for(var x in k)if(x!=='offset'&&x!=='easing')o[x]=k[x];o.offset=[0,.3,.68,1][i];o.easing='ease-in';return o})}
      var a=box.animate(f,{duration:closing?CLOSE:OPEN,easing:'linear'});
      a.addEventListener('finish',function(){box.style.transformOrigin=po});a.addEventListener('cancel',function(){box.style.transformOrigin=po});
      el.animate(closing?[{backgroundColor:bg},{backgroundColor:'rgba(0,0,0,0)'}]:[{backgroundColor:'rgba(0,0,0,0)'},{backgroundColor:bg}],{duration:closing?CLOSE:OPEN*.55,easing:'ease-out'});
      return a}
    var p=polys(r);
    return el.animate(closing?[{clipPath:p[2]},{clipPath:p[1],offset:.55},{clipPath:p[0],opacity:.3,filter:'blur(8px)'}]
      :[{clipPath:p[0],opacity:.3,filter:'blur(10px)'},{clipPath:p[1],opacity:1,filter:'blur(3px)',offset:.45},{clipPath:p[2],filter:'blur(0px)'}],
      {duration:closing?CLOSE:OPEN,easing:closing?'cubic-bezier(.55,0,.8,.35)':'cubic-bezier(.25,.75,.25,1)'});
  }
  function open(el){
    if(!el.animate||el.__gBusy||(el.getAnimations&&el.getAnimations().length))return;
    if(Date.now()-lastT>1500)return;var r=rectOf(last);if(!r)return;
    if(el.__gBusy)return;el.__gR=r;el.__gB=last;el.__gBusy=true;
    var ok=false;try{ok=warp(el,r,false,function(){el.__gBusy=false})}catch(e){ok=false}
    if(!ok){el.__gBusy=false;try{play(el,r,false)}catch(e){}}
  }
  function close(el){
    if(!el.__gR)return;var r=rectOf(el.__gB)||el.__gR;el.__gR=null;
    try{/* kopija prozora (ista izgleda, ne reaguje na klik) se uvuče u ikonu; pravi prozor je već zatvoren */
      var c=el.cloneNode(true);c.hidden=false;c.setAttribute('aria-hidden','true');c.setAttribute('data-no-genie','');c.style.pointerEvents='none';
      (el.parentNode&&el.isConnected?el.parentNode:document.body).appendChild(c);
      var ok=false;try{ok=warp(c,r,true,function(){c.remove()})}catch(e){ok=false}
      if(!ok){var a=play(c,r,true);a.onfinish=a.oncancel=function(){c.remove()}}setTimeout(function(){c.remove()},CLOSE+900);
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
