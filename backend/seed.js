// Demo data: workers (details + prices), a shop owner, customers, stock, orders, tasks, invites, alerts.
// Run with: npm run demo   (safe to run again - it skips if demo data already exists)
const bcrypt=require('bcryptjs'),M=require('./models');
const PASS='demo123';
const WORKERS=[
 // name, phone, skill, km, ₹/day, ₹/hour, years, city, languages, rating, jobs, available, verified, about
 ['Ramesh Kumar','9000000001','Helper',1,500,65,3,'Patiala',['Punjabi','Hindi'],4.6,42,true,true,'Loads, unloads and arranges stock. Reliable and early.'],
 ['Sukhwinder Singh','9000000002','Delivery',2,650,85,4,'Patiala',['Punjabi','Hindi','English'],4.8,87,true,true,'Own two-wheeler. Home delivery within the city.'],
 ['Geeta Devi','9000000003','Cook',3,700,90,6,'Patiala',['Hindi','Punjabi'],4.7,33,true,true,'Chai, snacks, parathas and tiffin. Hygiene first.'],
 ['Manpreet Kaur','9000000004','Cashier',2,750,95,3,'Patiala',['Punjabi','Hindi','English'],4.5,21,true,true,'Billing, UPI and cash counter. Good with maths.'],
 ['Raju Yadav','9000000005','Helper',4,450,60,1,'Rajpura',['Hindi'],3.9,8,true,false,'New to the city, hard worker, ready for daily work.'],
 ['Balwinder Lal','9000000006','Electrician',5,1100,140,9,'Patiala',['Punjabi','Hindi'],4.9,120,false,true,'Wiring, fittings, inverter and fan repair.'],
 ['Harjeet Singh','9000000007','Plumber',3,950,120,7,'Patiala',['Punjabi','Hindi'],4.4,64,true,true,'Leakage, tap and tank fitting. Brings own tools.'],
 ['Sunita Rani','9000000008','Cleaner',1,400,55,2,'Patiala',['Hindi','Punjabi'],4.3,39,true,false,'Shop and house cleaning, morning shifts.'],
 ['Mohd. Irfan','9000000009','Tailor',6,800,100,8,'Patiala',['Hindi','Urdu','Punjabi'],4.7,55,true,true,'Stitching, alteration and uniform orders.'],
 ['Jaspal Singh','9000000010','Driver',4,900,115,10,'Nabha',['Punjabi','Hindi','English'],4.6,76,true,true,'Tempo and pickup driver, valid licence.'],
 ['Pooja Sharma','9000000011','Cashier',8,700,90,2,'Samana',['Hindi','English'],4.1,12,true,false,'Counter and stock entry, comfortable with phone apps.'],
 ['Deepak Verma','9000000012','Painter',5,850,105,5,'Patiala',['Hindi','Punjabi'],4.5,29,true,true,'Shop boards, wall paint and shutters.']];
module.exports=async()=>{
 if(await M.User.findOne({phone:'9876500001'})){console.log('Demo data already present - skipping seed');return}
 const hash=await bcrypt.hash(PASS,10),day=n=>new Date(Date.now()+n*864e5);
 const owner=await M.User.create({name:'Gurpreet Singh',phone:'9876500001',role:'owner',hash,verified:true,city:'Patiala'});
 if(process.env.ADMIN_PHONE&&!(await M.User.findOne({phone:process.env.ADMIN_PHONE})))await M.User.create({name:'Admin',phone:process.env.ADMIN_PHONE,role:'admin',hash});
 const W={};
 for(const[name,phone,skill,km,wage,hourly,exp,city,langs,rating,jobs,avail,verified,bio]of WORKERS)
  W[name.split(' ')[0]]=await M.User.create({name,phone,role:'worker',hash,skill,km,wage,hourly,exp,city,langs,rating,jobs,avail,verified,bio});
 // udhaar ledger: balances are computed from the transactions below
 const people={};const T=[['Ramesh','credit',120,'chai and biscuits'],['Ramesh','credit',60,'atta'],['Sukhdev','credit',450,'monthly ration'],['Sukhdev','repay',200,''],
  ['Mohan Lal','credit',85,'milk'],['Kulwinder','credit',300,'oil and sugar'],['Kulwinder','repay',100,''],['Simran','credit',40,'maggi']];
 for(const[n,t,a,note]of T){const c=people[n]||(people[n]=await M.Customer.create({owner:owner.id,name:n}));c.bal+=t==='credit'?a:-a;await c.save();
  await M.Txn.create({owner:owner.id,customer:c.id,type:t,amount:a,note})}
 for(const a of[250,90,35,180,60,420])await M.Txn.create({owner:owner.id,type:'sale',amount:a,note:'counter sale'});
 await M.Product.insertMany([['Atta 10kg',14,6],['Sugar 1kg',22,10],['Tea leaves 250g',5,8],['Milk 1L',30,12],['Mustard oil 1L',4,6],['Maggi',40,15],['Biscuits',9,12],['Basmati rice 5kg',11,4]].map(([name,qty,min])=>({owner:owner.id,name,qty,min})));
 await M.Order.insertMany([{owner:owner.id,product:'Tea leaves 250g',qty:12},{owner:owner.id,product:'Mustard oil 1L',qty:10},{owner:owner.id,product:'Biscuits',qty:24,status:'Received'}]);
 const mk=(title,desc,w,pay,status,d)=>({title,desc,owner:owner.id,worker:w?W[w].id:undefined,pay,status,deadline:day(d),...(['Completed','Verified'].includes(status)?{doneAt:day(-1)}:{})});
 await M.Task.insertMany([mk('Unload new stock truck','Atta and sugar bags, 40 pieces','Ramesh',500,'Verified',-2),
  mk('Deliver orders to Model Town','5 home deliveries before 6pm','Sukhwinder',650,'Completed',0),
  mk('Run the chai counter','Morning shift 7am to 12pm','Geeta',700,'In Progress',0),
  mk('Fix shop wiring','Two tube lights and one fan','Balwinder',1100,'Assigned',2),
  mk('Paint shop shutter','One coat, green and white','Deepak',850,'Accepted',3),
  mk('Weekend cashier','Saturday and Sunday counter','',700,'Pending',4)]);
 await M.Invite.insertMany([{owner:owner.id,worker:W.Manpreet.id,job:'Cashier',status:'Accepted'},{owner:owner.id,worker:W.Raju.id,job:'Helper',status:'Pending'},{owner:owner.id,worker:W.Harjeet.id,job:'Plumber',status:'Shortlisted'}]);
 await M.Notif.insertMany([{user:owner.id,text:'Low stock: Tea leaves 250g'},{user:owner.id,text:'Sukhwinder marked "Deliver orders to Model Town" completed'},{user:owner.id,text:'Manpreet accepted your invitation (Cashier)'},
  {user:W.Balwinder.id,text:'Gurpreet Singh assigned you a task: Fix shop wiring (₹1100)'},{user:W.Raju.id,text:'Gurpreet Singh invited you for Helper'}]);
 console.log(`Demo data added. Log in as shop owner 9876500001 or any worker 9000000001-9000000012, password: ${PASS}`)};
