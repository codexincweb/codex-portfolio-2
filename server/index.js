const path=require('path');
const express=require('express');
const session=require('express-session');
const pgSession=require('connect-pg-simple')(session);
const multer=require('multer');
const {v2:cloudinary}=require('cloudinary');
const {pool,query,initDb}=require('./db');
const nodemailer=require('nodemailer');
require('dotenv').config();

const app=express();
const PORT=Number(process.env.PORT||3000);


const mailer=nodemailer.createTransport({
  host:process.env.SMTP_HOST,
  port:Number(process.env.SMTP_PORT||587),
  secure:Number(process.env.SMTP_PORT||587)===465,
  connectionTimeout:10000,
  greetingTimeout:10000,
  socketTimeout:10000,
  auth:{
    user:process.env.SMTP_USER,
    pass:process.env.SMTP_PASS
  }
});

async function sendTeamUpNotification(application){
  const skills=Array.isArray(application.skills)
    ? application.skills.join(', ')
    : String(application.skills||'');

  await mailer.sendMail({
    from:`${process.env.SMTP_FROM_NAME||'Codex Inc'} <${process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER}>`,
    to:process.env.ADMIN_EMAIL,
    replyTo:application.email,
    subject:`New Team Up Application — ${application.full_name}`,
    text:[
      'A new Team Up application has been submitted.',
      '',
      `Name: ${application.full_name}`,
      `Country: ${application.country}`,
      `Mobile: ${application.mobile}`,
      `Email: ${application.email}`,
      `Company/Organization: ${application.company||'Not provided'}`,
      `Experience level: ${application.experience_level}`,
      `Skills: ${skills}`,
      `Portfolio: ${application.portfolio_url||'Not provided'}`,
      '',
      'About the applicant:',
      application.bio||'Not provided',
      '',
      `Resume: ${application.resume_url}`,
      '',
      `Application ID: ${application.id}`,
      `Status: ${application.status}`
    ].join('\n')
  });
}


cloudinary.config({
  cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
  api_key:process.env.CLOUDINARY_API_KEY,
  api_secret:process.env.CLOUDINARY_API_SECRET
});

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>{
    if(/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(file.mimetype)) cb(null,true);
    else cb(new Error('Only image files are allowed'));
  }
});

function uploadToCloudinary(file,folder){
  return new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type:'image',
        quality:'auto',
        fetch_format:'auto'
      },
      (error,result)=>{
        if(error)return reject(error);
        resolve({
          url:result.secure_url,
          public_id:result.public_id
        });
      }
    );
    stream.end(file.buffer);
  });
}

async function deleteFromCloudinary(publicId){
  if(!publicId)return;
  try{
    await cloudinary.uploader.destroy(publicId,{resource_type:'image',invalidate:true});
  }catch(error){
    console.error('Cloudinary delete error:',error.message);
  }
}

app.set('trust proxy',1);
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));

const sessionConfig={
  secret:process.env.SESSION_SECRET||'dev-secret',
  resave:false,
  saveUninitialized:false,
  cookie:{
    httpOnly:true,
    sameSite:'lax',
    secure:process.env.NODE_ENV==='production',
    maxAge:1000*60*60*24*7
  }
};

if(process.env.NODE_ENV==='production'){
  sessionConfig.store=new pgSession({
    pool,
    tableName:'user_sessions',
    createTableIfMissing:true
  });
  console.log('Session store: PostgreSQL');
}else{
  console.log('Session store: memory (local development)');
}

app.use(session(sessionConfig));
app.use(express.static(path.join(__dirname,'..','public')));

const admin=(req,res,next)=>req.session?.admin?next():res.status(401).json({error:'Unauthorized'});


const resumeUpload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:10*1024*1024},
  fileFilter:(req,file,cb)=>{
    const allowed=[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if(allowed.includes(file.mimetype)) cb(null,true);
    else cb(new Error('Only PDF, DOC, and DOCX resume files are allowed'));
  }
});

