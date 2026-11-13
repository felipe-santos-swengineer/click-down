import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installDemo } from "./demo.mjs";
import { boardService } from "./boards.mjs";
import { assignmentService } from "./assignments.mjs";
import { activityService } from "./activity.mjs";

const scrypt = promisify(scryptCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "clickdown.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', lead_id TEXT REFERENCES users(id), created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')), PRIMARY KEY(project_id,user_id));
 CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), UNIQUE(project_id,email));
 CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, tag TEXT NOT NULL, date TEXT NOT NULL, assignee TEXT REFERENCES users(id), position REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, uploaded_by TEXT NOT NULL REFERENCES users(id), created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS migrations (user_id TEXT PRIMARY KEY REFERENCES users(id), completed TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), author_name TEXT NOT NULL, body TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS checklist (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)), revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS task_trash (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, deleted_by TEXT NOT NULL REFERENCES users(id), deleted_by_name TEXT NOT NULL, deleted_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS task_archive (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,archived_by TEXT NOT NULL REFERENCES users(id),archived_by_name TEXT NOT NULL,archived_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, kind TEXT NOT NULL, actor_name TEXT, due_date TEXT, dedupe_key TEXT UNIQUE NOT NULL, created TEXT NOT NULL, read_at TEXT);
 CREATE TABLE IF NOT EXISTS demo_sandboxes (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS demo_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, sandbox_id TEXT NOT NULL REFERENCES demo_sandboxes(id) ON DELETE CASCADE, role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS project_sandboxes (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, sandbox_id TEXT NOT NULL REFERENCES demo_sandboxes(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS task_project ON tasks(project);
 CREATE INDEX IF NOT EXISTS attachment_task ON attachments(task_id);
 CREATE INDEX IF NOT EXISTS member_user ON members(user_id);
 CREATE INDEX IF NOT EXISTS comment_task ON comments(task_id);
 CREATE INDEX IF NOT EXISTS checklist_task ON checklist(task_id);
 CREATE INDEX IF NOT EXISTS history_task ON history(task_id,id);
 CREATE INDEX IF NOT EXISTS notification_user ON notifications(user_id,id);
`);
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    const allowed = (
      process.env.APP_ORIGINS ||
      "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3001,http://localhost:3001"
    ).split(",");
    if (origin && !allowed.includes(origin))
      return res.status(403).json({ error: "Origem não permitida." });
  }
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
const run = (sql, ...args) => db.prepare(sql).run(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const fail = (status, message) => {
  const err = new Error(message);
  err.status = status;
  throw err;
};
const transaction = (fn) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
const now = () => new Date().toISOString();
const boards = boardService(db, {
  getAssignments: () => assignments,
  audit: (...args) => activity.record(...args),
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
});
const assignments = assignmentService(db, { run, one, all, fail });
const activity = activityService(db, { run, one, all, now, fail });
const demoEnabled =
  process.env.DEMO_ENABLED !== "false" && process.env.NODE_ENV !== "production";
const demoRoles = [
  {
    role: "owner",
    name: "Ana Costa",
    title: "Proprietária",
    description: "Gerencie todo o projeto e os papéis da equipe.",
  },
  {
    role: "admin",
    name: "Bruno Lima",
    title: "Administrador",
    description: "Configure o quadro e organize a equipe.",
  },
  {
    role: "editor",
    name: "Clara Souza",
    title: "Editora",
    description: "Crie tarefas, comente e acompanhe entregas.",
  },
  {
    role: "viewer",
    name: "Diego Alves",
    title: "Leitor",
    description: "Consulte o projeto com acesso de leitura.",
  },
];
function dayAt(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const date = new Date(
    `${get("year")}-${get("month")}-${get("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function demoProfile(userId) {
  return one(
    "SELECT sandbox_id,role FROM demo_profiles WHERE user_id=?",
    userId,
  );
}
function rejectDemo(user) {
  if (demoProfile(user.id))
    fail(
      403,
      "Esta ação está disponível na sua conta pessoal. O ambiente demo é separado dos projetos reais.",
    );
}
function notify(
  userId,
  taskId,
  kind,
  actor,
  dedupeKey,
  dueDate = null,
  subtaskId = null,
) {
  if (!userId || userId === actor?.id) return;
  const task = one("SELECT project FROM tasks WHERE id=?", taskId);
  if (
    !task ||
    !one(
      "SELECT 1 FROM members WHERE project_id=? AND user_id=?",
      task.project,
      userId,
    )
  )
    return;
  run(
    "INSERT OR IGNORE INTO notifications (user_id,task_id,kind,actor_name,due_date,dedupe_key,created,subtask_id) VALUES (?,?,?,?,?,?,?,?)",
    userId,
    taskId,
    kind,
    actor?.name || null,
    dueDate,
    dedupeKey,
    now(),
    subtaskId,
  );
}
function visibleNotifications(userId) {
  const direct = all(
    `SELECT n.*,COALESCE(s.title,t.title) AS task_title,t.title AS parent_title,t.project AS project_id,p.name AS project_name FROM notifications n JOIN tasks t ON t.id=n.task_id JOIN projects p ON p.id=t.project JOIN members m ON m.project_id=t.project AND m.user_id=n.user_id JOIN project_columns pc ON pc.project_id=t.project AND pc.id=t.status LEFT JOIN subtasks s ON s.id=n.subtask_id LEFT JOIN project_columns sc ON sc.project_id=t.project AND sc.id=s.status WHERE n.user_id=? AND n.project_event_id IS NULL AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) AND (n.subtask_id IS NULL OR(s.id IS NOT NULL AND s.deleted_at IS NULL)) AND (n.kind NOT IN ('due','overdue') OR (pc.kind<>'done' AND ((n.subtask_id IS NULL AND t.date=n.due_date AND EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=n.user_id)) OR(n.subtask_id IS NOT NULL AND sc.kind<>'done' AND s.date=n.due_date AND EXISTS(SELECT 1 FROM subtask_assignees a WHERE a.subtask_id=s.id AND a.user_id=n.user_id))))) ORDER BY n.id DESC`,
    userId,
  );
  const events = all(
    `SELECT n.*,e.kind AS action_kind,e.payload,e.task_title,e.project_id,p.name AS project_name,EXISTS(SELECT 1 FROM tasks t WHERE t.id=e.task_id AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)) AS task_available FROM notifications n JOIN project_events e ON e.id=n.project_event_id JOIN projects p ON p.id=e.project_id JOIN members m ON m.project_id=e.project_id AND m.user_id=n.user_id WHERE n.user_id=? ORDER BY n.id DESC`,
    userId,
  ).map((n) => ({
    ...n,
    payload: JSON.parse(n.payload),
    task_available: !!n.task_available,
  }));
  return [...direct, ...events].sort((a, b) => b.id - a.id);
}
function deadlineNotifications(userId) {
  const today = dayAt();
  for (const task of all(
    `SELECT t.* FROM tasks t JOIN task_assignees a ON a.task_id=t.id JOIN members m ON m.project_id=t.project AND m.user_id=a.user_id JOIN project_columns pc ON pc.project_id=t.project AND pc.id=t.status WHERE a.user_id=? AND t.date<>'' AND t.date<=? AND pc.kind<>'done' AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)`,
    userId,
    dayAt(1),
  )) {
    const kind = task.date < today ? "overdue" : "due";
    notify(
      userId,
      task.id,
      kind,
      null,
      `${kind}:${task.id}:${task.date}:${userId}`,
      task.date,
    );
  }
  for (const s of all(
    `SELECT s.* FROM subtasks s JOIN subtask_assignees a ON a.subtask_id=s.id JOIN tasks t ON t.id=s.task_id JOIN members m ON m.project_id=t.project AND m.user_id=a.user_id JOIN project_columns pc ON pc.project_id=t.project AND pc.id=t.status JOIN project_columns sc ON sc.project_id=t.project AND sc.id=s.status WHERE a.user_id=? AND s.date<>'' AND s.date<=? AND pc.kind<>'done' AND sc.kind<>'done' AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)`,
    userId,
    dayAt(1),
  )) {
    const kind = s.date < today ? "overdue" : "due";
    notify(
      userId,
      s.task_id,
      kind,
      null,
      `subtask-${kind}:${s.id}:${s.date}:${userId}`,
      s.date,
      s.id,
    );
  }
}
function record(taskId, user, kind, payload = {}) {
  const written = run(
    "INSERT INTO history (task_id,user_id,actor_name,kind,payload,created) VALUES (?,?,?,?,?,?)",
    taskId,
    user.id,
    user.name,
    kind,
    JSON.stringify(payload),
    now(),
  );
  const task = one("SELECT id,title,project FROM tasks WHERE id=?", taskId);
  activity.record(
    task.project,
    user,
    kind,
    payload,
    task,
    Number(written.lastInsertRowid),
  );
}
function assigneeName(id) {
  return id
    ? one("SELECT name FROM users WHERE id=?", id)?.name || "Pessoa removida"
    : "Não atribuído";
}
const hash = (token) => createHash("sha256").update(token).digest("hex");
function text(value, field, max, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, `${field}: valor inválido (máximo ${max} caracteres).`);
  return value.trim();
}
function email(value) {
  const result = text(value, "E-mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    fail(400, "Informe um e-mail válido.");
  return result;
}
function publicUser(user) {
  const demo = demoProfile(user.id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    ...(demo ? { is_demo: true, demo_role: demo.role } : {}),
  };
}
function cookie(token, maxAge = 604800) {
  return `cd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
}
function createSession(res, userId) {
  run("DELETE FROM sessions WHERE expires < ?", Date.now());
  const token = randomBytes(32).toString("hex");
  run(
    "INSERT INTO sessions VALUES (?,?,?)",
    hash(token),
    userId,
    Date.now() + 604800000,
  );
  res.append("Set-Cookie", cookie(token));
}
function auth(req, res, next) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("cd_session="))
    ?.slice(11);
  const user = token
    ? one(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
        hash(token),
        Date.now(),
      )
    : null;
  if (!user)
    return res
      .status(401)
      .json({ error: "Entre na sua conta para continuar." });
  if (!demoEnabled && demoProfile(user.id))
    return res
      .status(401)
      .json({ error: "A demonstração foi desativada neste servidor." });
  req.user = publicUser(user);
  req.sessionToken = hash(token);
  next();
}
function member(
  userId,
  projectId,
  roles = ["owner", "admin", "editor", "viewer"],
) {
  const sandbox =
    one(
      "SELECT sandbox_id FROM project_sandboxes WHERE project_id=?",
      projectId,
    )?.sandbox_id || null;
  if ((demoProfile(userId)?.sandbox_id || null) !== sandbox)
    fail(403, "Este projeto não pertence ao seu ambiente.");
  const row = one(
    "SELECT role FROM members WHERE user_id=? AND project_id=?",
    userId,
    projectId,
  );
  if (!row || !roles.includes(row.role))
    fail(403, "Você não tem permissão para esta ação no projeto.");
  return row.role;
}
function taskAccess(req, id, write = false) {
  const task = one("SELECT * FROM tasks WHERE id=?", id);
  if (!task) fail(404, "Tarefa não encontrada.");
  member(
    req.user.id,
    task.project,
    write ? ["owner", "admin", "editor"] : undefined,
  );
  if (one("SELECT 1 FROM task_trash WHERE task_id=?", task.id))
    fail(
      410,
      "Esta tarefa está na lixeira. Restaure-a para acessar seus detalhes.",
    );
  if (write && one("SELECT 1 FROM task_archive WHERE task_id=?", task.id))
    fail(409, "Esta tarefa está arquivada. Restaure-a para editar.");
  return task;
}
const attempts = new Map();
function limitAuth(req, res, next) {
  const key = req.socket.remoteAddress;
  const stamp = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.until > stamp && entry.count >= 30)
    return res
      .status(429)
      .json({ error: "Muitas tentativas. Aguarde 15 minutos." });
  if (!entry || entry.until <= stamp)
    attempts.set(key, { count: 1, until: stamp + 900000 });
  else entry.count++;
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < stamp) attempts.delete(k);
  next();
}
app.post("/api/auth/register", limitAuth, async (req, res) => {
  const name = text(req.body.name, "Nome", 80);
  const address = email(req.body.email);
  if (address.endsWith("@demo.clickdown.local"))
    fail(400, "Este domínio é reservado aos perfis de demonstração.");
  const password = text(req.body.password, "Senha", 128);
  if (password.length < 10)
    fail(400, "Use uma senha com pelo menos 10 caracteres.");
  if (one("SELECT id FROM users WHERE email=?", address))
    fail(409, "Este e-mail já possui uma conta. Entre com sua senha.");
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  const id = randomUUID();
  transaction(() => {
    if (one("SELECT id FROM users WHERE email=?", address))
      fail(409, "Este e-mail já possui uma conta.");
    run(
      "INSERT INTO users VALUES (?,?,?,?,?)",
      id,
      name,
      address,
      `${salt}:${derived.toString("hex")}`,
      now(),
    );
  });
  createSession(res, id);
  res.status(201).json({ user: { id, name, email: address } });
});
app.post("/api/auth/login", limitAuth, async (req, res) => {
  const address = email(req.body.email);
  const password = text(req.body.password, "Senha", 128);
  const user = one("SELECT * FROM users WHERE email=?", address);
  const [salt, expected] = (
    user?.password || `${"0".repeat(32)}:${"0".repeat(128)}`
  ).split(":");
  const actual = await scrypt(password, salt, 64);
  if (
    !user ||
    demoProfile(user.id) ||
    !timingSafeEqual(actual, Buffer.from(expected, "hex"))
  )
    fail(401, "E-mail ou senha incorretos.");
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});
app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));
app.post("/api/auth/logout", auth, (req, res) => {
  run("DELETE FROM sessions WHERE token=?", req.sessionToken);
  res.setHeader("Set-Cookie", cookie("", 0));
  res.json({ ok: true });
});
app.post("/api/invitations/:id/accept", auth, (req, res) => {
  rejectDemo(req.user);
  const invite = one("SELECT * FROM invitations WHERE id=?", req.params.id);
  if (!invite) fail(404, "Convite não encontrado ou já utilizado.");
  if (invite.email !== req.user.email)
    fail(403, `Entre com a conta do e-mail que recebeu este convite.`);
  transaction(() => {
    run(
      "INSERT OR IGNORE INTO members VALUES (?,?,?)",
      invite.project_id,
      req.user.id,
      invite.role,
    );
    run("DELETE FROM invitations WHERE id=?", invite.id);
    activity.record(invite.project_id, req.user, "member_joined", {
      name: req.user.name,
      changes: [{ field: "role", before: "Sem acesso", after: invite.role }],
    });
  });
  res.json({ project_id: invite.project_id });
});
app.get("/api/state", auth, (req, res) => {
  deadlineNotifications(req.user.id);
  const projects = all(
    "SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.created",
    req.user.id,
  ).map((p) => ({
    ...p,
    columns: boards.columns(p.id),
    board_revision: boards.board(p.id).revision,
    revision: activity.revision(p.id),
  }));
  const tasks = all(
    `SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.task_id=t.id) AS comment_count,
     (SELECT COUNT(*) FROM checklist c WHERE c.task_id=t.id) AS checklist_total,
     (SELECT COALESCE(SUM(done),0) FROM checklist c WHERE c.task_id=t.id) AS checklist_done,
     (SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id AND s.deleted_at IS NULL) AS subtask_total,
     (SELECT COUNT(*) FROM subtasks s JOIN project_columns c ON c.project_id=t.project AND c.id=s.status WHERE s.task_id=t.id AND s.deleted_at IS NULL AND c.kind='done') AS subtask_done
     FROM tasks t JOIN members m ON m.project_id=t.project WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) ORDER BY t.position,t.created`,
    req.user.id,
  ).map((t) => assignments.decorate(t));
  const members = all(
    "SELECT m.project_id,m.user_id AS id,m.role,u.name,u.email FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id IN (SELECT project_id FROM members WHERE user_id=?)",
    req.user.id,
  );
  const invitations = all(
    "SELECT i.* FROM invitations i JOIN members m ON m.project_id=i.project_id WHERE m.user_id=? AND m.role IN ('owner','admin')",
    req.user.id,
  );
  const attachments = all(
    "SELECT a.id,a.task_id,a.name,a.type,a.size,a.uploaded_by,a.created FROM attachments a JOIN tasks t ON t.id=a.task_id JOIN members m ON m.project_id=t.project WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) ORDER BY a.created",
    req.user.id,
  );
  res.json({
    projects,
    tasks,
    members,
    invitations,
    attachments,
    subtasks: all(
      "SELECT s.*,t.project FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN members m ON m.project_id=t.project WHERE m.user_id=? AND s.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) ORDER BY s.position,s.created",
      req.user.id,
    ).map((s) => assignments.decorate(s, true)),
    current_user: req.user,
    archived_count: Number(
      one(
        "SELECT COUNT(*) AS n FROM task_archive a JOIN tasks t ON t.id=a.task_id JOIN members m ON m.project_id=t.project WHERE m.user_id=?",
        req.user.id,
      ).n,
    ),
    activity_cursor: Number(
      one(
        "SELECT COALESCE(MAX(e.id),0) AS n FROM project_events e JOIN members m ON m.project_id=e.project_id WHERE m.user_id=?",
        req.user.id,
      ).n,
    ),
    unread_notifications: visibleNotifications(req.user.id).filter(
      (n) => !n.read_at,
    ).length,
    trash_count:
      Number(
        one(
          "SELECT COUNT(*) AS n FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN members m ON m.project_id=t.project WHERE m.user_id=? AND s.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)",
          req.user.id,
        ).n,
      ) +
      Number(
        one(
          "SELECT COUNT(*) AS n FROM task_trash x JOIN tasks t ON t.id=x.task_id JOIN members m ON m.project_id=t.project WHERE m.user_id=?",
          req.user.id,
        ).n,
      ),
  });
});
app.post("/api/projects", auth, (req, res) => {
  rejectDemo(req.user);
  const name = text(req.body.name, "Nome", 80);
  const description = text(
    req.body.description || "",
    "Descrição",
    1000,
    false,
  );
  const id = randomUUID();
  transaction(() => {
    run(
      "INSERT INTO projects VALUES (?,?,?,?,?,?)",
      id,
      name,
      "#8974eb",
      description,
      req.user.id,
      now(),
    );
    run("INSERT INTO members VALUES (?,?,?)", id, req.user.id, "owner");
    boards.ensure(id);
    activity.revision(id);
    activity.record(id, req.user, "project_created", { name });
  });
  res.status(201).json({ id });
});
app.patch("/api/projects/:id", auth, (req, res) => {
  member(req.user.id, req.params.id, ["owner", "admin"]);
  const p = one("SELECT * FROM projects WHERE id=?", req.params.id);
  const revision = activity.revision(p.id);
  if (req.body.revision !== undefined && req.body.revision !== revision)
    fail(
      409,
      "O projeto foi alterado em outro acesso. Reabra as configurações para carregar a versão atual.",
    );
  const name = text(req.body.name ?? p.name, "Nome", 80);
  const description = text(
    req.body.description ?? p.description,
    "Descrição",
    1000,
    false,
  );
  const lead =
    req.body.lead_id === undefined ? p.lead_id : req.body.lead_id || null;
  if (
    lead &&
    !one("SELECT 1 FROM members WHERE user_id=? AND project_id=?", lead, p.id)
  )
    fail(400, "O responsável precisa ser membro do projeto.");
  const changes = [
    ["name", p.name, name],
    ["description", p.description, description],
    ["lead_id", p.lead_id, lead],
  ]
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({
      field,
      before: field === "lead_id" ? assigneeName(before) : before,
      after: field === "lead_id" ? assigneeName(after) : after,
    }));
  if (!changes.length) return res.json({ ok: true, revision });
  transaction(() => {
    run(
      "UPDATE projects SET name=?,description=?,lead_id=? WHERE id=?",
      name,
      description,
      lead,
      p.id,
    );
    run(
      "UPDATE project_versions SET revision=revision+1 WHERE project_id=?",
      p.id,
    );
    activity.record(p.id, req.user, "project_updated", { changes });
  });
  res.json({ ok: true, revision: revision + 1 });
});
app.post("/api/projects/:id/members", auth, (req, res) => {
  const role = member(req.user.id, req.params.id, ["owner", "admin"]);
  const address = email(req.body.email);
  const targetRole = req.body.role;
  if (
    !["admin", "editor", "viewer"].includes(targetRole) ||
    (role === "admin" && targetRole === "admin")
  )
    fail(403, "Somente o proprietário pode nomear administradores.");
  const user = one("SELECT id,name FROM users WHERE email=?", address);
  const sourceSandbox = demoProfile(req.user.id)?.sandbox_id || null;
  const targetSandbox = user ? demoProfile(user.id)?.sandbox_id || null : null;
  if (
    sourceSandbox !== targetSandbox ||
    (sourceSandbox && !user) ||
    (!sourceSandbox && address.endsWith("@demo.clickdown.local"))
  )
    fail(
      403,
      "Perfis demo só podem participar de projetos do mesmo ambiente de demonstração.",
    );
  transaction(() => {
    if (user) {
      if (
        one(
          "SELECT 1 FROM members WHERE project_id=? AND user_id=?",
          req.params.id,
          user.id,
        )
      )
        fail(409, "Esta pessoa já participa do projeto.");
      run(
        "INSERT INTO members VALUES (?,?,?)",
        req.params.id,
        user.id,
        targetRole,
      );
      run(
        "DELETE FROM invitations WHERE project_id=? AND email=?",
        req.params.id,
        address,
      );
    } else {
      if (
        one(
          "SELECT 1 FROM invitations WHERE project_id=? AND email=?",
          req.params.id,
          address,
        )
      )
        fail(409, "Este e-mail já possui um convite pendente.");
      run(
        "INSERT INTO invitations VALUES (?,?,?,?)",
        randomUUID(),
        req.params.id,
        address,
        targetRole,
      );
    }
    activity.record(
      req.params.id,
      req.user,
      user ? "member_added" : "invitation_created",
      {
        name: user?.name || address,
        changes: [{ field: "role", before: "Sem acesso", after: targetRole }],
      },
    );
  });
  res.status(201).json({ pending: !user });
});
app.patch("/api/projects/:id/members/:userId", auth, (req, res) => {
  const role = member(req.user.id, req.params.id, ["owner", "admin"]);
  const target = one(
    "SELECT * FROM members WHERE project_id=? AND user_id=?",
    req.params.id,
    req.params.userId,
  );
  if (!target) fail(404, "Membro não encontrado.");
  if (
    target.role === "owner" ||
    (role === "admin" && (target.role === "admin" || req.body.role === "admin"))
  )
    fail(
      403,
      "Somente o proprietário pode gerenciar administradores. O proprietário não pode ser alterado.",
    );
  if (!["admin", "editor", "viewer"].includes(req.body.role))
    fail(400, "Papel inválido.");
  if (target.role === req.body.role) return res.json({ ok: true });
  transaction(() => {
    run(
      "UPDATE members SET role=? WHERE project_id=? AND user_id=?",
      req.body.role,
      req.params.id,
      req.params.userId,
    );
    activity.record(req.params.id, req.user, "member_role_updated", {
      name: assigneeName(req.params.userId),
      changes: [{ field: "role", before: target.role, after: req.body.role }],
    });
  });
  res.json({ ok: true });
});
app.delete("/api/projects/:id/members/:userId", auth, (req, res) => {
  const role = member(req.user.id, req.params.id, ["owner", "admin"]);
  const target = one(
    "SELECT * FROM members WHERE project_id=? AND user_id=?",
    req.params.id,
    req.params.userId,
  );
  if (!target) fail(404, "Membro não encontrado.");
  if (target.role === "owner" || (role === "admin" && target.role === "admin"))
    fail(403, "Você não pode remover este membro.");
  transaction(() => {
    for (const sub of [false, true]) {
      const rows = sub
        ? all(
            "SELECT s.id,s.task_id,s.title FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN subtask_assignees a ON a.subtask_id=s.id WHERE t.project=? AND a.user_id=?",
            req.params.id,
            req.params.userId,
          )
        : all(
            "SELECT t.id FROM tasks t JOIN task_assignees a ON a.task_id=t.id WHERE t.project=? AND a.user_id=?",
            req.params.id,
            req.params.userId,
          );
      for (const row of rows) {
        const before = assignments.ids(row.id, sub);
        const after = before.filter((id) => id !== req.params.userId);
        assignments.replace(row.id, after, sub);
        run(
          `UPDATE ${sub ? "subtasks" : "tasks"} SET revision=revision+1,updated=? WHERE id=?`,
          now(),
          row.id,
        );
        record(
          sub ? row.task_id : row.id,
          req.user,
          sub ? "subtask_updated" : "task_updated",
          {
            title: row.title,
            changes: [
              {
                field: "assignees",
                before: assignments.names(before),
                after: assignments.names(after),
              },
            ],
            reason: "Membro removido do projeto",
          },
        );
      }
    }
    if (
      one("SELECT lead_id FROM projects WHERE id=?", req.params.id)?.lead_id ===
      req.params.userId
    ) {
      activity.record(req.params.id, req.user, "project_updated", {
        changes: [
          {
            field: "lead_id",
            before: assigneeName(req.params.userId),
            after: "Não atribuído",
          },
        ],
        reason: "Membro removido do projeto",
      });
      activity.revision(req.params.id);
      run(
        "UPDATE project_versions SET revision=revision+1 WHERE project_id=?",
        req.params.id,
      );
    }
    run(
      "UPDATE projects SET lead_id=NULL WHERE id=? AND lead_id=?",
      req.params.id,
      req.params.userId,
    );
    activity.record(req.params.id, req.user, "member_removed", {
      name: assigneeName(req.params.userId),
      changes: [{ field: "role", before: target.role, after: "Sem acesso" }],
    });
    run(
      "DELETE FROM members WHERE project_id=? AND user_id=?",
      req.params.id,
      req.params.userId,
    );
  });
  res.json({ ok: true });
});
app.delete("/api/projects/:id/invitations/:inviteId", auth, (req, res) => {
  const role = member(req.user.id, req.params.id, ["owner", "admin"]);
  const invite = one(
    "SELECT * FROM invitations WHERE id=? AND project_id=?",
    req.params.inviteId,
    req.params.id,
  );
  if (!invite) fail(404, "Convite não encontrado.");
  if (role === "admin" && invite.role === "admin")
    fail(403, "Somente o proprietário pode cancelar este convite.");
  transaction(() => {
    run("DELETE FROM invitations WHERE id=?", invite.id);
    activity.record(req.params.id, req.user, "invitation_cancelled", {
      name: invite.email,
    });
  });
  res.json({ ok: true });
});
function taskFields(body, project) {
  const title = text(body.title, "Título", 160);
  const description = text(body.description || "", "Descrição", 10000, false);
  const tag = text(body.tag || "Geral", "Etiqueta", 40);
  if (typeof body.status !== "string" || !boards.column(project, body.status))
    fail(400, "Status inválido.");
  if (!["Alta", "Média", "Baixa"].includes(body.priority))
    fail(400, "Prioridade inválida.");
  const date = body.date || "";
  if (
    typeof date !== "string" ||
    (date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date + "T12:00:00Z")) ||
        new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date))
  )
    fail(400, "Prazo inválido.");
  const selected = assignments.validate(body, project);
  const assignee = selected[0] || null;
  return {
    title,
    description,
    tag,
    date,
    assignee,
    assignees: selected,
    status: body.status,
    priority: body.priority,
  };
}
app.post("/api/tasks", auth, (req, res) => {
  const project = text(req.body.project, "Projeto", 100);
  member(req.user.id, project, ["owner", "admin", "editor"]);
  const t = taskFields(req.body, project);
  const id = randomUUID();
  const stamp = now();
  const position = Number(
    one(
      "SELECT COALESCE(MAX(position),0)+1 AS n FROM tasks WHERE project=?",
      project,
    ).n,
  );
  transaction(() => {
    run(
      "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)",
      id,
      project,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.tag,
      t.date,
      t.assignee,
      position,
      stamp,
      stamp,
    );
    assignments.replace(id, t.assignees);
    record(id, req.user, "task_created", {
      changes: [
        {
          field: "assignees",
          before: "Não atribuído",
          after: assignments.names(t.assignees),
        },
      ],
    });
    for (const person of t.assignees)
      notify(
        person,
        id,
        "assignment",
        req.user,
        `assignment:${id}:1:${person}`,
      );
  });
  res
    .status(201)
    .json(assignments.decorate(one("SELECT * FROM tasks WHERE id=?", id)));
});
app.patch("/api/tasks/:id", auth, (req, res) => {
  const old = assignments.decorate(taskAccess(req, req.params.id, true));
  if (req.body.project && req.body.project !== old.project)
    fail(400, "A tarefa deve permanecer no projeto original.");
  const t = taskFields(assignments.merge(old, req.body), old.project);
  if (req.body.revision !== old.revision)
    fail(
      409,
      "Esta tarefa foi alterada por outra pessoa. Feche e abra novamente para carregar a versão atual.",
    );
  let position = old.position;
  if (req.body.position !== undefined) {
    if (
      typeof req.body.position !== "number" ||
      !Number.isFinite(req.body.position)
    )
      fail(400, "Posição inválida.");
    position = req.body.position;
  }
  const changes = ["title", "description", "status", "priority", "tag", "date"]
    .filter((field) => old[field] !== t[field])
    .map((field) => ({
      field,
      before:
        field === "assignee"
          ? assigneeName(old[field])
          : field === "status"
            ? boards.column(old.project, old.status).name
            : old[field],
      after:
        field === "assignee"
          ? assigneeName(t[field])
          : field === "status"
            ? boards.column(old.project, t.status).name
            : t[field],
    }));
  if (JSON.stringify(old.assignees) !== JSON.stringify(t.assignees))
    changes.push({
      field: "assignees",
      before: assignments.names(old.assignees),
      after: assignments.names(t.assignees),
    });
  if (position !== old.position)
    changes.push({ field: "position", before: old.position, after: position });
  if (!changes.length) return res.json(old);
  transaction(() => {
    const result = run(
      "UPDATE tasks SET title=?,description=?,status=?,priority=?,tag=?,date=?,assignee=?,position=?,revision=revision+1,updated=? WHERE id=? AND revision=?",
      t.title,
      t.description,
      t.status,
      t.priority,
      t.tag,
      t.date,
      t.assignee,
      position,
      now(),
      old.id,
      old.revision,
    );
    if (!result.changes) fail(409, "Tarefa alterada. Atualize a página.");
    assignments.replace(old.id, t.assignees);
    record(old.id, req.user, "task_updated", { changes });
    for (const person of t.assignees.filter(
      (id) => !old.assignees.includes(id),
    ))
      notify(
        person,
        old.id,
        "assignment",
        req.user,
        `assignment:${old.id}:${old.revision + 1}:${person}`,
      );
  });
  res.json(assignments.decorate(one("SELECT * FROM tasks WHERE id=?", old.id)));
});
app.delete("/api/tasks/:id", auth, (req, res) => {
  const t = taskAccess(req, req.params.id, true);
  if (Number(req.query.revision) !== t.revision)
    fail(
      409,
      "Tarefa alterada por outra pessoa. Abra novamente antes de excluir.",
    );
  transaction(() => {
    run(
      "INSERT INTO task_trash VALUES (?,?,?,?)",
      t.id,
      req.user.id,
      req.user.name,
      now(),
    );
    run(
      "UPDATE tasks SET revision=revision+1,updated=? WHERE id=?",
      now(),
      t.id,
    );
    record(t.id, req.user, "task_trashed");
  });
  res.json({ ok: true });
});
app.get("/api/trash", auth, (req, res) => {
  const items = all(
    `SELECT t.*,x.deleted_at,x.deleted_by_name,p.name AS project_name,m.role,(SELECT COUNT(*) FROM attachments a WHERE a.task_id=t.id) AS attachment_count,(SELECT COUNT(*) FROM comments c WHERE c.task_id=t.id) AS comment_count,(SELECT COUNT(*) FROM checklist c WHERE c.task_id=t.id) AS checklist_total,(SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) AS subtask_total FROM task_trash x JOIN tasks t ON t.id=x.task_id JOIN projects p ON p.id=t.project JOIN members m ON m.project_id=t.project WHERE m.user_id=? ORDER BY x.deleted_at DESC,t.id`,
    req.user.id,
  );
  const children = all(
    `SELECT s.*,t.project,t.title AS parent_title,s.task_id AS parent_task_id,'subtask' AS entity_type,p.name AS project_name,m.role,0 AS attachment_count,0 AS comment_count,0 AS checklist_total FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN projects p ON p.id=t.project JOIN members m ON m.project_id=t.project WHERE m.user_id=? AND s.deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id)`,
    req.user.id,
  );
  res.json({
    items: [...items, ...children].sort((a, b) =>
      b.deleted_at.localeCompare(a.deleted_at),
    ),
  });
});
app.post("/api/tasks/:id/archive", auth, (req, res) => {
  const t = taskAccess(req, req.params.id, true);
  if (req.body.revision !== t.revision)
    fail(
      409,
      "A tarefa foi alterada em outro acesso. Reabra antes de arquivar.",
    );
  transaction(() => {
    run(
      "INSERT INTO task_archive VALUES (?,?,?,?)",
      t.id,
      req.user.id,
      req.user.name,
      now(),
    );
    run(
      "UPDATE tasks SET revision=revision+1,updated=? WHERE id=?",
      now(),
      t.id,
    );
    record(t.id, req.user, "task_archived");
  });
  res.json({ ok: true });
});
app.get("/api/archive", auth, (req, res) => {
  const items = all(
    `SELECT t.*,a.archived_at,a.archived_by_name,p.name AS project_name,m.role,(SELECT COUNT(*) FROM comments c WHERE c.task_id=t.id) AS comment_count,(SELECT COUNT(*) FROM attachments x WHERE x.task_id=t.id) AS attachment_count,(SELECT COUNT(*) FROM checklist c WHERE c.task_id=t.id) AS checklist_total,(SELECT COUNT(*) FROM subtasks s WHERE s.task_id=t.id) AS subtask_total FROM task_archive a JOIN tasks t ON t.id=a.task_id JOIN projects p ON p.id=t.project JOIN members m ON m.project_id=t.project WHERE m.user_id=? ORDER BY a.archived_at DESC,t.id`,
    req.user.id,
  ).map((t) => assignments.decorate(t));
  res.json({ items });
});
app.get("/api/archive/:id", auth, (req, res) => {
  const t = taskAccess(req, req.params.id);
  const archived = one("SELECT * FROM task_archive WHERE task_id=?", t.id);
  if (!archived) fail(404, "Tarefa não encontrada nos arquivados.");
  const p = one(
    "SELECT p.*,m.role FROM projects p JOIN members m ON m.project_id=p.id WHERE p.id=? AND m.user_id=?",
    t.project,
    req.user.id,
  );
  res.json({
    task: assignments.decorate({ ...t, ...archived }),
    project: {
      ...p,
      columns: boards.columns(p.id),
      revision: activity.revision(p.id),
    },
    members: all(
      "SELECT u.id,u.name,u.email,m.role,m.project_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?",
      t.project,
    ),
    attachments: all(
      "SELECT id,task_id,name,type,size,uploaded_by,created FROM attachments WHERE task_id=? ORDER BY created",
      t.id,
    ),
  });
});
app.post("/api/archive/:id/restore", auth, (req, res) => {
  const t = one(
    "SELECT t.* FROM tasks t JOIN task_archive a ON a.task_id=t.id WHERE t.id=?",
    req.params.id,
  );
  if (!t) fail(404, "Tarefa não encontrada nos arquivados.");
  member(req.user.id, t.project, ["owner", "admin", "editor"]);
  if (req.body.revision !== t.revision)
    fail(
      409,
      "Esta tarefa mudou em outro acesso. Atualize os arquivados e tente novamente.",
    );
  transaction(() => {
    run("DELETE FROM task_archive WHERE task_id=?", t.id);
    run(
      "UPDATE tasks SET revision=revision+1,updated=? WHERE id=?",
      now(),
      t.id,
    );
    record(t.id, req.user, "task_unarchived");
  });
  res.json(assignments.decorate(one("SELECT * FROM tasks WHERE id=?", t.id)));
});
function trashedTask(req, roles) {
  const t = one(
    "SELECT t.* FROM tasks t JOIN task_trash x ON x.task_id=t.id WHERE t.id=?",
    req.params.id,
  );
  if (!t) fail(404, "Tarefa não encontrada na lixeira.");
  member(req.user.id, t.project, roles);
  const revision =
    req.method === "DELETE" ? Number(req.query.revision) : req.body.revision;
  if (revision !== t.revision)
    fail(
      409,
      "A lixeira mudou em outro acesso. Atualize a lista e tente novamente.",
    );
  return t;
}
app.post("/api/trash/:id/restore", auth, (req, res) => {
  const t = trashedTask(req, ["owner", "admin", "editor"]);
  transaction(() => {
    run("DELETE FROM task_trash WHERE task_id=?", t.id);
    run(
      "UPDATE tasks SET revision=revision+1,updated=? WHERE id=?",
      now(),
      t.id,
    );
    record(t.id, req.user, "task_restored");
  });
  res.json(assignments.decorate(one("SELECT * FROM tasks WHERE id=?", t.id)));
});
app.delete("/api/trash/:id", auth, (req, res) => {
  const t = trashedTask(req, ["owner", "admin"]);
  transaction(() => {
    activity.record(t.project, req.user, "task_removed", {}, t);
    run("DELETE FROM tasks WHERE id=?", t.id);
  });
  res.json({ ok: true });
});
app.get("/api/notifications", auth, (req, res) => {
  deadlineNotifications(req.user.id);
  const allItems = visibleNotifications(req.user.id);
  let items = allItems;
  if (req.query.unread === "1") items = items.filter((n) => !n.read_at);
  if (req.query.before) {
    const before = Number(req.query.before);
    if (!Number.isSafeInteger(before) || before < 1)
      fail(400, "Cursor de notificações inválido.");
    items = items.filter((n) => n.id < before);
  }
  res.json({
    items: items.slice(0, 50),
    unread_count: allItems.filter((n) => !n.read_at).length,
    has_more: items.length > 50,
  });
});
app.post("/api/notifications/read-all", auth, (req, res) => {
  const items = visibleNotifications(req.user.id).filter((n) => !n.read_at);
  transaction(() => {
    for (const n of items)
      run(
        "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
        now(),
        n.id,
        req.user.id,
      );
  });
  res.json({ ok: true });
});
app.patch("/api/notifications/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const n = visibleNotifications(req.user.id).find((n) => n.id === id);
  if (!n) fail(404, "Notificação não encontrada.");
  if (typeof req.body.read !== "boolean")
    fail(400, "Informe se a notificação foi lida.");
  run(
    "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
    req.body.read ? n.read_at || now() : null,
    id,
    req.user.id,
  );
  res.json({ ok: true });
});
app.get("/api/tasks/:id/collaboration", auth, (req, res) => {
  taskAccess(req, req.params.id);
  res.json({
    current_user_id: req.user.id,
    subtasks: all(
      "SELECT s.*,t.project FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.task_id=? AND s.deleted_at IS NULL ORDER BY s.position,s.created",
      req.params.id,
    ).map((s) => assignments.decorate(s, true)),
    comments: all(
      "SELECT id,task_id,user_id,author_name,body,mentions,created FROM comments WHERE task_id=? ORDER BY rowid",
      req.params.id,
    ).map((c) => ({ ...c, mentions: JSON.parse(c.mentions) })),
    checklist: all(
      "SELECT * FROM checklist WHERE task_id=? ORDER BY rowid",
      req.params.id,
    ).map((c) => ({ ...c, done: !!c.done })),
    history: all(
      "SELECT * FROM history WHERE task_id=? ORDER BY id DESC",
      req.params.id,
    ).map((h) => ({ ...h, payload: JSON.parse(h.payload) })),
  });
});
app.post("/api/tasks/:id/comments", auth, (req, res) => {
  const task = taskAccess(req, req.params.id, true);
  const body = text(req.body.body, "Comentário", 4000);
  const ids = req.body.mentions ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 20 ||
    !ids.every((id) => typeof id === "string")
  )
    fail(400, "Menções inválidas. Selecione até 20 pessoas do projeto.");
  const mentions = [...new Set(ids)].map((id) => {
    const person = one(
      "SELECT u.id,u.name FROM users u JOIN members m ON m.user_id=u.id WHERE m.project_id=? AND u.id=?",
      task.project,
      id,
    );
    if (!person || !body.includes("@" + person.name))
      fail(
        400,
        "Selecione uma pessoa do projeto e mantenha a menção no comentário.",
      );
    return person;
  });
  if (
    Number(
      one("SELECT COUNT(*) AS n FROM comments WHERE task_id=?", task.id).n,
    ) >= 1000
  )
    fail(400, "Limite de 1.000 comentários por tarefa.");
  const id = randomUUID();
  transaction(() => {
    run(
      "INSERT INTO comments VALUES (?,?,?,?,?,?,?)",
      id,
      task.id,
      req.user.id,
      req.user.name,
      body,
      JSON.stringify(mentions),
      now(),
    );
    record(task.id, req.user, "comment_added", { comment_id: id, mentions });
    for (const mention of mentions)
      notify(
        mention.id,
        task.id,
        "mention",
        req.user,
        `mention:${id}:${mention.id}`,
      );
  });
  const comment = one("SELECT * FROM comments WHERE id=?", id);
  res.status(201).json({ ...comment, mentions });
});
app.post("/api/tasks/:id/checklist", auth, (req, res) => {
  const task = taskAccess(req, req.params.id, true);
  const title = text(req.body.title, "Item do checklist", 240);
  if (
    Number(
      one("SELECT COUNT(*) AS n FROM checklist WHERE task_id=?", task.id).n,
    ) >= 100
  )
    fail(400, "Limite de 100 itens por tarefa.");
  const id = randomUUID();
  transaction(() => {
    run(
      "INSERT INTO checklist VALUES (?,?,?,0,1,?)",
      id,
      task.id,
      title,
      now(),
    );
    record(task.id, req.user, "checklist_added", { item_id: id, title });
  });
  res
    .status(201)
    .json({ ...one("SELECT * FROM checklist WHERE id=?", id), done: false });
});
function checklistAccess(req) {
  const item = one("SELECT * FROM checklist WHERE id=?", req.params.id);
  if (!item) fail(404, "Item não encontrado.");
  taskAccess(req, item.task_id, true);
  return item;
}
app.patch("/api/checklist/:id", auth, (req, res) => {
  const item = checklistAccess(req);
  if (req.body.revision !== item.revision)
    fail(
      409,
      "Este item foi alterado por outra pessoa. A lista foi atualizada; confira antes de tentar novamente.",
    );
  const title =
    req.body.title === undefined
      ? item.title
      : text(req.body.title, "Item do checklist", 240);
  if (req.body.done !== undefined && typeof req.body.done !== "boolean")
    fail(400, "O campo concluído deve ser verdadeiro ou falso.");
  const done = req.body.done === undefined ? !!item.done : req.body.done;
  if (title === item.title && done === !!item.done)
    return res.json({ ...item, done });
  transaction(() => {
    run(
      "UPDATE checklist SET title=?,done=?,revision=revision+1 WHERE id=?",
      title,
      done ? 1 : 0,
      item.id,
    );
    if (title !== item.title)
      record(item.task_id, req.user, "checklist_renamed", {
        item_id: item.id,
        before: item.title,
        after: title,
      });
    if (done !== !!item.done)
      record(
        item.task_id,
        req.user,
        done ? "checklist_completed" : "checklist_reopened",
        { item_id: item.id, title },
      );
  });
  res.json({ ...one("SELECT * FROM checklist WHERE id=?", item.id), done });
});
app.delete("/api/checklist/:id", auth, (req, res) => {
  const item = checklistAccess(req);
  if (Number(req.query.revision) !== item.revision)
    fail(
      409,
      "Este item foi alterado por outra pessoa. Confira a lista atualizada antes de excluir.",
    );
  transaction(() => {
    run("DELETE FROM checklist WHERE id=?", item.id);
    record(item.task_id, req.user, "checklist_removed", {
      item_id: item.id,
      title: item.title,
    });
  });
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
});
function safeMime(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    return "video/webm";
  if (
    b.toString("ascii", 0, 3) === "ID3" ||
    (b[0] === 255 && (b[1] & 224) === 224)
  )
    return "audio/mpeg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WAVE"
  )
    return "audio/wav";
  if (b.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}
app.post(
  "/api/tasks/:id/attachments",
  auth,
  (req, res, next) => {
    taskAccess(req, req.params.id, true);
    next();
  },
  upload.single("file"),
  (req, res) => {
    const task = taskAccess(req, req.params.id, true);
    if (!req.file) fail(400, "Selecione um arquivo.");
    if (
      Number(
        one("SELECT COUNT(*) AS n FROM attachments WHERE task_id=?", task.id).n,
      ) >= 10
    )
      fail(400, "Limite de 10 anexos por tarefa.");
    const mime = safeMime(req.file.buffer);
    if (!mime)
      fail(
        400,
        "Formato não suportado. Use PNG, JPG, GIF, WebP, MP4, WebM, MP3, WAV ou PDF.",
      );
    const total = Number(
      one(
        "SELECT COALESCE(SUM(a.size),0) AS n FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE t.project=?",
        task.project,
      ).n,
    );
    if (total + req.file.size > 500 * 1024 * 1024)
      fail(400, "O projeto atingiu o limite de 500 MB em anexos.");
    const id = randomUUID();
    const name =
      Buffer.from(req.file.originalname, "latin1")
        .toString("utf8")
        .replace(/[\x00-\x1f\x7f\\/]/g, "_")
        .slice(0, 180) || "anexo";
    transaction(() => {
      run(
        "INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)",
        id,
        task.id,
        name,
        mime,
        req.file.size,
        req.file.buffer,
        req.user.id,
        now(),
      );
      record(task.id, req.user, "attachment_added", { name });
    });
    res.status(201).json({ id });
  },
);
app.get("/api/attachments/:id", auth, (req, res) => {
  const metadata = one(
    "SELECT task_id FROM attachments WHERE id=?",
    req.params.id,
  );
  if (!metadata) fail(404, "Anexo não encontrado.");
  taskAccess(req, metadata.task_id);
  const a = one("SELECT * FROM attachments WHERE id=?", req.params.id);
  res.setHeader("Content-Type", a.type);
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" || a.type === "application/pdf" ? "attachment" : "inline"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(a.name).replace(/'/g, "%27")}`,
  );
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Accept-Ranges", "bytes");
  const bytes = Buffer.from(a.bytes);
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    let start = 0,
      end = bytes.length - 1;
    if (match) {
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
      } else if (match[2]) start = Math.max(0, bytes.length - Number(match[2]));
      else start = -1;
    }
    if (!match || start < 0 || start >= bytes.length || end < start) {
      res.setHeader("Content-Range", `bytes */${bytes.length}`);
      return res.status(416).end();
    }
    res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    return res.status(206).send(bytes.subarray(start, end + 1));
  }
  res.send(bytes);
});
app.delete("/api/attachments/:id", auth, (req, res) => {
  const a = one(
    "SELECT task_id,name FROM attachments WHERE id=?",
    req.params.id,
  );
  if (!a) fail(404, "Anexo não encontrado.");
  taskAccess(req, a.task_id, true);
  transaction(() => {
    run("DELETE FROM attachments WHERE id=?", req.params.id);
    record(a.task_id, req.user, "attachment_removed", { name: a.name });
  });
  res.json({ ok: true });
});
boards.install(app, auth);
activity.install(app, auth);
installDemo(app, {
  auditProject: activity.record,
  setAssignees: assignments.replace,
  getAssignees: assignments.ids,
  assigneeNames: assignments.names,
  ensureBoard: boards.ensure,
  enabled: demoEnabled,
  profiles: demoRoles,
  run,
  one,
  all,
  transaction,
  now,
  dayAt,
  record,
  notify,
  hash,
  scrypt,
  createSession,
  publicUser,
  limitAuth,
  fail,
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Rota não encontrada." }),
);
app.use(express.static(path.join(root, "dist")));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.join(root, "dist", "index.html")),
);
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "O arquivo deve ter até 20 MB."
          : "Envie um arquivo por vez, com até 20 MB.",
    });
  if (err instanceof SyntaxError && "body" in err)
    return res.status(400).json({ error: "JSON inválido." });
  if (err.type === "entity.too.large")
    return res.status(413).json({ error: "O backup excede o limite de 2 MB." });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({
    error: err.status
      ? err.message
      : "Não foi possível concluir. Tente novamente.",
  });
});
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `ClickDown API: http://${process.env.HOST || "127.0.0.1"}:${port}`,
  ),
);
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
