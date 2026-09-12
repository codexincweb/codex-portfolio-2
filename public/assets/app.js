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


  (function(){
    const picker=document.querySelector('[data-country-picker]');
    if(!picker)return;

    const trigger=picker.querySelector('.country-trigger');
    const selected=picker.querySelector('.country-selected');
    const menu=picker.querySelector('.country-menu');
    const search=picker.querySelector('.country-search');
    const options=picker.querySelector('.country-options');
    const hidden=picker.querySelector('#country');

    const countries=[
      ["Afghanistan","af"],["Albania","al"],["Algeria","dz"],["Andorra","ad"],["Angola","ao"],
      ["Antigua and Barbuda","ag"],["Argentina","ar"],["Armenia","am"],["Australia","au"],["Austria","at"],
      ["Azerbaijan","az"],["Bahamas","bs"],["Bahrain","bh"],["Bangladesh","bd"],["Barbados","bb"],
      ["Belarus","by"],["Belgium","be"],["Belize","bz"],["Benin","bj"],["Bhutan","bt"],
      ["Bolivia","bo"],["Bosnia and Herzegovina","ba"],["Botswana","bw"],["Brazil","br"],["Brunei","bn"],
      ["Bulgaria","bg"],["Burkina Faso","bf"],["Burundi","bi"],["Cabo Verde","cv"],["Cambodia","kh"],
      ["Cameroon","cm"],["Canada","ca"],["Central African Republic","cf"],["Chad","td"],["Chile","cl"],
      ["China","cn"],["Colombia","co"],["Comoros","km"],["Congo","cg"],["Costa Rica","cr"],
      ["Croatia","hr"],["Cuba","cu"],["Cyprus","cy"],["Czechia","cz"],["Denmark","dk"],
      ["Djibouti","dj"],["Dominica","dm"],["Dominican Republic","do"],["Ecuador","ec"],["Egypt","eg"],
      ["El Salvador","sv"],["Equatorial Guinea","gq"],["Eritrea","er"],["Estonia","ee"],["Eswatini","sz"],
      ["Ethiopia","et"],["Fiji","fj"],["Finland","fi"],["France","fr"],["Gabon","ga"],
      ["Gambia","gm"],["Georgia","ge"],["Germany","de"],["Ghana","gh"],["Greece","gr"],
      ["Grenada","gd"],["Guatemala","gt"],["Guinea","gn"],["Guinea-Bissau","gw"],["Guyana","gy"],
      ["Haiti","ht"],["Honduras","hn"],["Hungary","hu"],["Iceland","is"],["India","in"],
      ["Indonesia","id"],["Iran","ir"],["Iraq","iq"],["Ireland","ie"],["Israel","il"],
      ["Italy","it"],["Jamaica","jm"],["Japan","jp"],["Jordan","jo"],["Kazakhstan","kz"],
      ["Kenya","ke"],["Kiribati","ki"],["Kuwait","kw"],["Kyrgyzstan","kg"],["Laos","la"],
      ["Latvia","lv"],["Lebanon","lb"],["Lesotho","ls"],["Liberia","lr"],["Libya","ly"],
      ["Liechtenstein","li"],["Lithuania","lt"],["Luxembourg","lu"],["Madagascar","mg"],["Malawi","mw"],
      ["Malaysia","my"],["Maldives","mv"],["Mali","ml"],["Malta","mt"],["Marshall Islands","mh"],
      ["Mauritania","mr"],["Mauritius","mu"],["Mexico","mx"],["Micronesia","fm"],["Moldova","md"],
      ["Monaco","mc"],["Mongolia","mn"],["Montenegro","me"],["Morocco","ma"],["Mozambique","mz"],
      ["Myanmar","mm"],["Namibia","na"],["Nauru","nr"],["Nepal","np"],["Netherlands","nl"],
      ["New Zealand","nz"],["Nicaragua","ni"],["Niger","ne"],["Nigeria","ng"],["North Korea","kp"],
      ["North Macedonia","mk"],["Norway","no"],["Oman","om"],["Pakistan","pk"],["Palau","pw"],
      ["Palestine","ps"],["Panama","pa"],["Papua New Guinea","pg"],["Paraguay","py"],["Peru","pe"],
      ["Philippines","ph"],["Poland","pl"],["Portugal","pt"],["Qatar","qa"],["Romania","ro"],
      ["Russia","ru"],["Rwanda","rw"],["Saint Kitts and Nevis","kn"],["Saint Lucia","lc"],
      ["Saint Vincent and the Grenadines","vc"],["Samoa","ws"],["San Marino","sm"],["Sao Tome and Principe","st"],
      ["Saudi Arabia","sa"],["Senegal","sn"],["Serbia","rs"],["Seychelles","sc"],["Sierra Leone","sl"],
      ["Singapore","sg"],["Slovakia","sk"],["Slovenia","si"],["Solomon Islands","sb"],["Somalia","so"],
      ["South Africa","za"],["South Korea","kr"],["South Sudan","ss"],["Spain","es"],["Sri Lanka","lk"],
      ["Sudan","sd"],["Suriname","sr"],["Sweden","se"],["Switzerland","ch"],["Syria","sy"],
      ["Taiwan","tw"],["Tajikistan","tj"],["Tanzania","tz"],["Thailand","th"],["Timor-Leste","tl"],
      ["Togo","tg"],["Tonga","to"],["Trinidad and Tobago","tt"],["Tunisia","tn"],["Turkey","tr"],
      ["Turkmenistan","tm"],["Tuvalu","tv"],["Uganda","ug"],["Ukraine","ua"],["United Arab Emirates","ae"],
      ["United Kingdom","gb"],["United States","us"],["Uruguay","uy"],["Uzbekistan","uz"],
      ["Vanuatu","vu"],["Vatican City","va"],["Venezuela","ve"],["Vietnam","vn"],["Yemen","ye"],
      ["Zambia","zm"],["Zimbabwe","zw"]
    ];

    const dialingCodes={
      af:"+93",al:"+355",dz:"+213",ad:"+376",ao:"+244",ag:"+1",ar:"+54",am:"+374",au:"+61",at:"+43",
      az:"+994",bs:"+1",bh:"+973",bd:"+880",bb:"+1",by:"+375",be:"+32",bz:"+501",bj:"+229",bt:"+975",
      bo:"+591",ba:"+387",bw:"+267",br:"+55",bn:"+673",bg:"+359",bf:"+226",bi:"+257",cv:"+238",kh:"+855",
      cm:"+237",ca:"+1",cf:"+236",td:"+235",cl:"+56",cn:"+86",co:"+57",km:"+269",cg:"+242",cr:"+506",
      hr:"+385",cu:"+53",cy:"+357",cz:"+420",dk:"+45",dj:"+253",dm:"+1",do:"+1",ec:"+593",eg:"+20",
      sv:"+503",gq:"+240",er:"+291",ee:"+372",sz:"+268",et:"+251",fj:"+679",fi:"+358",fr:"+33",
      ga:"+241",gm:"+220",ge:"+995",de:"+49",gh:"+233",gr:"+30",gd:"+1",gt:"+502",gn:"+224",gw:"+245",
      gy:"+592",ht:"+509",hn:"+504",hu:"+36",is:"+354",in:"+91",id:"+62",ir:"+98",iq:"+964",ie:"+353",
      il:"+972",it:"+39",jm:"+1",jp:"+81",jo:"+962",kz:"+7",ke:"+254",ki:"+686",kw:"+965",kg:"+996",
      la:"+856",lv:"+371",lb:"+961",ls:"+266",lr:"+231",ly:"+218",li:"+423",lt:"+370",lu:"+352",mg:"+261",
      mw:"+265",my:"+60",mv:"+960",ml:"+223",mt:"+356",mh:"+692",mr:"+222",mu:"+230",mx:"+52",fm:"+691",
      md:"+373",mc:"+377",mn:"+976",me:"+382",ma:"+212",mz:"+258",mm:"+95",na:"+264",nr:"+674",np:"+977",
      nl:"+31",nz:"+64",ni:"+505",ne:"+227",ng:"+234",kp:"+850",mk:"+389",no:"+47",om:"+968",pk:"+92",
      pw:"+680",ps:"+970",pa:"+507",pg:"+675",py:"+595",pe:"+51",ph:"+63",pl:"+48",pt:"+351",qa:"+974",
      ro:"+40",ru:"+7",rw:"+250",kn:"+1",lc:"+1",vc:"+1",ws:"+685",sm:"+378",st:"+239",sa:"+966",sn:"+221",
      rs:"+381",sc:"+248",sl:"+232",sg:"+65",sk:"+421",si:"+386",sb:"+677",so:"+252",za:"+27",kr:"+82",
      ss:"+211",es:"+34",lk:"+94",sd:"+249",sr:"+597",se:"+46",ch:"+41",sy:"+963",tw:"+886",tj:"+992",
      tz:"+255",th:"+66",tl:"+670",tg:"+228",to:"+676",tt:"+1",tn:"+216",tr:"+90",tm:"+993",tv:"+688",
      ug:"+256",ua:"+380",ae:"+971",gb:"+44",us:"+1",uy:"+598",uz:"+998",vu:"+678",va:"+39",ve:"+58",
      vn:"+84",ye:"+967",zm:"+260",zw:"+263"
    };

    const phoneCode=document.querySelector('#phone-code');
    const mobileInput=document.querySelector('#mobile');

    function flag(code){
      return 'https://flagcdn.com/w40/'+code+'.png';
    }

    function render(filter=''){
      options.innerHTML='';
      const q=filter.trim().toLowerCase();

      countries
        .filter(([name])=>name.toLowerCase().includes(q))
        .forEach(([name,code])=>{
          const button=document.createElement('button');
          button.type='button';
          button.className='country-option';
          button.innerHTML='<img src="'+flag(code)+'" alt="" loading="lazy"><span>'+name+'</span>';

          button.addEventListener('click',()=>{
            hidden.value=name;
            if(phoneCode) phoneCode.textContent=dialingCodes[code] || '';
            if(mobileInput) mobileInput.placeholder=(dialingCodes[code] || '')+' mobile number';
            selected.innerHTML='<img class="country-selected-flag" src="'+flag(code)+'" alt=""><span>'+name+'</span>';
            picker.classList.remove('open');
            trigger.setAttribute('aria-expanded','false');
            search.value='';
            render();
          });

          options.appendChild(button);
        });

      if(!options.children.length){
        options.innerHTML='<div class="country-empty">No countries found</div>';
      }
    }

    trigger.addEventListener('click',()=>{
      const open=picker.classList.toggle('open');
      trigger.setAttribute('aria-expanded',open?'true':'false');
      if(open){
        render();
        setTimeout(()=>search.focus(),0);
      }
    });


    if(mobileInput){
      mobileInput.addEventListener('input',()=>{
        mobileInput.value=mobileInput.value.replace(/[^\d\s().-]/g,'');
      });

      mobileInput.addEventListener('paste',()=>{
        setTimeout(()=>{
          mobileInput.value=mobileInput.value.replace(/[^\d\s().-]/g,'');
        },0);
      });
    }

    search.addEventListener('input',()=>render(search.value));

    document.addEventListener('click',e=>{
      if(!picker.contains(e.target)){
        picker.classList.remove('open');
        trigger.setAttribute('aria-expanded','false');
      }
    });

    render();
  })();

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
async function load(){shell();try{const p=await api('/api/profile');applyProfile(p);const w=await api('/api/works');document.querySelectorAll('[data-works]').forEach(e=>e.innerHTML=w.map(card).join(''));window.refreshScrollReveal?.();}catch(e){console.error(e)}}
load();

