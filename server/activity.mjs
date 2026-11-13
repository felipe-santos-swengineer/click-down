export function activityService(db, { run, one, all, now, fail }) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_events (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,kind TEXT NOT NULL,task_id TEXT,task_title TEXT,payload TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS project_events_project ON project_events(project_id,id);
 CREATE TABLE IF NOT EXISTS project_versions (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 1);
 INSERT OR IGNORE INTO project_versions SELECT id,1 FROM projects;`);
  if (
    !all("PRAGMA table_info(notifications)").some(
      (c) => c.name === "project_event_id",
    )
  ) {
    db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE notifications_next (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,kind TEXT NOT NULL,actor_name TEXT,due_date TEXT,dedupe_key TEXT UNIQUE NOT NULL,created TEXT NOT NULL,read_at TEXT,subtask_id TEXT REFERENCES subtasks(id) ON DELETE CASCADE,project_event_id INTEGER REFERENCES project_events(id) ON DELETE CASCADE);
   INSERT INTO notifications_next (id,user_id,task_id,kind,actor_name,due_date,dedupe_key,created,read_at,subtask_id) SELECT id,user_id,task_id,kind,actor_name,due_date,dedupe_key,created,read_at,subtask_id FROM notifications;
   DROP TABLE notifications; ALTER TABLE notifications_next RENAME TO notifications;
   CREATE INDEX notification_user ON notifications(user_id,id); COMMIT;`);
  }
  if (
    !all("PRAGMA table_info(project_events)").some(
      (c) => c.name === "source_history_id",
    )
  )
    db.exec("ALTER TABLE project_events ADD COLUMN source_history_id INTEGER");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS project_events_source_history ON project_events(source_history_id)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const h of all(
      `SELECT h.*,t.project,t.title AS task_title FROM history h JOIN tasks t ON t.id=h.task_id WHERE NOT EXISTS(SELECT 1 FROM project_events e WHERE e.source_history_id=h.id) ORDER BY h.id`,
    )) {
      const existing = one(
        `SELECT id FROM project_events WHERE source_history_id IS NULL AND task_id=? AND kind=? AND user_id=? AND payload=? AND ABS(julianday(created)-julianday(?))<0.000012 ORDER BY id LIMIT 1`,
        h.task_id,
        h.kind,
        h.user_id,
        h.payload,
        h.created,
      );
      if (existing)
        run(
          "UPDATE project_events SET source_history_id=? WHERE id=?",
          h.id,
          existing.id,
        );
      else
        run(
          "INSERT INTO project_events (project_id,user_id,actor_name,kind,task_id,task_title,payload,created,source_history_id) VALUES (?,?,?,?,?,?,?,?,?)",
          h.project,
          h.user_id,
          h.actor_name,
          h.kind,
          h.task_id,
          h.task_title,
          h.payload,
          h.created,
          h.id,
        );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  function revision(project) {
    run("INSERT OR IGNORE INTO project_versions VALUES (?,1)", project);
    return Number(
      one("SELECT revision FROM project_versions WHERE project_id=?", project)
        .revision,
    );
  }
  function record(
    project,
    user,
    kind,
    payload = {},
    task = null,
    sourceHistoryId = null,
  ) {
    const stamp = now();
    const inserted = run(
      "INSERT INTO project_events (project_id,user_id,actor_name,kind,task_id,task_title,payload,created,source_history_id) VALUES (?,?,?,?,?,?,?,?,?)",
      project,
      user.id,
      user.name,
      kind,
      task?.id || null,
      task?.title || null,
      JSON.stringify(payload),
      stamp,
      sourceHistoryId,
    );
    const id = Number(inserted.lastInsertRowid);
    const reorderOnly =
      kind === "task_updated" &&
      Array.isArray(payload.changes) &&
      payload.changes.length > 0 &&
      payload.changes.every((change) => change.field === "position");
    if (reorderOnly) return id;
    for (const m of all(
      "SELECT user_id FROM members WHERE project_id=? AND user_id<>?",
      project,
      user.id,
    ))
      run(
        "INSERT INTO notifications (user_id,task_id,kind,actor_name,dedupe_key,created,project_event_id) VALUES (?,?,'activity',?,?,?,?)",
        m.user_id,
        task?.id || null,
        user.name,
        `activity:${id}:${m.user_id}`,
        stamp,
        id,
      );
    return id;
  }
  function install(app, auth) {
    app.get("/api/activity", auth, (req, res) => {
      const clauses = ["m.user_id=?"],
        args = [req.user.id];
      if (req.query.project && req.query.project !== "all") {
        clauses.push("e.project_id=?");
        args.push(String(req.query.project));
      }
      if (req.query.before) {
        const before = Number(req.query.before);
        if (!Number.isSafeInteger(before) || before < 1)
          fail(400, "Cursor de atividades inválido.");
        clauses.push("e.id<?");
        args.push(before);
      }
      if (req.query.search) {
        const q = String(req.query.search).trim().slice(0, 160);
        clauses.push(
          "(e.actor_name LIKE ? OR e.task_title LIKE ? OR p.name LIKE ? OR e.payload LIKE ?)",
        );
        args.push(...Array(4).fill("%" + q + "%"));
      }
      const rows = all(
        `SELECT e.*,p.name AS project_name,EXISTS(SELECT 1 FROM tasks t WHERE t.id=e.task_id AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)) AS task_available FROM project_events e JOIN projects p ON p.id=e.project_id JOIN members m ON m.project_id=e.project_id WHERE ${clauses.join(" AND ")} ORDER BY e.id DESC LIMIT 51`,
        ...args,
      );
      res.json({
        items: rows.slice(0, 50).map((e) => ({
          ...e,
          payload: JSON.parse(e.payload),
          task_available: !!e.task_available,
        })),
        has_more: rows.length > 50,
      });
    });
  }
  return { record, revision, install };
}
