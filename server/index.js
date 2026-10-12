const fs=require('fs');
const path=require('path');
const express=require('express');
const session=require('express-session');
const cookieParser=require('cookie-parser');
const crypto=require('crypto');
const pgSession=require('connect-pg-simple')(session);
const multer=require('multer');
const {v2:cloudinary}=require('cloudinary');
const {pool,query,initDb}=require('./db');
const nodemailer=require('nodemailer');
const {OAuth2Client}=require('google-auth-library');
const Groq=require('groq-sdk');
require('dotenv').config();

const app=express();
const groq=new Groq({apiKey:process.env.GROQ_API_KEY});
const PORT=Number(process.env.PORT||3000);

const REFERRAL_SESSION_DAYS =
  Math.max(1,Number(process.env.REFERRAL_SESSION_DAYS||7));

const REFERRAL_COMMISSION_RATE =
  Math.max(0,Math.min(1,Number(
    process.env.REFERRAL_COMMISSION_RATE||0.05
  )));

function normalizeReferralEmail(value){
  return String(value||'').trim().toLowerCase();
}

function hashReferralPassword(password){
  return new Promise((resolve,reject)=>{
    const salt=crypto.randomBytes(16).toString('hex');

    crypto.scrypt(
      String(password),
      salt,
      64,
      {
        N:16384,
        r:8,
        p:1
      },
      (error,derivedKey)=>{
        if(error)return reject(error);

        resolve(
          `scrypt:${salt}:${derivedKey.toString('hex')}`
        );
      }
    );
  });
}

function verifyReferralPassword(password,storedHash){
  return new Promise((resolve,reject)=>{
    const parts=String(storedHash||'').split(':');

    if(parts.length!==3 || parts[0]!=='scrypt'){
      return resolve(false);
    }

    const salt=parts[1];
    const expected=Buffer.from(parts[2],'hex');

    crypto.scrypt(
      String(password),
      salt,
      expected.length,
      {
        N:16384,
        r:8,
        p:1
      },
      (error,derivedKey)=>{
        if(error)return reject(error);

        if(derivedKey.length!==expected.length){
          return resolve(false);
        }

        resolve(
          crypto.timingSafeEqual(derivedKey,expected)
        );
      }
    );
  });
}

function generateReferralCode(){
  return `CDX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function getReferralPublicUser(user){
  return {
    id:user.id,
    full_name:user.full_name,
    email:user.email,
    phone:user.phone,
    avatar_url:user.avatar_url,
    referral_code:user.referral_code,
    status:user.status,
    email_verified:user.email_verified,
    created_at:user.created_at,
    last_login_at:user.last_login_at
  };
}


async function verifyTurnstile(token,remoteIp){
  const secret=String(process.env.TURNSTILE_SECRET_KEY||'').trim();

  if(!secret){
    throw new Error('TURNSTILE_SECRET_KEY is not configured');
  }

  if(!token){
    return {
      success:false,
      errorCodes:['missing-input-response']
    };
  }

  const params=new URLSearchParams();

  params.set('secret',secret);
  params.set('response',String(token));

  if(remoteIp){
    params.set('remoteip',String(remoteIp));
  }

  const response=await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method:'POST',
      headers:{
        'content-type':'application/x-www-form-urlencoded'
      },
      body:params.toString()
    }
  );

  if(!response.ok){
    throw new Error(
      `Turnstile verification request failed with HTTP ${response.status}`
    );
  }

  return response.json();
}

function referralAuth(req,res,next){
  if(!req.session.referralUser){
    return res.status(401).json({
      error:'Referral account authentication required'
    });
  }

  next();
}




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

function generateReferralVerificationCode(){
  return String(crypto.randomInt(0,100000000)).padStart(8,'0');
}

function hashReferralVerificationCode(code){
  return crypto.createHash('sha256')
    .update(`${String(code)}:${process.env.SESSION_SECRET||'dev-secret'}`)
    .digest('hex');
}

async function sendReferralVerificationEmail(email,fullName,code){
  const name=String(fullName||'there').trim()||'there';

  await mailer.sendMail({
    from:`${process.env.SMTP_FROM_NAME||'Codex Inc'} <${process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER}>`,
    to:email,
    subject:'Verify your Codex Inc Referral Program email',
    text:[
      `Hello ${name},`,
      '',
      'Use the verification code below to verify your email address:',
      '',
      code,
      '',
      'This code expires in 10 minutes. Do not share it with anyone.',
      'If you did not request this registration, you can ignore this email.',
      '',
      'Codex Inc'
    ].join('\\n'),
    html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#172033">
      <h2 style="margin-bottom:12px">Verify your email</h2>
      <p>Hello ${name.replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]))},</p>
      <p>Use this eight-digit code to verify your Codex Inc Referral Program account:</p>
      <div style="font-size:30px;font-weight:700;letter-spacing:7px;padding:18px;background:#f2f5f9;border-radius:10px;text-align:center">${code}</div>
      <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p>If you did not request this registration, you can ignore this email.</p>
      <p>Codex Inc</p>
    </div>`
  });
}

