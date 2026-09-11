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

app.get('/api/smtp-test',admin,async(req,res)=>{
  try{
    await mailer.verify();
    res.json({ok:true,smtp:'connected'});
  }catch(error){
    console.error('SMTP test error:',error);
    res.status(500).json({
      ok:false,
      smtp:'failed',
      error:error.message
    });
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
