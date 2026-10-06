CREATE UNIQUE INDEX IF NOT EXISTS one_session_time ON sessions(course_id,start_at,end_at);
-- All guards run inside the SQLite write statement, including concurrent Worker requests.
CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_entry
ON waitlist(user_id, course_id) WHERE status='waiting';

CREATE TRIGGER IF NOT EXISTS guard_active_enrollment
BEFORE INSERT ON enrollments WHEN NEW.status='active'
BEGIN
  SELECT RAISE(ABORT, 'INVALID_USER') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id);
  SELECT RAISE(ABORT, 'COURSE_CLOSED') WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id=NEW.course_id AND status='published');
  SELECT RAISE(ABORT, 'ALREADY_ENROLLED') WHERE EXISTS (SELECT 1 FROM enrollments WHERE user_id=NEW.user_id AND course_id=NEW.course_id AND status='active');
  SELECT RAISE(ABORT, 'TIME_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM enrollments e
    JOIN sessions mine ON mine.course_id=e.course_id
    JOIN sessions target ON target.course_id=NEW.course_id
    WHERE e.user_id=NEW.user_id AND e.status='active'
      AND datetime(mine.start_at)<datetime(target.end_at)
      AND datetime(mine.end_at)>datetime(target.start_at)
  );
  SELECT RAISE(ABORT, 'COURSE_FULL') WHERE
    (SELECT COUNT(*) FROM enrollments WHERE course_id=NEW.course_id AND status='active') >=
    (SELECT capacity FROM courses WHERE id=NEW.course_id);
END;

CREATE TRIGGER IF NOT EXISTS guard_waiting_entry
BEFORE INSERT ON waitlist WHEN NEW.status='waiting'
BEGIN
  SELECT RAISE(ABORT, 'INVALID_USER') WHERE NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id);
  SELECT RAISE(ABORT, 'COURSE_CLOSED') WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id=NEW.course_id AND status='published');
  SELECT RAISE(ABORT, 'ALREADY_ENROLLED') WHERE EXISTS (SELECT 1 FROM enrollments WHERE user_id=NEW.user_id AND course_id=NEW.course_id AND status='active');
  SELECT RAISE(ABORT, 'ALREADY_WAITING') WHERE EXISTS (SELECT 1 FROM waitlist WHERE user_id=NEW.user_id AND course_id=NEW.course_id AND status='waiting');
  SELECT RAISE(ABORT, 'TIME_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM enrollments e
    JOIN sessions mine ON mine.course_id=e.course_id
    JOIN sessions target ON target.course_id=NEW.course_id
    WHERE e.user_id=NEW.user_id AND e.status='active'
      AND datetime(mine.start_at)<datetime(target.end_at)
      AND datetime(mine.end_at)>datetime(target.start_at)
  );
END;

CREATE TRIGGER IF NOT EXISTS promote_on_cancellation
AFTER UPDATE OF status ON enrollments
WHEN OLD.status='active' AND NEW.status='cancelled'
BEGIN
  INSERT INTO enrollments(user_id,course_id,status)
  SELECT w.user_id,w.course_id,'active' FROM waitlist w
  JOIN courses c ON c.id=w.course_id
  WHERE w.course_id=NEW.course_id AND w.status='waiting' AND c.status='published'
    AND (SELECT COUNT(*) FROM enrollments WHERE course_id=w.course_id AND status='active')<c.capacity
    AND NOT EXISTS (SELECT 1 FROM enrollments WHERE user_id=w.user_id AND course_id=w.course_id AND status='active')
    AND NOT EXISTS (
      SELECT 1 FROM enrollments e JOIN sessions mine ON mine.course_id=e.course_id
      JOIN sessions target ON target.course_id=w.course_id
      WHERE e.user_id=w.user_id AND e.status='active'
        AND datetime(mine.start_at)<datetime(target.end_at)
        AND datetime(mine.end_at)>datetime(target.start_at)
    )
  ORDER BY w.position,w.id LIMIT 1;
  UPDATE waitlist SET status='promoted'
  WHERE course_id=NEW.course_id AND status='waiting' AND EXISTS (
    SELECT 1 FROM enrollments e WHERE e.user_id=waitlist.user_id AND e.course_id=waitlist.course_id AND e.status='active'
  );
END;

-- A cancellation can happen between a full-course error and joining its queue.
-- Fill the resulting vacancy atomically rather than leaving an empty seat.
CREATE TRIGGER IF NOT EXISTS promote_on_waiting_insert
AFTER INSERT ON waitlist WHEN NEW.status='waiting'
BEGIN
  INSERT INTO enrollments(user_id,course_id,status)
  SELECT w.user_id,w.course_id,'active' FROM waitlist w JOIN courses c ON c.id=w.course_id
  WHERE w.course_id=NEW.course_id AND w.status='waiting' AND c.status='published'
    AND (SELECT COUNT(*) FROM enrollments WHERE course_id=w.course_id AND status='active')<c.capacity
    AND NOT EXISTS (SELECT 1 FROM enrollments WHERE user_id=w.user_id AND course_id=w.course_id AND status='active')
    AND NOT EXISTS (
      SELECT 1 FROM enrollments e JOIN sessions mine ON mine.course_id=e.course_id
      JOIN sessions target ON target.course_id=w.course_id
      WHERE e.user_id=w.user_id AND e.status='active'
        AND datetime(mine.start_at)<datetime(target.end_at)
        AND datetime(mine.end_at)>datetime(target.start_at)
    )
  ORDER BY w.position,w.id LIMIT 1;
  UPDATE waitlist SET status='promoted'
  WHERE course_id=NEW.course_id AND status='waiting' AND EXISTS (
    SELECT 1 FROM enrollments e WHERE e.user_id=waitlist.user_id AND e.course_id=waitlist.course_id AND e.status='active'
  );
END;
