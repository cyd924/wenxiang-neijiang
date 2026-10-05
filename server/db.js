const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'wenban.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, font_scale TEXT DEFAULT 'normal', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
  teacher TEXT NOT NULL, location TEXT NOT NULL, level TEXT NOT NULL, audience TEXT NOT NULL, fee INTEGER DEFAULT 0,
  capacity INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'published', open_at TEXT NOT NULL, close_at TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '', cover TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, version INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id),
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, cancelled_at TEXT,
  UNIQUE(user_id, course_id, status)
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id),
  position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, object_type TEXT, object_id INTEGER, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
  if (count) return;
  const users = db.prepare('INSERT OR IGNORE INTO users(id,name,phone) VALUES(?,?,?)');
  users.run(1, '张阿姨', '13800000001'); users.run(2, '李叔叔', '13800000002'); users.run(3, '演示用户', '13800000003');
  const add = db.prepare(`INSERT INTO courses(title,category,description,teacher,location,level,audience,fee,capacity,status,open_at,close_at,tags,cover) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date();
  const day = (n, hour) => { const d=new Date(now); d.setDate(d.getDate()+n); d.setHours(hour,0,0,0); return d.toISOString(); };
  const rows = [
    ['书法入门','传统艺术','学习坐姿、握笔和楷书基本笔画，适合第一次接触书法的学员。','王老师','文化馆二楼书画室','初级','初学者和银龄学员',0,12,'published',day(-1,8),day(20,18),'书法,安静,传统文化'],
    ['合唱基础','音乐','从呼吸、发声和简单合唱曲目开始，课堂氛围轻松。','陈老师','文化馆一楼音乐厅','初级','喜欢唱歌的居民',0,20,'published',day(-1,8),day(15,18),'合唱,音乐,社交'],
    ['川剧脸谱欣赏','地方文化','认识川剧脸谱颜色和人物故事，包含内江地方戏曲文化介绍。','刘老师','文化馆三楼讲堂','初级','传统文化爱好者',0,30,'published',day(-1,8),day(12,18),'川剧,非遗,讲座'],
    ['剪纸体验','传统艺术','完成一幅简单窗花作品，材料由课堂提供。','赵老师','文化馆二楼手工室','初级','亲子和老年人',10,10,'published',day(-1,8),day(10,18),'剪纸,手工,非遗'],
    ['太极拳舒展','健康文化','练习基础站姿、呼吸和舒展动作，强度较低。','周老师','文化馆广场','初级','需要轻运动的居民',0,18,'published',day(-1,8),day(18,18),'太极,舒展,低强度'],
    ['国画花鸟','传统艺术','认识毛笔和墨色变化，练习简单花鸟构图。','何老师','文化馆二楼国画室','初级','国画初学者',20,8,'published',day(-1,8),day(14,18),'国画,安静,绘画'],
    ['古琴文化入门','传统音乐','了解古琴历史、基本指法和经典曲目欣赏。','郭老师','文化馆三楼琴室','初级','传统音乐爱好者',30,8,'published',day(-1,8),day(16,18),'古琴,音乐,传统文化'],
    ['普通话朗诵','语言艺术','练习气息、停连和短篇作品朗读，适合想提高表达的居民。','孙老师','文化馆一楼排练厅','初级','希望练习表达的居民',0,15,'published',day(-1,8),day(13,18),'朗诵,表达,轻松'],
    ['地方民歌欣赏','地方文化','认识内江及四川民歌，学习一段简单旋律。','陈老师','文化馆一楼音乐厅','初级','音乐爱好者',0,16,'published',day(-1,8),day(11,18),'民歌,内江,音乐'],
    ['摄影与生活','数字文化','用手机拍好身边的文化和生活，学习构图与光线。','吴老师','文化馆二楼多功能室','初级','手机摄影初学者',0,14,'published',day(-1,8),day(17,18),'摄影,手机,生活'],
    ['篆刻体验','传统艺术','认识印章和篆刻工具，完成一枚安全体验章。','罗老师','文化馆二楼书画室','初级','传统艺术爱好者',20,6,'published',day(-1,8),day(19,18),'篆刻,书法,手工'],
    ['亲子绘本讲读','文化教育','通过绘本故事认识传统节日和地方文化。','杨老师','文化馆少儿阅览室','初级','家庭用户',0,10,'published',day(-1,8),day(9,18),'绘本,亲子,节日']
  ];
  for (const r of rows) { const result=add.run(...r); const courseId=Number(result.lastInsertRowid); const n = courseId % 3 === 0 ? 2 : 1; for(let i=0;i<n;i++){ db.prepare('INSERT INTO sessions(course_id,start_at,end_at) VALUES(?,?,?)').run(courseId, day(2+courseId+i*7, 9+(courseId%3)*3), day(2+courseId+i*7, 11+(courseId%3)*3)); } }
}
seed();

function all(sql, params=[]) { return db.prepare(sql).all(...params); }
function get(sql, params=[]) { return db.prepare(sql).get(...params); }
function run(sql, params=[]) { return db.prepare(sql).run(...params); }
module.exports = { db, all, get, run };
