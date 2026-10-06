export function bookingError(error) {
  const message = String(error?.message || error);
  const known = {
    INVALID_USER: [400, '请使用有效的演示账户'],
    COURSE_CLOSED: [400, '课程暂未开放报名'],
    ALREADY_ENROLLED: [409, '你已经报名过这门课'],
    ALREADY_WAITING: [409, '你已经在这门课的候补名单中'],
    TIME_CONFLICT: [409, '和你已报名的课程时间冲突'],
  };
  for (const [code, response] of Object.entries(known)) if (message.includes(code)) return response;
  if (message.includes('UNIQUE constraint failed: enrollments')) return known.ALREADY_ENROLLED;
  if (message.includes('UNIQUE constraint failed: waitlist')) return known.ALREADY_WAITING;
  return null;
}

// The migration's triggers enforce capacity, uniqueness and conflicts inside each write.
// Application-level reads alone cannot enforce these rules across simultaneous requests.
export async function enroll(env, data) {
  const uid = Number(data.userId ?? 1), cid = Number(data.courseId);
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(cid) || cid <= 0) {
    return { code: 400, data: { error: '用户和课程编号必须是正整数' } };
  }
  const course = await env.DB.prepare('SELECT id FROM courses WHERE id=?').bind(cid).first();
  if (!course) return { code: 404, data: { error: '课程不存在' } };
  try {
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO enrollments(user_id,course_id,status) VALUES(?,?,'active')").bind(uid,cid),
      env.DB.prepare("INSERT INTO audit_logs(actor,action,object_type,object_id,detail) VALUES(?,'报名','course',?,'')").bind(String(uid),cid),
    ]);
    return { code: 201, data: { status: 'active', id: results[0].meta.last_row_id, message: '报名成功' } };
  } catch (error) {
    if (!String(error.message).includes('COURSE_FULL')) throw error;
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO waitlist(user_id,course_id,position)
      SELECT ?,?,COALESCE(MAX(position),0)+1 FROM waitlist WHERE course_id=?`).bind(uid,cid,cid),
    env.DB.prepare("INSERT INTO audit_logs(actor,action,object_type,object_id,detail) VALUES(?,'加入候补','course',?,'')").bind(String(uid),cid),
  ]);
  const entry = await env.DB.prepare("SELECT id,position,status FROM waitlist WHERE user_id=? AND course_id=? ORDER BY id DESC LIMIT 1").bind(uid,cid).first();
  if (entry.status === 'promoted') {
    const active = await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status='active'").bind(uid,cid).first();
    return { code: 201, data: { status: 'active', id: active.id, message: '已递补成功' } };
  }
  const queue = await env.DB.prepare("SELECT COUNT(*) position FROM waitlist WHERE course_id=? AND status='waiting' AND (position<? OR (position=? AND id<=?))").bind(cid,entry.position,entry.position,entry.id).first();
  return { code: 200, data: { status: 'waiting', position: queue.position, message: `名额已满，已加入第 ${queue.position} 位候补` } };
}

export async function cancel(env, id, uid) {
  const entry = await env.DB.prepare("SELECT * FROM enrollments WHERE id=? AND status='active'").bind(id).first();
  if (!entry) return { code: 404, data: { error: '报名记录不存在' } };
  if (!uid || entry.user_id !== uid) return { code: 403, data: { error: '只能取消自己的报名' } };
  const result = await env.DB.prepare("UPDATE enrollments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='active'").bind(id,uid).run();
  if (!result.meta.changes) return { code: 404, data: { error: '报名记录已取消' } };
  return { code: 200, data: { message: '已取消报名' } };
}
