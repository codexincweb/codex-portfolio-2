(function(){

  const welcome=document.getElementById('dashboard-welcome');
  const status=document.getElementById('referral-dashboard-status');
  const logoutButton=document.getElementById('referral-logout-button');

  const referralLink=document.getElementById('referral-link');
  const copyButton=document.getElementById('copy-referral-link');
  const shareButton=document.getElementById('share-referral-link');

  const referralCode=document.getElementById('referral-code');
  const referralName=document.getElementById('referral-name');
  const referralEmail=document.getElementById('referral-email');

  const clicksElement=document.getElementById('stat-clicks');
  const clientsElement=document.getElementById('stat-clients');
  const pendingElement=document.getElementById('stat-pending');
  const totalElement=document.getElementById('stat-total');

  function showStatus(message,type=''){
    if(!status)return;

    status.textContent=message;
    status.className=`form-status ${type}`.trim();
  }

  function formatNumber(value){
    return Number(value||0).toLocaleString('en-NG');
  }

  function formatMoney(value){
    return `₦${Number(value||0).toLocaleString('en-NG',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })}`;
  }

  async function requestJson(url,options={}){
    const response=await fetch(url,{
      credentials:'same-origin',
      ...options,
      headers:{
        ...(options.headers||{}),
        'content-type':'application/json'
      }
    });

    const data=await response.json().catch(()=>({}));

    if(response.status===401){
      window.location.href='/referral-login.html';
      throw new Error('Referral account authentication required.');
    }

    if(!response.ok){
      throw new Error(data.error||'Unable to complete the request.');
    }

    return data;
  }

  async function loadStats(){

    try{

      const data=await requestJson('/api/referrals/stats');
      const stats=data.stats||{};

      if(clicksElement){
        clicksElement.textContent=formatNumber(stats.clicks);
      }

      if(clientsElement){
        clientsElement.textContent=formatNumber(stats.clients);
      }

      const conversionElement=document.getElementById('rd-conversion');
      if(conversionElement){
        const clicks=Number(stats.clicks||0);
        const clients=Number(stats.clients||0);
        const conversion=clicks>0 ? (clients/clicks)*100 : 0;
        conversionElement.textContent=`${conversion.toFixed(1)}%`;
      }

      if(pendingElement){
        pendingElement.textContent=formatMoney(stats.pending_commission);
      }

      if(totalElement){
        totalElement.textContent=formatMoney(stats.total_commission);
      }

    }catch(error){

      console.error('Referral statistics error:',error);

    }

  }

  async function loadAccount(){

    try{

      const data=await requestJson('/api/referrals/me');
      const user=data.user||{};

      if(referralName){
        referralName.textContent=user.full_name||'—';
      }

      if(referralEmail){
        referralEmail.textContent=user.email||'—';
      }

      if(referralCode){
        referralCode.textContent=user.referral_code||'—';
      }

      if(welcome){
        welcome.textContent=
          `Hello ${user.full_name||'there'}, here is your partner activity.`;
      }

      if(referralLink && user.referral_code){

        const baseUrl=window.location.origin;

        referralLink.value=
          `${baseUrl}/ref/${encodeURIComponent(user.referral_code)}`;

      }

      showStatus('');

    }catch(error){

      console.error('Referral dashboard error:',error);

      showStatus(
        error.message||'Unable to load your referral account.',
        'error'
      );

    }

  }

  async function copyReferralLink(){

    if(!referralLink?.value)return;

    try{

      await navigator.clipboard.writeText(referralLink.value);

      if(copyButton){
        copyButton.textContent='Copied';

        setTimeout(()=>{
          copyButton.textContent='Copy link';
        },1800);
      }

    }catch(error){

      referralLink.focus();
      referralLink.select();
      document.execCommand('copy');

      if(copyButton){
        copyButton.textContent='Copied';

        setTimeout(()=>{
          copyButton.textContent='Copy link';
        },1800);
      }

    }

  }

  async function shareReferralLink(){

    if(!referralLink?.value)return;

    const shareData={
      title:'Codex Inc Referral Program',
      text:'Work with Codex Inc through my referral link.',
      url:referralLink.value
    };

    if(navigator.share){

      try{

        await navigator.share(shareData);

      }catch(error){

        if(error.name!=='AbortError'){
          console.error('Referral share error:',error);
        }

      }

      return;
    }

    await copyReferralLink();

    showStatus(
      'Referral link copied. You can now share it anywhere.',
      'success'
    );

  }

  async function logout(){

    if(!logoutButton)return;

    logoutButton.disabled=true;
    logoutButton.textContent='Signing out...';

    try{

      await requestJson('/api/referrals/logout',{
        method:'POST'
      });

      window.location.href='/referral-login.html';

    }catch(error){

      logoutButton.disabled=false;
      logoutButton.textContent='Sign out';

      showStatus(
        error.message||'Unable to sign you out.',
        'error'
      );

    }

  }

  copyButton?.addEventListener('click',copyReferralLink);
  shareButton?.addEventListener('click',shareReferralLink);
  logoutButton?.addEventListener('click',logout);

  loadAccount();
  loadStats();

})();
