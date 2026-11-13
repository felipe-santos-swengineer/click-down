import { randomUUID } from "node:crypto";
export const defaults = [
  { id: "todo", name: "A fazer", color: "#9299ad", kind: "todo" },
  { id: "doing", name: "Em andamento", color: "#9a85ef", kind: "doing" },
  { id: "review", name: "Em revisão", color: "#eca951", kind: "review" },
  { id: "done", name: "Concluído", color: "#49ab89", kind: "done" },
];
export function boardService(
  db,
  {
    run,
    one,
    all,
    fail,
    transaction,
    record,
    now,
    assigneeName,
    notify,
    member,
    taskAccess,
    text,
    getAssignments,
    audit,
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS board_settings (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS project_columns (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id TEXT NOT NULL,name TEXT NOT NULL,color TEXT NOT NULL,kind TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(project_id,id));
 CREATE TABLE IF NOT EXISTS subtasks (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,assignee TEXT REFERENCES users(id),date TEXT NOT NULL,position INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL,deleted_at TEXT,deleted_by_name TEXT);
 CREATE INDEX IF NOT EXISTS subtask_parent ON subtasks(task_id);
 CREATE INDEX IF NOT EXISTS subtask_assignee ON subtasks(assignee);
 `);
  if (
    !all("PRAGMA table_info(notifications)").some(
      (c) => c.name === "subtask_id",
    )
  )
    db.exec(
      "ALTER TABLE notifications ADD COLUMN subtask_id TEXT REFERENCES subtasks(id) ON DELETE CASCADE",
    );
  function validateColumns(input) {
    if (!Array.isArray(input) || input.length < 2 || input.length > 12)
      fail(400, "O quadro deve ter entre 2 e 12 colunas.");
    const ids = new Set(),
      names = new Set();
    const result = input.map((c) => {
      if (
        !c ||
        typeof c.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) ||
        ids.has(c.id)
      )
        fail(400, "Identificadores de coluna inválidos ou repetidos.");
      ids.add(c.id);
      const name = text(c.name, "Nome da coluna", 40);
      const key = name.normalize("NFKC").toLocaleLowerCase();
      if (names.has(key)) fail(400, "Use um nome diferente para cada coluna.");
      names.add(key);
      if (
        !defaults.some((d) => d.kind === c.kind) ||
        !/^#[0-9a-f]{6}$/i.test(c.color || "")
      )
        fail(400, "Categoria ou cor de coluna inválida.");
      return { id: c.id, name, color: c.color, kind: c.kind };
    });
    if (
      !result.some((c) => c.kind === "done") ||
      !result.some((c) => c.kind !== "done")
    )
      fail(400, "Mantenha ao menos uma coluna de trabalho e uma de conclusão.");
    return result;
  }
  function ensure(projectId, input) {
    if (one("SELECT 1 FROM board_settings WHERE project_id=?", projectId))
      return;
    const cols = input === undefined ? defaults : validateColumns(input);
    run("INSERT INTO board_settings VALUES (?,1)", projectId);
    cols.forEach((c, i) =>
      run(
        "INSERT INTO project_columns VALUES (?,?,?,?,?,?)",
        projectId,
        c.id,
        c.name,
        c.color,
        c.kind,
        i,
      ),
    );
  }
  transaction(() => {
    for (const p of all("SELECT id FROM projects")) ensure(p.id);
  });
  function columns(project) {
    return all(
      "SELECT id,name,color,kind,position FROM project_columns WHERE project_id=? ORDER BY position",
      project,
    );
  }
  function column(project, id) {
    return one(
      "SELECT * FROM project_columns WHERE project_id=? AND id=?",
      project,
      id,
    );
  }
  function board(project) {
    return {
      revision: one(
        "SELECT revision FROM board_settings WHERE project_id=?",
        project,
      ).revision,
      columns: columns(project).map((c) => ({
        ...c,
        task_count: Number(
          one(
            "SELECT COUNT(*) AS n FROM tasks WHERE project=? AND status=?",
            project,
            c.id,
          ).n,
        ),
        subtask_count: Number(
          one(
            "SELECT COUNT(*) AS n FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE t.project=? AND s.status=?",
            project,
            c.id,
          ).n,
        ),
      })),
    };
  }
  function subFields(body, parent) {
    const title = text(body.title, "Título da subtarefa", 160),
      description = text(body.description || "", "Descrição", 4000, false);
    if (typeof body.status !== "string" || !column(parent.project, body.status))
      fail(400, "Escolha uma coluna deste projeto para a subtarefa.");
    const selected = getAssignments().validate(body, parent.project);
    const assignee = selected[0] || null;
    const date = body.date || "";
    if (
      typeof date !== "string" ||
      (date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
          new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date))
    )
      fail(400, "Prazo da subtarefa inválido.");
    return {
      title,
      description,
      status: body.status,
      assignee,
      assignees: selected,
      date,
    };
  }
  function subtask(req, trashed = false, roles) {
    const s = getAssignments().decorate(
      one("SELECT * FROM subtasks WHERE id=?", req.params.id),
      true,
    );
    if (!s) fail(404, "Subtarefa não encontrada.");
    const parent = taskAccess(req, s.task_id, true);
    if (roles) member(req.user.id, parent.project, roles);
    if (trashed ? !s.deleted_at : !!s.deleted_at)
      fail(
        trashed ? 404 : 410,
        trashed
          ? "Subtarefa não encontrada na lixeira."
          : "Esta subtarefa está na lixeira.",
      );
    return { s, parent };
  }
  function install(app, auth) {
    app.get("/api/projects/:id/columns", auth, (req, res) => {
      member(req.user.id, req.params.id);
      res.json(board(req.params.id));
    });
    app.put("/api/projects/:id/columns", auth, (req, res) => {
      const project = req.params.id;
      member(req.user.id, project, ["owner", "admin"]);
      const prev = board(project);
      if (req.body.revision !== prev.revision)
        fail(
          409,
          "O quadro foi alterado em outro acesso. Reabra a configuração para carregar a versão atual.",
        );
      const next = validateColumns(req.body.columns);
      if (
        JSON.stringify(
          prev.columns.map(({ id, name, color, kind }) => ({
            id,
            name,
            color,
            kind,
          })),
        ) === JSON.stringify(next)
      )
        return res.json(prev);
      const transfers = req.body.transfers || {};
      if (typeof transfers !== "object" || Array.isArray(transfers))
        fail(400, "Destinos de migração inválidos.");
      const removed = prev.columns.filter(
        (c) => !next.some((n) => n.id === c.id),
      );
      if (
        Object.entries(transfers).some(
          ([id, target]) =>
            !removed.some((c) => c.id === id) ||
            typeof target !== "string" ||
            !next.some((c) => c.id === target),
        )
      )
        fail(
          400,
          "Informe destinos somente para colunas removidas, usando etapas que permanecerão no quadro.",
        );
      for (const c of removed)
        if (
          (c.task_count || c.subtask_count) &&
          !next.some((n) => n.id === transfers[c.id])
        )
          fail(
            400,
            `Escolha uma coluna de destino para as atividades de “${c.name}”, incluindo as que estão na lixeira.`,
          );
      transaction(() => {
        const snapshots = prev.columns.map((old) => ({
          old,
          tasks: all(
            "SELECT id FROM tasks WHERE project=? AND status=?",
            project,
            old.id,
          ),
          subtasks: all(
            "SELECT s.* FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE t.project=? AND s.status=?",
            project,
            old.id,
          ),
        }));
        for (const { old, tasks, subtasks } of snapshots) {
          const replacement = next.find(
            (n) =>
              n.id ===
              (Object.hasOwn(transfers, old.id) ? transfers[old.id] : old.id),
          );
          if (!replacement) continue;
          const changed =
            replacement.id !== old.id ||
            replacement.name !== old.name ||
            replacement.kind !== old.kind;
          if (!changed) continue;
          for (const task of tasks) {
            run(
              "UPDATE tasks SET status=?,revision=revision+1,updated=? WHERE id=?",
              replacement.id,
              now(),
              task.id,
            );
            record(task.id, req.user, "column_updated", {
              changes: [
                { field: "column", before: old.name, after: replacement.name },
                {
                  field: "category",
                  before: old.kind,
                  after: replacement.kind,
                },
              ].filter((c) => c.before !== c.after),
            });
          }
          for (const s of subtasks) {
            run(
              "UPDATE subtasks SET status=?,revision=revision+1,updated=? WHERE id=?",
              replacement.id,
              now(),
              s.id,
            );
            record(s.task_id, req.user, "subtask_updated", {
              title: s.title,
              changes: [
                { field: "status", before: old.name, after: replacement.name },
                {
                  field: "category",
                  before: old.kind,
                  after: replacement.kind,
                },
              ].filter((c) => c.before !== c.after),
            });
          }
        }
        audit(project, req.user, "columns_updated", {
          changes: [
            {
              field: "columns",
              before: prev.columns
                .map((c) => c.name + " (" + c.kind + ", " + c.color + ")")
                .join(" → "),
              after: next
                .map((c) => c.name + " (" + c.kind + ", " + c.color + ")")
                .join(" → "),
            },
          ],
        });
        run("DELETE FROM project_columns WHERE project_id=?", project);
        next.forEach((c, i) =>
          run(
            "INSERT INTO project_columns VALUES (?,?,?,?,?,?)",
            project,
            c.id,
            c.name,
            c.color,
            c.kind,
            i,
          ),
        );
        run(
          "UPDATE board_settings SET revision=revision+1 WHERE project_id=?",
          project,
        );
      });
      res.json(board(project));
    });
    app.post("/api/tasks/:id/subtasks", auth, (req, res) => {
      const parent = taskAccess(req, req.params.id, true);
      const f = subFields(req.body, parent);
      if (
        Number(
          one(
            "SELECT COUNT(*) AS n FROM subtasks WHERE task_id=? AND deleted_at IS NULL",
            parent.id,
          ).n,
        ) >= 100
      )
        fail(400, "Limite de 100 subtarefas ativas por tarefa.");
      const id = randomUUID();
      transaction(() => {
        run(
          "INSERT INTO subtasks (id,task_id,title,description,status,assignee,date,position,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
          id,
          parent.id,
          f.title,
          f.description,
          f.status,
          f.assignee,
          f.date,
          Number(
            one(
              "SELECT COALESCE(MAX(position),0)+1 AS n FROM subtasks WHERE task_id=?",
              parent.id,
            ).n,
          ),
          now(),
          now(),
        );
        getAssignments().replace(id, f.assignees, true);
        record(parent.id, req.user, "subtask_created", {
          title: f.title,
          changes: [
            {
              field: "assignees",
              before: "Não atribuído",
              after: getAssignments().names(f.assignees),
            },
          ],
        });
        for (const person of f.assignees)
          notify(
            person,
            parent.id,
            "assignment",
            req.user,
            `subtask-assignment:${id}:1:${person}`,
            null,
            id,
          );
      });
      res
        .status(201)
        .json(
          getAssignments().decorate(
            one("SELECT * FROM subtasks WHERE id=?", id),
            true,
          ),
        );
    });
    app.patch("/api/subtasks/:id", auth, (req, res) => {
      const { s, parent } = subtask(req);
      if (req.body.revision !== s.revision)
        fail(
          409,
          "Esta subtarefa foi alterada por outra pessoa. Confira a versão atual antes de tentar novamente.",
        );
      if (req.body.task_id && req.body.task_id !== s.task_id)
        fail(400, "A subtarefa deve permanecer na tarefa original.");
      const f = subFields(getAssignments().merge(s, req.body), parent);
      const changes = Object.keys(f)
        .filter((k) => k !== "assignee" && k !== "assignees" && f[k] !== s[k])
        .map((field) => ({
          field,
          before:
            field === "assignee"
              ? assigneeName(s[field])
              : field === "status"
                ? column(parent.project, s.status).name
                : s[field],
          after:
            field === "assignee"
              ? assigneeName(f[field])
              : field === "status"
                ? column(parent.project, f.status).name
                : f[field],
        }));
      if (JSON.stringify(s.assignees) !== JSON.stringify(f.assignees))
        changes.push({
          field: "assignees",
          before: getAssignments().names(s.assignees),
          after: getAssignments().names(f.assignees),
        });
      if (!changes.length) return res.json(s);
      transaction(() => {
        run(
          "UPDATE subtasks SET title=?,description=?,status=?,assignee=?,date=?,revision=revision+1,updated=? WHERE id=?",
          f.title,
          f.description,
          f.status,
          f.assignee,
          f.date,
          now(),
          s.id,
        );
        getAssignments().replace(s.id, f.assignees, true);
        record(parent.id, req.user, "subtask_updated", {
          title: f.title,
          changes,
        });
        for (const person of f.assignees.filter(
          (id) => !s.assignees.includes(id),
        ))
          notify(
            person,
            parent.id,
            "assignment",
            req.user,
            `subtask-assignment:${s.id}:${s.revision + 1}:${person}`,
            null,
            s.id,
          );
      });
      res.json(
        getAssignments().decorate(
          one("SELECT * FROM subtasks WHERE id=?", s.id),
          true,
        ),
      );
    });
    app.delete("/api/subtasks/:id", auth, (req, res) => {
      const { s } = subtask(req);
      if (Number(req.query.revision) !== s.revision)
        fail(
          409,
          "A subtarefa mudou em outro acesso. Atualize antes de mover para a lixeira.",
        );
      transaction(() => {
        run(
          "UPDATE subtasks SET deleted_at=?,deleted_by_name=?,revision=revision+1,updated=? WHERE id=?",
          now(),
          req.user.name,
          now(),
          s.id,
        );
        record(s.task_id, req.user, "subtask_trashed", { title: s.title });
      });
      res.json({ ok: true });
    });
    app.post("/api/trash/subtasks/:id/restore", auth, (req, res) => {
      const { s } = subtask(req, true);
      if (req.body.revision !== s.revision)
        fail(409, "A subtarefa mudou em outro acesso. Atualize a lixeira.");
      if (
        Number(
          one(
            "SELECT COUNT(*) AS n FROM subtasks WHERE task_id=? AND deleted_at IS NULL",
            s.task_id,
          ).n,
        ) >= 100
      )
        fail(400, "A tarefa já possui 100 subtarefas ativas.");
      transaction(() => {
        run(
          "UPDATE subtasks SET deleted_at=NULL,deleted_by_name=NULL,revision=revision+1,updated=? WHERE id=?",
          now(),
          s.id,
        );
        record(s.task_id, req.user, "subtask_restored", { title: s.title });
      });
      res.json(
        getAssignments().decorate(
          one("SELECT * FROM subtasks WHERE id=?", s.id),
          true,
        ),
      );
    });
    app.delete("/api/trash/subtasks/:id", auth, (req, res) => {
      const { s } = subtask(req, true, ["owner", "admin"]);
      if (Number(req.query.revision) !== s.revision)
        fail(409, "A subtarefa mudou em outro acesso. Atualize a lixeira.");
      transaction(() => {
        record(s.task_id, req.user, "subtask_removed", { title: s.title });
        run("DELETE FROM subtasks WHERE id=?", s.id);
      });
      res.json({ ok: true });
    });
  }
  return { ensure, columns, column, board, install, subFields };
}
