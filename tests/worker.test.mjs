import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker.js';

// Use real SQLite in memory: the SQL triggers and constraints are executed, not mocked.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of ['0001_init.sql','0002_booking_guards.sql']) {
  db.exec(readFileSync(new URL('../cloudflare/migrations/'+file, import.meta.url),'utf8'));
}
class Statement {
  constructor(sql, params=[]) { this.sql=sql; this.params=params; }
  bind(...params) { return new Statement(this.sql,params); }
  execute() {
    const result=db.prepare(this.sql).run(...this.params);
    return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
  }
  async run() { return this.execute(); }
  async first() { return db.prepare(this.sql).get(...this.params) || null; }
  async all() { return {success:true,results:db.prepare(this.sql).all(...this.params)}; }
}
const env={DB:{prepare(sql){return new Statement(sql)},async batch(statements){
  db.exec('BEGIN IMMEDIATE');
  try { const results=statements.map(s=>s.execute()); db.exec('COMMIT'); return results; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}}};
async function call(path,method='GET',data,bindings=env){
  const response=await worker.fetch(new Request('https://example.test'+path,{method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})}),bindings);
  return {status:response.status,data:await response.json()};
}
async function course(title,capacity=1,start='2026-12-01T01:00:00Z') {
  const response=await call('/api/admin/courses','POST',{title,capacity,category:'传统艺术',description:'测试数据',teacher:'演示教师',location:'测试教室',level:'初级',audience:'居民',fee:10,openAt:'2026-10-01T00:00:00Z',closeAt:'2026-11-30T00:00:00Z',startAt:start,endAt:new Date(new Date(start).getTime()+7200000).toISOString()});
  assert.equal(response.status,201); return response.data.id;
}

test('Worker exposes 12 demo courses and rule mode',async()=>{
  assert.equal((await call('/api/courses')).data.courses.length,12);
  assert.equal((await call('/api/health')).data.mode,'规则模式');
  const search=await call('/api/ai/search','POST',{text:'想学书法',userId:3});
  assert.equal(search.status,200);assert.equal(search.data.mode,'规则模式');assert.ok(search.data.results.length);
});
test('concurrent last seat has one enrollment; duplicate waiting and promotion are correct',async()=>{
  const id=await course('并发测试');
  const results=await Promise.all([1,2].map(userId=>call('/api/enrollments','POST',{userId,courseId:id})));
  assert.deepEqual(results.map(r=>r.data.status).sort(),['active','waiting']);
  const winner=results.findIndex(r=>r.data.status==='active'),loser=1-winner;
  assert.equal((await call('/api/enrollments','POST',{userId:loser+1,courseId:id})).status,409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM waitlist WHERE course_id=? AND status='waiting'").get(id).n,1);
  const enrolled=results[winner].data.id;
  assert.equal((await call('/api/enrollments','POST',{userId:winner+1,courseId:id})).status,409);
  assert.equal((await call('/api/enrollments/'+enrolled+'?userId='+(loser+1),'DELETE')).status,403);
  assert.equal((await call('/api/enrollments/'+enrolled+'?userId='+(winner+1),'DELETE')).status,200);
  const promoted=(await call('/api/me/schedule?userId='+(loser+1))).data.courses.find(c=>c.id===id);
  assert.ok(promoted);
  assert.equal((await call('/api/enrollments/'+promoted.enrollment_id+'?userId='+(loser+1),'DELETE')).status,200);
  for(let round=0;round<2;round++){
    const again=await call('/api/enrollments','POST',{userId:1,courseId:id});assert.equal(again.status,201);
    assert.equal((await call('/api/enrollments/'+again.data.id+'?userId=1','DELETE')).status,200);
  }
});
test('all sessions are checked and simultaneous conflicting bookings cannot both succeed',async()=>{
  const id=await course('多次上课',5,'2026-12-03T01:00:00Z');
  db.prepare('INSERT INTO sessions(course_id,start_at,end_at) VALUES(?,?,?)').run(id,'2026-12-04T01:00:00Z','2026-12-04T03:00:00Z');
  const other=await course('第二次时间冲突',5,'2026-12-04T02:00:00Z');
  const responses=await Promise.all([id,other].map(courseId=>call('/api/enrollments','POST',{courseId,userId:3})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  for(const r of responses)if(r.status===201)await call('/api/enrollments/'+r.data.id+'?userId=3','DELETE');
});
test('promotion skips a waiting user who subsequently enrolled in a conflicting class',async()=>{
  const id=await course('跳过冲突候补',1,'2026-12-05T01:00:00Z');
  const clash=await course('后来报名的冲突班',5,'2026-12-05T02:00:00Z');
  const first=await call('/api/enrollments','POST',{userId:1,courseId:id});
  assert.equal((await call('/api/enrollments','POST',{userId:2,courseId:id})).data.status,'waiting');
  const occupied=await call('/api/enrollments','POST',{userId:2,courseId:clash});assert.equal(occupied.status,201);
  assert.equal((await call('/api/enrollments','POST',{userId:3,courseId:id})).data.status,'waiting');
  await call('/api/enrollments/'+first.data.id+'?userId=1','DELETE');
  const promoted=(await call('/api/me/schedule?userId=3')).data.courses.find(c=>c.id===id);assert.ok(promoted);
  assert.equal(db.prepare("SELECT status FROM waitlist WHERE course_id=? AND user_id=2").get(id).status,'waiting');
  await call('/api/enrollments/'+occupied.data.id+'?userId=2','DELETE');
  await call('/api/enrollments/'+promoted.enrollment_id+'?userId=3','DELETE');
});
test('invalid IDs, course status and import fee are handled',async()=>{
  assert.equal((await call('/api/enrollments','POST',{userId:'bad',courseId:1})).status,400);
  assert.equal((await call('/api/enrollments','POST',{userId:12345,courseId:1})).status,400);
  const id=await course('状态测试',2,'2026-12-06T01:00:00Z');
  assert.equal((await call('/api/admin/courses/'+id,'PATCH',{status:'closed'})).status,200);
  assert.equal((await call('/api/enrollments','POST',{userId:1,courseId:id})).status,400);
  assert.equal((await call('/api/admin/courses/'+id,'PATCH',{status:'published'})).status,200);
  const r=await call('/api/admin/courses/import','POST',{courses:[{title:'费用导入',category:'传统艺术',teacher:'演示教师',description:'CSV测试',location:'教室',level:'初级',audience:'居民',capacity:2,fee:20,startAt:'2026-12-07T01:00:00Z',endAt:'2026-12-07T03:00:00Z'}]});
  assert.equal(r.data.created,1);assert.equal(db.prepare("SELECT fee FROM courses WHERE title='费用导入'").get().fee,20);
});
test('model network error and invalid output fall back without exposing a secret',async()=>{
  const original=globalThis.fetch;
  const configured={...env,AI_BASE_URL:'https://model.test/v1',AI_MODEL:'demo',AI_API_KEY:'test-key-not-real'};
  try{
    globalThis.fetch=async(_url,options)=>{assert.ok(options.signal);throw new Error('timeout')};
    let r=await call('/api/ai/search','POST',{text:'书法'},configured);assert.equal(r.status,200);assert.equal(r.data.mode,'规则模式');
    globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"invented":"course"}'}}]}),{headers:{'content-type':'application/json'}});
    r=await call('/api/ai/search','POST',{text:'书法'},configured);assert.equal(r.data.mode,'规则模式');
    assert.equal(JSON.stringify(r.data).includes('test-key-not-real'),false);
  }finally{globalThis.fetch=original}
});
test.after(()=>db.close());
