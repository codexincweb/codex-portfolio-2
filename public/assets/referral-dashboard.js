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

  function showStatus(message,type=''){
    if(!status)return;

    status.textContent=message;
    status.className=`form-status ${type}`.trim();
  }

  async function loadStats(){

    try{

      const response=await fetch('/api/referrals/stats',{
        credentials:'same-origin'
      });

      const data=await response.json().catch(()=>({}));

      if(response.status===401){
        window.location.href='/referrals.html';
        return;
      }

      if(!response.ok){
        throw new Error(
          data.error||'Unable to load referral statistics.'
        );
      }

      const stats=data.stats||{};

      const clicks=document.getElementById('stat-clicks');
      const clients=document.getElementById('stat-clients');
      const pending=document.getElementById('stat-pending');
      const total=document.getElementById('stat-total');

      if(clicks){
        clicks.textContent=Number(
          stats.clicks||0
        ).toLocaleString();
      }

      if(clients){
        clients.textContent=Number(
          stats.clients||0
        ).toLocaleString();
      }

      if(pending){
        pending.textContent=
          `₦${Number(
            stats.pending_commission||0
          ).toLocaleString(
            'en-NG',
            {
              minimumFractionDigits:2,
              maximumFractionDigits:2
            }
          )}`;
      }

      if(total){
        total.textContent=
          `₦${Number(
            stats.total_commission||0
          ).toLocaleString(
            'en-NG',
            {
              minimumFractionDigits:2,
              maximumFractionDigits:2
            }
          )}`;
      }

    }catch(error){

      console.error(
        'Referral statistics error:',
        error
      );

    }
  }

  async function loadAccount(){

    try{

      const response=await fetch('/api/referrals/me',{
        credentials:'same-origin'
      });

      const data=await response.json().catch(()=>({}));

      if(response.status===401){
        window.location.href='/referrals.html';
        return;
      }

      if(!response.ok){
        throw new Error(
          data.error||'Unable to load your referral account.'
        );
      }

      const user=data.user;

      referralName.textContent=user.full_name||'—';
      referralEmail.textContent=user.email||'—';
      referralCode.textContent=user.referral_code||'—';

      welcome.textContent=
        `Hello ${user.full_name||'there'}, here is your referral activity.`;

      const baseUrl=window.location.origin;

      const link=
        `${baseUrl}/ref/${encodeURIComponent(user.referral_code)}`;

      referralLink.value=link;

      showStatus('');

    }catch(error){

      console.error(
        'Referral dashboard error:',
        error
      );

      showStatus(
        error.message||
        'Unable to load your referral account.',
        'error'
      );
    }
  }

  async function copyReferralLink(){

    if(!referralLink?.value)return;

    try{

      await navigator.clipboard.writeText(
        referralLink.value
      );

      copyButton.textContent='Copied';

      setTimeout(()=>{
        copyButton.textContent='Copy link';
      },1800);

    }catch(error){

      referralLink.select();
      referralLink.setSelectionRange(
        0,
        referralLink.value.length
      );

      document.execCommand('copy');

      copyButton.textContent='Copied';

      setTimeout(()=>{
        copyButton.textContent='Copy link';
      },1800);
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
          console.error(
            'Referral share error:',
            error
          );
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

    logoutButton.disabled=true;
    logoutButton.textContent='Signing out...';

    try{

      const response=await fetch(
        '/api/referrals/logout',
        {
          method:'POST',
          credentials:'same-origin',
          headers:{
            'content-type':'application/json'
          }
        }
      );

      const data=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(
          data.error||'Unable to sign you out.'
        );
      }

      window.location.href='/referrals.html';

    }catch(error){

      logoutButton.disabled=false;
      logoutButton.textContent='Sign out';

      showStatus(
        error.message||
        'Unable to sign you out.',
        'error'
      );
    }
  }

  copyButton?.addEventListener(
    'click',
    copyReferralLink
  );

  shareButton?.addEventListener(
    'click',
    shareReferralLink
  );

  logoutButton?.addEventListener(
    'click',
    logout
  );

  loadAccount();
  loadStats();

})();
