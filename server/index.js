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

const port = Number(process.env.PORT || 3000);
const webRoot = path.join(__dirname, '..', 'web');
const miniRoot = path.join(__dirname, '..', 'miniprogram');

function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolve,reject)=>{ let s=''; req.on('data',c=>s+=c); req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}}); req.on('error',reject); }); }
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

function tokenize(s){ return String(s||'').toLowerCase().replace(/[，。！？、]/g,' ').split(/\s+/).filter(Boolean); }
function ruleIntent(text){
  const t=String(text||''); const cats={书法:'书法',毛笔:'书法',合唱:'合唱',唱歌:'音乐',音乐:'音乐',川剧:'川剧',脸谱:'川剧',剪纸:'剪纸',手工:'剪纸',太极:'太极',国画:'国画',绘画:'国画',古琴:'古琴',朗诵:'朗诵',民歌:'民歌',摄影:'摄影',篆刻:'篆刻',绘本:'绘本'};
  let interest=''; for(const [k,v] of Object.entries(cats)) if(t.includes(k)){interest=v;break;}
  let level=t.includes('进阶')||t.includes('提高')?'进阶':'初级'; let time=''; if(t.includes('周末')||t.includes('周六')||t.includes('周日'))time='周末'; else if(t.includes('上午'))time='上午'; else if(t.includes('下午'))time='下午';
  return {interest, level, time, location:t.includes('市区')?'市区':'', lowIntensity:t.includes('轻松')||t.includes('低强度')||t.includes('安静')};
}
function score(c,intent){ let s=0; const text=(c.title+' '+c.category+' '+c.tags+' '+c.description).toLowerCase(); if(intent.interest && text.includes(intent.interest))s+=30; if(intent.level && c.level===intent.level)s+=20; if(intent.lowIntensity && /太极|书法|国画|古琴|讲座/.test(text))s+=15; if(intent.time){const hours=c.sessions.map(x=>new Date(x.start_at).getHours());if(intent.time==='上午'&&hours.some(h=>h<12))s+=25;if(intent.time==='下午'&&hours.some(h=>h>=12))s+=25;if(intent.time==='周末'&&c.sessions.some(x=>[0,6].includes(new Date(x.start_at).getDay())))s+=25;} s+=Math.min(10,Math.max(0,c.capacity-(c.active_count||0))); return s; }
function recommendationReason(c,intent){ const r=[]; if(intent.interest && (c.title+c.tags).includes(intent.interest))r.push('和你想学的内容接近'); if(intent.level===c.level)r.push('适合初学者'); if(intent.lowIntensity)r.push('课程节奏较舒缓'); if(intent.time)r.push('时间要求比较匹配'); return r.join('，')||'目前仍有名额，适合作为入门选择'; }
async function modelIntent(text) {
  if (!process.env.AI_BASE_URL || !process.env.AI_MODEL || !process.env.AI_API_KEY) return null;
  const response = await fetch(`${process.env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.AI_API_KEY}`},body:JSON.stringify({model:process.env.AI_MODEL,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:'你是文化馆课程筛选助手。只输出 JSON，字段为 interest, level, time, location, lowIntensity。不要编造课程。level 只能是初级或进阶，time 只能是周末、上午、下午或空字符串，lowIntensity 是布尔值。'},{role:'user',content:String(text||'')} ]})});
  if(!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
  const payload=await response.json(); const parsed=JSON.parse(payload.choices?.[0]?.message?.content||'{}');
  const allowed=['书法','合唱','音乐','川剧','剪纸','太极','国画','古琴','朗诵','民歌','摄影','篆刻','绘本'];
  return {interest:allowed.includes(parsed.interest)?parsed.interest:'',level:['初级','进阶'].includes(parsed.level)?parsed.level:'初级',time:['周末','上午','下午'].includes(parsed.time)?parsed.time:'',location:typeof parsed.location==='string'?parsed.location:'',lowIntensity:parsed.lowIntensity===true};
}

async function aiSearch(text,userId){
  let intent=ruleIntent(text); let mode='规则模式'; let modelNotice='未配置模型，当前使用可解释的规则推荐；配置模型后可增加自然语言理解。';
  if(process.env.AI_BASE_URL&&process.env.AI_MODEL&&process.env.AI_API_KEY){try{intent=await modelIntent(text);mode='AI+规则';modelNotice='已使用配置的兼容模型提取需求，课程过滤和排序仍由本地规则完成。'}catch(error){modelNotice=`模型调用失败，已回退到规则模式：${error.message}`;}}
  const courses=all("SELECT * FROM courses WHERE status='published' AND datetime(close_at)>datetime('now')").map(c=>courseRow(c,userId));
  const filtered=courses.filter(c=>!intent.interest || (c.title+' '+c.category+' '+c.tags+' '+c.description).includes(intent.interest));
  const pool=(filtered.length?filtered:courses).filter(c=>!conflict(userId,c.id));
  const results=pool.sort((a,b)=>score(b,intent)-score(a,intent)).slice(0,3).map(c=>({...c,score:score(c,intent),reason:recommendationReason(c,intent)}));
  return {mode,intent,results,notice:modelNotice};
}

async function api(req,res,url){
  const method=req.method; const pathname=url.pathname; const q=Object.fromEntries(url.searchParams.entries());
  try {
    if(method==='GET'&&pathname==='/api/health')return json(res,200,{ok:true,mode:process.env.AI_BASE_URL?'ai+规则':'规则模式'});
    if(method==='GET'&&pathname==='/api/users')return json(res,200,{users:all('SELECT id,name,phone,font_scale FROM users')});
    if(method==='GET'&&pathname==='/api/courses'){
      const uid=Number(q.userId||1); let rows=all("SELECT * FROM courses WHERE status='published' ORDER BY id").map(c=>courseRow(c,uid));
      if(q.category)rows=rows.filter(x=>x.category===q.category); if(q.level)rows=rows.filter(x=>x.level===q.level); if(q.keyword){const k=q.keyword.toLowerCase();rows=rows.filter(x=>(x.title+x.description+x.tags).toLowerCase().includes(k));} return json(res,200,{courses:rows});
    }
    const cm=pathname.match(/^\/api\/courses\/(\d+)$/); if(method==='GET'&&cm){const c=get('SELECT * FROM courses WHERE id=?',[Number(cm[1])]);if(!c)return json(res,404,{error:'课程不存在'});return json(res,200,{course:courseRow(c,Number(q.userId||1))});}
    if(method==='POST'&&pathname==='/api/ai/search'){const b=await body(req);return json(res,200,await aiSearch(b.text||'',Number(b.userId||1)));}
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
server.listen(port,()=>console.log(`文享内江原型运行：http://localhost:${port}`));
module.exports={server,db};

