import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

test("autenticação, persistência, isolamento, papéis, responsáveis, anexos e conflitos", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "clickdown-test-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const base = `http://127.0.0.1:${port}/api`;
  let child;
  let logs = "";
  async function boot(overrides = {}) {
    child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        DATA_DIR: temp,
        PORT: String(port),
        NODE_ENV: "test",
        DEMO_ENABLED: "true",
        ...overrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    logs = "";
    child.stdout.on("data", (b) => (logs += b));
    child.stderr.on("data", (b) => (logs += b));
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(base + "/auth/me");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error(logs);
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
  t.after(async () => {
    await stop();
    const resolved = path.resolve(temp);
    assert.ok(
      resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
        path.basename(resolved).startsWith("clickdown-test-"),
    );
    await rm(resolved, { recursive: true, force: true });
  });
  await boot();
  const client = () => {
    const cookies = new Map();
    return async (method, url, body, expected = 200, extra = {}) => {
      const response = await fetch(base + url, {
        method,
        headers: {
          ...(cookies.size
            ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
            : {}),
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...extra,
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      if (response.headers.has("set-cookie")) {
        for (const value of response.headers.getSetCookie()) {
          assert.match(value, /HttpOnly/);
          assert.match(value, /SameSite=Strict/);
          const pair = value.split(";")[0];
          const at = pair.indexOf("=");
          cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
      }
      const data = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      assert.equal(
        response.status,
        expected,
        `${method} ${url}: ${JSON.stringify(data)}`,
      );
      return data;
    };
  };
  const owner = client(),
    admin = client(),
    editor = client(),
    viewer = client(),
    outsider = client(),
    future = client();
  const register = async (c, name, address) => {
    const result = await c(
      "POST",
      "/auth/register",
      { name, email: address, password: "UmaSenhaForte123!" },
      201,
    );
    return result.user;
  };
  await outsider("GET", "/state", undefined, 401);
  const o = await register(owner, "Proprietário", "owner@example.com");
  const a = await register(admin, "Administrador", "admin@example.com");
  const e = await register(editor, "Editor", "editor@example.com");
  const v = await register(viewer, "Leitor", "viewer@example.com");
  await register(outsider, "Outra pessoa", "outside@example.com");
  await owner(
    "POST",
    "/auth/register",
    {
      name: "Duplicado",
      email: "owner@example.com",
      password: "UmaSenhaForte123!",
    },
    409,
  );
  await owner(
    "POST",
    "/auth/login",
    { email: "owner@example.com", password: "errada" },
    401,
  );
  const project = await owner(
    "POST",
    "/projects",
    { name: "Projeto compartilhado" },
    201,
  );
  for (const [email, role] of [
    ["admin@example.com", "admin"],
    ["editor@example.com", "editor"],
    ["viewer@example.com", "viewer"],
  ])
    await owner(
      "POST",
      `/projects/${project.id}/members`,
      { email, role },
      201,
    );
  assert.equal((await outsider("GET", "/state")).projects.length, 0);
  await outsider("PATCH", `/projects/${project.id}`, { name: "Invadido" }, 403);
  await editor(
    "POST",
    `/projects/${project.id}/members`,
    { email: "outside@example.com", role: "editor" },
    403,
  );
  await admin(
    "PATCH",
    `/projects/${project.id}/members/${a.id}`,
    { role: "editor" },
    403,
  );
  await admin(
    "PATCH",
    `/projects/${project.id}/members/${e.id}`,
    { role: "admin" },
    403,
  );
  await owner(
    "PATCH",
    `/projects/${project.id}/members/${o.id}`,
    { role: "viewer" },
    403,
  );
  await owner("PATCH", `/projects/${project.id}`, { lead_id: e.id });
  await owner(
    "PATCH",
    `/projects/${project.id}`,
    { lead_id: "not-member" },
    400,
  );
  const taskBody = {
    project: project.id,
    title: "Tarefa com mídia",
    description: "Uma descrição",
    status: "todo",
    priority: "Alta",
    tag: "Design",
    date: "2026-11-30",
    assignee: e.id,
  };
  await viewer("POST", "/tasks", taskBody, 403);
  let task = await editor("POST", "/tasks", taskBody, 201);
  await outsider(
    "PATCH",
    "/tasks/" + task.id,
    { status: "done", revision: task.revision },
    403,
  );
  await viewer(
    "PATCH",
    "/tasks/" + task.id,
    { status: "done", revision: task.revision },
    403,
  );
  await editor(
    "PATCH",
    "/tasks/" + task.id,
    { date: "2026-02-31", revision: task.revision },
    400,
  );
  const stale = task.revision;
  task = await editor("PATCH", "/tasks/" + task.id, {
    status: "doing",
    revision: stale,
    position: 10,
  });
  await owner(
    "PATCH",
    "/tasks/" + task.id,
    { title: "Sobrescrever", revision: stale },
    409,
  );
  assert.equal(task.status, "doing");
  const activityUrl = `/tasks/${task.id}/collaboration`;
  await outsider("GET", activityUrl, undefined, 403);
  let activity = await viewer("GET", activityUrl);
  assert.equal(activity.history.length, 2);
  assert.equal(activity.history[0].actor_name, "Editor");
  assert.deepEqual(
    activity.history[0].payload.changes.find((c) => c.field === "status"),
    { field: "status", before: "A fazer", after: "Em andamento" },
  );
  await viewer(
    "POST",
    `/tasks/${task.id}/comments`,
    { body: "Sem permissão" },
    403,
  );
  await outsider(
    "POST",
    `/tasks/${task.id}/comments`,
    { body: "De fora" },
    403,
  );
  await editor("POST", `/tasks/${task.id}/comments`, { body: "   " }, 400);
  await editor(
    "POST",
    `/tasks/${task.id}/comments`,
    { body: "Texto muito longo".repeat(400) },
    400,
  );
  await editor(
    "POST",
    `/tasks/${task.id}/comments`,
    { body: "Olá @Outra pessoa", mentions: ["not-a-member"] },
    400,
  );
  await editor(
    "POST",
    `/tasks/${task.id}/comments`,
    { body: "Sem a menção no texto", mentions: [o.id] },
    400,
  );
  assert.equal((await owner("GET", activityUrl)).history.length, 2);
  const comment = await editor(
    "POST",
    `/tasks/${task.id}/comments`,
    {
      body: "Pode revisar, @Proprietário? <script>alert(1)</script>",
      mentions: [o.id, o.id],
      user_id: o.id,
    },
    201,
  );
  assert.equal(comment.user_id, e.id);
  assert.equal(comment.author_name, "Editor");
  assert.deepEqual(comment.mentions, [{ id: o.id, name: "Proprietário" }]);
  await viewer(
    "POST",
    `/tasks/${task.id}/checklist`,
    { title: "Bloqueado" },
    403,
  );
  let item = await editor(
    "POST",
    `/tasks/${task.id}/checklist`,
    { title: "Validar acessibilidade" },
    201,
  );
  await outsider(
    "PATCH",
    "/checklist/" + item.id,
    { done: true, revision: item.revision },
    403,
  );
  await viewer(
    "PATCH",
    "/checklist/" + item.id,
    { done: true, revision: item.revision },
    403,
  );
  await viewer(
    "DELETE",
    `/checklist/${item.id}?revision=${item.revision}`,
    undefined,
    403,
  );
  await editor(
    "PATCH",
    "/checklist/" + item.id,
    { done: "true", revision: item.revision },
    400,
  );
  const itemRevision = item.revision;
  item = await editor("PATCH", "/checklist/" + item.id, {
    done: true,
    revision: itemRevision,
  });
  await owner(
    "PATCH",
    "/checklist/" + item.id,
    { done: false, revision: itemRevision },
    409,
  );
  await owner(
    "DELETE",
    `/checklist/${item.id}?revision=${itemRevision}`,
    undefined,
    409,
  );
  item = await owner("PATCH", "/checklist/" + item.id, {
    title: "Validar acessibilidade e contraste",
    revision: item.revision,
  });
  const beforeNoop = (await owner("GET", activityUrl)).history.length;
  await owner("PATCH", "/checklist/" + item.id, {
    done: true,
    revision: item.revision,
  });
  assert.equal((await owner("GET", activityUrl)).history.length, beforeNoop);
  const summary = (await viewer("GET", "/state")).tasks.find(
    (t) => t.id === task.id,
  );
  assert.equal(summary.comment_count, 1);
  assert.equal(summary.checklist_total, 1);
  assert.equal(summary.checklist_done, 1);
  assert.equal(summary.revision, task.revision);
  activity = await owner("GET", activityUrl);
  assert.equal(activity.comments[0].body, comment.body);
  assert.equal(activity.checklist[0].done, true);
  assert.equal(activity.history[0].kind, "checklist_renamed");
  const mentionNotice = (await owner("GET", "/notifications")).items.find(
    (n) => n.kind === "mention" && n.task_id === task.id,
  );
  assert.ok(mentionNotice);
  assert.equal(mentionNotice.actor_name, "Editor");
  await outsider(
    "PATCH",
    "/notifications/" + mentionNotice.id,
    { read: true },
    404,
  );
  await owner("PATCH", "/notifications/" + mentionNotice.id, { read: true });
  assert.ok(
    (await owner("GET", "/notifications")).items.find(
      (n) => n.id === mentionNotice.id,
    ).read_at,
  );
  await owner("PATCH", "/notifications/" + mentionNotice.id, { read: false });
  assert.equal(
    (await owner("GET", "/notifications?unread=1")).items.some(
      (n) => n.id === mentionNotice.id,
    ),
    true,
  );
  await owner("POST", "/notifications/read-all");
  assert.equal((await owner("GET", "/notifications")).unread_count, 0);
  task = await owner("PATCH", "/tasks/" + task.id, {
    assignee: a.id,
    revision: task.revision,
  });
  assert.ok(
    (await admin("GET", "/notifications")).items.some(
      (n) => n.kind === "assignment" && n.task_id === task.id,
    ),
  );
  task = await owner("PATCH", "/tasks/" + task.id, {
    assignee: e.id,
    revision: task.revision,
  });
  assert.ok(
    (await editor("GET", "/notifications")).items.some(
      (n) => n.kind === "assignment" && n.task_id === task.id,
    ),
  );
  const businessDay = (offset = 0) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Fortaleza",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const d = new Date(
      `${get("year")}-${get("month")}-${get("day")}T12:00:00Z`,
    );
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  let dueTask = await owner(
    "POST",
    "/tasks",
    {
      ...taskBody,
      title: "Prazo de teste",
      assignee: a.id,
      date: businessDay(),
    },
    201,
  );
  const firstDue = (await admin("GET", "/notifications")).items.filter(
    (n) => n.task_id === dueTask.id && n.kind === "due",
  );
  assert.equal(firstDue.length, 1);
  await admin("GET", "/state");
  assert.equal(
    (await admin("GET", "/notifications")).items.filter(
      (n) => n.task_id === dueTask.id && n.kind === "due",
    ).length,
    1,
  );
  dueTask = await owner("PATCH", "/tasks/" + dueTask.id, {
    date: businessDay(-1),
    revision: dueTask.revision,
  });
  const overdueNotices = (await admin("GET", "/notifications")).items.filter(
    (n) => n.task_id === dueTask.id && ["due", "overdue"].includes(n.kind),
  );
  assert.equal(overdueNotices.length, 1);
  assert.equal(overdueNotices[0].kind, "overdue");
  dueTask = await owner("PATCH", "/tasks/" + dueTask.id, {
    status: "done",
    revision: dueTask.revision,
  });
  assert.equal(
    (await admin("GET", "/notifications")).items.some(
      (n) => n.task_id === dueTask.id && ["due", "overdue"].includes(n.kind),
    ),
    false,
  );
  let disposable = await owner(
    "POST",
    `/tasks/${task.id}/checklist`,
    { title: "Temporário" },
    201,
  );
  await owner(
    "DELETE",
    `/checklist/${disposable.id}?revision=${disposable.revision}`,
  );
  assert.equal(
    (await owner("GET", activityUrl)).history[0].kind,
    "checklist_removed",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cWQAAAAASUVORK5CYII=",
    "base64",
  );
  const form = () => {
    const f = new FormData();
    f.append("file", new Blob([png], { type: "image/png" }), "imagem.png");
    return f;
  };
  await viewer("POST", `/tasks/${task.id}/attachments`, form(), 403);
  const attachment = await editor(
    "POST",
    `/tasks/${task.id}/attachments`,
    form(),
    201,
  );
  assert.equal(
    (await owner("GET", activityUrl)).history[0].kind,
    "attachment_added",
  );
  assert.deepEqual(await viewer("GET", "/attachments/" + attachment.id), png);
  assert.deepEqual(
    await viewer("GET", "/attachments/" + attachment.id, undefined, 206, {
      Range: "bytes=0-7",
    }),
    png.subarray(0, 8),
  );
  await viewer("GET", "/attachments/" + attachment.id, undefined, 416, {
    Range: "bytes=999999-",
  });
  await outsider("GET", "/attachments/" + attachment.id, undefined, 403);
  await viewer("DELETE", "/attachments/" + attachment.id, undefined, 403);
  const bad = new FormData();
  bad.append(
    "file",
    new Blob(["<script>alert(1)</script>"], { type: "image/png" }),
    "fake.png",
  );
  await editor("POST", `/tasks/${task.id}/attachments`, bad, 400);
  const tooLarge = new FormData();
  tooLarge.append(
    "file",
    new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]),
    "huge.png",
  );
  await editor("POST", `/tasks/${task.id}/attachments`, tooLarge, 400);
  assert.equal((await viewer("GET", "/state")).tasks[0].assignee, e.id);
  const pending = await owner(
    "POST",
    `/projects/${project.id}/members`,
    { email: "future@example.com", role: "viewer" },
    201,
  );
  assert.equal(pending.pending, true);
  await register(future, "Pessoa convidada", "future@example.com");
  assert.equal((await future("GET", "/state")).projects.length, 0);
  const invite = (await owner("GET", "/state")).invitations[0];
  await outsider("POST", `/invitations/${invite.id}/accept`, {}, 403);
  await future("POST", `/invitations/${invite.id}/accept`, {});
  assert.equal((await future("GET", "/state")).projects[0].role, "viewer");
  await owner("PATCH", `/projects/${project.id}/members/${v.id}`, {
    role: "editor",
  });
  await viewer("PATCH", "/tasks/" + task.id, {
    priority: "Baixa",
    revision: task.revision,
  });
  await owner("DELETE", `/projects/${project.id}/members/${e.id}`);
  const state = await owner("GET", "/state");
  assert.equal(state.projects[0].lead_id, null);
  assert.equal(state.tasks[0].assignee, null);
  await editor("GET", "/attachments/" + attachment.id, undefined, 403);
  await editor("GET", activityUrl, undefined, 403);
  assert.equal((await editor("GET", "/state")).projects.length, 0);
  await owner("POST", "/projects", { name: "CSRF" }, 403, {
    Origin: "https://malicious.example",
  });
  await owner("POST", "/import", {}, 404);
  await stop();
  await boot();
  const persisted = await owner("GET", "/state");
  assert.equal(persisted.projects.length, 1);
  assert.equal(persisted.attachments.length, 1);
  const persistedActivity = await owner("GET", activityUrl);
  assert.equal(persistedActivity.comments.length, 1);
  assert.equal(
    persistedActivity.checklist[0].title,
    "Validar acessibilidade e contraste",
  );
  assert.ok(
    persistedActivity.history.some(
      (h) => h.payload.reason === "Membro removido do projeto",
    ),
  );
  assert.equal(persistedActivity.history.at(-1).kind, "task_created");
  assert.deepEqual(await owner("GET", "/attachments/" + attachment.id), png);
  await owner("POST", "/auth/logout");
  await owner("GET", "/state", undefined, 401);
  await owner("POST", "/auth/login", {
    email: "owner@example.com",
    password: "UmaSenhaForte123!",
  });
  let latest = (await owner("GET", "/state")).tasks.find(
    (x) => x.id === task.id,
  );
  await future(
    "POST",
    `/tasks/${task.id}/archive`,
    { revision: latest.revision },
    403,
  );
  await outsider(
    "POST",
    `/tasks/${task.id}/archive`,
    { revision: latest.revision },
    403,
  );
  await owner(
    "POST",
    `/tasks/${task.id}/archive`,
    { revision: latest.revision - 1 },
    409,
  );
  await owner("POST", `/tasks/${task.id}/archive`, {
    revision: latest.revision,
  });
  const archiveState = await owner("GET", "/state");
  assert.equal(
    archiveState.tasks.some((t) => t.id === task.id),
    false,
  );
  assert.equal(
    archiveState.attachments.some((t) => t.task_id === task.id),
    false,
  );
  assert.equal(archiveState.archived_count, 1);
  const stored = (await owner("GET", "/archive")).items.find(
    (t) => t.id === task.id,
  );
  assert.equal(stored.attachment_count, 1);
  assert.equal(stored.comment_count, 1);
  assert.equal(stored.checklist_total, 1);
  assert.equal(
    (await owner("GET", "/trash")).items.some((t) => t.id === task.id),
    false,
  );
  assert.equal((await outsider("GET", "/archive")).items.length, 0);
  await outsider("GET", `/archive/${task.id}`, undefined, 403);
  const details = await future("GET", `/archive/${task.id}`);
  assert.equal(details.task.title, latest.title);
  assert.equal(details.attachments.length, 1);
  assert.deepEqual(await future("GET", "/attachments/" + attachment.id), png);
  assert.equal((await future("GET", activityUrl)).comments.length, 1);
  await future(
    "POST",
    `/archive/${task.id}/restore`,
    { revision: stored.revision },
    403,
  );
  await owner(
    "PATCH",
    `/tasks/${task.id}`,
    { title: "Não editar arquivada", revision: stored.revision },
    409,
  );
  await owner(
    "DELETE",
    `/tasks/${task.id}?revision=${stored.revision}`,
    undefined,
    409,
  );
  await owner(
    "POST",
    `/tasks/${task.id}/archive`,
    { revision: stored.revision },
    409,
  );
  await stop();
  await boot();
  assert.equal(
    (await owner("GET", "/archive")).items.some((t) => t.id === task.id),
    true,
  );
  await owner(
    "POST",
    `/archive/${task.id}/restore`,
    { revision: latest.revision },
    409,
  );
  latest = await viewer("POST", `/archive/${task.id}/restore`, {
    revision: stored.revision,
  });
  assert.equal(
    (await owner("GET", "/state")).tasks.some((t) => t.id === task.id),
    true,
  );
  assert.equal((await owner("GET", "/archive")).items.length, 0);
  assert.equal(
    (await owner("GET", activityUrl)).history[0].kind,
    "task_unarchived",
  );
  assert.deepEqual(await owner("GET", "/attachments/" + attachment.id), png);
  await owner("DELETE", `/tasks/${task.id}?revision=${latest.revision}`);
  assert.equal(
    (await owner("GET", "/state")).tasks.some((t) => t.id === task.id),
    false,
  );
  let trashed = (await owner("GET", "/trash")).items.find(
    (t) => t.id === task.id,
  );
  assert.ok(trashed);
  assert.equal(trashed.attachment_count, 1);
  assert.equal(trashed.comment_count, 1);
  assert.equal(trashed.checklist_total, 1);
  assert.equal((await outsider("GET", "/trash")).items.length, 0);
  await future(
    "POST",
    `/trash/${task.id}/restore`,
    { revision: trashed.revision },
    403,
  );
  await viewer(
    "DELETE",
    `/trash/${task.id}?revision=${trashed.revision}`,
    undefined,
    403,
  );
  await owner(
    "POST",
    `/trash/${task.id}/restore`,
    { revision: latest.revision },
    409,
  );
  await owner("GET", "/attachments/" + attachment.id, undefined, 410);
  await owner("GET", activityUrl, undefined, 410);
  assert.equal(
    (await owner("GET", "/notifications")).items.some(
      (n) => n.task_id === task.id && n.kind !== "activity",
    ),
    false,
  );
  await stop();
  await boot();
  assert.ok((await owner("GET", "/trash")).items.some((t) => t.id === task.id));
  const restored = await viewer("POST", `/trash/${task.id}/restore`, {
    revision: trashed.revision,
  });
  assert.equal(restored.id, task.id);
  assert.deepEqual(await owner("GET", "/attachments/" + attachment.id), png);
  const restoredActivity = await owner("GET", activityUrl);
  assert.equal(restoredActivity.comments.length, 1);
  assert.equal(restoredActivity.checklist.length, 1);
  assert.equal(restoredActivity.history[0].kind, "task_restored");
  await owner(
    "DELETE",
    `/trash/${task.id}?revision=${restored.revision}`,
    undefined,
    404,
  );
  await owner("DELETE", `/tasks/${task.id}?revision=${restored.revision}`);
  trashed = (await owner("GET", "/trash")).items.find((t) => t.id === task.id);
  await owner("DELETE", `/trash/${task.id}?revision=${trashed.revision}`);
  await owner("GET", "/attachments/" + attachment.id, undefined, 404);
  await owner("GET", activityUrl, undefined, 404);
  await owner(
    "PATCH",
    "/checklist/" + item.id,
    { done: false, revision: item.revision },
    404,
  );
  const flex = await owner(
    "POST",
    "/projects",
    { name: "Fluxo personalizável" },
    201,
  );
  for (const [email, role] of [
    ["admin@example.com", "admin"],
    ["editor@example.com", "editor"],
    ["future@example.com", "viewer"],
  ])
    await owner("POST", `/projects/${flex.id}/members`, { email, role }, 201);
  let board = await owner("GET", `/projects/${flex.id}/columns`);
  assert.equal(board.columns.length, 4);
  const waiting = {
      id: "waiting",
      name: "Aguardando cliente",
      color: "#d79963",
      kind: "doing",
    },
    delivered = {
      id: "delivered",
      name: "Entregue",
      color: "#5aab88",
      kind: "done",
    };
  const nextColumns = [...board.columns, waiting, delivered];
  await editor(
    "PUT",
    `/projects/${flex.id}/columns`,
    { revision: board.revision, columns: nextColumns },
    403,
  );
  await future(
    "PUT",
    `/projects/${flex.id}/columns`,
    { revision: board.revision, columns: nextColumns },
    403,
  );
  await outsider("GET", `/projects/${flex.id}/columns`, undefined, 403);
  await owner(
    "PUT",
    `/projects/${flex.id}/columns`,
    {
      revision: board.revision,
      columns: [...board.columns, { ...waiting, name: "A fazer" }],
    },
    400,
  );
  const firstBoardRevision = board.revision;
  board = await admin("PUT", `/projects/${flex.id}/columns`, {
    revision: board.revision,
    columns: nextColumns,
  });
  await owner(
    "PUT",
    `/projects/${flex.id}/columns`,
    { revision: firstBoardRevision, columns: nextColumns },
    409,
  );
  let parent = await owner(
    "POST",
    "/tasks",
    {
      ...taskBody,
      title: "Entrega com responsáveis",
      project: flex.id,
      status: "waiting",
      assignee: a.id,
      date: businessDay(),
    },
    201,
  );
  const subInput = {
    title: "Preparar aplicações da marca",
    description: "Uma entrega específica",
    status: "waiting",
    assignee: o.id,
    date: businessDay(),
  };
  await future("POST", `/tasks/${parent.id}/subtasks`, subInput, 403);
  await outsider("POST", `/tasks/${parent.id}/subtasks`, subInput, 403);
  await editor(
    "POST",
    `/tasks/${parent.id}/subtasks`,
    { ...subInput, status: "nonexistent" },
    400,
  );
  await editor(
    "POST",
    `/tasks/${parent.id}/subtasks`,
    { ...subInput, assignee: "outside" },
    400,
  );
  await editor(
    "POST",
    `/tasks/${parent.id}/subtasks`,
    { ...subInput, date: "2026-02-31" },
    400,
  );
  let sub = await editor("POST", `/tasks/${parent.id}/subtasks`, subInput, 201);
  const secondChild = await editor(
    "POST",
    `/tasks/${parent.id}/subtasks`,
    {
      ...subInput,
      title: "Validação concluída",
      status: "delivered",
      assignee: e.id,
    },
    201,
  );
  const parentView = (await owner("GET", "/state")).tasks.find(
    (t) => t.id === parent.id,
  );
  assert.equal(parentView.subtask_total, 2);
  assert.equal(parentView.subtask_done, 1);
  assert.equal(parentView.revision, parent.revision);
  assert.ok(
    (await owner("GET", "/notifications")).items.some(
      (n) => n.subtask_id === sub.id && n.kind === "assignment",
    ),
  );
  assert.ok(
    (await owner("GET", "/notifications")).items.some(
      (n) => n.subtask_id === sub.id && n.kind === "due",
    ),
  );
  await future(
    "PATCH",
    "/subtasks/" + sub.id,
    { status: "done", revision: sub.revision },
    403,
  );
  const staleChildRevision = sub.revision;
  sub = await owner("PATCH", "/subtasks/" + sub.id, {
    title: "Preparar todas as aplicações",
    assignee: e.id,
    date: businessDay(-1),
    revision: sub.revision,
  });
  await editor(
    "PATCH",
    "/subtasks/" + sub.id,
    { status: "done", revision: staleChildRevision },
    409,
  );
  assert.ok(
    (await editor("GET", "/notifications")).items.some(
      (n) => n.subtask_id === sub.id && n.kind === "overdue",
    ),
  );
  board = await owner("PUT", `/projects/${flex.id}/columns`, {
    revision: board.revision,
    columns: board.columns.map((c) =>
      c.id === "waiting" ? { ...c, name: "Bloqueado" } : c,
    ),
  });
  await owner(
    "PATCH",
    "/subtasks/" + sub.id,
    { status: "done", revision: sub.revision },
    409,
  );
  let collab = await owner("GET", `/tasks/${parent.id}/collaboration`);
  sub = collab.subtasks.find((s) => s.id === sub.id);
  assert.ok(collab.history.some((h) => h.kind === "column_updated"));
  sub = await editor("PATCH", "/subtasks/" + sub.id, {
    status: "delivered",
    revision: sub.revision,
  });
  assert.equal(
    (await editor("GET", "/notifications")).items.some(
      (n) => n.subtask_id === sub.id && n.kind === "overdue",
    ),
    false,
  );
  assert.equal(
    (await owner("GET", "/state")).tasks.find((t) => t.id === parent.id)
      .subtask_done,
    2,
  );
  sub = await editor("PATCH", "/subtasks/" + sub.id, {
    status: "waiting",
    revision: sub.revision,
  });
  await editor("DELETE", `/subtasks/${sub.id}?revision=${sub.revision}`);
  let childTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === sub.id,
  );
  assert.equal(childTrash.entity_type, "subtask");
  assert.equal(childTrash.parent_task_id, parent.id);
  assert.equal(
    (await owner("GET", "/state")).tasks.find((t) => t.id === parent.id)
      .subtask_total,
    1,
  );
  let archived = await owner(
    "POST",
    "/tasks",
    {
      ...taskBody,
      title: "Tarefa arquivada nesta etapa",
      project: flex.id,
      status: "waiting",
      assignee: null,
    },
    201,
  );
  await owner("DELETE", `/tasks/${archived.id}?revision=${archived.revision}`);
  const withoutWaiting = board.columns
    .filter((c) => c.id !== "waiting")
    .map((c) => (c.id === "doing" ? { ...c, name: "Execução" } : c));
  const beforeInvalid = board.revision;
  await owner(
    "PUT",
    `/projects/${flex.id}/columns`,
    { revision: board.revision, columns: withoutWaiting },
    400,
  );
  assert.equal(
    (await owner("GET", `/projects/${flex.id}/columns`)).revision,
    beforeInvalid,
  );
  parent = (await owner("GET", "/state")).tasks.find((t) => t.id === parent.id);
  const parentBeforeMove = parent.revision;
  board = await owner("PUT", `/projects/${flex.id}/columns`, {
    revision: board.revision,
    columns: withoutWaiting,
    transfers: { waiting: "doing" },
  });
  parent = (await owner("GET", "/state")).tasks.find((t) => t.id === parent.id);
  assert.equal(parent.status, "doing");
  assert.equal(parent.revision, parentBeforeMove + 1);
  childTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === sub.id,
  );
  assert.equal(childTrash.status, "doing");
  await future(
    "POST",
    `/trash/subtasks/${sub.id}/restore`,
    { revision: childTrash.revision },
    403,
  );
  sub = await editor("POST", `/trash/subtasks/${sub.id}/restore`, {
    revision: childTrash.revision,
  });
  assert.equal(sub.status, "doing");
  assert.equal(
    (await owner("GET", `/tasks/${parent.id}/collaboration`)).subtasks.length,
    2,
  );
  const archivedTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === archived.id,
  );
  archived = await owner("POST", `/trash/${archived.id}/restore`, {
    revision: archivedTrash.revision,
  });
  assert.equal(archived.status, "doing");
  board = await owner("PUT", `/projects/${flex.id}/columns`, {
    revision: board.revision,
    columns: board.columns.filter((c) => c.id !== "todo"),
  });
  await stop();
  await boot();
  assert.equal(
    (await owner("GET", `/projects/${flex.id}/columns`)).columns.some(
      (c) => c.id === "todo",
    ),
    false,
  );
  board = await owner("PUT", `/projects/${flex.id}/columns`, {
    revision: board.revision,
    columns: board.columns.map((c) =>
      c.id === "doing" ? { ...c, kind: "done" } : c,
    ),
  });
  assert.equal(
    (await admin("GET", "/notifications")).items.some(
      (n) => n.task_id === parent.id && ["due", "overdue"].includes(n.kind),
    ),
    false,
  );
  await owner("DELETE", `/projects/${flex.id}/members/${e.id}`);
  collab = await owner("GET", `/tasks/${parent.id}/collaboration`);
  sub = collab.subtasks.find((s) => s.id === sub.id);
  assert.equal(sub.assignee, null);
  await editor(
    "PATCH",
    "/subtasks/" + sub.id,
    { status: "review", revision: sub.revision },
    403,
  );
  await owner("DELETE", `/subtasks/${sub.id}?revision=${sub.revision}`);
  childTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === sub.id,
  );
  await future(
    "DELETE",
    `/trash/subtasks/${sub.id}?revision=${childTrash.revision}`,
    undefined,
    403,
  );
  await admin(
    "DELETE",
    `/trash/subtasks/${sub.id}?revision=${childTrash.revision}`,
  );
  await owner(
    "PATCH",
    "/subtasks/" + sub.id,
    { status: "review", revision: childTrash.revision },
    404,
  );
  parent = (await owner("GET", "/state")).tasks.find((t) => t.id === parent.id);
  await owner("DELETE", `/tasks/${parent.id}?revision=${parent.revision}`);
  await owner(
    "PATCH",
    "/subtasks/" + secondChild.id,
    { title: "Sem acesso à tarefa na lixeira", revision: secondChild.revision },
    410,
  );
  const parentTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === parent.id,
  );
  await owner("DELETE", `/trash/${parent.id}?revision=${parentTrash.revision}`);
  await owner(
    "PATCH",
    "/subtasks/" + secondChild.id,
    { title: "Removida em cascata", revision: secondChild.revision },
    404,
  );
  // Multiple assignees, project naming and durable activity feed.
  let shared = await owner(
    "POST",
    "/tasks",
    {
      ...taskBody,
      project: flex.id,
      title: "Entrega compartilhada",
      status: "review",
      assignee: null,
      assignees: [o.id, a.id],
      date: businessDay(),
    },
    201,
  );
  assert.deepEqual(new Set(shared.assignees), new Set([o.id, a.id]));
  const inboxBeforeReorder = await admin("GET", "/notifications");
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    status: shared.status,
    position: shared.position + 5,
    revision: shared.revision,
  });
  const inboxAfterReorder = await admin("GET", "/notifications");
  assert.deepEqual(
    inboxAfterReorder.items.map((n) => n.id),
    inboxBeforeReorder.items.map((n) => n.id),
  );
  assert.equal(inboxAfterReorder.unread_count, inboxBeforeReorder.unread_count);
  const reorderEvent = (await owner("GET", `/activity?project=${flex.id}`))
    .items[0];
  assert.equal(reorderEvent.task_id, shared.id);
  assert.deepEqual(
    reorderEvent.payload.changes.map((c) => c.field),
    ["position"],
  );
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    status: "done",
    position: shared.position + 1,
    revision: shared.revision,
  });
  const moveNotice = (await admin("GET", "/notifications")).items.find(
    (n) =>
      n.kind === "activity" &&
      n.task_id === shared.id &&
      n.payload.changes?.some((c) => c.field === "status"),
  );
  assert.ok(moveNotice);
  assert.ok(moveNotice.payload.changes.some((c) => c.field === "position"));
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    status: "review",
    revision: shared.revision,
  });
  const eventCountBefore = (await owner("GET", `/activity?project=${flex.id}`))
    .items.length;
  await owner(
    "PATCH",
    `/tasks/${shared.id}`,
    { assignees: [o.id, "outsider"], revision: shared.revision },
    400,
  );
  assert.equal(
    (await owner("GET", `/activity?project=${flex.id}`)).items.length,
    eventCountBefore,
  );
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    description: "Dois responsáveis, uma mesma entrega",
    revision: shared.revision,
  });
  assert.deepEqual(new Set(shared.assignees), new Set([o.id, a.id]));
  assert.ok(
    (await admin("GET", "/notifications")).items.some(
      (n) => n.kind === "due" && n.task_id === shared.id,
    ),
  );
  await owner(
    "POST",
    `/projects/${flex.id}/members`,
    { email: "viewer@example.com", role: "viewer" },
    201,
  );
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    assignees: [o.id, a.id, v.id, o.id],
    revision: shared.revision,
  });
  assert.equal(shared.assignees.length, 3);
  assert.ok(
    (await viewer("GET", "/notifications")).items.some(
      (n) => n.kind === "assignment" && n.task_id === shared.id,
    ),
  );
  assert.ok(
    (await viewer("GET", "/notifications")).items.some(
      (n) => n.kind === "due" && n.task_id === shared.id,
    ),
  );
  const sharedSub = await owner(
    "POST",
    `/tasks/${shared.id}/subtasks`,
    {
      title: "Etapa com duas pessoas",
      status: "review",
      assignees: [o.id, a.id],
      date: businessDay(),
    },
    201,
  );
  assert.deepEqual(new Set(sharedSub.assignees), new Set([o.id, a.id]));
  const renamedSub = await admin("PATCH", `/subtasks/${sharedSub.id}`, {
    title: "Etapa revisada pelo time",
    revision: sharedSub.revision,
  });
  assert.deepEqual(new Set(renamedSub.assignees), new Set([o.id, a.id]));
  let currentProject = (await owner("GET", "/state")).projects.find(
    (p) => p.id === flex.id,
  );
  const projectRevision = currentProject.revision;
  await viewer(
    "PATCH",
    `/projects/${flex.id}`,
    { name: "Não permitido", revision: projectRevision },
    403,
  );
  const renamed = await admin("PATCH", `/projects/${flex.id}`, {
    name: "Projeto com várias pessoas",
    revision: projectRevision,
    user_id: o.id,
  });
  assert.equal(renamed.revision, projectRevision + 1);
  await owner(
    "PATCH",
    `/projects/${flex.id}`,
    { name: "Sobrescrever", revision: projectRevision },
    409,
  );
  const newFeed = await viewer("GET", `/activity?project=${flex.id}`);
  const nameEvent = newFeed.items.find(
    (e) =>
      e.kind === "project_updated" &&
      e.payload.changes?.some((c) => c.field === "name"),
  );
  assert.ok(nameEvent);
  assert.equal(nameEvent.actor_name, "Administrador");
  assert.equal(nameEvent.user_id, a.id);
  assert.ok(nameEvent.created);
  assert.equal(
    nameEvent.payload.changes.find((c) => c.field === "name").after,
    "Projeto com várias pessoas",
  );
  const renameNotice = (await owner("GET", "/notifications")).items.find(
    (n) =>
      n.kind === "activity" &&
      n.action_kind === "project_updated" &&
      n.payload.changes?.some((c) => c.field === "name"),
  );
  assert.ok(renameNotice);
  assert.equal(renameNotice.task_id, null);
  await outsider(
    "PATCH",
    `/notifications/${renameNotice.id}`,
    { read: true },
    404,
  );
  await owner("PATCH", `/notifications/${renameNotice.id}`, { read: true });
  assert.ok(
    (await owner("GET", "/notifications")).items.find(
      (n) => n.id === renameNotice.id,
    ).read_at,
  );
  assert.equal(
    (await outsider("GET", `/activity?project=${flex.id}`)).items.length,
    0,
  );
  const latestCursor = (await owner("GET", "/state")).activity_cursor;
  await owner("PATCH", `/projects/${flex.id}`, {
    name: "Projeto com várias pessoas",
    revision: renamed.revision,
  });
  assert.equal((await owner("GET", "/state")).activity_cursor, latestCursor);
  await owner("DELETE", `/projects/${flex.id}/members/${v.id}`);
  shared = (await owner("GET", "/state")).tasks.find((t) => t.id === shared.id);
  assert.deepEqual(new Set(shared.assignees), new Set([o.id, a.id]));
  assert.equal(
    (await viewer("GET", `/activity?project=${flex.id}`)).items.length,
    0,
  );
  shared = await owner("PATCH", `/tasks/${shared.id}`, {
    assignees: [a.id],
    revision: shared.revision,
  });
  assert.deepEqual(shared.assignees, [a.id]);
  await owner("DELETE", `/tasks/${shared.id}?revision=${shared.revision}`);
  const sharedTrash = (await owner("GET", "/trash")).items.find(
    (t) => t.id === shared.id,
  );
  await owner("DELETE", `/trash/${shared.id}?revision=${sharedTrash.revision}`);
  let permanentFeed = await admin(
    "GET",
    `/activity?project=${flex.id}&search=${encodeURIComponent("Entrega compartilhada")}`,
  );
  assert.ok(
    permanentFeed.items.some(
      (e) =>
        e.kind === "task_removed" &&
        e.task_id === shared.id &&
        !e.task_available,
    ),
  );
  assert.ok(permanentFeed.items.some((e) => e.kind === "task_created"));
  assert.ok(
    (await admin("GET", "/notifications")).items.some(
      (n) =>
        n.kind === "activity" && n.action_kind === "task_removed" && !n.task_id,
    ),
  );
  const feedCount = permanentFeed.items.length;
  await stop();
  await boot();
  permanentFeed = await admin(
    "GET",
    `/activity?project=${flex.id}&search=${encodeURIComponent("Entrega compartilhada")}`,
  );
  assert.equal(permanentFeed.items.length, feedCount);
  assert.ok(
    (await owner("GET", "/notifications")).items.find(
      (n) => n.id === renameNotice.id,
    ).read_at,
  );
  await owner("POST", "/import", {}, 404);
  await owner("GET", "/export", undefined, 404);
  const demoA = client(),
    demoB = client();
  assert.equal((await demoA("GET", "/demo/profiles")).profiles.length, 4);
  const demoOwner = (await demoA("POST", "/demo/login", { role: "owner" }))
    .user;
  assert.equal(demoOwner.is_demo, true);
  const demoState = await demoA("GET", "/state");
  assert.equal(demoState.projects.length, 1);
  assert.equal(demoState.projects[0].role, "owner");
  assert.equal(demoState.members.length, 4);
  assert.equal(demoState.tasks.length, 8);
  assert.equal((await demoA("GET", "/trash")).items.length, 2);
  assert.ok((await demoA("GET", "/notifications")).items.length > 0);
  await demoA("POST", "/projects", { name: "Não misturar" }, 403);
  await demoA("POST", "/import", {}, 404);
  await demoA("POST", "/invitations/unknown/accept", {}, 403);
  await demoA(
    "POST",
    `/projects/${demoState.projects[0].id}/members`,
    { email: "owner@example.com", role: "editor" },
    403,
  );
  await owner(
    "POST",
    `/projects/${project.id}/members`,
    { email: demoOwner.email, role: "editor" },
    403,
  );
  await owner(
    "GET",
    `/tasks/${demoState.tasks[0].id}/collaboration`,
    undefined,
    403,
  );
  await demoA("GET", `/tasks/${dueTask.id}/collaboration`, undefined, 403);
  await demoB("POST", "/demo/login", { role: "owner" });
  const otherDemo = await demoB("GET", "/state");
  assert.notEqual(otherDemo.projects[0].id, demoState.projects[0].id);
  await demoB(
    "GET",
    `/tasks/${demoState.tasks[0].id}/collaboration`,
    undefined,
    403,
  );
  const demoViewer = (await demoA("POST", "/demo/login", { role: "viewer" }))
    .user;
  assert.equal(demoViewer.demo_role, "viewer");
  assert.equal(
    (await demoA("GET", "/state")).projects[0].id,
    demoState.projects[0].id,
  );
  await demoA(
    "POST",
    "/tasks",
    { ...taskBody, project: demoState.projects[0].id, assignee: null },
    403,
  );
  await demoA("POST", "/demo/login", { role: "editor" });
  const demoTask = await demoA(
    "POST",
    "/tasks",
    {
      ...taskBody,
      title: "Minha tarefa de demonstração",
      project: demoState.projects[0].id,
      assignee: null,
    },
    201,
  );
  assert.ok(
    (await demoA("GET", "/state")).tasks.some((t) => t.id === demoTask.id),
  );
  await demoA("POST", "/demo/login", { role: "admin" });
  assert.equal((await demoA("GET", "/state")).projects[0].role, "admin");
  await demoA(
    "PATCH",
    `/projects/${demoState.projects[0].id}/members/${demoViewer.id}`,
    { role: "admin" },
    403,
  );
  await stop();
  await boot({ DEMO_ENABLED: "false" });
  assert.equal((await demoA("GET", "/demo/profiles")).enabled, false);
  await demoA("POST", "/demo/login", { role: "owner" }, 404);
  await demoA("GET", "/state", undefined, 401);
  assert.ok(
    (await owner("GET", "/state")).projects.some((p) => p.id === project.id),
  );
  console.log(
    "Verificados: contas, isolamento, papéis, responsáveis múltiplos, renomeação, atividades/notificações, persistência, conflitos e exclusão com log preservado.",
  );
});

