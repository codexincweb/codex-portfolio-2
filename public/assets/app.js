(function(){
  const saved=localStorage.getItem('codex-theme');
  if(saved==='dark') document.documentElement.classList.add('dark');

  function updateThemeButton(){
    const btn=document.querySelector('[data-theme-toggle]');
    if(!btn)return;
    const dark=document.documentElement.classList.contains('dark');
    btn.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    btn.setAttribute('title',dark?'Switch to light mode':'Switch to dark mode');
    btn.innerHTML=dark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.2A9 9 0 0 1 8.8 3a9 9 0 1 0 12.2 12.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  window.toggleTheme=function(){
    const dark=document.documentElement.classList.toggle('dark');
    localStorage.setItem('codex-theme',dark?'dark':'light');
    updateThemeButton();
  };

  window.updateThemeButton=updateThemeButton;
  updateThemeButton();
})();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const icons={
 whatsapp:`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.16 1.6 5.97L.05 24l6.27-1.64a11.88 11.88 0 0 0 5.73 1.47h.01c6.56 0 11.9-5.34 11.9-11.9 0-3.18-1.24-6.17-3.44-8.45ZM12.06 21.67h-.01a9.84 9.84 0 0 1-5.02-1.37l-.36-.21-3.72.97.99-3.63-.23-.37a9.86 9.86 0 1 1 8.35 4.61Zm5.41-7.39c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.69.63.71.23 1.35.2 1.86.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z"/></svg>`,
 linkedin:`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.95v5.66H9.34V8.99h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.61 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM3.54 20.45H7.1V8.99H3.54v11.46Z"/></svg>`,
 github:`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#181717" d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.4-1.34-1.77-1.34-1.77-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.23 1.84 1.23 1.07 1.83 2.8 1.3 3.48.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .3Z"/></svg>`,
 email:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m3 7 9 6 9-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`
};
const socials=`<div class="socials"><a class="social" href="https://wa.me/2347045139075?text=Good%20day%20Codex%2C%20I%20need%20your%20service.%20My%20name%20is%20" target="_blank" rel="noopener">${icons.whatsapp}<span>WhatsApp</span></a><a class="social" href="https://www.linkedin.com/in/codex-inc-146990412" target="_blank" rel="noopener">${icons.linkedin}<span>LinkedIn</span></a><a class="social" href="https://github.com/codexincweb" target="_blank" rel="noopener">${icons.github}<span>GitHub</span></a><a class="social" href="mailto:codexinc.web@gmail.com">${icons.email}<span>Email</span></a></div>`;
function shell(){document.querySelectorAll('[data-footer]').forEach(e=>e.innerHTML=`<footer class="footer"><div class="wrap footer-grid"><div><a class="brand" href="/">Codex Inc</a><p class="footer-copy">Software development, digital products, backend systems and security-focused engineering.</p></div><div><h4>Explore</h4><a href="/about.html">About me</a><a href="/works.html">Works</a><a href="/services.html">Services</a><a href="/experience.html">Experience</a><a href="/contact.html">Contact</a></div><div><h4>Connect</h4>${socials}</div></div><div class="wrap footer-bottom"><span>© 2026 Codex Inc. All rights reserved.</span><span>Built with purpose.</span></div></footer>`)}
async function api(url,opts){const r=await fetch(url,opts);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
function applyProfile(p){document.querySelectorAll('[data-name]').forEach(e=>e.textContent=p.name||'Codex Inc');document.querySelectorAll('[data-title]').forEach(e=>e.textContent=p.title||'Software Developer & Digital Product Builder');document.querySelectorAll('[data-bio]').forEach(e=>e.textContent=p.bio||'');document.querySelectorAll('[data-location]').forEach(e=>e.textContent=p.location||'');document.querySelectorAll('[data-profile-image]').forEach(e=>{if(p.image_url){e.src=p.image_url;e.classList.add('has-image');e.style.display='block';document.querySelectorAll('[data-profile-placeholder]').forEach(x=>x.style.display='none')}})}
function card(x){return `<article class="card project-card"><a href="/work/${encodeURIComponent(x.slug)}"><img class="project-image" src="${esc(x.image_url||'/assets/placeholder.svg')}" alt="${esc(x.title)}" onerror="this.src='/assets/placeholder.svg'"></a><div class="eyebrow">${esc(x.category||'Project')}</div><h3>${esc(x.title)}</h3><p class="muted">${esc(x.summary)}</p><div class="tags">${(x.tech||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><a class="text-link" href="/work/${encodeURIComponent(x.slug)}">View project →</a></article>`}
async function load(){shell();try{const p=await api('/api/profile');applyProfile(p);const w=await api('/api/works');document.querySelectorAll('[data-works]').forEach(e=>e.innerHTML=w.map(card).join(''));}catch(e){console.error(e)}}
load();
