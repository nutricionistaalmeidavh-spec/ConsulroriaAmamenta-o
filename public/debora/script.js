document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',e=>{const target=document.querySelector(link.getAttribute('href'));if(target){e.preventDefault();target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}}));

async function mountOriginalBrandMotion(){
  const host=document.querySelector('#brandMotion');if(!host)return;
  const source=await fetch('public/logo-motion-original.html').then(r=>r.text());
  const original=new DOMParser().parseFromString(source,'text/html');
  const shadow=host.attachShadow({mode:'open'}),style=original.querySelector('style')?.textContent||'',stage=original.querySelector('.stage');
  if(!stage)return;
  stage.querySelector('.hint')?.remove();
  stage.querySelector('.progress')?.remove();
  shadow.innerHTML=`<style>${style}:host{display:block;height:100%;overflow:hidden}.stage{height:100%!important;min-height:0!important;background:#fffaf7}.logo{width:min(64vw,330px)!important}</style>${stage.outerHTML}`;
  const scene=shadow.querySelector('.stage'),set=(key,value)=>scene.style.setProperty(key,value),clamp=(value,a=0,b=1)=>Math.max(a,Math.min(b,value)),ease=t=>1-Math.pow(1-t,3),range=(p,a,b)=>clamp((p-a)/(b-a)),mix=(a,b,t)=>a+(b-a)*t;
  const render=p=>{const card=ease(range(p,0,.2)),mother=ease(range(p,.25,.45)),baby=ease(range(p,.45,.65)),heart=ease(range(p,.65,.83)),finish=ease(range(p,.83,1));set('--co',card);set('--cs',mix(.92,1,card));set('--mo',mother);set('--mx',mix(-26,0,mother)+'px');set('--my',mix(32,0,mother)+'px');set('--ms',mix(.96,1,mother));set('--mclip',mix(100,0,mother)+'%');set('--bo',baby);set('--bx',mix(48,0,baby)+'px');set('--by',mix(52,0,baby)+'px');set('--bs',mix(.76,1,baby));set('--ho',heart);set('--hy',mix(12,0,heart)+'px');set('--hs',mix(.72,1,heart)+(heart>.89?Math.sin((heart-.89)/.11*Math.PI)*.08:0));set('--ly',mix(16,-2,finish)+'px');set('--ls',mix(.94,1,finish));set('--gscale',mix(.72,1.05,finish));set('--gopacity',mix(.16,.48,finish));set('--sho',finish);set('--shx',mix(-72,72,finish)+'%')};
  const updateFromScroll=()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches){render(1);return}const section=host.parentElement,rect=section.getBoundingClientRect(),lead=innerHeight*.55,distance=Math.max(section.offsetHeight-innerHeight+lead,1);render(clamp((-rect.top+lead)/distance))};
  addEventListener('scroll',updateFromScroll,{passive:true});addEventListener('resize',updateFromScroll);updateFromScroll();
}
mountOriginalBrandMotion().catch(()=>{});