function uploadResumeToCloudinary(file){
  return new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream(
      {
        folder:'codex-inc/team-up/resumes',
        resource_type:'raw',
        use_filename:true,
        unique_filename:true
      },
      (error,result)=>{
        if(error)return reject(error);
        resolve({
          url:result.secure_url,
          public_id:result.public_id
        });
      }
    );
    stream.end(file.buffer);
  });
}

app.post('/api/team-up/apply',resumeUpload.single('resume'),async(req,res)=>{
  try{
    const {
      full_name,
      country,
      mobile,
      email,
      company,
      experience_level,
      portfolio_url,
      bio
    }=req.body;

    let skills=req.body.skills||[];
    if(!Array.isArray(skills))skills=[skills];

    if(!full_name||!country||!mobile||!email||!experience_level||!skills.length){
      return res.status(400).json({error:'Please complete all required fields'});
    }

    if(!req.file){
      return res.status(400).json({error:'Resume/CV is required'});
    }

    const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailPattern.test(email)){
      return res.status(400).json({error:'Please provide a valid email address'});
    }

    const resume=await uploadResumeToCloudinary(req.file);

    const result=await query(
      `INSERT INTO team_up_applications
      (full_name,country,mobile,email,company,experience_level,skills,portfolio_url,bio,resume_url,resume_public_id,resume_filename)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id,created_at,status`,
      [
        full_name.trim(),
        country.trim(),
        mobile.trim(),
        email.trim().toLowerCase(),
        company?.trim()||null,
        experience_level.trim(),
        skills,
        portfolio_url?.trim()||null,
        bio?.trim()||null,
        resume.url,
        resume.public_id,
        req.file.originalname
      ]
    );

    const application={
      id:result.rows[0].id,
      status:result.rows[0].status,
      full_name:full_name.trim(),
      country:country.trim(),
      mobile:mobile.trim(),
      email:email.trim().toLowerCase(),
      company:company?.trim()||null,
      experience_level:experience_level.trim(),
      skills,
      portfolio_url:portfolio_url?.trim()||null,
      bio:bio?.trim()||null,
      resume_url:resume.url
    };

    sendTeamUpNotification(application)
      .then(()=>console.log(`Team Up admin email sent for application ${application.id}`))
      .catch(mailError=>console.error('Team Up notification email failed:',mailError.message));

    res.status(201).json({
      success:true,
      message:'Your Team Up application has been submitted successfully.',
      application_id:result.rows[0].id,
      status:result.rows[0].status
    });
  }catch(error){
    console.error('Team Up application error:',error);
    res.status(500).json({error:'Unable to submit your application right now'});
  }
});




