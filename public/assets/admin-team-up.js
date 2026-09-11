(function(){
  const list = document.getElementById('applications-list');
  const count = document.getElementById('application-count');
  const details = document.getElementById('application-details');
  const refresh = document.getElementById('refresh-btn');
  const logout = document.getElementById('logout-btn');

  let applications = [];
  let selectedId = null;

  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function formatDate(value){
    if(!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? escapeHtml(value)
      : date.toLocaleString();
  }

  function renderList(){
    if(!applications.length){
      list.innerHTML =
        '<div class="empty-state muted">No Team Up applications yet.</div>';
      count.textContent = '0 applications';
      return;
    }

    count.textContent =
      applications.length +
      (applications.length === 1 ? ' application' : ' applications');

    list.innerHTML = applications.map(app => `
      <button type="button"
        class="application-item"
        data-id="${Number(app.id)}"
        style="width:100%;text-align:left;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;background:var(--bg);color:var(--ink);cursor:pointer">
        <strong>${escapeHtml(app.full_name)}</strong>
        <div class="muted" style="margin-top:4px">${escapeHtml(app.email)}</div>
        <div style="margin-top:8px">
          <span class="status-badge status-${escapeHtml(app.status)}">
            ${escapeHtml(app.status)}
          </span>
        </div>
      </button>
    `).join('');

    list.querySelectorAll('[data-id]').forEach(button => {
      button.addEventListener('click', () => {
        selectApplication(Number(button.dataset.id));
      });
    });
  }

  function selectApplication(id){
    selectedId = Number(id);

    const application = applications.find(
      item => Number(item.id) === selectedId
    );

    if(!application){
      details.innerHTML =
        '<div class="empty-state muted">Application not found.</div>';
      return;
    }

    const skills = Array.isArray(application.skills)
      ? application.skills
      : [];

    details.innerHTML = `
      <p class="eyebrow">Application #${Number(application.id)}</p>
      <h2>${escapeHtml(application.full_name)}</h2>

      <div class="detail-row">
        <span class="detail-label">Status</span>
        <div class="detail-value">
          <span class="status-badge status-${escapeHtml(application.status)}">
            ${escapeHtml(application.status)}
          </span>
        </div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Country</span>
        <div class="detail-value">${escapeHtml(application.country)}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Mobile</span>
        <div class="detail-value">${escapeHtml(application.mobile)}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Email</span>
        <div class="detail-value">
          <a href="mailto:${escapeHtml(application.email)}">
            ${escapeHtml(application.email)}
          </a>
        </div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Company / Organization</span>
        <div class="detail-value">${escapeHtml(application.company || '—')}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Experience</span>
        <div class="detail-value">${escapeHtml(application.experience_level)}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Skills</span>
        <div class="detail-value">
          ${skills.length
            ? skills.map(skill =>
                `<span class="tag">${escapeHtml(skill)}</span>`
              ).join(' ')
            : '—'}
        </div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Portfolio</span>
        <div class="detail-value">
          ${
            application.portfolio_url
            ? `<a href="${escapeHtml(application.portfolio_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(application.portfolio_url)}</a>`
            : '—'
          }
        </div>
      </div>

      <div class="detail-row">
        <span class="detail-label">About</span>
        <div class="detail-value">${escapeHtml(application.bio || '—')}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Resume</span>
        <div class="detail-value">
          ${
            application.resume_url
            ? `<a class="btn btn-secondary" href="${escapeHtml(application.resume_url)}" target="_blank" rel="noopener noreferrer">View Resume</a>`
            : '—'
          }
        </div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Submitted</span>
        <div class="detail-value">${formatDate(application.created_at)}</div>
      </div>

      ${
        application.reviewed_at
        ? `<div class="detail-row">
             <span class="detail-label">Reviewed</span>
             <div class="detail-value">${formatDate(application.reviewed_at)}</div>
           </div>`
        : ''
      }

      ${
        application.admin_notes
        ? `<div class="detail-row">
             <span class="detail-label">Admin Notes</span>
             <div class="detail-value">${escapeHtml(application.admin_notes)}</div>
           </div>`
        : ''
      }

      ${
        application.community_link
        ? `<div class="detail-row">
             <span class="detail-label">Community Link</span>
             <div class="detail-value">
               <a href="${escapeHtml(application.community_link)}" target="_blank" rel="noopener noreferrer">
                 ${escapeHtml(application.community_link)}
               </a>
             </div>
           </div>`
        : ''
      }

      ${
        application.status === 'pending'
        ? `<div class="action-row">
             <button class="btn success-btn" type="button" id="approve-btn">Approve</button>
             <button class="btn danger-btn" type="button" id="reject-btn">Reject</button>
           </div>`
        : ''
      }
    `;

    const approve = document.getElementById('approve-btn');
    const reject = document.getElementById('reject-btn');

    if(approve){
      approve.addEventListener('click', () => {
        alert('Approval API will be connected next.');
      });
    }

    if(reject){
      reject.addEventListener('click', () => {
        alert('Rejection API will be connected next.');
      });
    }
  }

  async function loadApplications(){
    list.innerHTML = '<div class="muted">Loading applications...</div>';

    try{
      const response = await fetch('/api/admin/team-up', {
        credentials: 'same-origin',
        cache: 'no-store'
      });

      if(response.status === 401){
        window.location.href = '/admin/login';
        return;
      }

      const data = await response.json();

      if(!response.ok){
        throw new Error(data.error || 'Unable to load applications');
      }

      applications = Array.isArray(data) ? data : [];

      renderList();

      if(applications.length){
        selectApplication(
          selectedId &&
          applications.some(item => Number(item.id) === selectedId)
            ? selectedId
            : Number(applications[0].id)
        );
      }else{
        details.innerHTML =
          '<div class="empty-state muted">No applications to review yet.</div>';
      }

    }catch(error){
      console.error('Team Up load error:', error);
      list.innerHTML =
        `<div class="muted">${escapeHtml(error.message)}</div>`;
      details.innerHTML =
        '<div class="empty-state muted">Unable to load application details.</div>';
    }
  }

  if(refresh){
    refresh.addEventListener('click', loadApplications);
  }

  if(logout){
    logout.addEventListener('click', async () => {
      try{
        await fetch('/api/admin/logout', {
          method:'POST',
          credentials:'same-origin'
        });
      }finally{
        window.location.href='/admin/login';
      }
    });
  }

  loadApplications();
})();
