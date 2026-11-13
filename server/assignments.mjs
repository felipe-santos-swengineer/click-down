export function assignmentService(db, { run, one, all, fail }) {
  db.exec(`CREATE TABLE IF NOT EXISTS task_assignees (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),position INTEGER NOT NULL,PRIMARY KEY(task_id,user_id));
 CREATE TABLE IF NOT EXISTS subtask_assignees (subtask_id TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),position INTEGER NOT NULL,PRIMARY KEY(subtask_id,user_id));
 CREATE INDEX IF NOT EXISTS task_assignees_user ON task_assignees(user_id);
 CREATE INDEX IF NOT EXISTS subtask_assignees_user ON subtask_assignees(user_id);
 INSERT OR IGNORE INTO task_assignees SELECT id,assignee,0 FROM tasks WHERE assignee IS NOT NULL;
 INSERT OR IGNORE INTO subtask_assignees SELECT id,assignee,0 FROM subtasks WHERE assignee IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS task_default_assignee AFTER INSERT ON tasks WHEN NEW.assignee IS NOT NULL BEGIN INSERT OR IGNORE INTO task_assignees VALUES (NEW.id,NEW.assignee,0); END;
 CREATE TRIGGER IF NOT EXISTS subtask_default_assignee AFTER INSERT ON subtasks WHEN NEW.assignee IS NOT NULL BEGIN INSERT OR IGNORE INTO subtask_assignees VALUES (NEW.id,NEW.assignee,0); END;`);
  const table = (sub) => (sub ? "subtask_assignees" : "task_assignees");
  const key = (sub) => (sub ? "subtask_id" : "task_id");
  function ids(id, sub = false) {
    return all(
      `SELECT user_id FROM ${table(sub)} WHERE ${key(sub)}=? ORDER BY position,user_id`,
      id,
    ).map((row) => row.user_id);
  }
  function decorate(row, sub = false) {
    return row ? { ...row, assignees: ids(row.id, sub) } : row;
  }
  function validate(body, project) {
    const raw =
      body.assignees === undefined
        ? body.assignee
          ? [body.assignee]
          : []
        : body.assignees;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string"))
      fail(400, "Selecione os responsáveis entre os membros do projeto.");
    const selected = [...new Set(raw)].sort();
    const allowed = new Set(
      all("SELECT user_id FROM members WHERE project_id=?", project).map(
        (m) => m.user_id,
      ),
    );
    if (selected.some((id) => !allowed.has(id)))
      fail(400, "Todos os responsáveis devem participar do projeto.");
    return selected;
  }
  function replace(id, selected, sub = false) {
    run(`DELETE FROM ${table(sub)} WHERE ${key(sub)}=?`, id);
    selected.forEach((user, i) =>
      run(`INSERT INTO ${table(sub)} VALUES (?,?,?)`, id, user, i),
    );
    run(
      `UPDATE ${sub ? "subtasks" : "tasks"} SET assignee=? WHERE id=?`,
      selected[0] || null,
      id,
    );
  }
  function names(selected) {
    return (
      selected
        .map(
          (id) =>
            one("SELECT name FROM users WHERE id=?", id)?.name ||
            "Pessoa removida",
        )
        .join(", ") || "Não atribuído"
    );
  }
  function merge(old, body) {
    const merged = { ...old, ...body };
    if (Object.hasOwn(body, "assignee") && !Object.hasOwn(body, "assignees"))
      delete merged.assignees;
    return merged;
  }
  return { ids, decorate, validate, replace, names, merge };
}
