const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { all, get, run, db } = require('./db');

// Load a local .env file without adding a dependency. Real environment
// variables take precedence, and secrets stay on the server.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const assistantModule = import('../cloudflare/assistant.mjs');
const os = require('node:os');
const localAIEnv=()=>({...process.env,AI_REMOTE_URL:process.env.AI_REMOTE_URL===undefined?'https://wenxiang-neijiang.pages.dev':process.env.AI_REMOTE_URL});
const port = Number(process.env.PORT || 3000);
const webRoot = path.join(__dirname, '..', 'web');
const miniRoot = path.join(__dirname, '..', 'miniprogram');

function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{ let s=''; req.on('data',c=>{s+=c;if(s.length>1024*1024){reject(Error('请求内容过大'));req.destroy();}}); req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}}); req.on('error',reject); }); }
function parseDate(v){ const d=new Date(v); return Number.isNaN(d.getTime())?null:d; }
function sessions(courseId){ return all('SELECT * FROM sessions WHERE course_id=? ORDER BY start_at',[courseId]); }
function courseRow(c, userId=1){
  const ss=sessions(c.id); const active=Number(get("SELECT COUNT(*) n FROM enrollments WHERE course_id=? AND status='active'",[c.id]).n); const waiting=Number(get("SELECT COUNT(*) n FROM waitlist WHERE course_id=? AND status='waiting'",[c.id]).n);
  const mine=get("SELECT status FROM enrollments WHERE course_id=? AND user_id=? AND status='active'",[c.id,userId]);
  return {...c, sessions:ss, active_count:active, waiting_count:waiting, remaining:Math.max(0,c.capacity-active), mine:!!mine};
}
function conflict(userId, courseId){
  const target=sessions(courseId); const mine=all("SELECT course_id FROM enrollments WHERE user_id=? AND status='active'",[userId]);
  for(const item of mine){ for(const a of target){ for(const b of sessions(item.course_id)){ if(new Date(a.start_at)<new Date(b.end_at) && new Date(a.end_at)>new Date(b.start_at)) return {courseId:item.course_id,session:a}; } } }
  return null;
}
function log(actor,action,type,id,detail){run('INSERT INTO audit_logs(actor,action,object_type,object_id,detail) VALUES(?,?,?,?,?)',[actor,action,type,id,detail||'']);}
function validateCourseInput(b){const required=['title','category','description','teacher','location','level','audience','capacity','openAt','closeAt','startAt','endAt'];for(const k of required)if(b[k]===undefined||b[k]===null||String(b[k]).trim()==='')return `缺少字段 ${k}`;const cap=Number(b.capacity);if(!Number.isInteger(cap)||cap<=0)return '名额必须是正整数';for(const k of ['openAt','closeAt','startAt','endAt'])if(!parseDate(b[k]))return `${k} 日期格式不正确`;if(new Date(b.endAt)<=new Date(b.startAt))return '结束时间必须晚于开始时间';if(new Date(b.closeAt)<=new Date(b.openAt))return '报名截止时间必须晚于开放时间';return null;}

async function aiSearch(text,userId){
  const assistant=await assistantModule;
  const parsed=await assistant.resolveIntent(text,localAIEnv());
  const courses=all("SELECT * FROM courses WHERE status='published' AND datetime(open_at)<=datetime('now') AND datetime(close_at)>datetime('now')").map(c=>courseRow(c,userId));
  return {...parsed,...await assistant.recommendCourses(courses,parsed.intent,c=>!!conflict(userId,c.id)),version:assistant.ASSISTANT_VERSION};
}

