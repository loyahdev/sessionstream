const makeWave = (selector, count, scale) => {
 const root=document.querySelector(selector);if(!root)return;
 for(let i=0;i<count;i++){const bar=document.createElement('i');const edge=Math.sin((i/(count-1))*Math.PI);const variation=.45+.55*Math.abs(Math.sin(i*1.8));bar.style.setProperty('--height',`${Math.max(5,edge*variation*scale)}px`);bar.style.setProperty('--delay',`${i*-.13}s`);root.append(bar);}
};
makeWave('.stream-bars',24,42);
const dialog=document.querySelector('#image-dialog');
document.querySelectorAll('[data-image]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#dialog-image').src=button.dataset.image;document.querySelector('#dialog-image').alt=button.dataset.caption;document.querySelector('#dialog-caption').textContent=button.dataset.caption;dialog.showModal();document.querySelector('#dialog-caption').focus({preventScroll:true})}));
function closeImage(){if(!dialog.open||dialog.classList.contains('is-closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close();return}dialog.classList.add('is-closing');setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing')},150)}
dialog.addEventListener('cancel',event=>{event.preventDefault();closeImage()});
document.querySelector('.dialog-close').addEventListener('click',closeImage);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeImage()}});

const spectrum=document.querySelector('.footer-spectrum');
for(let i=0;i<96;i++){const bar=document.createElement('i');const wave=Math.pow(Math.abs(Math.sin(i*.17)*Math.cos(i*.067)),.7);bar.style.setProperty('--level',`${8+wave*69}px`);bar.style.setProperty('--beat',`${-i*.09}s`);spectrum.append(bar);}

const placeholderDialog=document.querySelector('#placeholder-dialog');
placeholderDialog.querySelectorAll('.placeholder-close,.placeholder-done').forEach(button=>button.addEventListener('click',()=>placeholderDialog.close()));
if('IntersectionObserver' in window){const animationObserver=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.classList.toggle('is-offscreen',!entry.isIntersecting)),{rootMargin:'100px'});document.querySelectorAll('.intro,.intro-product-stage,.studio-footer').forEach(el=>animationObserver.observe(el));}

const themeToggle=document.querySelector('.theme-toggle');
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';themeToggle.setAttribute('aria-pressed',String(dark));themeToggle.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');themeToggle.title=themeToggle.getAttribute('aria-label');document.querySelector('meta[name="theme-color"]').content=dark?'#131912':'#efefe7';}
applyTheme(document.documentElement.dataset.theme||'light');
themeToggle.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(next);try{localStorage.setItem('sessionstream-theme',next)}catch{}});
systemTheme.addEventListener('change',event=>{try{if(!localStorage.getItem('sessionstream-theme'))applyTheme(event.matches?'dark':'light')}catch{}});

// Keep native details semantics and keyboard activation, with reversible height motion.
document.querySelectorAll('.faq-list details, details.plan-comparison').forEach(details=>{
 const summary=details.querySelector('summary');let animation=null,expanded=details.open;
 summary.setAttribute('aria-expanded',String(expanded));
 summary.addEventListener('click',event=>{
  event.preventDefault();expanded=!expanded;summary.setAttribute('aria-expanded',String(expanded));
  const start=details.getBoundingClientRect().height;animation?.cancel();animation=null;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){details.open=expanded;details.style.overflow='';return}
  details.open=true;const end=expanded?details.getBoundingClientRect().height:summary.getBoundingClientRect().height;
  details.style.overflow='hidden';animation=details.animate([{height:`${start}px`},{height:`${end}px`}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
  animation.onfinish=()=>{details.open=expanded;details.style.overflow='';animation=null};
 });
});
