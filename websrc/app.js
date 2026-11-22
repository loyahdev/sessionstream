import {setDisclosureOpen} from '/websrc/disclosures.js';
const $=selector=>document.querySelector(selector);
const placeholder=$('#placeholder-dialog');placeholder.querySelectorAll('.placeholder-close,.placeholder-done').forEach(button=>button.addEventListener('click',()=>placeholder.close()));

const themeToggle=$('.theme-toggle'),systemTheme=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';themeToggle.setAttribute('aria-pressed',String(dark));themeToggle.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');themeToggle.title=themeToggle.getAttribute('aria-label');document.querySelector('meta[name="theme-color"]').content='#15221a'}
applyTheme(document.documentElement.dataset.theme||'light');themeToggle.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(next);try{localStorage.setItem('sessionstream-theme',next)}catch{}});
systemTheme.addEventListener('change',event=>{try{if(!localStorage.getItem('sessionstream-theme'))applyTheme(event.matches?'dark':'light')}catch{}});
const spectrum=$('.footer-spectrum');for(let i=0;i<100;i++){const bar=document.createElement('i');bar.style.setProperty('--level',`${10+Math.pow(Math.abs(Math.sin(i*.17)*Math.cos(i*.067)),.7)*80}px`);bar.style.setProperty('--beat',`${-i*.09}s`);spectrum.append(bar)}
document.addEventListener('visibilitychange',()=>document.documentElement.classList.toggle('page-hidden',document.hidden));

// The hero starts edge-to-edge and settles into its rounded page composition.
(function heroScroll(){
 const hero=$('.hero-composition'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 if(!hero)return;
 let frame=null;
 function paint(){frame=null;const h=hero.offsetHeight;const progress=reduced.matches?0:Math.min(1,Math.max(0,window.scrollY/(h*.65)));const scale=1-progress*.06;hero.style.setProperty('--hero-scale',scale.toFixed(4));hero.style.setProperty('--hero-corner',`${progress*(innerWidth<600?85:150)}px`);hero.style.setProperty('--hero-small-corner',`${progress*18}px`);}
 function schedule(){if(frame===null)frame=requestAnimationFrame(paint)}
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});reduced.addEventListener('change',schedule);paint();
})();

// Native mobile navigation stays keyboard accessible without JavaScript.
const mobileNav=$('.mobile-nav');
if(mobileNav){
 mobileNav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{setDisclosureOpen(mobileNav,false)}));
 mobileNav.addEventListener('keydown',event=>{if(event.key==='Escape'&&mobileNav.open){setDisclosureOpen(mobileNav,false);mobileNav.querySelector('summary').focus()}});
}