async function sendTeamUpDecisionEmail(application){
  const approved = application.status === 'approved';

  const subject = approved
    ? 'Your Codex Inc Team Up application has been approved'
    : 'Update on your Codex Inc Team Up application';

  const communitySection = approved && application.community_link
    ? `
      <p>Your application has been approved. Welcome to Codex Inc Team Up.</p>
      <p>
        Join the community using the link below:
      </p>
      <p>
        <a href="${application.community_link}"
           style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:8px">
          Join Codex Inc Team Up
        </a>
      </p>
    `
    : `
      <p>Thank you for taking the time to apply to Codex Inc Team Up.</p>
      <p>
        After reviewing your application, we are unable to approve it at this time.
      </p>
    `;

  await mailer.sendMail({
    from:`${process.env.SMTP_FROM_NAME||'Codex Inc'} <${process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER}>`,
    to:application.email,
    subject,
    html:`
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#17202a">
          <div style="max-width:620px;margin:40px auto;background:#fff;padding:32px;border-radius:14px">
            <h2 style="margin-top:0">Codex Inc Team Up</h2>

            <p>Hello ${application.full_name},</p>

            ${communitySection}

            ${
              application.admin_notes
                ? `<p><strong>Message from the review team:</strong></p>
                   <p>${String(application.admin_notes).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
                : ''
            }

            <p style="margin-top:28px">
              Regards,<br>
              <strong>Codex Inc</strong>
            </p>
          </div>
        </body>
      </html>
    `
  });
}


app.patch('/api/admin/team-up/:id',admin,async(req,res)=>{
  try{
    const id = Number(req.params.id);
    const {status,admin_notes,community_link} = req.body || {};

    if(!Number.isInteger(id) || id < 1){
      return res.status(400).json({error:'Invalid application ID'});
    }

    if(!['approved','rejected'].includes(status)){
      return res.status(400).json({error:'Status must be approved or rejected'});
    }

    const result = await pool.query(
      `UPDATE team_up_applications
       SET status=$1,
           admin_notes=$2,
           community_link=$3,
           reviewed_at=NOW()
       WHERE id=$4
       RETURNING *`,
      [
        status,
        admin_notes ? String(admin_notes).trim() : null,
        community_link ? String(community_link).trim() : null,
        id
      ]
    );

    if(!result.rows.length){
      return res.status(404).json({error:'Application not found'});
    }

    const application=result.rows[0];

    res.json({
      success:true,
      application,
      email_queued:true
    });

    sendTeamUpDecisionEmail(application)
      .then(()=>console.log(`Team Up ${status} email sent to ${application.email}`))
      .catch(mailError=>console.error('Team Up decision email error:',mailError));

  }catch(error){
    console.error('Team Up review error:',error);
    return res.status(500).json({error:'Unable to update application'});
  }
});

app.get('/api/admin/team-up',admin,async(req,res)=>{
  try{
    const result=await query(
      `SELECT
        id,
        full_name,
        country,
        mobile,
        email,
        company,
        experience_level,
        skills,
        portfolio_url,
        bio,
        resume_url,
        resume_filename,
        status,
        admin_notes,
        community_link,
        created_at,
        reviewed_at
       FROM team_up_applications
       ORDER BY
        CASE status
          WHEN 'pending' THEN 1
          WHEN 'approved' THEN 2
          WHEN 'rejected' THEN 3
          ELSE 4
        END,
        created_at DESC`
    );

    res.json(result.rows);
  }catch(error){
    console.error('Team Up admin list error:',error);
    res.status(500).json({error:'Unable to load Team Up applications'});
  }
});


// =========================================
// Public Updates / News API
// =========================================

app.get('/api/updates',async(req,res)=>{
  try{
    const result=await query(`
      SELECT
        id,
        slug,
        title,
        excerpt,
        category,
        cover_image_url,
        author,
        featured,
        published_at,
        view_count
      FROM updates
      WHERE status='published'
      ORDER BY featured DESC, published_at DESC NULLS LAST, created_at DESC
    `);

    res.json(result.rows);
  }catch(error){
    console.error('Failed to load updates:',error);
    res.status(500).json({error:'Unable to load updates'});
  }
});

app.get('/api/updates/:slug',async(req,res)=>{
  try{
    const result=await query(`
      SELECT
        id,
        slug,
        title,
        excerpt,
        content,
        category,
        cover_image_url,
        author,
        featured,
        published_at,
        view_count,
        created_at,
        updated_at
      FROM updates
      WHERE slug=$1
        AND status='published'
      LIMIT 1
    `,[req.params.slug]);

    if(!result.rowCount){
      return res.status(404).json({error:'Update not found'});
    }

    const update=result.rows[0];

    await query(`
      UPDATE updates
      SET view_count=view_count+1
      WHERE id=$1
    `,[update.id]);

    update.view_count+=1;

    const comments=await query(`
      SELECT
        id,
        name,
        comment,
        created_at
      FROM update_comments
      WHERE update_id=$1
        AND status='approved'
      ORDER BY created_at ASC
    `,[update.id]);

    res.json({
      update,
      comments:comments.rows
    });
  }catch(error){
    console.error('Failed to load update:',error);
    res.status(500).json({error:'Unable to load update'});
  }
});

app.post('/api/updates/:id/comments',async(req,res)=>{
  try{
    const updateId=Number(req.params.id);
    const name=String(req.body.name||'').trim();
    const email=String(req.body.email||'').trim().toLowerCase();
    const comment=String(req.body.comment||'').trim();

    if(!Number.isInteger(updateId)||updateId<1){
      return res.status(400).json({error:'Invalid update'});
    }

    if(name.length<2||name.length>80){
      return res.status(400).json({
        error:'Name must be between 2 and 80 characters'
      });
    }

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      return res.status(400).json({
        error:'Enter a valid email address'
      });
    }

    if(comment.length<2||comment.length>2000){
      return res.status(400).json({
        error:'Comment must be between 2 and 2000 characters'
      });
    }

    const update=await query(`
      SELECT id
      FROM updates
      WHERE id=$1
        AND status='published'
      LIMIT 1
    `,[updateId]);

    if(!update.rowCount){
      return res.status(404).json({error:'Update not found'});
    }

    const result=await query(`
      INSERT INTO update_comments
      (update_id,name,email,comment,status)
      VALUES ($1,$2,$3,$4,'pending')
      RETURNING id,name,comment,created_at,status
    `,[updateId,name,email,comment]);

    res.status(201).json({
      message:'Comment submitted for review.',
      comment:result.rows[0]
    });
  }catch(error){
    console.error('Failed to submit comment:',error);
    res.status(500).json({error:'Unable to submit comment'});
  }
});

app.get('/api/health',async(req,res)=>{
  try{
    await query('SELECT 1');
    res.json({ok:true,database:'connected'});
  }catch(e){
    res.status(503).json({ok:false,error:'Database unavailable'});
  }
});

app.get('/api/profile',async(req,res)=>{
  const r=await query('SELECT * FROM profile WHERE id=1');
  res.json(r.rows[0]);
});

app.get('/api/works',async(req,res)=>{
  const r=await query('SELECT * FROM works ORDER BY featured DESC,created_at DESC');
  res.json(r.rows);
});

app.get('/api/works/:slug',async(req,res)=>{
  const r=await query('SELECT * FROM works WHERE slug=$1',[req.params.slug]);
  if(!r.rowCount)return res.status(404).json({error:'Not found'});
  res.json(r.rows[0]);
});

app.post('/api/admin/login',async(req,res)=>{
  const {email,password}=req.body;
  if(email===process.env.ADMIN_EMAIL&&password===process.env.ADMIN_PASSWORD){
    req.session.admin={email};
    return res.json({ok:true});
  }
  res.status(401).json({error:'Invalid credentials'});
});

app.post('/api/admin/logout',(req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

app.get('/api/admin/me',admin,(req,res)=>{
  res.json({email:req.session.admin.email});
});

app.put('/api/admin/profile',admin,upload.single('image'),async(req,res)=>{
  const {name,title,bio,location}=req.body;

  const current=await query(
    'SELECT image_public_id FROM profile WHERE id=1'
  );

  let image=req.body.image_url||null;
  let publicId=null;

  if(req.file){
    const uploaded=await uploadToCloudinary(
      req.file,
      'codex-inc/profile'
    );
    image=uploaded.url;
    publicId=uploaded.public_id;

    if(current.rows[0]?.image_public_id){
      await deleteFromCloudinary(current.rows[0].image_public_id);
    }
  }

  const r=await query(
    `UPDATE profile
     SET name=COALESCE($1,name),
         title=COALESCE($2,title),
         bio=COALESCE($3,bio),
         location=COALESCE($4,location),
         image_url=COALESCE($5,image_url),
         image_public_id=COALESCE($6,image_public_id),
         updated_at=now()
     WHERE id=1
     RETURNING *`,
    [name,title,bio,location,image,publicId]
  );

  res.json(r.rows[0]);
});

app.post('/api/admin/works',admin,upload.single('image'),async(req,res)=>{
  const {
    slug,title,category,summary,description,
    live_url,repo_url,featured
  }=req.body;

  let image=null;
  let publicId=null;

  if(req.file){
    const uploaded=await uploadToCloudinary(
      req.file,
      'codex-inc/projects'
    );
    image=uploaded.url;
    publicId=uploaded.public_id;
  }

  const tech=(req.body.tech||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);

  const r=await query(
    `INSERT INTO works
     (slug,title,category,summary,description,tech,live_url,repo_url,image_url,image_public_id,featured)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      slug,
      title,
      category,
      summary,
      description||summary,
      tech,
      live_url||null,
      repo_url||null,
      image,
      publicId,
      featured==='true'
    ]
  );

  res.status(201).json(r.rows[0]);
});