/* =========================================
   Premium page loading + scroll reveal
   ========================================= */

(function(){
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function createLoader(){
    if(document.querySelector('.page-loader')) return;

    const loader=document.createElement('div');
    loader.className='page-loader';
    loader.setAttribute('aria-hidden','true');
    loader.innerHTML=`
      <div class="page-loader-inner">
        <div class="page-loader-brand"></div>
        <div class="page-loader-line"></div>
        <div class="page-loader-line short"></div>
      </div>
    `;

    document.documentElement.classList.add('page-loading');
    document.body.prepend(loader);

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        loader.classList.add('is-hidden');
        document.documentElement.classList.remove('page-loading');

        setTimeout(()=>{
          loader.remove();
        },400);
      });
    });
  }

  function setupScrollReveal(){
    const elements=[
      ...document.querySelectorAll(
        'main h1, main h2, main h3, main p, main .eyebrow, main .text-link, main .project-image, main .profile-pic, main .profile-placeholder, main .contact-box, main .list-item'
      )
    ];

    const cards=[
      ...document.querySelectorAll(
        'main .card, main .service-list > *, main .experience-list > *'
      )
    ];

    elements.forEach(element=>{
      if(
        element.closest('.admin-shell') ||
        element.closest('script') ||
        element.classList.contains('reveal') ||
        element.classList.contains('reveal-group')
      ) return;

      element.classList.add('reveal');
    });

    cards.forEach((card,index)=>{
      card.classList.add('reveal');
      card.style.setProperty('--reveal-delay',`${Math.min(index * 90,360)}ms`);
    });

    if(reduceMotion){
      document.querySelectorAll('.reveal').forEach(element=>{
        element.classList.add('is-visible');
      });
      return;
    }

    const observer=new IntersectionObserver((entries,obs)=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;

        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    },{
      threshold:0.12,
      rootMargin:'0px 0px -45px 0px'
    });

    document.querySelectorAll('.reveal').forEach(element=>{
      observer.observe(element);
    });

    window.refreshScrollReveal=setupScrollReveal;
  }

  function setupPageTransitions(){
    if(reduceMotion) return;

    document.addEventListener('click',event=>{
      const link=event.target.closest('a[href]');

      if(!link) return;
      if(link.target==='_blank') return;
      if(link.hasAttribute('download')) return;

      const href=link.getAttribute('href');

      if(!href) return;
      if(href.startsWith('#')) return;
      if(href.startsWith('mailto:')) return;
      if(href.startsWith('tel:')) return;
      if(href.startsWith('javascript:')) return;

      let url;

      try{
        url=new URL(href,window.location.href);
      }catch{
        return;
      }

      if(url.origin!==window.location.origin) return;
      if(url.pathname===window.location.pathname && url.search===window.location.search) return;

      event.preventDefault();

      const loader=document.createElement('div');
      loader.className='page-loader';
      loader.setAttribute('aria-hidden','true');
      loader.innerHTML=`
        <div class="page-loader-inner">
          <div class="page-loader-brand"></div>
          <div class="page-loader-line"></div>
          <div class="page-loader-line short"></div>
        </div>
      `;

      document.documentElement.classList.add('page-loading');
      document.body.prepend(loader);

      requestAnimationFrame(()=>{
        setTimeout(()=>{
          window.location.href=url.href;
        },120);
      });
    });
  }

  function initMotion(){
    createLoader();
    setupScrollReveal();
    setupPageTransitions();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initMotion,{once:true});
  }else{
    initMotion();
  }
})();