async function api(req,res,url){
  const method=req.method; const pathname=url.pathname; const q=Object.fromEntries(url.searchParams.entries());
  try {
    if(method==='GET'&&pathname==='/api/health')return json(res,200,{ok:true,version:'2.0',mode:(await assistantModule).providerInfo(localAIEnv()).provider==='本地规则'?'规则模式':'AI已配置',provider:(await assistantModule).providerInfo(localAIEnv()).provider});
    if(method==='GET'&&pathname==='/api/users')return json(res,200,{users:all('SELECT id,name,phone,font_scale FROM users')});
    if(method==='GET'&&pathname==='/api/courses'){
      const uid=Number(q.userId||1); let rows=all("SELECT * FROM courses WHERE status='published' ORDER BY id").map(c=>courseRow(c,uid));
      if(q.category)rows=rows.filter(x=>x.category===q.category); if(q.level)rows=rows.filter(x=>x.level===q.level); if(q.keyword){const k=q.keyword.toLowerCase();rows=rows.filter(x=>(x.title+x.description+x.tags).toLowerCase().includes(k));} return json(res,200,{courses:rows});
    }
    const cm=pathname.match(/^\/api\/courses\/(\d+)$/); if(method==='GET'&&cm){const c=get('SELECT * FROM courses WHERE id=?',[Number(cm[1])]);if(!c)return json(res,404,{error:'课程不存在'});return json(res,200,{course:courseRow(c,Number(q.userId||1))});}
    if(method==='POST'&&pathname==='/api/ai/search'){const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>600)return json(res,400,{error:'请输入1至600字的找课需求'});return json(res,200,await aiSearch(b.text,Number(b.userId||1)));}
    if(method==='POST'&&pathname==='/api/ai/explain'){const b=await body(req),c=get('SELECT * FROM courses WHERE id=?',[Number(b.courseId)]);if(!c)return json(res,404,{error:'课程不存在'});const a=await assistantModule;return json(res,200,{...await a.plainCourse(c,localAIEnv()),course:courseRow(c,Number(b.userId||1))});}
    if(method==='GET'&&pathname==='/api/me/schedule'){const uid=Number(q.userId||1);return json(res,200,{courses:all("SELECT e.id enrollment_id,e.status,e.created_at,c.*,GROUP_CONCAT(s.start_at||'|'||s.end_at) schedule FROM enrollments e JOIN courses c ON c.id=e.course_id JOIN sessions s ON s.course_id=c.id WHERE e.user_id=? AND e.status='active' GROUP BY e.id ORDER BY s.start_at",[uid])});}
    if(method==='POST'&&pathname==='/api/enrollments'){
      const b=await body(req);const uid=Number(b.userId||1),cid=Number(b.courseId);const c=get('SELECT * FROM courses WHERE id=?',[cid]);if(!c)return json(res,404,{error:'课程不存在'});if(c.status!=='published')return json(res,400,{error:'课程暂未开放报名'});
      if(get("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status='active'",[uid,cid]))return json(res,409,{error:'你已经报名过这门课'});
      const clash=conflict(uid,cid);if(clash)return json(res,409,{error:'和你已报名的课程时间冲突'});
      const active=Number(get("SELECT COUNT(*) n FROM enrollments WHERE course_id=? AND status='active'",[cid]).n);
      if(active>=c.capacity){const pos=Number(get("SELECT COALESCE(MAX(position),0)+1 p FROM waitlist WHERE course_id=? AND status='waiting'",[cid]).p);run("INSERT INTO waitlist(user_id,course_id,position) VALUES(?,?,?)",[uid,cid,pos]);log(String(uid),'加入候补','course',cid,`position=${pos}`);return json(res,200,{status:'waiting',position:pos,message:`名额已满，已加入第 ${pos} 位候补`});}
      const result=run("INSERT INTO enrollments(user_id,course_id,status) VALUES(?,?, 'active')",[uid,cid]);log(String(uid),'报名','course',cid,'');return json(res,201,{status:'active',id:Number(result.lastInsertRowid),message:'报名成功'});
    }
    const em=pathname.match(/^\/api\/enrollments\/(\d+)$/);if(method==='DELETE'&&em){const id=Number(em[1]);const uid=Number(q.userId||0);const e=get("SELECT * FROM enrollments WHERE id=? AND status='active'",[id]);if(!e)return json(res,404,{error:'报名记录不存在'});if(!uid||e.user_id!==uid)return json(res,403,{error:'只能取消自己的报名'});run("UPDATE enrollments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE id=?",[id]);const next=get("SELECT * FROM waitlist WHERE course_id=? AND status='waiting' ORDER BY position,id LIMIT 1",[e.course_id]);if(next){const c=get('SELECT * FROM courses WHERE id=?',[e.course_id]);if(!conflict(next.user_id,e.course_id)&&Number(get("SELECT COUNT(*) n FROM enrollments WHERE course_id=? AND status='active'",[e.course_id]).n)<c.capacity){run("INSERT INTO enrollments(user_id,course_id,status) VALUES(?,?, 'active')",[next.user_id,e.course_id]);run("UPDATE waitlist SET status='promoted' WHERE id=?",[next.id]);}}return json(res,200,{message:'已取消报名'});}
    if(method==='PATCH'&&/^\/api\/admin\/courses\/\d+$/.test(pathname)){const id=Number(pathname.split('/').pop());const b=await body(req);if(!['published','closed'].includes(b.status))return json(res,400,{error:'状态只能是 published 或 closed'});if(!get('SELECT id FROM courses WHERE id=?',[id]))return json(res,404,{error:'课程不存在'});run('UPDATE courses SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[b.status,id]);log('admin','修改状态','course',id,b.status);return json(res,200,{status:b.status});}
    if(method==='GET'&&pathname==='/api/admin/courses')return json(res,200,{courses:all('SELECT * FROM courses ORDER BY id DESC').map(c=>courseRow(c,1))});
    if(method==='POST'&&pathname==='/api/admin/courses'){const b=await body(req);const validation=validateCourseInput(b);if(validation)return json(res,400,{error:validation});const r=run(`INSERT INTO courses(title,category,description,teacher,location,level,audience,fee,capacity,status,open_at,close_at,tags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[b.title,b.category,b.description,b.teacher,b.location,b.level,b.audience,Number(b.fee||0),Number(b.capacity),b.status||'published',b.openAt,b.closeAt,b.tags||'']);const id=Number(r.lastInsertRowid);run('INSERT INTO sessions(course_id,start_at,end_at) VALUES(?,?,?)',[id,b.startAt,b.endAt]);log('admin','创建课程','course',id,'');return json(res,201,{id});}
    if(method==='POST'&&pathname==='/api/admin/courses/import'){const b=await body(req);let created=0;for(const x of (b.courses||[])){const validation=validateCourseInput({...x,category:x.category||'文化课程',description:x.description||'演示课程',teacher:x.teacher||'待定',location:x.location||'文化馆',level:x.level||'初级',audience:x.audience||'居民',capacity:x.capacity||10,openAt:x.openAt||new Date().toISOString(),closeAt:x.closeAt||new Date(Date.now()+86400000*30).toISOString(),endAt:x.endAt||x.startAt});if(validation)continue;const r=run(`INSERT INTO courses(title,category,description,teacher,location,level,audience,fee,capacity,status,open_at,close_at,tags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[x.title,x.category||'文化课程',x.description||'演示课程',x.teacher||'待定',x.location||'文化馆',x.level||'初级',x.audience||'居民',Number(x.fee||0),Number(x.capacity||10),'published',x.openAt||new Date().toISOString(),x.closeAt||new Date(Date.now()+86400000*30).toISOString(),x.tags||'']);run('INSERT INTO sessions(course_id,start_at,end_at) VALUES(?,?,?)',[Number(r.lastInsertRowid),x.startAt,x.endAt||x.startAt]);created++;}return json(res,200,{created});}
    if(method==='GET'&&pathname==='/api/admin/export'){const rows=all("SELECT e.id,e.status,u.name,u.phone,c.title,c.teacher,c.location,e.created_at FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id ORDER BY e.created_at DESC");const csv=['报名编号,状态,姓名,电话,课程,教师,地点,报名时间',...rows.map(r=>Object.values(r).map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','))].join('\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=enrollments.csv'});return res.end('\ufeff'+csv);}
    return json(res,404,{error:'接口不存在'});
  } catch(e){ console.error(e); return json(res,500,{error:e.message||'服务器错误'}); }
}
function staticFile(req,res){const url=new URL(req.url,'http://localhost');let base=url.pathname.startsWith('/miniprogram')?miniRoot:webRoot;let rel=url.pathname.replace(/^\/miniprogram/,'')||'/index.html';if(rel==='/')rel='/index.html';const fp=path.normalize(path.join(base,rel));if(!fp.startsWith(base)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory())return json(res,404,{error:'页面不存在'});const ext=path.extname(fp);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wxml':'application/xml; charset=utf-8','.wxss':'text/css; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'text/plain; charset=utf-8'});res.end(fs.readFileSync(fp));}
const server=http.createServer(async(req,res)=>{if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end();}const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return api(req,res,url);return staticFile(req,res);});
server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error('端口 '+port+' 已被占用。若文享内江已启动，请直接打开网页；否则关闭原来的服务窗口后重试。');
  else console.error('服务启动失败：',error.message);
  process.exitCode=1;
});
server.listen(port,process.env.HOST||'0.0.0.0',()=>{
  console.log('文享内江 2.0：本机 http://localhost:'+port);
  for(const list of Object.values(os.networkInterfaces()))for(const info of list||[])if(info.family==='IPv4'&&!info.internal)console.log('同一Wi-Fi手机访问：http://'+info.address+':'+port);
  console.log('在线演示：https://wenxiang-neijiang.pages.dev');
});
module.exports={server,db};

