const path=require('path');
const express=require('express');
const session=require('express-session');
const pgSession=require('connect-pg-simple')(session);
const multer=require('multer');
const {v2:cloudinary}=require('cloudinary');
const {pool,query,initDb}=require('./db');
require('dotenv').config();

const app=express();
const PORT=Number(process.env.PORT||3000);

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

(async()=>{
  try{
    await initDb();
    app.listen(PORT,'0.0.0.0',()=>
      console.log(`Codex Inc portfolio running on port ${PORT}`)
    );
  }catch(e){
    console.error(e);
    process.exit(1);
  }
})();