(function(){
  const form=document.querySelector('#team-up-form');
  if(!form)return;

  const button=form.querySelector('button[type="submit"]');
  const originalText=button?.textContent||'Apply to Team';

  form.addEventListener('submit',async e=>{
    e.preventDefault();

    if(!button)return;

    const resume=form.querySelector('#resume');
    const skills=[...form.querySelectorAll('input[name="skills"]:checked')].map(x=>x.value);

    if(!skills.length){
      alert('Please select at least one skill or profession.');
      return;
    }

    if(!resume?.files?.length){
      alert('Please upload your resume/CV.');
      return;
    }

    const data=new FormData(form);

    data.delete('skills');
    skills.forEach(skill=>data.append('skills',skill));

    data.set('portfolio_url',form.querySelector('#portfolio')?.value||'');
    data.set('bio',form.querySelector('#intro')?.value||'');
    data.delete('portfolio');
    data.delete('intro');

    button.disabled=true;
    button.textContent='Submitting...';

    try{
      const result=await api('/api/team-up/apply',{
        method:'POST',
        body:data
      });

      alert(result.message||'Your application has been submitted successfully.');
      form.reset();

      const countrySelected=form.querySelector('.country-selected');
      const countryHidden=form.querySelector('#country');
      const phoneCode=form.querySelector('#phone-code');

      if(countrySelected)countrySelected.textContent='Select your country';
      if(countryHidden)countryHidden.value='';
      if(phoneCode)phoneCode.textContent='+234';

      button.textContent='Application Submitted';
    }catch(error){
      console.error('Team Up submission error:',error);
      alert(error.message||'Unable to submit your application right now.');
      button.textContent=originalText;
    }finally{
      button.disabled=false;
    }
  });
})();
