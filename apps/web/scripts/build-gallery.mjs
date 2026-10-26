// Builds the pages to browse the screenshots capture-gallery.mjs took:
//   index.html   one self-contained file (images embedded): share it or open it from disk
//   viewer.html  the same page pointing at the image files next to it: small and fast, serve the folder over http
// Run on its own to rebuild them from what is already in the gallery folder:
//   node scripts/build-gallery.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GALLERY_DIR = path.join(web, "test-results", "gallery");

const GROUPS = {
  "01-launch": ["Launch", "The splash, the welcome slides and the location primer, in the order a first-time visitor sees them."],
  "02-tabs": ["The four tabs", "Home, Services, Activity and Account: the only screens with the tab bar."],
  "03-account": ["Account pages", "Saved places, preferences, classes, help and the safety toolkit."],
  "04-tools": ["Tools", "Search, night travel, transit near you and campus parking."],
  "05-light": ["Light appearance", "The same screens with the light theme on."],
  "06-car": ["Parked car", "Saving where you parked and finding your way back."],
  "07-trip": ["A trip from start to finish", "The option ranked first when the screens were captured: search → options → one option in full → guidance step by step → arrival → Activity → receipt. Times such as “Took 1 min” come from clicking through the steps instantly."],
  "08-other": ["The other kind of option", "The same trip with the other kind of option (a drive-and-park option if the first was not driving, otherwise a non-driving one), so both kinds of guidance steps are shown."],
  "09-analysis": ["Analysis workspace", "The school-safety side: Analyze, Explore, Schools, Methodology and the rest."],
};
// [key, label, capture size, image width, image height] (the screenshots are taken at the CSS size)
const VIEWPORTS = [
  ["phone", "Phone", "390 × 844", 390, 844],
  ["tablet", "Tablet", "820 × 1180", 820, 1180],
  ["desktop", "Desktop", "1440 × 900", 1440, 900],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const CSS = `
:root{--bg:#f3f4f0;--panel:#fff;--ink:#0f1211;--mute:#5a625d;--line:#dde0d9;--chrome:#e7e9e3;--accent:#06c167;--on-accent:#032313;--bezel:#14171a;--ring:rgba(0,0,0,.18);--lift:0 22px 44px -26px rgba(15,18,17,.45);--hero:#06c16722}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0b0d0e;--panel:#14171a;--ink:#f1f4f2;--mute:#9aa39e;--line:#242a2d;--chrome:#1d2225;--ring:rgba(255,255,255,.16);--lift:0 22px 44px -22px rgba(0,0,0,.9);--hero:#06c16730}}
:root[data-theme=dark]{--bg:#0b0d0e;--panel:#14171a;--ink:#f1f4f2;--mute:#9aa39e;--line:#242a2d;--chrome:#1d2225;--ring:rgba(255,255,255,.16);--lift:0 22px 44px -22px rgba(0,0,0,.9);--hero:#06c16730}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Inter Variable",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.bar1{display:flex;align-items:center;gap:14px;padding:10px 24px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;margin-right:auto}
.brand .mark{width:22px;height:22px;border-radius:50%;background:var(--accent);display:grid;place-items:center}
.brand .mark::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--on-accent)}
.brand small{font-weight:500;color:var(--mute)}
.seg{display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--panel);border:1px solid var(--line)}
.seg button{border:0;background:transparent;padding:6px 14px;border-radius:999px;cursor:pointer;font-weight:600;font-size:14px;color:var(--mute);display:flex;gap:7px;align-items:center}
.seg button span{font-weight:500;font-size:12px;opacity:.8}
.seg button[aria-selected=true]{background:var(--accent);color:var(--on-accent)}
.seg button:not([aria-selected=true]):hover{color:var(--ink)}
.theme{border:1px solid var(--line);background:var(--panel);width:36px;height:36px;border-radius:50%;cursor:pointer;display:grid;place-items:center}
.chips{display:flex;gap:6px;padding:0 24px 10px;overflow-x:auto;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chips a{flex:none;color:var(--mute);text-decoration:none;font-size:13px;font-weight:500;padding:5px 12px;border-radius:999px;border:1px solid transparent}
.chips a:hover{color:var(--ink)}
.chips a[aria-current=true]{color:var(--ink);border-color:var(--line);background:var(--panel)}
.chips a[hidden]{display:none}

.hero{position:relative;overflow:hidden;padding:56px 24px 40px;border-bottom:1px solid var(--line)}
.hero svg{position:absolute;right:-40px;top:-30px;width:520px;max-width:80vw;height:auto;color:var(--accent);opacity:.9;pointer-events:none}
.hero .in{position:relative;max-width:1500px;margin:0 auto}
.hero h1{font-size:clamp(34px,6vw,64px);line-height:1.02;letter-spacing:-.035em;margin:0 0 14px;max-width:760px}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero p{margin:0;color:var(--mute);max-width:640px;font-size:17px}
.stats{display:flex;gap:28px;flex-wrap:wrap;margin-top:26px}
.stats div{display:flex;flex-direction:column}
.stats b{font-size:28px;letter-spacing:-.02em;line-height:1.1}
.stats span{font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.06em}

main{max-width:1500px;margin:0 auto;padding:0 24px 96px}
section.flow{padding-top:56px;scroll-margin-top:110px}
section.flow[hidden]{display:none}
.head{display:flex;gap:18px;align-items:baseline;margin-bottom:8px}
.head .no{font-size:13px;font-weight:700;letter-spacing:.08em;color:var(--accent)}
.head h2{font-size:clamp(24px,3.2vw,34px);letter-spacing:-.025em;line-height:1.1;margin:0}
.head .count{margin-left:auto;font-size:13px;color:var(--mute);white-space:nowrap}
.lead{color:var(--mute);margin:0 0 28px;max-width:820px}

.grid{display:none;gap:44px 28px;align-items:start}
body[data-size=phone] .grid[data-vp=phone],body[data-size=tablet] .grid[data-vp=tablet],body[data-size=desktop] .grid[data-vp=desktop]{display:grid}
.grid[data-vp=phone]{grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),252px))}
.grid[data-vp=tablet]{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),330px));gap:44px 32px}
.grid[data-vp=desktop]{grid-template-columns:repeat(auto-fill,minmax(min(100%,520px),1fr));gap:48px 32px}

.shot{margin:0;min-width:0}
.frame{display:block;width:100%;border:0;padding:0;background:var(--bezel);cursor:zoom-in;box-shadow:0 0 0 1px var(--ring),var(--lift);transition:transform .22s cubic-bezier(.2,.7,.2,1),box-shadow .22s}
.frame:hover{transform:translateY(-4px)}
.frame img{display:block;width:100%;height:auto;background:var(--panel)}
[data-vp=phone] .frame{padding:7px;border-radius:38px}
[data-vp=phone] .frame img{aspect-ratio:390/844;border-radius:31px}
[data-vp=tablet] .frame{padding:11px;border-radius:28px}
[data-vp=tablet] .frame img{aspect-ratio:820/1180;border-radius:18px}
[data-vp=desktop] .frame{border-radius:12px;overflow:hidden;background:var(--chrome)}
[data-vp=desktop] .frame img{aspect-ratio:1440/900}
.dots{display:none;gap:6px;padding:10px 14px}
[data-vp=desktop] .dots{display:flex}
.dots i{width:9px;height:9px;border-radius:50%;background:var(--mute);opacity:.45}
.miss{display:grid;place-items:center;aspect-ratio:390/700;border:1px dashed var(--line);border-radius:24px;color:var(--mute);font-size:13px;text-align:center;padding:12px}
figcaption{display:flex;gap:10px;margin-top:14px;font-size:13.5px;line-height:1.4}
figcaption .n{flex:none;width:22px;height:22px;border-radius:50%;background:var(--panel);border:1px solid var(--line);color:var(--mute);font-size:11px;font-weight:700;display:grid;place-items:center;margin-top:1px}
figcaption strong{display:block;font-weight:600}
figcaption em{display:block;font-style:normal;color:var(--mute)}

dialog#big{width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(5,7,8,.95);color:#f1f4f2}
dialog#big[open]{display:flex;flex-direction:column}
dialog#big::backdrop{background:#000}
.lb-top,.lb-bot{display:flex;align-items:center;gap:14px;padding:12px 18px}
.lb-top .where{color:#9aa39e;font-size:13px;margin-right:auto}
.lb-btn{border:1px solid #2c3236;background:#14181a;color:#f1f4f2;border-radius:999px;padding:7px 14px;cursor:pointer;font-size:13px;text-decoration:none;display:inline-flex;align-items:center}
.lb-btn:hover{background:#1e2326}
.lb-btn:disabled{opacity:.3;cursor:default}
.stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 12px}
.stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;box-shadow:0 30px 80px -30px #000;background:#000}
.stage .nav{flex:none;width:46px;height:46px;padding:0;justify-content:center;font-size:20px}
.lb-bot{justify-content:center;flex-direction:column;gap:2px;text-align:center;padding-bottom:18px}
.lb-bot strong{font-size:15px}.lb-bot span{color:#9aa39e;font-size:13px;max-width:760px}

@media(max-width:640px){.bar1,.chips,main,.hero{padding-left:16px;padding-right:16px}.bar1{flex-wrap:nowrap;gap:8px}.brand{font-size:0}.brand small{display:none}.seg button{padding:6px 11px;font-size:13px}.seg button span{display:none}.stage .nav{display:none}.hero{padding-top:36px}.stats{gap:20px}.grid[data-vp=phone],.grid[data-vp=tablet]{justify-content:center}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.frame{transition:none}.frame:hover{transform:none}}
`;

const JS = `
(function(){
var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var size=null,list=[],cur=0,d=$('#big');
function setSize(s){
  size=s;document.body.dataset.size=s;
  $$('[data-show]').forEach(function(b){b.setAttribute('aria-selected',b.dataset.show===s)});
  $$('section.flow').forEach(function(sec){
    var n=$$('.grid[data-vp="'+s+'"] .shot',sec).length;
    sec.hidden=!n;$('.count',sec).textContent=n+(n===1?' screen':' screens');
  });
  $$('.chips a').forEach(function(a){var sec=document.getElementById(a.hash.slice(1));a.hidden=!sec||sec.hidden});
  try{var u=new URL(location.href);u.searchParams.set('size',s);history.replaceState(null,'',u)}catch(e){}
}
var want=null;try{want=new URL(location.href).searchParams.get('size')}catch(e){}
var first=$('[data-show]');
setSize($('[data-show="'+want+'"]')?want:(first?first.dataset.show:'phone'));
$$('[data-show]').forEach(function(b){b.addEventListener('click',function(){setSize(b.dataset.show);window.scrollTo({top:0})})});

var th=$('#theme');
th.addEventListener('click',function(){
  var dark=document.documentElement.dataset.theme?document.documentElement.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;
  document.documentElement.dataset.theme=dark?'light':'dark';
});

if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(es){es.forEach(function(e){
    if(!e.isIntersecting)return;
    $$('.chips a').forEach(function(a){a.setAttribute('aria-current',a.hash==='#'+e.target.id)});
    var on=$('.chips a[aria-current=true]');if(on&&on.scrollIntoView)on.scrollIntoView({inline:'center',block:'nearest'});
  })},{rootMargin:'-30% 0px -65% 0px'});
  $$('section.flow').forEach(function(s){io.observe(s)});
}

function show(i){
  cur=Math.max(0,Math.min(list.length-1,i));
  var s=list[cur],img=$('img',s);
  $('.stage img',d).src=img.src;$('.stage img',d).alt=img.alt;
  $('.lb-bot strong',d).textContent=s.dataset.title;$('.lb-bot span',d).textContent=s.dataset.note||'';
  $('.where',d).textContent=s.dataset.where+'  ·  '+(cur+1)+' of '+list.length;
  var dl=$('.dl',d);dl.href=img.src;dl.download=s.dataset.file;
  $('.prev',d).disabled=cur===0;$('.next',d).disabled=cur===list.length-1;
}
$$('.shot button.frame').forEach(function(b){b.addEventListener('click',function(){
  list=$$('.grid[data-vp="'+size+'"] .shot');
  show(list.indexOf(b.closest('.shot')));d.showModal();
})});
$('.prev',d).addEventListener('click',function(){show(cur-1)});
$('.next',d).addEventListener('click',function(){show(cur+1)});
$('.close',d).addEventListener('click',function(){d.close()});
d.addEventListener('click',function(e){if(e.target===d||e.target.classList.contains('stage'))d.close()});
d.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'){e.preventDefault();show(cur+1)}
  else if(e.key==='ArrowLeft'){e.preventDefault();show(cur-1)}
});
})();
`;

// Three lines meeting at a station: the same motif as the app's splash.
const MOTIF = `<svg viewBox="0 0 520 360" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" aria-hidden="true" style="opacity:.55"><path d="M0 40 L220 260 M520 40 L300 260 M260 0 V360" stroke-opacity=".18"/><path d="M60 330 L260 130 L460 330" stroke-opacity=".28"/><circle cx="260" cy="130" r="38" stroke-opacity=".5"/><circle cx="260" cy="130" r="14" fill="currentColor" stroke="none" fill-opacity=".6"/><circle cx="440" cy="310" r="12" stroke-opacity=".4"/><circle cx="260" cy="320" r="12" stroke-opacity=".4"/></svg>`;

export function buildGallery(dir = GALLERY_DIR) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const b64 = (f) => "data:image/jpeg;base64," + fs.readFileSync(path.join(dir, f)).toString("base64");
  const present = VIEWPORTS.filter(([k]) => manifest.some((m) => m.vp === k && m.ok));
  const groups = Object.entries(GROUPS).filter(([gk]) => manifest.some((m) => m.group === gk));
  const screens = manifest.filter((m) => m.ok).length;

  const render = (embed) => {
    let sections = "";
    groups.forEach(([gk, [title, lead]], gi) => {
      const items = manifest.filter((m) => m.group === gk);
      const grids = present
        .map(([k]) => {
          const list = items.filter((m) => m.vp === k);
          if (!list.length) return "";
          const figs = list
            .map((m, i) =>
              m.ok
                ? `<figure class="shot" data-title="${esc(m.title)}" data-note="${esc(m.note ?? "")}" data-where="${esc(title)}" data-file="${esc(path.basename(m.file))}"><button type="button" class="frame" aria-label="Enlarge: ${esc(m.title)}"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><img loading="lazy" decoding="async" alt="${esc(m.title)}" src="${embed ? b64(m.file) : esc(m.file)}"></button><figcaption><span class="n">${i + 1}</span><span><strong>${esc(m.title)}</strong>${m.note ? `<em>${esc(m.note)}</em>` : ""}</span></figcaption></figure>`
                : `<figure class="shot-missed"><div class="miss">Could not capture<br>${esc(m.note ?? "")}</div><figcaption><span class="n">${i + 1}</span><span><strong>${esc(m.title)}</strong></span></figcaption></figure>`,
            )
            .join("");
          return `<div class="grid" data-vp="${k}">${figs}</div>`;
        })
        .join("");
      sections += `<section class="flow" id="${gk}"><div class="head"><span class="no">${String(gi + 1).padStart(2, "0")}</span><h2>${esc(title)}</h2><span class="count"></span></div><p class="lead">${esc(lead)}</p>${grids}</section>`;
    });
    const seg = present
      .map(([k, label, , ,], i) => `<button type="button" role="tab" data-show="${k}" aria-selected="${i === 0}">${label}<span>${manifest.filter((m) => m.vp === k && m.ok).length}</span></button>`)
      .join("");
    const chips = groups.map(([gk, [title]]) => `<a href="#${gk}">${esc(title)}</a>`).join("");
    const built = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CrossMetric screens</title><style>${CSS}</style></head><body>
<header class="top"><div class="bar1"><div class="brand"><span class="mark"></span>CrossMetric <small>screens</small></div><div class="seg" role="tablist" aria-label="Screen size">${seg}</div><button type="button" id="theme" class="theme" aria-label="Switch light or dark page"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></div><nav class="chips" aria-label="Sections">${chips}</nav></header>
<div class="hero">${MOTIF}<div class="in"><h1>Every screen, <em>every phase</em>.</h1><p>The whole app as it is right now: launch, the four tabs, a trip from search to receipt, and the analysis workspace. Pick a size above and click any screen to enlarge it; the arrow keys step through the set.</p><div class="stats"><div><b>${screens}</b><span>screens</span></div><div><b>${groups.length}</b><span>flows</span></div><div><b>${present.length}</b><span>sizes</span></div><div><b>${esc(built)}</b><span>captured</span></div></div></div></div>
<main>${sections}</main>
<dialog id="big" aria-label="Enlarged screen"><div class="lb-top"><span class="where"></span><a class="lb-btn dl" href="#">Save image</a><button type="button" class="lb-btn close">Close</button></div><div class="stage"><button type="button" class="lb-btn nav prev" aria-label="Previous screen">‹</button><img alt=""><button type="button" class="lb-btn nav next" aria-label="Next screen">›</button></div><div class="lb-bot"><strong></strong><span></span></div></dialog>
<script>${JS}</script></body></html>`;
  };

  const file = path.join(dir, "index.html");
  const linked = path.join(dir, "viewer.html");
  const html = render(true);
  fs.writeFileSync(file, html);
  fs.writeFileSync(linked, render(false));
  return { file, linked, megabytes: html.length / 1e6, screens };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = buildGallery();
  console.log(`gallery: ${r.file} (${r.megabytes.toFixed(1)} MB, ${r.screens} screens)`);
  console.log(`  linked: ${r.linked} (serve this folder over http)`);
}