async function sendReferralWelcomeEmail(email,fullName,referralCode){
  const name=String(fullName||'there').trim()||'there';
  const siteUrl=String(process.env.SITE_URL||'https://codexwebwork.vercel.app').replace(/\/$/,'');
  const dashboardUrl=`${siteUrl}/dashboard`;
  const safeName=name.replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));

  await mailer.sendMail({
    from:`${process.env.SMTP_FROM_NAME||'Codex Inc'} <${process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER}>`,
    to:email,
    subject:'Welcome to the Codex Inc Referral Program',
    text:[
      `Hello ${name},`,
      '',
      'Your email has been verified and your referral account is ready.',
      'Sign in to your affiliate dashboard to access your account and referral tools.',
      '',
      `Go to Your Affiliate Dashboard: ${dashboardUrl}`,
      '',
      'Welcome aboard,',
      'Codex Inc'
    ].join('\n'),
    html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#172033">
      <h2>Welcome to Codex Inc!</h2>
      <p>Hello ${safeName},</p>
      <p>Your email has been verified and your referral account is ready.</p>
      <p>Sign in to your affiliate dashboard to access your account and referral tools.</p>
      <p><a href="${dashboardUrl}" style="display:inline-block;padding:12px 18px;background:#1877f2;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Go to Your Affiliate Dashboard</a></p>
      <p>Welcome aboard,<br>Codex Inc</p>
    </div>`
  });
}

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

async function deleteResumeFromCloudinary(publicId){
  if(!publicId)return true;

  try{
    const result=await cloudinary.uploader.destroy(
      publicId,
      {
        resource_type:'raw',
        invalidate:true
      }
    );

    if(result.result==='ok' || result.result==='not found'){
      return true;
    }

    console.error('Cloudinary resume delete failed:',result);
    return false;
  }catch(error){
    console.error('Cloudinary resume delete error:',error.message);
    return false;
  }
}

app.set('trust proxy',1);
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());

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

const chatRateLimit = new Map();
const CHAT_WINDOW_MS = 60 * 1000;
const CHAT_MAX_REQUESTS = 10;

function checkChatRateLimit(req){
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  const current = chatRateLimit.get(ip);

  if(!current || now - current.startedAt >= CHAT_WINDOW_MS){
    chatRateLimit.set(ip,{startedAt:now,count:1});
    return true;
  }

  if(current.count >= CHAT_MAX_REQUESTS){
    return false;
  }

  current.count += 1;
  return true;
}


function getReferralGoogleClient(){
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl=process.env.GOOGLE_CALLBACK_URL;

  if(!clientId||!clientSecret||!callbackUrl){
    throw new Error('Google OAuth configuration is incomplete.');
  }

  return new OAuth2Client(clientId,clientSecret,callbackUrl);
}

app.get('/api/referrals/auth/google',(req,res)=>{
  try{
    const client=getReferralGoogleClient();
    const state=crypto.randomBytes(32).toString('hex');
    req.session.googleOAuthState=state;

    req.session.save(error=>{
      if(error){
        console.error('Google OAuth session error:',error.message);
        return res.redirect('/referral-login.html?google=failed');
      }

      res.redirect(client.generateAuthUrl({
        response_type:'code',
        scope:['openid','email','profile'],
        state,
        prompt:'select_account'
      }));
    });
  }catch(error){
    console.error('Google OAuth start error:',error.message);
    res.redirect('/referral-login.html?google=unavailable');
  }
});

app.get('/api/referrals/auth/google/callback',async(req,res)=>{
  const fail=()=>{
    if(req.session)delete req.session.googleOAuthState;
    return res.redirect('/referral-login.html?google=failed');
  };

  if(req.query.error){
    delete req.session.googleOAuthState;
    return res.redirect('/referral-login.html?google=cancelled');
  }

  const receivedState=String(req.query.state||'');
  const expectedState=String(req.session.googleOAuthState||'');
  delete req.session.googleOAuthState;

  if(!receivedState||!expectedState||
     receivedState.length!==expectedState.length||
     !crypto.timingSafeEqual(Buffer.from(receivedState),Buffer.from(expectedState))){
    return fail();
  }

  const code=String(req.query.code||'');
  if(!code)return fail();

  let user;
  let isNewUser=false;

  try{
    const client=getReferralGoogleClient();
    const tokenResult=await client.getToken(code);
    const idToken=tokenResult.tokens.id_token;
    if(!idToken)throw new Error('Google did not return an ID token.');

    const ticket=await client.verifyIdToken({
      idToken,
      audience:process.env.GOOGLE_CLIENT_ID
    });
    const identity=ticket.getPayload();

    if(!identity||!identity.sub||identity.email_verified!==true){
      throw new Error('Google identity or verified email is missing.');
    }

    const email=normalizeReferralEmail(identity.email);
    const googleId=String(identity.sub);
    const fullName=String(identity.name||email.split('@')[0]).trim().slice(0,200);
    const avatarUrl=identity.picture?String(identity.picture).slice(0,2000):null;

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      throw new Error('Google returned an invalid email address.');
    }

    const dbClient=await pool.connect();

    try{
      await dbClient.query('BEGIN');

      const existing=await dbClient.query(
        `SELECT id,full_name,email,phone,password_hash,google_id,
                avatar_url,referral_code,status,email_verified,
                created_at,last_login_at
         FROM referral_users
         WHERE email=$1 OR google_id=$2
         FOR UPDATE`,
        [email,googleId]
      );

      if(existing.rowCount){
        const matched=existing.rows.find(
          row=>row.email===email||row.google_id===googleId
        );

        if(!matched||matched.email!==email||
           (matched.google_id&&matched.google_id!==googleId)){
          throw new Error('This Google account cannot be safely linked.');
        }

        if(matched.status!=='active'){
          await dbClient.query('COMMIT');
          return res.redirect('/referral-login.html?google=suspended');
        }

        const updated=await dbClient.query(
          `UPDATE referral_users
           SET google_id=COALESCE(google_id,$2),
               avatar_url=COALESCE($3,avatar_url),
               email_verified=true,
               last_login_at=now(),
               updated_at=now()
           WHERE id=$1
           RETURNING id,full_name,email,phone,password_hash,google_id,
                     avatar_url,referral_code,status,email_verified,
                     created_at,last_login_at`,
          [matched.id,googleId,avatarUrl]
        );
        user=updated.rows[0];
      }else{
        let referralCode;
        let available=false;

        for(let attempt=0;attempt<5;attempt++){
          referralCode=generateReferralCode();
          const collision=await dbClient.query(
            `SELECT 1 FROM referral_users WHERE referral_code=$1
             UNION ALL
             SELECT 1 FROM referral_pending_registrations WHERE referral_code=$1
             LIMIT 1`,
            [referralCode]
          );
          if(!collision.rowCount){available=true;break;}
        }

        if(!available)throw new Error('Unable to generate a referral code.');

        const created=await dbClient.query(
          `INSERT INTO referral_users
           (full_name,email,google_id,avatar_url,referral_code,email_verified)
           VALUES($1,$2,$3,$4,$5,true)
           RETURNING id,full_name,email,phone,password_hash,google_id,
                     avatar_url,referral_code,status,email_verified,
                     created_at,last_login_at`,
          [fullName,email,googleId,avatarUrl,referralCode]
        );
        user=created.rows[0];
        isNewUser=true;
      }

      await dbClient.query('COMMIT');
    }catch(error){
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{
      dbClient.release();
    }

    await new Promise((resolve,reject)=>{
      req.session.regenerate(error=>error?reject(error):resolve());
    });
    req.session.referralUser={id:user.id};
    req.session.cookie.maxAge=1000*60*60*24*REFERRAL_SESSION_DAYS;

    await new Promise((resolve,reject)=>{
      req.session.save(error=>error?reject(error):resolve());
    });

    if(isNewUser){
      try{
        await sendReferralWelcomeEmail(user.email,user.full_name,user.referral_code);
      }catch(error){
        console.error('Google signup welcome email error:',error.message);
      }
    }

    return res.redirect('/referral-dashboard.html');
  }catch(error){
    console.error('Google OAuth callback error:',error.message);
    return fail();
  }
});

app.post('/api/referrals/login',async(req,res)=>{
  try{
    const email=normalizeReferralEmail(req.body.email);
    const password=String(req.body.password||'');
    const turnstileToken=String(
      req.body.turnstile_token||''
    ).trim();

    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      return res.status(400).json({
        error:'Please provide a valid email address.'
      });
    }

    if(!password){
      return res.status(400).json({
        error:'Please enter your password.'
      });
    }

    if(!turnstileToken){
      return res.status(400).json({
        error:'Please complete the human verification.'
      });
    }

    let turnstileResult;

    try{
      const forwarded=String(
        req.headers['x-forwarded-for']||''
      ).split(',')[0].trim();

      const remoteIp=
        forwarded ||
        req.socket.remoteAddress ||
        '';

      turnstileResult=await verifyTurnstile(
        turnstileToken,
        remoteIp
      );
    }catch(error){
      console.error(
        'Turnstile login verification error:',
        error.message
      );

      return res.status(503).json({
        error:'Human verification is temporarily unavailable. Please try again.'
      });
    }

    if(!turnstileResult?.success){
      return res.status(400).json({
        error:'Human verification failed. Please try again.'
      });
    }

    const result=await query(
      `
      SELECT
        id,
        full_name,
        email,
        phone,
        password_hash,
        avatar_url,
        referral_code,
        status,
        email_verified,
        created_at,
        last_login_at
      FROM referral_users
      WHERE email=$1
      LIMIT 1
      `,
      [email]
    );

    if(!result.rowCount){
      return res.status(401).json({
        error:'Invalid email or password.'
      });
    }

    const user=result.rows[0];

    if(user.status!=='active'){
      return res.status(403).json({
        error:'This referral account is currently suspended.'
      });
    }

    if(!user.password_hash){
      return res.status(400).json({
        error:'This account uses Google sign-in. Please continue with Google.'
      });
    }

    const passwordValid=await verifyReferralPassword(
      password,
      user.password_hash
    );

    if(!passwordValid){
      return res.status(401).json({
        error:'Invalid email or password.'
      });
    }

    if(user.email_verified!==true){
      return res.status(403).json({
        error:'Please verify your email address before signing in.'
      });
    }

    await new Promise((resolve,reject)=>{
      req.session.regenerate(error=>{
        if(error)return reject(error);
        resolve();
      });
    });

    req.session.referralUser={
      id:user.id
    };

    req.session.cookie.maxAge=
      1000*60*60*24*REFERRAL_SESSION_DAYS;

    await query(
      `
      UPDATE referral_users
      SET
        last_login_at=now(),
        updated_at=now()
      WHERE id=$1
      `,
      [user.id]
    );

    await new Promise((resolve,reject)=>{
      req.session.save(error=>{
        if(error)return reject(error);
        resolve();
      });
    });

    res.json({
      ok:true,
      user:getReferralPublicUser({
        ...user,
        last_login_at:new Date()
      })
    });

  }catch(error){
    console.error(
      'Referral login error:',
      error.message
    );

    res.status(500).json({
      error:'Unable to sign you in right now.'
    });
  }
});

app.get('/api/referrals/stats',referralAuth,async(req,res)=>{
  try{
    const userId=req.session.referralUser.id;

    const clicksResult=await query(
      `
      SELECT COUNT(*)::integer AS count
      FROM referral_clicks
      WHERE referral_user_id=$1
      `,
      [userId]
    );

    const clientsResult=await query(
      `
      SELECT COUNT(*)::integer AS count
      FROM referral_leads
      WHERE referral_user_id=$1
        AND status='converted'
      `,
      [userId]
    );

    const commissionResult=await query(
      `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN status IN ('pending','approved')
              THEN commission_amount
              ELSE 0
            END
          ),
          0
        )::numeric AS pending,
        COALESCE(
          SUM(
            CASE
              WHEN status IN ('pending','approved','paid')
              THEN commission_amount
              ELSE 0
            END
          ),
          0
        )::numeric AS total
      FROM referral_commissions
      WHERE referral_user_id=$1
      `,
      [userId]
    );

    const commissions=commissionResult.rows[0];

    res.json({
      ok:true,
      stats:{
        clicks:Number(clicksResult.rows[0]?.count||0),
        clients:Number(clientsResult.rows[0]?.count||0),
        pending_commission:Number(
          commissions?.pending||0
        ),
        total_commission:Number(
          commissions?.total||0
        )
      }
    });

  }catch(error){
    console.error(
      'Referral stats error:',
      error.message
    );

    res.status(500).json({
      error:'Unable to load referral statistics.'
    });
  }
});

app.post('/api/referrals/logout',(req,res)=>{
  req.session.destroy(error=>{
    if(error){
      console.error(
        'Referral logout error:',
        error.message
      );

      return res.status(500).json({
        error:'Unable to sign you out right now.'
      });
    }

    res.clearCookie('connect.sid');

    res.json({
      ok:true
    });
  });
});

app.get('/api/referrals/me',referralAuth,async(req,res)=>{
  try{
    const result=await query(
      `
      SELECT
        id,
        full_name,
        email,
        phone,
        avatar_url,
        referral_code,
        status,
        email_verified,
        created_at,
        last_login_at
      FROM referral_users
      WHERE id=$1
      LIMIT 1
      `,
      [req.session.referralUser.id]
    );

    if(!result.rowCount){
      req.session.destroy(()=>{});

      return res.status(401).json({
        error:'Referral account no longer exists.'
      });
    }

    const user=result.rows[0];

    if(user.status!=='active'){
      req.session.destroy(()=>{});

      return res.status(403).json({
        error:'This referral account is currently suspended.'
      });
    }

    res.json({
      ok:true,
      user:getReferralPublicUser(user)
    });

  }catch(error){
    console.error(
      'Referral session lookup error:',
      error.message
    );

    res.status(500).json({
      error:'Unable to load your referral account.'
    });
  }
});

app.get('/ref/:code',async(req,res)=>{
  try{
    const referralCode=String(
      req.params.code||''
    ).trim().toUpperCase();

    if(!/^CDX-[A-Z0-9]{10}$/.test(referralCode)){
      return res.status(404).send('Referral link not found.');
    }

    const result=await query(
      `
      SELECT
        id,
        referral_code,
        status
      FROM referral_users
      WHERE referral_code=$1
      LIMIT 1
      `,
      [referralCode]
    );

    if(!result.rowCount || result.rows[0].status!=='active'){
      return res.status(404).send('Referral link not found.');
    }

    const user=result.rows[0];

    let visitorToken=req.cookies?.referral_visitor;

    if(!visitorToken){
      visitorToken=crypto.randomBytes(24).toString('hex');

      res.cookie(
        'referral_visitor',
        visitorToken,
        {
          httpOnly:true,
          sameSite:'lax',
          secure:process.env.NODE_ENV==='production',
          maxAge:1000*60*60*24*90
        }
      );
    }

    const ipAddress=String(
      req.headers['x-forwarded-for']||''
    ).split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '';

    const ipHash=crypto
      .createHash('sha256')
      .update(
        `${ipAddress}|${process.env.SESSION_SECRET||''}`
      )
      .digest('hex');

    await query(
      `
      INSERT INTO referral_clicks
      (
        referral_user_id,
        referral_code,
        visitor_token,
        landing_path,
        user_agent,
        ip_hash
      )
      VALUES($1,$2,$3,$4,$5,$6)
      `,
      [
        user.id,
        user.referral_code,
        visitorToken,
        req.originalUrl,
        String(req.headers['user-agent']||''),
        ipHash
      ]
    );

    res.cookie(
      'referral_code',
      user.referral_code,
      {
        httpOnly:true,
        sameSite:'lax',
        secure:process.env.NODE_ENV==='production',
        maxAge:1000*60*60*24*30
      }
    );

    res.redirect('/referral-work.html?ref='+encodeURIComponent(
      user.referral_code
    ));

  }catch(error){
    console.error(
      'Referral link error:',
      error.message
    );

    res.redirect('/referral-work.html');
  }
});

app.post('/api/contact',async(req,res)=>{
  try{
    const clientName=String(req.body?.client_name||'').trim();
    const clientEmail=normalizeReferralEmail(req.body?.client_email);
    const clientPhone=String(req.body?.client_phone||'').trim();
    const company=String(req.body?.company||'').trim();
    const projectDescription=String(req.body?.project_description||'').trim();

    if(clientName.length<2 || clientName.length>100){
      return res.status(400).json({error:'Please provide your name.'});
    }

    if(clientEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(clientEmail)){
      return res.status(400).json({error:'Please provide a valid email address.'});
    }

    if(!clientEmail && !clientPhone){
      return res.status(400).json({error:'Please provide an email address or phone number.'});
    }

    if(projectDescription.length<10 || projectDescription.length>5000){
      return res.status(400).json({error:'Please describe your project in 10 to 5000 characters.'});
    }

    if(!process.env.ADMIN_EMAIL){
      console.error('Contact inquiry email failed: ADMIN_EMAIL is not configured.');
      return res.status(503).json({error:'Contact submissions are temporarily unavailable. Please contact us through WhatsApp or email.'});
    }

    await mailer.sendMail({
      from:`${process.env.SMTP_FROM_NAME||'Codex Inc'} <${process.env.SMTP_FROM_EMAIL||process.env.SMTP_USER}>`,
      to:process.env.ADMIN_EMAIL,
      ...(clientEmail ? {replyTo:clientEmail} : {}),
      subject:`New Project Inquiry — ${clientName}`,
      text:[
        'A new project inquiry was submitted through the Codex Inc contact page.',
        '',
        `Name: ${clientName}`,
        `Email: ${clientEmail||'Not provided'}`,
        `Phone / WhatsApp: ${clientPhone||'Not provided'}`,
        `Company: ${company||'Not provided'}`,
        '',
        'Project description:',
        projectDescription
      ].join('\\n')
    });

    return res.status(201).json({
      ok:true,
      message:'Your project inquiry has been received. We will get back to you soon.'
    });
  }catch(error){
    console.error('Contact inquiry email failed:',error.message);
    return res.status(500).json({
      error:'Unable to send your inquiry right now. Please try again or contact us directly.'
    });
  }
});

app.post('/api/referrals/lead',async(req,res)=>{
  try{
    const clientName=String(
      req.body.client_name||''
    ).trim();

    const clientEmail=normalizeReferralEmail(
      req.body.client_email
    );

    const clientPhone=String(
      req.body.client_phone||''
    ).trim();

    const company=String(
      req.body.company||''
    ).trim();

    const projectDescription=String(
      req.body.project_description||''
    ).trim();

    if(clientName.length<2 || clientName.length>100){
      return res.status(400).json({
        error:'Please provide your name.'
      });
    }

    if(
      clientEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)
    ){
      return res.status(400).json({
        error:'Please provide a valid email address.'
      });
    }

    if(!clientEmail && !clientPhone){
      return res.status(400).json({
        error:'Please provide an email address or phone number.'
      });
    }

    if(
      projectDescription.length<10 ||
      projectDescription.length>5000
    ){
      return res.status(400).json({
        error:'Please describe the project you need help with.'
      });
    }

    const referralCode=String(
      req.cookies?.referral_code ||
      req.body.referral_code ||
      ''
    ).trim().toUpperCase();

    if(!referralCode){
      return res.status(400).json({
        error:'This project inquiry is not connected to a referral link.'
      });
    }

    const referralResult=await query(
      `
      SELECT
        id,
        referral_code,
        status
      FROM referral_users
      WHERE referral_code=$1
      LIMIT 1
      `,
      [referralCode]
    );

    if(
      !referralResult.rowCount ||
      referralResult.rows[0].status!=='active'
    ){
      return res.status(400).json({
        error:'The referral link is no longer active.'
      });
    }

    const referralUser=referralResult.rows[0];

    const duplicate=await query(
      `
      SELECT id
      FROM referral_leads
      WHERE referral_user_id=$1
        AND client_email=$2
        AND status NOT IN ('lost')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [
        referralUser.id,
        clientEmail||null
      ]
    );

    if(duplicate.rowCount){
      return res.status(409).json({
        error:'A project inquiry from this client has already been recorded.'
      });
    }

    const result=await query(
      `
      INSERT INTO referral_leads
      (
        referral_user_id,
        referral_code,
        client_name,
        client_email,
        client_phone,
        company,
        project_description
      )
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING
        id,
        status,
        created_at
      `,
      [
        referralUser.id,
        referralUser.referral_code,
        clientName,
        clientEmail||null,
        clientPhone||null,
        company||null,
        projectDescription
      ]
    );

    res.status(201).json({
      ok:true,
      message:'Your project inquiry has been received.',
      lead_id:result.rows[0].id,
      status:result.rows[0].status
    });

  }catch(error){
    console.error(
      'Referral lead error:',
      error.message
    );

    res.status(500).json({
      error:'Unable to submit your project inquiry right now.'
    });
  }
});