app.put('/api/admin/works/:id',admin,upload.single('image'),async(req,res)=>{
  const {
    title,category,summary,description,
    live_url,repo_url,featured
  }=req.body;

  const current=await query(
    'SELECT image_public_id FROM works WHERE id=$1',
    [req.params.id]
  );

  if(!current.rowCount){
    return res.status(404).json({error:'Not found'});
  }

  let image=null;
  let publicId=null;

  if(req.file){
    const uploaded=await uploadToCloudinary(
      req.file,
      'codex-inc/projects'
    );
    image=uploaded.url;
    publicId=uploaded.public_id;

    if(current.rows[0].image_public_id){
      await deleteFromCloudinary(current.rows[0].image_public_id);
    }
  }

  const tech=(req.body.tech||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);

  const r=await query(
    `UPDATE works
     SET title=COALESCE($1,title),
         category=COALESCE($2,category),
         summary=COALESCE($3,summary),
         description=COALESCE($4,description),
         tech=$5,
         live_url=$6,
         repo_url=$7,
         image_url=COALESCE($8,image_url),
         image_public_id=COALESCE($9,image_public_id),
         featured=$10,
         updated_at=now()
     WHERE id=$11
     RETURNING *`,
    [
      title,
      category,
      summary,
      description,
      tech,
      live_url||null,
      repo_url||null,
      image,
      publicId,
      featured==='true',
      req.params.id
    ]
  );

  res.json(r.rows[0]);
});

