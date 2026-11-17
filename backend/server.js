require('dotenv').config();
const express=require('express'),mongoose=require('mongoose'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),
rate=require('express-rate-limit'),helmet=require('helmet'),path=require('path'),M=require('./models');
const fs=require('fs'),crypto=require('crypto'),Users=require('./users');
if(!process.env.JWT_SECRET){const f=path.join(__dirname,'../.jwt-secret');if(!fs.existsSync(f))fs.writeFileSync(f,crypto.randomBytes(32).toString('hex'));process.env.JWT_SECRET=fs.readFileSync(f,'utf8').trim();console.log('No JWT_SECRET in .env - using auto-generated one')}
const app=express();app.use(helmet({contentSecurityPolicy:false}),express.json({limit:'100kb'}));
app.use('/api',(q,s,n)=>{s.set({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'});q.method==='OPTIONS'?s.sendStatus(204):n()});
app.use(express.static(path.join(__dirname,'../frontend')));
const bad=(msg,code=400)=>{throw{msg,code}};
const dupMsg=e=>({phone:'This mobile number is already registered',username:'That username is already taken',email:'That email is already registered'}[Object.keys(e.keyPattern||{})[0]]||'This account already exists');
const W=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(e=>s.status(e.code>=400&&e.code<600?e.code:e.code===11000?400:500).json({error:e.msg||(e.code===11000?dupMsg(e):e.message)}));
const note=(user,text)=>M.Notif.create({user,text});
const auth=(...roles)=>W(async(q,s,n)=>{let p;try{p=jwt.verify((q.headers.authorization||'').slice(7),process.env.JWT_SECRET)}catch{bad('Please log in',401)}
 const u=await M.User.findById(p.id);if(!u||!u.active)bad('Account unavailable',401);if(roles.length&&!roles.includes(u.role))bad('Not allowed',403);q.user=u;n()});
const pub=u=>({id:u.id,name:u.name,phone:u.phone,role:u.role,skill:u.skill,km:u.km,wage:u.wage,exp:u.exp,avail:u.avail,city:u.city,bio:u.bio,langs:u.langs,hourly:u.hourly,rating:u.rating,jobs:u.jobs,verified:u.verified,active:u.active});
const me=u=>({...pub(u),...Users.selfExtras(u)}); // own data (login/signup/me) - includes own email, never the hash
const num=(v,min=0)=>{v=Number(v);if(!Number.isFinite(v)||v<min)bad('Invalid number');return v};
const str=(v,l=100)=>String(v??'').trim().slice(0,l);
const lim=rate({windowMs:15*60*1000,max:30,message:{error:'Too many attempts, try later'}});

// ---- Auth
app.post('/api/auth/signup',lim,W(async(q,s)=>{const b=q.body,phone=str(b.phone,15);
 if(str(b.name).length<2)bad('Enter your name');if(!/^\d{10}$/.test(phone))bad('Mobile must be 10 digits');
 if(String(b.password||'').length<6)bad('Password needs 6+ characters');
 if(!['owner','worker'].includes(b.role))bad('Choose account type');
 const role=phone===(process.env.ADMIN_PHONE||'')?'admin':b.role;
 const email=Users.cleanEmail(b.email,bad);
 const username=str(b.username)?Users.cleanUsername(b.username,bad):await Users.makeUsername(b.name); // blank -> made from the name
 const u=await M.User.create({name:str(b.name),phone,role,username,email,hash:await bcrypt.hash(b.password,10),skill:role==='worker'?'Worker':'',isOnline:true,lastSeen:new Date()});
 s.json({token:jwt.sign({id:u.id},process.env.JWT_SECRET,{expiresIn:'30d'}),user:me(u)})}));
app.post('/api/auth/login',lim,W(async(q,s)=>{const u=await M.User.findOne({phone:str(q.body.phone,15)});
 if(!u||!(await bcrypt.compare(String(q.body.password||''),u.hash)))bad('Wrong credentials',401);if(!u.active)bad('Account suspended',403);
 await Users.markOnline(u.id);
 s.json({token:jwt.sign({id:u.id},process.env.JWT_SECRET,{expiresIn:'30d'}),user:me(u)})}));
app.get('/api/auth/me',auth(),(q,s)=>s.json(me(q.user)));
// Logout now also marks the person offline (the token is optional/ignored if already expired).
app.post('/api/auth/logout',W(async(q,s)=>{try{const p=jwt.verify((q.headers.authorization||'').slice(7),process.env.JWT_SECRET);await Users.markOffline(p.id)}catch{}s.json({ok:true})}));

// ---- Workers + hiring
const score=(w,j)=>{const r=[];let p=0;if(j.skill&&w.skill.toLowerCase()!==j.skill.toLowerCase())return null;p+=40;r.push('skill match');
 if(j.km&&w.km>j.km)return null;p+=20*(1-w.km/((j.km||10)*1.2));r.push(w.km+' km');
 if(w.avail){p+=15;r.push('available')}else r.push('busy');
 if(!j.wage||w.wage<=j.wage){p+=15;r.push('wage fits')}else{p+=Math.max(0,15-(w.wage-j.wage)/10);r.push('asks ₹'+(w.wage-j.wage)+' more')}
 if(j.exp&&w.exp<j.exp)r.push('below experience need');p+=Math.min(10,10*w.exp/Math.max(1,(j.exp||1)*2));
 return{...pub(w),match:Math.min(100,Math.round(p)),why:r.join(' · ')}};
app.get('/api/workers',auth('owner','admin'),W(async(q,s)=>{const j={skill:str(q.query.skill),km:+q.query.km||0,wage:+q.query.wage||0,exp:+q.query.exp||0};
 const ws=await M.User.find({role:'worker',active:true});s.json(ws.map(w=>score(w,j)).filter(Boolean).sort((a,b)=>b.match-a.match))}));
app.get('/api/workers/:id',auth(),W(async(q,s)=>{const w=await M.User.findOne({_id:q.params.id,role:'worker'});if(!w)bad('Not found',404);s.json(pub(w))}));
app.put('/api/workers/me',auth('worker'),W(async(q,s)=>{const b=q.body,u=q.user;u.skill=str(b.skill,40);u.km=num(b.km);u.wage=num(b.wage);u.exp=num(b.exp);u.avail=!!b.avail;u.hourly=num(b.hourly);u.city=str(b.city,40);u.bio=str(b.bio,200);
 u.langs=String(b.langs||'').split(',').map(x=>x.trim().slice(0,20)).filter(Boolean).slice(0,5);await u.save();s.json(pub(u))}));
app.post('/api/invites',auth('owner'),W(async(q,s)=>{const w=await M.User.findOne({_id:q.body.worker,role:'worker'});if(!w)bad('Worker not found',404);
 const job=str(q.body.job)||w.skill;if(await M.Invite.findOne({owner:q.user.id,worker:w.id,job}))bad('Already invited');
 const i=await M.Invite.create({owner:q.user.id,worker:w.id,job});await note(w.id,`${q.user.name} invited you for ${job}`);s.json(i)}));
app.get('/api/invites',auth('owner','worker'),W(async(q,s)=>{const f=q.user.role==='owner'?{owner:q.user.id}:{worker:q.user.id};
 s.json(await M.Invite.find(f).populate('worker','name skill').populate('owner','name').sort('-createdAt'))}));
app.patch('/api/invites/:id',auth('owner','worker'),W(async(q,s)=>{const i=await M.Invite.findById(q.params.id);const st=q.body.status;
 const ok=q.user.role==='owner'?(String(i?.owner)===q.user.id&&['Shortlisted','Rejected'].includes(st)):(String(i?.worker)===q.user.id&&['Accepted','Rejected'].includes(st));
 if(!ok)bad('Not allowed',403);i.status=st;await i.save();await note(q.user.role==='owner'?i.worker:i.owner,`Application ${st.toLowerCase()} (${i.job})`);s.json(i)}));

// ---- Tasks
const FLOW={worker:{Assigned:['Accepted','Rejected'],Accepted:['In Progress'],'In Progress':['Completed']},
 owner:{Pending:['Rejected'],Assigned:['Rejected'],Accepted:['Rejected'],'In Progress':['Rejected'],Completed:['Verified']}};
app.post('/api/tasks',auth('owner'),W(async(q,s)=>{const b=q.body;if(str(b.title).length<2)bad('Task title required');
 const t={title:str(b.title),desc:str(b.desc,500),owner:q.user.id,pay:num(b.pay),deadline:b.deadline||undefined,status:'Pending'};
 if(b.worker){if(!(await M.User.findOne({_id:b.worker,role:'worker',active:true})))bad('Worker not found');t.worker=b.worker;t.status='Assigned'}
 const k=await M.Task.create(t);if(t.worker)await note(t.worker,`New task: ${t.title} (₹${t.pay})`);s.json(k)}));
app.get('/api/tasks',auth('owner','worker'),W(async(q,s)=>{const f=q.user.role==='owner'?{owner:q.user.id}:{worker:q.user.id};
 s.json(await M.Task.find(f).populate('worker','name').populate('owner','name').sort('-createdAt'))}));
app.get('/api/tasks/:id',auth('owner','worker'),W(async(q,s)=>{const t=await M.Task.findById(q.params.id).populate('worker','name');
 if(!t||![String(t.owner),String(t.worker?._id)].includes(q.user.id))bad('Not found',404);s.json(t)}));
app.put('/api/tasks/:id',auth('owner'),W(async(q,s)=>{const t=await M.Task.findOne({_id:q.params.id,owner:q.user.id});if(!t)bad('Not found',404);
 if(!['Pending','Assigned'].includes(t.status))bad('Task already started');Object.assign(t,{title:str(q.body.title)||t.title,desc:str(q.body.desc,500),pay:num(q.body.pay)});await t.save();s.json(t)}));
app.patch('/api/tasks/:id/status',auth('owner','worker'),W(async(q,s)=>{const t=await M.Task.findById(q.params.id);const st=q.body.status;
 if(!t||String(q.user.role==='owner'?t.owner:t.worker)!==q.user.id)bad('Not found',404);
 if(!(FLOW[q.user.role][t.status]||[]).includes(st))bad(`Cannot change ${t.status} to ${st}`);
 t.status=st;if(st==='Completed')t.doneAt=new Date();await t.save();
 if(st==='Verified'&&t.worker){const r=Number(q.body.rating),w=await M.User.findById(t.worker);if(w){if(r>=1&&r<=5)w.rating=Math.round((w.rating*w.jobs+r)/(w.jobs+1)*10)/10;w.jobs+=1;await w.save()}}
 const to=q.user.role==='owner'?t.worker:t.owner;if(to)await note(to,`Task "${t.title}" is now ${st}`);s.json(t)}));

// ---- Shop
const own=auth('owner');
app.get('/api/customers',own,W(async(q,s)=>s.json(await M.Customer.find({owner:q.user.id}).sort('name'))));
app.post('/api/customers',own,W(async(q,s)=>{if(!str(q.body.name))bad('Name required');s.json(await M.Customer.create({owner:q.user.id,name:str(q.body.name,40)}))}));
app.post('/api/transactions',own,W(async(q,s)=>{const b=q.body,type=b.type,amt=num(b.amount,1);if(!['credit','repay','sale'].includes(type))bad('Invalid type');
 let c;if(type!=='sale'){const nm=str(b.customer,40);if(!nm)bad('Customer required');c=await M.Customer.findOne({owner:q.user.id,name:new RegExp('^'+nm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')})||await M.Customer.create({owner:q.user.id,name:nm});
  if(type==='repay'&&amt>c.bal)bad(`Repayment is more than balance ₹${c.bal}`);c.bal+=type==='credit'?amt:-amt;await c.save()}
 const t=await M.Txn.create({owner:q.user.id,customer:c?.id,type,amount:amt,note:str(b.note)});s.json({txn:t,customer:c})}));
app.get('/api/transactions',own,W(async(q,s)=>s.json(await M.Txn.find({owner:q.user.id}).populate('customer','name').sort('-createdAt').limit(50))));
app.get('/api/products',own,W(async(q,s)=>s.json(await M.Product.find({owner:q.user.id}).sort('name'))));
app.post('/api/products',own,W(async(q,s)=>{const b=q.body;if(!str(b.name))bad('Name required');const p=await M.Product.create({owner:q.user.id,name:str(b.name,40),qty:num(b.qty),min:num(b.min)});
 if(p.qty<p.min)await note(q.user.id,`Low stock: ${p.name}`);s.json(p)}));
app.put('/api/products/:id',own,W(async(q,s)=>{const p=await M.Product.findOne({_id:q.params.id,owner:q.user.id});if(!p)bad('Not found',404);
 p.qty=num(q.body.qty);if(q.body.min!=null)p.min=num(q.body.min);await p.save();if(p.qty<p.min)await note(q.user.id,`Low stock: ${p.name}`);s.json(p)}));
app.delete('/api/products/:id',own,W(async(q,s)=>{await M.Product.deleteOne({_id:q.params.id,owner:q.user.id});s.json({ok:true})}));
app.get('/api/orders',own,W(async(q,s)=>s.json(await M.Order.find({owner:q.user.id}).sort('-createdAt'))));
app.post('/api/orders',own,W(async(q,s)=>s.json(await M.Order.create({owner:q.user.id,product:str(q.body.product,40),qty:num(q.body.qty,1)}))));
app.patch('/api/orders/:id',own,W(async(q,s)=>s.json(await M.Order.findOneAndUpdate({_id:q.params.id,owner:q.user.id},{status:q.body.status==='Received'?'Received':'Pending'},{new:true}))));

// ---- Dashboard, notifications, admin
app.get('/api/shop/dashboard',auth('owner','worker'),W(async(q,s)=>{const u=q.user,n=await M.Notif.find({user:u.id}).sort('-createdAt').limit(5);
 if(u.role==='worker'){const t=await M.Task.find({worker:u.id});return s.json({role:'worker',active:t.filter(x=>['Accepted','In Progress'].includes(x.status)).length,pending:t.filter(x=>x.status==='Assigned').length,
  done:t.filter(x=>['Completed','Verified'].includes(x.status)).length,earned:t.filter(x=>x.status==='Verified').reduce((a,x)=>a+x.pay,0),recent:n})}
 const day=new Date();day.setHours(0,0,0,0);const [t,tx,c,p,w]=await Promise.all([M.Task.find({owner:u.id}),M.Txn.find({owner:u.id,createdAt:{$gte:day}}),M.Customer.find({owner:u.id}),M.Product.find({owner:u.id}),M.User.countDocuments({role:'worker',active:true})]);
 s.json({role:'owner',workers:w,active:t.filter(x=>['Assigned','Accepted','In Progress'].includes(x.status)).length,pending:t.filter(x=>x.status==='Pending').length,
  done:t.filter(x=>['Completed','Verified'].includes(x.status)).length,sales:tx.filter(x=>x.type!=='repay').reduce((a,x)=>a+x.amount,0),
  udhaar:c.reduce((a,x)=>a+x.bal,0),low:p.filter(x=>x.qty<x.min).length,recent:n})}));
app.get('/api/notifications',auth(),W(async(q,s)=>s.json(await M.Notif.find({user:q.user.id}).sort('-createdAt').limit(50))));
app.patch('/api/notifications/:id/read',auth(),W(async(q,s)=>s.json(await M.Notif.findOneAndUpdate({_id:q.params.id,user:q.user.id},{read:true},{new:true}))));
app.get('/api/admin/users',auth('admin'),W(async(q,s)=>s.json((await M.User.find().sort('-createdAt')).map(Users.adminView))));
app.patch('/api/admin/users/:id',auth('admin'),W(async(q,s)=>{const u=await M.User.findById(q.params.id);if(!u||u.role==='admin')bad('Not allowed',403);
 if('active' in q.body){u.active=!!q.body.active;if(!u.active)u.isOnline=false}if('verified' in q.body)u.verified=!!q.body.verified;await u.save();s.json(Users.adminView(u))}));
Users.register(app,{auth,W,bad,str}); // Users / Community routes (see users.js)
app.use('/api',(q,s)=>s.status(404).json({error:'Not found'}));
const PORT=process.env.PORT||3000;
async function connectDb(){
 if(process.env.MONGO_URI){try{await mongoose.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:4000});console.log('Connected to MongoDB');return}catch(e){console.warn('MongoDB at MONGO_URI not reachable ('+e.message+'). Falling back to built-in local database.')}}
 let MMS;try{MMS=require('mongodb-memory-server').MongoMemoryServer}catch{throw Error('No MongoDB available. Install MongoDB / set MONGO_URI, or run "npm install" again.')}
 const dir=path.join(__dirname,'../data');fs.mkdirSync(dir,{recursive:true});
 const m=await MMS.create({instance:{dbPath:dir,storageEngine:'wiredTiger'}});
 await mongoose.connect(m.getUri('dukaanflow'));console.log('Using built-in local database (data saved in ./data)');
 const stop=()=>m.stop().finally(()=>process.exit());process.on('SIGINT',stop);process.on('SIGTERM',stop)}
connectDb().then(async()=>{if(process.argv.includes('--seed'))await require('./seed')();await Users.backfillUsernames()}).then(()=>app.listen(PORT,()=>console.log('Dukaanflow on http://localhost:'+PORT))).catch(e=>{console.error('Startup failed:',e.message);process.exit(1)});
