document.addEventListener('DOMContentLoaded',()=>{
  const form=document.getElementById('project-inquiry-form');
  const status=document.getElementById('project-inquiry-status');

  if(!form||!status)return;

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();

    status.textContent='Sending your inquiry...';
    status.className='form-status';

    const data=Object.fromEntries(new FormData(form).entries());

    try{
      const response=await fetch('/api/referrals/lead',{
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        credentials:'same-origin',
        body:JSON.stringify(data)
      });

      const result=await response.json().catch(()=>({}));

      if(!response.ok){
        throw new Error(result.error||'Unable to send your inquiry.');
      }

      status.textContent='Your project inquiry has been received. We will get back to you soon.';
      status.className='form-status success';
      form.reset();
    }catch(error){
      status.textContent=error.message||'Something went wrong. Please try again.';
      status.className='form-status error';
    }
  });
});