app.delete('/api/admin/works/:id',admin,async(req,res)=>{
  const current=await query(
    'SELECT image_public_id FROM works WHERE id=$1',
    [req.params.id]
  );

  if(!current.rowCount){
    return res.status(404).json({error:'Not found'});
  }

  await query('DELETE FROM works WHERE id=$1',[req.params.id]);

  if(current.rows[0].image_public_id){
    await deleteFromCloudinary(current.rows[0].image_public_id);
  }

  res.json({ok:true});
});


// =========================================
// Admin Updates / Comments API
// =========================================

function makeUpdateSlug(title, currentId=null){
  const base=String(title||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,90);

  return base || `update-${currentId||Date.now()}`;
}

async function createUniqueUpdateSlug(title,currentId=null){
  const base=makeUpdateSlug(title,currentId);
  let slug=base;
  let counter=2;

  while(true){
    const result=await query(
      `SELECT id FROM updates WHERE slug=$1 LIMIT 1`,
      [slug]
    );

    if(!result.rowCount || Number(result.rows[0].id)===Number(currentId)){
      return slug;
    }

    slug=`${base}-${counter++}`;
  }
}

app.get('/api/admin/updates',admin,async(req,res)=>{
  try{
    const result=await query(`
      SELECT
        id,
        slug,
        title,
        excerpt,
        content,
        category,
        cover_image_url,
        author,
        featured,
        status,
        published_at,
        view_count,
        created_at,
        updated_at
      FROM updates
      ORDER BY
        CASE WHEN status='published' THEN 0 ELSE 1 END,
        featured DESC,
        published_at DESC NULLS LAST,
        created_at DESC
    `);

    res.json(result.rows);
  }catch(error){
    console.error('Failed to load admin updates:',error);
    res.status(500).json({error:'Unable to load updates'});
  }
});