test("atualização de banco anterior preserva contas, responsáveis e histórico e incorpora o registro sem alertas retroativos", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "clickdown-test-upgrade-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    const resolved = path.resolve(temp);
    assert.ok(
      resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
        path.basename(resolved).startsWith("clickdown-test-upgrade-"),
    );
    await rm(resolved, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(path.join(temp, "clickdown.sqlite"));
  legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',lead_id TEXT,created TEXT NOT NULL);
 CREATE TABLE members (project_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(project_id,user_id));
 CREATE TABLE tasks (id TEXT PRIMARY KEY,project TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,priority TEXT NOT NULL,tag TEXT NOT NULL,date TEXT NOT NULL,assignee TEXT,position REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);`);
  legacy
    .prepare("INSERT INTO users VALUES (?,?,?,?,?)")
    .run(
      "legacy-user",
      "Equipe anterior",
      "old@example.com",
      "preservar-hash",
      "2026-01-01",
    );
  legacy
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(
      createHash("sha256").update("legacy-session").digest("hex"),
      "legacy-user",
      Date.now() + 60000,
    );
  legacy
    .prepare("INSERT INTO projects VALUES (?,?,?,?,?,?)")
    .run(
      "legacy-project",
      "Projeto anterior",
      "#8974eb",
      "",
      "legacy-user",
      "2026-01-01",
    );
  legacy
    .prepare("INSERT INTO members VALUES (?,?,?)")
    .run("legacy-project", "legacy-user", "owner");
  legacy
    .prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      "legacy-task",
      "legacy-project",
      "Preservar minha tarefa",
      "Contexto importante",
      "doing",
      "Alta",
      "Design",
      "2026-12-01",
      "legacy-user",
      12,
      7,
      "2026-01-01",
      "2026-01-02",
    );
  legacy.exec(
    `CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,user_id TEXT NOT NULL,actor_name TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);`,
  );
  legacy
    .prepare(
      "INSERT INTO history (task_id,user_id,actor_name,kind,payload,created) VALUES (?,?,?,?,?,?)",
    )
    .run(
      "legacy-task",
      "legacy-user",
      "Equipe anterior",
      "task_updated",
      JSON.stringify({
        changes: [{ field: "status", before: "todo", after: "doing" }],
      }),
      "2026-01-02T12:34:56.000Z",
    );
  legacy
    .prepare("INSERT INTO users VALUES (?,?,?,?,?)")
    .run(
      "legacy-other",
      "Pessoa da equipe",
      "other@example.com",
      "hash-existente",
      "2026-01-01",
    );
  legacy
    .prepare("INSERT INTO members VALUES (?,?,?)")
    .run("legacy-project", "legacy-other", "viewer");
  legacy
    .prepare("INSERT INTO sessions VALUES (?,?,?)")
    .run(
      createHash("sha256").update("legacy-other-session").digest("hex"),
      "legacy-other",
      Date.now() + 60000,
    );
  legacy.close();
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  child = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, DATA_DIR: temp, PORT: String(port) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + "/auth/me");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.equal(ready, true);
  const headers = {
    cookie: "cd_session=legacy-session",
    "Content-Type": "application/json",
  };
  const state = await (await fetch(base + "/state", { headers })).json();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, "Preservar minha tarefa");
  assert.equal(state.tasks[0].revision, 7);
  assert.deepEqual(state.tasks[0].assignees, ["legacy-user"]);
  assert.equal(state.tasks[0].checklist_total, 0);
  assert.equal(state.projects[0].role, "owner");
  const activity = await (
    await fetch(base + "/tasks/legacy-task/collaboration", { headers })
  ).json();
  assert.equal(activity.history.length, 1);
  assert.deepEqual(activity.comments, []);
  const projectLog = await (
    await fetch(base + "/activity?project=legacy-project", { headers })
  ).json();
  assert.equal(projectLog.items.length, 1);
  assert.equal(projectLog.items[0].actor_name, "Equipe anterior");
  assert.equal(projectLog.items[0].created, "2026-01-02T12:34:56.000Z");
  const otherInbox = await (
    await fetch(base + "/notifications", {
      headers: { cookie: "cd_session=legacy-other-session" },
    })
  ).json();
  assert.equal(otherInbox.items.length, 0);
  const added = await fetch(base + "/tasks/legacy-task/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ body: "Continuando de onde paramos." }),
  });
  assert.equal(added.status, 201);
  const after = await (
    await fetch(base + "/tasks/legacy-task/collaboration", { headers })
  ).json();
  assert.equal(after.history.length, 2);
  assert.equal(after.history[0].kind, "comment_added");
});
