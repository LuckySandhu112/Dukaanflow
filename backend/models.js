const m=require('mongoose'),S=m.Schema,R=r=>({type:S.Types.ObjectId,ref:r});
const M=(n,d)=>m.model(n,new S(d,{timestamps:true}));
exports.User=M('User',{name:String,phone:{type:String,unique:true},hash:String,
 role:{type:String,enum:['owner','worker','admin']},active:{type:Boolean,default:true},verified:{type:Boolean,default:false},
 skill:{type:String,default:''},km:{type:Number,default:3},wage:{type:Number,default:600},exp:{type:Number,default:1},avail:{type:Boolean,default:true},
 city:{type:String,default:''},bio:{type:String,default:''},langs:{type:[String],default:[]},hourly:{type:Number,default:75},rating:{type:Number,default:0},jobs:{type:Number,default:0},
 // ---- Community / profile fields (added to the SAME User collection - no second user table)
 // username + email are 'sparse' so old accounts without them don't clash; both are stored lowercase.
 username:{type:String,unique:true,sparse:true,lowercase:true,trim:true},
 email:{type:String,unique:true,sparse:true,lowercase:true,trim:true},
 showEmail:{type:Boolean,default:false},      // email is private unless the user opts in
 avatar:{type:String,select:false},           // small image (data URL); select:false = never loaded by accident
 avatarAt:Date,                               // when the picture last changed (also tells us "has a picture")
 isOnline:{type:Boolean,default:false},       // set true on login/heartbeat, false on logout
 lastSeen:Date});                             // updated by the heartbeat; used to detect closed tabs
exports.Invite=M('Invite',{owner:R('User'),worker:R('User'),job:String,status:{type:String,default:'Pending'}});
exports.Task=M('Task',{title:String,desc:String,owner:R('User'),worker:R('User'),deadline:Date,pay:Number,status:{type:String,default:'Pending'},doneAt:Date});
exports.Customer=M('Customer',{owner:R('User'),name:String,bal:{type:Number,default:0}});
exports.Txn=M('Txn',{owner:R('User'),customer:R('Customer'),type:String,amount:Number,note:String});
exports.Product=M('Product',{owner:R('User'),name:String,qty:Number,min:Number});
exports.Order=M('Order',{owner:R('User'),product:String,qty:Number,status:{type:String,default:'Pending'}});
exports.Notif=M('Notif',{user:R('User'),text:String,read:{type:Boolean,default:false}});