app.post('/api/admin/updates',admin,upload.single('cover_image'),async(req,res)=>{
  try{
    const {
      title,
      excerpt,
      content,
      category,
      author,
      featured,
      status,
      published_at
    }=req.body;

    if(!String(title||'').trim()){
      return res.status(400).json({error:'Headline is required'});
    }

    if(!String(content||'').trim()){
      return res.status(400).json({error:'Article content is required'});
    }

    const cleanStatus=status==='published'?'published':'draft';
    const slug=await createUniqueUpdateSlug(title);

    let coverImage=null;
    let coverPublicId=null;

    if(req.file){
      const uploaded=await uploadToCloudinary(
        req.file,
        'codex-inc/updates'
      );
      coverImage=uploaded.url;
      coverPublicId=uploaded.public_id;
    }

    const publishDate=cleanStatus==='published'
      ? (published_at ? new Date(published_at) : new Date())
      : null;

    const result=await query(`
      INSERT INTO updates
      (
        slug,
        title,
        excerpt,
        content,
        category,
        cover_image_url,
        cover_image_public_id,
        author,
        featured,
        status,
        published_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,[
      slug,
      String(title).trim(),
      String(excerpt||'').trim()||null,
      String(content).trim(),
      String(category||'').trim()||null,
      coverImage,
      coverPublicId,
      String(author||'Codex Inc').trim()||'Codex Inc',
      featured==='true',
      cleanStatus,
      publishDate
    ]);

    res.status(201).json({update:result.rows[0]});
  }catch(error){
    console.error('Failed to create update:',error);
    res.status(500).json({error:'Unable to create update'});
  }
});

app.put('/api/admin/updates/:id',admin,upload.single('cover_image'),async(req,res)=>{
  try{
    const {
      title,
      excerpt,
      content,
      category,
      author,
      featured,
      status,
      published_at
    }=req.body;

    const current=await query(`
      SELECT *
      FROM updates
      WHERE id=$1
      LIMIT 1
    `,[req.params.id]);

    if(!current.rowCount){
      return res.status(404).json({error:'Update not found'});
    }

    const existing=current.rows[0];

    if(!String(title||'').trim()){
      return res.status(400).json({error:'Headline is required'});
    }

    if(!String(content||'').trim()){
      return res.status(400).json({error:'Article content is required'});
    }

    const cleanStatus=status==='published'?'published':'draft';
    const slug=await createUniqueUpdateSlug(title,existing.id);

    let coverImage=existing.cover_image_url;
    let coverPublicId=existing.cover_image_public_id;

    if(req.file){
      const uploaded=await uploadToCloudinary(
        req.file,
        'codex-inc/updates'
      );

      coverImage=uploaded.url;
      coverPublicId=uploaded.public_id;

      if(existing.cover_image_public_id){
        await deleteFromCloudinary(existing.cover_image_public_id);
      }
    }

    let publishDate=existing.published_at;

    if(cleanStatus==='published'){
      publishDate=published_at
        ? new Date(published_at)
        : (existing.published_at || new Date());
    }else{
      publishDate=null;
    }

    const result=await query(`
      UPDATE updates
      SET
        slug=$1,
        title=$2,
        excerpt=$3,
        content=$4,
        category=$5,
        cover_image_url=$6,
        cover_image_public_id=$7,
        author=$8,
        featured=$9,
        status=$10,
        published_at=$11,
        updated_at=now()
      WHERE id=$12
      RETURNING *
    `,[
      slug,
      String(title).trim(),
      String(excerpt||'').trim()||null,
      String(content).trim(),
      String(category||'').trim()||null,
      coverImage,
      coverPublicId,
      String(author||'Codex Inc').trim()||'Codex Inc',
      featured==='true',
      cleanStatus,
      publishDate,
      existing.id
    ]);

    res.json({update:result.rows[0]});
  }catch(error){
    console.error('Failed to update update:',error);
    res.status(500).json({error:'Unable to update update'});
  }
});

app.delete('/api/admin/updates/:id',admin,async(req,res)=>{
  try{
    const current=await query(`
      SELECT cover_image_public_id
      FROM updates
      WHERE id=$1
      LIMIT 1
    `,[req.params.id]);

    if(!current.rowCount){
      return res.status(404).json({error:'Update not found'});
    }

    await query(
      'DELETE FROM updates WHERE id=$1',
      [req.params.id]
    );

    if(current.rows[0].cover_image_public_id){
      await deleteFromCloudinary(
        current.rows[0].cover_image_public_id
      );
    }

    res.json({ok:true});
  }catch(error){
    console.error('Failed to delete update:',error);
    res.status(500).json({error:'Unable to delete update'});
  }
});

app.get('/api/admin/comments',admin,async(req,res)=>{
  try{
    const result=await query(`
      SELECT
        c.id,
        c.update_id,
        c.name,
        c.email,
        c.comment,
        c.status,
        c.created_at,
        c.updated_at,
        u.title AS update_title,
        u.slug AS update_slug
      FROM update_comments c
      INNER JOIN updates u ON u.id=c.update_id
      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);
  }catch(error){
    console.error('Failed to load admin comments:',error);
    res.status(500).json({error:'Unable to load comments'});
  }
});

