// Animate every native disclosure in both directions, retaining native no-script behavior.
const disclosureMotion=matchMedia('(prefers-reduced-motion: reduce)');
const disclosures=new Map();
export function setDisclosureOpen(details,open){
 const state=disclosures.get(details);if(!state)return;
 const {summary,popup}=state;
 const current=details.getBoundingClientRect().height;
 const popupFrame=popup&&state.animation?{opacity:getComputedStyle(popup).opacity,transform:getComputedStyle(popup).transform,clipPath:getComputedStyle(popup).clipPath}:null;
 state.animation?.cancel();state.animation=null;state.open=open;
 summary.setAttribute('aria-expanded',String(open));
 details.dataset.expanded=String(open);
 const finish=()=>{details.open=open;details.style.overflow='';state.animation=null;};
 if(!open&&details.contains(document.activeElement)&&document.activeElement!==summary)summary.focus({preventScroll:true});
 if(disclosureMotion.matches||!details.animate){finish();return;}
 if(popup){
  details.open=true;
  const animation=popup.animate(open?
   [popupFrame||{opacity:0,transform:'translateY(-8px)',clipPath:'inset(0 0 12% 0)'},{opacity:1,transform:'translateY(0)',clipPath:'inset(0)'}]:
   [popupFrame||{opacity:1,transform:'translateY(0)',clipPath:'inset(0)'},{opacity:0,transform:'translateY(-6px)',clipPath:'inset(0 0 12% 0)'}],
   {duration:open?240:180,easing:'cubic-bezier(.22,1,.36,1)'});
  state.animation=animation;animation.onfinish=finish;return;
 }
 const style=getComputedStyle(details);
 const collapsed=summary.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
 details.open=true;details.style.overflow='hidden';
 const target=open?details.getBoundingClientRect().height:collapsed;
 const animation=details.animate([{height:current+'px'},{height:target+'px'}],{duration:open?300:220,easing:'cubic-bezier(.22,1,.36,1)'});
 state.animation=animation;animation.onfinish=finish;
}
for(const details of document.querySelectorAll('details')){
 const summary=details.querySelector(':scope > summary');if(!summary)continue;
 const state={summary,popup:details.classList.contains('mobile-nav')?details.querySelector(':scope > nav'):null,open:details.open,animation:null};
 disclosures.set(details,state);summary.setAttribute('aria-expanded',String(state.open));details.dataset.expanded=String(state.open);
 summary.addEventListener('click',event=>{event.preventDefault();setDisclosureOpen(details,!state.open)});
 details.addEventListener('toggle',()=>{if(!state.animation){state.open=details.open;summary.setAttribute('aria-expanded',String(state.open));details.dataset.expanded=String(state.open)}});
}
disclosureMotion.addEventListener('change',()=>{if(disclosureMotion.matches)for(const [details,state] of disclosures){state.animation?.cancel();state.animation=null;details.open=state.open;details.style.overflow='';}});