app.get('/api/referrals/config',(req,res)=>{
  res.json({
    turnstile_site_key:
      String(process.env.TURNSTILE_SITE_KEY||'').trim()
  });
});

app.post('/api/referrals/register',async(req,res)=>{
  try{
    const fullName=String(req.body.full_name||'').trim();
    const email=normalizeReferralEmail(req.body.email);
    const phone=String(req.body.phone||'').trim();
    const password=String(req.body.password||'');
    const confirmPassword=String(req.body.confirm_password||'');
    const turnstileToken=String(req.body.turnstile_token||'').trim();

    if(!turnstileToken){
      return res.status(400).json({
        error:'Please complete the human verification.'
      });
    }

    let turnstileResult;

    try{
      const forwarded=String(
        req.headers['x-forwarded-for']||''
      ).split(',')[0].trim();

      const remoteIp=
        forwarded ||
        req.socket.remoteAddress ||
        '';

      turnstileResult=await verifyTurnstile(
        turnstileToken,
        remoteIp
      );
    }catch(error){
      console.error(
        'Turnstile verification error:',
        error.message
      );

      return res.status(503).json({
        error:'Human verification is temporarily unavailable. Please try again.'
      });
    }

    if(!turnstileResult?.success){
      return res.status(400).json({
        error:'Human verification failed. Please try again.',
        codes:Array.isArray(turnstileResult?.['error-codes'])
          ? turnstileResult['error-codes']
          : []
      });
    }

    if(fullName.length<2 || fullName.length>100){
      return res.status(400).json({
        error:'Please provide your full name.'
      });
    }

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      return res.status(400).json({
        error:'Please provide a valid email address.'
      });
    }

    if(password.length<8 || password.length>128){
      return res.status(400).json({
        error:'Password must be between 8 and 128 characters.'
      });
    }

    if(!/[A-Z]/.test(password)){
      return res.status(400).json({
        error:'Password must contain at least one uppercase letter.'
      });
    }

    if(!/[a-z]/.test(password)){
      return res.status(400).json({
        error:'Password must contain at least one lowercase letter.'
      });
    }

    if(!/[0-9]/.test(password)){
      return res.status(400).json({
        error:'Password must contain at least one number.'
      });
    }

    if(!/[^A-Za-z0-9]/.test(password)){
      return res.status(400).json({
        error:'Password must contain at least one special character.'
      });
    }

    if(password!==confirmPassword){
      return res.status(400).json({
        error:'Passwords do not match.'
      });
    }

    const termsAgreed =
      req.body.terms_agreed === true ||
      req.body.terms_agreed === 'true' ||
      req.body.terms_agreed === 'on';

    if(!termsAgreed){
      return res.status(400).json({
        error:'You must agree to the Codex Referral Program Terms & Conditions.'
      });
    }

    const existing=await query(
      `
      SELECT id
      FROM referral_users
      WHERE email=$1
      LIMIT 1
      `,
      [email]
    );

    if(existing.rowCount){
      return res.status(409).json({
        error:'An account with this email already exists.'
      });
    }

    const passwordHash=await hashReferralPassword(password);
    const existingPending=await query(
      `SELECT id,last_code_sent_at
       FROM referral_pending_registrations
       WHERE email=$1
       LIMIT 1`,
      [email]
    );

    if(existingPending.rowCount){
      const lastSentAt=new Date(
        existingPending.rows[0].last_code_sent_at
      ).getTime();

      const waitMs=60000-(Date.now()-lastSentAt);

      if(waitMs>0){
        return res.status(429).json({
          error:`A verification code was recently sent. Please wait ${Math.ceil(waitMs/1000)} seconds before trying again.`
        });
      }
    }

    let referralCode=existingPending.rowCount
      ? null
      : undefined;

    if(!existingPending.rowCount){
      let attempts=0;

      while(!referralCode && attempts<10){
        attempts++;
        const candidate=generateReferralCode();

        const codeCheck=await query(
          `SELECT referral_code FROM referral_users WHERE referral_code=$1
           UNION ALL
           SELECT referral_code FROM referral_pending_registrations WHERE referral_code=$1
           LIMIT 1`,
          [candidate]
        );

        if(!codeCheck.rowCount){
          referralCode=candidate;
        }
      }

      if(!referralCode){
        return res.status(500).json({
          error:'Unable to prepare your referral registration right now.'
        });
      }
    }

    const verificationCode=generateReferralVerificationCode();
    const verificationHash=hashReferralVerificationCode(verificationCode);

    if(existingPending.rowCount){
      await query(
        `UPDATE referral_pending_registrations
         SET full_name=$1,
             phone=$2,
             password_hash=$3,
             verification_code_hash=$4,
             verification_expires_at=now()+interval '10 minutes',
             failed_attempts=0,
             last_code_sent_at=now()
         WHERE email=$5`,
        [
          fullName,
          phone||null,
          passwordHash,
          verificationHash,
          email
        ]
      );
    }else{
      await query(
        `INSERT INTO referral_pending_registrations
         (full_name,email,phone,password_hash,referral_code,
          verification_code_hash,verification_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
        [
          fullName,
          email,
          phone||null,
          passwordHash,
          referralCode,
          verificationHash
        ]
      );
    }

    try{
      await sendReferralVerificationEmail(
        email,
        fullName,
        verificationCode
      );
    }catch(mailError){
      console.error(
        'Referral verification email error:',
        mailError.message
      );

      return res.status(503).json({
        error:'Your registration is saved, but we could not send the verification email. Please try requesting a new code shortly.'
      });
    }

    return res.status(200).json({
      ok:true,
      verification_required:true,
      email,
      message:'We sent an eight-digit verification code to your email. It expires in 10 minutes.'
    });

  }catch(error){
    console.error(
      'Referral registration error:',
      error.message
    );

    res.status(500).json({
      error:'Unable to start your referral registration right now.'
    });
  }
});

app.post('/api/referrals/resend-verification',async(req,res)=>{
  const email=normalizeReferralEmail(req.body?.email);

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return res.status(400).json({
      error:'Please provide a valid email address.'
    });
  }

  let client;

  try{
    client=await pool.connect();
    await client.query('BEGIN');

    const result=await client.query(
      `SELECT id,email,full_name,last_code_sent_at
       FROM referral_pending_registrations
       WHERE email=$1
       FOR UPDATE`,
      [email]
    );

    if(!result.rowCount){
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:'No pending registration was found. Please register again.'
      });
    }

    const pending=result.rows[0];
    const elapsed=Date.now()-new Date(pending.last_code_sent_at).getTime();
    const remaining=Math.ceil((60000-elapsed)/1000);

    if(remaining>0){
      await client.query('ROLLBACK');
      return res.status(429).json({
        error:`Please wait ${remaining} seconds before requesting another code.`,
        retry_after_seconds:remaining
      });
    }

    const code=generateReferralVerificationCode();

    await client.query(
      `UPDATE referral_pending_registrations
       SET verification_code_hash=$1,
           verification_expires_at=now()+interval '10 minutes',
           failed_attempts=0,
           last_code_sent_at=now()
       WHERE id=$2`,
      [hashReferralVerificationCode(code),pending.id]
    );

    await client.query('COMMIT');

    try {
      await sendReferralVerificationEmail(
        pending.email,
        pending.full_name,
        code
      );
    } catch (emailError) {
      console.error(
        'Referral verification resend email error:',
        emailError.message
      );

      return res.status(503).json({
        error:'The new code was saved, but email delivery failed. Please wait 60 seconds before requesting another code.'
      });
    }

    return res.json({
      ok:true,
      message:'A new verification code has been sent. It expires in 10 minutes.'
    });
  }catch(error){
    if(client){
      try{await client.query('ROLLBACK');}catch(_){}
    }

    console.error('Referral verification resend error:',error.message);

    return res.status(500).json({
      error:'Unable to send a new verification code right now. Please try again later.'
    });
  }finally{
    if(client)client.release();
  }
});

app.post('/api/referrals/verify-email',async(req,res)=>{
  const email=normalizeReferralEmail(req.body?.email);
  const code=String(req.body?.code||'').trim();

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return res.status(400).json({error:'Please provide a valid email address.'});
  }

  if(!/^\d{8}$/.test(code)){
    return res.status(400).json({error:'Enter the eight-digit verification code.'});
  }

  let client;
  let user;

  try{
    client=await pool.connect();
    await client.query('BEGIN');

    const pendingResult=await client.query(
      `SELECT *
       FROM referral_pending_registrations
       WHERE email=$1
       FOR UPDATE`,
      [email]
    );

    if(!pendingResult.rowCount){
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:'No pending registration was found. Please register again.'
      });
    }

    const pending=pendingResult.rows[0];

    if(new Date(pending.verification_expires_at).getTime()<=Date.now()){
      await client.query('ROLLBACK');

      return res.status(400).json({
        error:'Your verification code has expired. Use Resend verification code to receive a new one.'
      });
    }

    if(pending.failed_attempts>=5){
      await client.query('ROLLBACK');
      return res.status(429).json({
        error:'Too many incorrect attempts. Please request a new verification code.'
      });
    }

    const expected=Buffer.from(pending.verification_code_hash,'hex');
    const supplied=Buffer.from(hashReferralVerificationCode(code),'hex');
    const valid=expected.length===supplied.length &&
      crypto.timingSafeEqual(expected,supplied);

    if(!valid){
      await client.query(
        `UPDATE referral_pending_registrations
         SET failed_attempts=failed_attempts+1
         WHERE id=$1`,
        [pending.id]
      );
      await client.query('COMMIT');

      return res.status(400).json({
        error:'That verification code is incorrect.'
      });
    }

    const created=await client.query(
      `INSERT INTO referral_users
       (full_name,email,phone,password_hash,referral_code,email_verified)
       VALUES($1,$2,$3,$4,$5,true)
       RETURNING id,full_name,email,phone,avatar_url,referral_code,
                 status,email_verified,created_at,last_login_at`,
      [
        pending.full_name,
        pending.email,
        pending.phone,
        pending.password_hash,
        pending.referral_code
      ]
    );

    user=created.rows[0];

    await client.query(
      'DELETE FROM referral_pending_registrations WHERE id=$1',
      [pending.id]
    );

    await client.query('COMMIT');
  }catch(error){
    if(client){
      try{await client.query('ROLLBACK');}catch(_){}
    }

    console.error('Referral email verification error:',error.message);

    return res.status(500).json({
      error:'Unable to verify your email right now. Please try again.'
    });
  }finally{
    if(client)client.release();
  }

  try{
    await new Promise((resolve,reject)=>{
      req.session.regenerate(error=>{
        if(error)return reject(error);
        resolve();
      });
    });

    req.session.referralUser={id:user.id};
    req.session.cookie.maxAge=1000*60*60*24*REFERRAL_SESSION_DAYS;

    await query(
      'UPDATE referral_users SET last_login_at=now(),updated_at=now() WHERE id=$1',
      [user.id]
    );

    await new Promise((resolve,reject)=>{
      req.session.save(error=>{
        if(error)return reject(error);
        resolve();
      });
    });
  }catch(error){
    console.error('Referral verification session error:',error.message);
    return res.status(500).json({
      error:'Your email was verified, but sign-in could not be completed. Please log in.'
    });
  }

  try{
    await sendReferralWelcomeEmail(user.email,user.full_name,user.referral_code);
  }catch(error){
    console.error('Referral welcome email error:',error.message);
  }

  return res.json({
    ok:true,
    user:getReferralPublicUser({
      ...user,
      last_login_at:new Date()
    }),
    referral_url:`${req.protocol}://${req.get('host')}/ref/${user.referral_code}`
  });
});