app.patch('/api/admin/comments/:id',admin,async(req,res)=>{
  try{
    const status=String(req.body.status||'').trim();

    if(!['pending','approved','hidden'].includes(status)){
      return res.status(400).json({error:'Invalid comment status'});
    }

    const result=await query(`
      UPDATE update_comments
      SET
        status=$1,
        updated_at=now()
      WHERE id=$2
      RETURNING *
    `,[status,req.params.id]);

    if(!result.rowCount){
      return res.status(404).json({error:'Comment not found'});
    }

    res.json({comment:result.rows[0]});
  }catch(error){
    console.error('Failed to update comment:',error);
    res.status(500).json({error:'Unable to update comment'});
  }
});

app.delete('/api/admin/comments/:id',admin,async(req,res)=>{
  try{
    const result=await query(`
      DELETE FROM update_comments
      WHERE id=$1
      RETURNING id
    `,[req.params.id]);

    if(!result.rowCount){
      return res.status(404).json({error:'Comment not found'});
    }

    res.json({ok:true});
  }catch(error){
    console.error('Failed to delete comment:',error);
    res.status(500).json({error:'Unable to delete comment'});
  }
});

app.get('/updates',(req,res)=>
  res.sendFile(path.join(__dirname,'..','public','updates.html'))
);

app.get('/update/:slug',(req,res)=>
  res.sendFile(path.join(__dirname,'..','public','update.html'))
);

app.get('/work/:slug',(req,res)=>
  res.sendFile(path.join(__dirname,'..','public','work.html'))
);

app.get('/admin/login',(req,res)=>
  res.sendFile(path.join(__dirname,'..','public','pages','admin-login.html'))
);

app.get('/admin',(req,res)=>
  res.sendFile(path.join(__dirname,'..','public','pages','admin.html'))
);

app.use((err,req,res,next)=>{
  console.error(err);
  res.status(400).json({error:err.message||'Request failed'});
});

async function initializeDatabaseWithRetry(){
  const maxAttempts=5;

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      await initDb();
      console.log(`Database initialized successfully (attempt ${attempt}/${maxAttempts})`);
      return;
    }catch(error){
      console.error(
        `Database initialization failed (attempt ${attempt}/${maxAttempts}):`,
        error.code||error.message
      );

      if(attempt===maxAttempts){
        throw error;
      }

      const delay=attempt*3000;
      console.log(`Retrying database initialization in ${delay/1000}s...`);
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}

(async()=>{
  try{
    await initializeDatabaseWithRetry();

    app.listen(PORT,'0.0.0.0',()=>{
      console.log(`Codex Inc portfolio running on port ${PORT}`)
    });
  }catch(e){
    console.error('Database initialization failed after all retries:',e);
    process.exit(1);
  }
})();