app.post('/api/chat', async (req,res)=>{
  if(!checkChatRateLimit(req)){
    return res.status(429).json({
      error:'Too many chat requests. Please try again in a minute.'
    });
  }

  try{
    const message=String(req.body?.message||'').trim();
    const history=Array.isArray(req.body?.history)
      ? req.body.history
      : [];

    if(!message){
      return res.status(400).json({error:'Message is required'});
    }

    if(message.length>1000){
      return res.status(400).json({error:'Message is too long'});
    }

    const safeHistory=history
      .filter(item =>
        item &&
        (item.role==='user'||item.role==='assistant') &&
        typeof item.content==='string'
      )
      .slice(-12)
      .map(item=>({
        role:item.role,
        content:item.content.slice(0,2000)
      }));

    const [worksResult,updatesResult]=await Promise.all([
      query(`
        SELECT slug,title,category,summary,description,tech,live_url,repo_url,featured
        FROM works
        ORDER BY featured DESC,created_at DESC
      `),
      query(`
        SELECT slug,title,excerpt,content,category,author,featured,published_at
        FROM updates
        WHERE status='published'
        ORDER BY published_at DESC NULLS LAST,created_at DESC
      `)
    ]);

    const knowledge={
      portfolio:{
        name:'Codex',
        type:'Personal technology portfolio',
        description:'A personal technology portfolio showcasing software development, digital products, APIs, web development, cybersecurity-related technology, and practical technology projects.',
        owner:'Abubakar Ewenyi Abdulqudus, professionally known as Codex.',
        website_pages:[
          {path:'/index.html',purpose:'Home'},
          {path:'/about.html',purpose:'About Codex'},
          {path:'/works.html',purpose:'Projects and work'},
          {path:'/services.html',purpose:'Services'},
          {path:'/experience.html',purpose:'Experience'},
          {path:'/team-up.html',purpose:'Team Up and collaboration applications'},
          {path:'/updates.html',purpose:'Latest updates and news'},
          {path:'/contact.html',purpose:'Contact Me'}
        ],
        contact:{
          email:'codexinc.web@gmail.com',
          whatsapp:'+234 704 513 9075',
          github:'https://github.com/codexincweb',
          linkedin:'https://www.linkedin.com/in/codex-inc-146990412'
        }
      },
      works:worksResult.rows,
      updates:updatesResult.rows
    };

    const systemInstruction=`You are the personal portfolio assistant for Codex.

You help visitors understand and navigate Codex's personal technology portfolio.

This is NOT a company or organization website. Do not describe Codex as a company, organization, agency, team, or corporation.

CORE RULES:
- Answer naturally, professionally and concisely.
- You know Codex's portfolio, projects, services, experience, Team Up system, updates and contact information.
- Use the live portfolio knowledge supplied below as your source of truth.
- For project questions, use the live WORKS data.
- For update/news questions, use the live PUBLISHED UPDATES data.
- Newly published projects and updates automatically appear in the supplied knowledge.
- Never invent a project, service, update, technology, achievement, statistic, employee, client or other fact.
- If information is not present in the supplied knowledge, say that you don't have that information.
- Never expose API keys, environment variables, database credentials, admin credentials, private records, server internals or security-sensitive implementation details.
- You may explain public website features and direct visitors to the appropriate public page.
- If someone asks who owns the portfolio, identify Abubakar Ewenyi Abdulqudus, professionally known as Codex.
- If someone asks how to contact Codex, provide the public contact information below.
- Do not claim that you personally performed actions on the website.
- Do not mention databases or internal systems unless specifically asked how the assistant's public knowledge works.
- Remember relevant information from earlier messages in the current conversation and use it when answering follow-up questions.

NAVIGATION RULES:
- When recommending a page on this portfolio, ALWAYS use a Markdown link with the exact internal path from the portfolio knowledge.
- Never display internal page paths such as /works.html or /team-up.html as raw text when a useful link can be provided.
- Use clear human-friendly link labels.
- Examples:
  [View My Projects](/works.html)
  [View My Services](/services.html)
  [View My Updates](/updates.html)
  [Contact Me](/contact.html)
  [Team Up with Me](/team-up.html)
- Prefer one or two relevant navigation links instead of listing every page.
- Do not invent internal URLs.
- External public links such as GitHub and LinkedIn may be provided when relevant.
- Do not put navigation links inside code blocks.

LIVE PORTFOLIO KNOWLEDGE:
${JSON.stringify(knowledge,null,2)}
`;

    const messages=[
      {
        role:'system',
        content:systemInstruction
      },
      ...safeHistory.map(item=>({
        role:item.role,
        content:item.parts?.[0]?.text||''
      })),
      {
        role:'user',
        content:message
      }
    ];

    const response=await groq.chat.completions.create({
      model:process.env.GROQ_MODEL||'openai/gpt-oss-20b',
      messages,
      temperature:0.4,
      max_tokens:700
    });

    const reply=String(
      response.choices?.[0]?.message?.content||''
    ).trim();

    if(!reply){
      return res.status(502).json({
        error:'No response received from AI'
      });
    }

    return res.json({reply});

  }catch(error){
    console.error('Codex chat error:',error);

    return res.status(500).json({
      error:'Unable to process the chat request right now.'
    });
  }
});
app.use(express.static(path.join(__dirname,'..','public')));

// Friendly affiliate dashboard URL (also supported by vercel.json).
app.get('/dashboard',(req,res) => {
  res.sendFile(path.join(__dirname,'..','public','referral-dashboard.html'));
});


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

    try{
      await sendTeamUpNotification(application);
      console.log(`Team Up admin email sent for application ${application.id}`);
    }catch(mailError){
      console.error('Team Up notification email failed:',mailError.message);
    }

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

app.delete('/api/admin/team-up/:id',admin,async(req,res)=>{
  try{
    const id=Number(req.params.id);

    if(!Number.isInteger(id) || id<1){
      return res.status(400).json({error:'Invalid application ID'});
    }

    const current=await query(
      `SELECT id,status,resume_public_id
       FROM team_up_applications
       WHERE id=$1
       LIMIT 1`,
      [id]
    );

    if(!current.rowCount){
      return res.status(404).json({error:'Application not found'});
    }

    const application=current.rows[0];

    if(application.status==='pending'){
      return res.status(400).json({
        error:'Pending applications must be reviewed before deletion'
      });
    }

    if(application.resume_public_id){
      const resumeDeleted=await deleteResumeFromCloudinary(
        application.resume_public_id
      );

      if(!resumeDeleted){
        return res.status(500).json({
          error:'Unable to remove the uploaded resume. The application was not deleted.'
        });
      }
    }

    await query(
      'DELETE FROM team_up_applications WHERE id=$1',
      [id]
    );

    res.json({ok:true});
  }catch(error){
    console.error('Team Up delete error:',error);
    res.status(500).json({error:'Unable to delete application'});
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

function getReactionVisitorToken(req){
  if(!req.session.reactionVisitorToken){
    req.session.reactionVisitorToken=crypto.randomBytes(24).toString('hex');
  }

  return req.session.reactionVisitorToken;
}


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

    const visitorToken=getReactionVisitorToken(req);

    const reactions=await query(`
      SELECT
        COUNT(*) FILTER (WHERE reaction='like')::int AS likes,
        COUNT(*) FILTER (WHERE reaction='dislike')::int AS dislikes
      FROM update_reactions
      WHERE update_id=$1
    `,[update.id]);

    const visitorReaction=await query(`
      SELECT reaction
      FROM update_reactions
      WHERE update_id=$1
        AND visitor_token=$2
      LIMIT 1
    `,[update.id,visitorToken]);

    res.json({
      update,
      comments:comments.rows,
      reactions:{
        likes:reactions.rows[0]?.likes||0,
        dislikes:reactions.rows[0]?.dislikes||0,
        current:visitorReaction.rows[0]?.reaction||null
      }
    });
  }catch(error){
    console.error('Failed to load update:',error);
    res.status(500).json({error:'Unable to load update'});
  }
});

app.post('/api/updates/:id/reaction',async(req,res)=>{
  try{
    const updateId=Number(req.params.id);
    const requested=String(req.body.reaction||'').trim().toLowerCase();

    if(!Number.isInteger(updateId)||updateId<1){
      return res.status(400).json({error:'Invalid update'});
    }

    if(!['like','dislike','none'].includes(requested)){
      return res.status(400).json({
        error:'Reaction must be like, dislike or none'
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

    const visitorToken=getReactionVisitorToken(req);

    if(requested==='none'){
      await query(`
        DELETE FROM update_reactions
        WHERE update_id=$1
          AND visitor_token=$2
      `,[updateId,visitorToken]);
    }else{
      await query(`
        INSERT INTO update_reactions
          (update_id,visitor_token,reaction)
        VALUES ($1,$2,$3)
        ON CONFLICT (update_id,visitor_token)
        DO UPDATE SET
          reaction=EXCLUDED.reaction,
          updated_at=now()
      `,[updateId,visitorToken,requested]);
    }

    const counts=await query(`
      SELECT
        COUNT(*) FILTER (WHERE reaction='like')::int AS likes,
        COUNT(*) FILTER (WHERE reaction='dislike')::int AS dislikes
      FROM update_reactions
      WHERE update_id=$1
    `,[updateId]);

    const current=await query(`
      SELECT reaction
      FROM update_reactions
      WHERE update_id=$1
        AND visitor_token=$2
      LIMIT 1
    `,[updateId,visitorToken]);

    res.json({
      likes:counts.rows[0]?.likes||0,
      dislikes:counts.rows[0]?.dislikes||0,
      current:current.rows[0]?.reaction||null
    });
  }catch(error){
    console.error('Failed to save reaction:',error);
    res.status(500).json({error:'Unable to save reaction'});
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

app.get('/api/gallery',async(req,res)=>{
  try{
    const r=await query(`
      SELECT id,image_url,sort_order,created_at
      FROM homepage_gallery
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json(r.rows);
  }catch(error){
    console.error('Gallery fetch error:',error.message);
    res.status(500).json({error:'Failed to load gallery'});
  }
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

app.get('/api/admin/gallery',admin,async(req,res)=>{
  try{
    const r=await query(`
      SELECT *
      FROM homepage_gallery
      ORDER BY sort_order ASC, created_at ASC
    `);
    res.json(r.rows);
  }catch(error){
    console.error('Admin gallery fetch error:',error.message);
    res.status(500).json({error:'Failed to load gallery'});
  }
});

app.post('/api/admin/gallery',admin,upload.single('image'),async(req,res)=>{
  try{
    if(!req.file){
      return res.status(400).json({error:'Image is required'});
    }

    const uploaded=await uploadToCloudinary(
      req.file,
      'codex-inc/home-gallery'
    );

    const sortOrder=Number.isFinite(Number(req.body.sort_order))
      ? Number(req.body.sort_order)
      : 0;

    const r=await query(`
      INSERT INTO homepage_gallery
      (image_url,image_public_id,sort_order)
      VALUES ($1,$2,$3)
      RETURNING *
    `,[
      uploaded.url,
      uploaded.public_id,
      sortOrder
    ]);

    res.status(201).json(r.rows[0]);
  }catch(error){
    console.error('Gallery upload error:',error.message);
    res.status(500).json({error:'Failed to upload gallery image'});
  }
});

app.delete('/api/admin/gallery/:id',admin,async(req,res)=>{
  try{
    const current=await query(
      'SELECT image_public_id FROM homepage_gallery WHERE id=$1',
      [req.params.id]
    );

    if(!current.rowCount){
      return res.status(404).json({error:'Gallery image not found'});
    }

    await deleteFromCloudinary(current.rows[0].image_public_id);

    await query(
      'DELETE FROM homepage_gallery WHERE id=$1',
      [req.params.id]
    );

    res.json({ok:true});
  }catch(error){
    console.error('Gallery delete error:',error.message);
    res.status(500).json({error:'Failed to delete gallery image'});
  }
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

  if(current.rows[0].image_public_id){
    await deleteFromCloudinary(current.rows[0].image_public_id);
  }

  await query('DELETE FROM works WHERE id=$1',[req.params.id]);

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

    if(current.rows[0].cover_image_public_id){
      await deleteFromCloudinary(
        current.rows[0].cover_image_public_id
      );
    }

    await query(
      'DELETE FROM updates WHERE id=$1',
      [req.params.id]
    );

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

app.get('/update/:slug',async(req,res)=>{
  try{
    const result=await query(`
      SELECT
        slug,
        title,
        excerpt,
        author,
        cover_image_url,
        published_at
      FROM updates
      WHERE slug=$1
        AND status='published'
      LIMIT 1
    `,[req.params.slug]);

    if(!result.rowCount){
      return res.status(404).send('Update not found');
    }

    const update=result.rows[0];
    const template=fs.readFileSync(
      path.join(__dirname,'..','public','update.html'),
      'utf8'
    );

    const escapeAttr=value=>String(value||'')
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');

    const protocol=(
      req.headers['x-forwarded-proto']?.split(',')[0]
      || req.protocol
      || 'https'
    );

    const canonicalUrl=
      `${protocol}://${req.get('host')}/update/${encodeURIComponent(update.slug)}`;

    const title=escapeAttr(update.title);
    const description=escapeAttr(update.excerpt||'Codex Inc update');
    const image=escapeAttr(update.cover_image_url||'');
    const author=escapeAttr(update.author||'Codex Inc');
    const publishedTime=update.published_at
      ? new Date(update.published_at).toISOString()
      : '';

    const metadata=`
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  ${image?`<meta property="og:image" content="${image}">`:''}
  <meta property="og:url" content="${escapeAttr(canonicalUrl)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Codex Inc">
  ${publishedTime?`<meta property="article:published_time" content="${publishedTime}">`:''}
  <meta property="article:author" content="${author}">
  <meta name="twitter:card" content="${image?'summary_large_image':'summary'}">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${image?`<meta name="twitter:image" content="${image}">`:''}
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}">
`;

    const html=template
      .replace(
        '<meta name="description" content="Codex Inc update">',
        `<meta name="description" content="${description}">${metadata}`
      )
      .replace(
        '<title>Update — Codex Inc</title>',
        `<title>${title} — Codex Inc</title>`
      );

    res.type('html').send(html);
  }catch(error){
    console.error('Failed to load update page:',error);
    res.status(500).send('Unable to load update');
  }
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

module.exports=app;

if(!process.env.VERCEL){
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
}
