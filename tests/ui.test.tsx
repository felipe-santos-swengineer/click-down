import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:5173",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FormData",
  "localStorage",
  "location",
  "history",
])
  Object.defineProperty(globalThis, key, {
    value: (dom.window as any)[key],
    configurable: true,
    writable: true,
  });
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).matchMedia = () => ({ matches: false });
(globalThis as any).confirm = () => true;
(globalThis as any).requestAnimationFrame = (fn: () => void) =>
  setTimeout(fn, 0);
const { render, screen, within, cleanup, waitFor } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { Auth, TaskDialog, ProjectDialog } = await import("../src/components");
const { Workspace, App } = await import("../src/App");
const { TaskCollaboration } = await import("../src/TaskCollaboration");
const { NotificationCenter, TrashView } = await import("../src/InboxAndTrash");
const { BoardColumnsDialog } = await import("../src/BoardsAndSubtasks");
const { columns: defaultColumns } = await import("../src/types");
const { ProjectActivity } = await import("../src/ProjectActivity");
const user = { id: "u1", name: "Ana Silva", email: "ana@example.com" };
const members = [
  { ...user, project_id: "p1", role: "owner" as const },
  {
    id: "u2",
    name: "Bruno Lima",
    email: "bruno@example.com",
    project_id: "p1",
    role: "editor" as const,
  },
];
const project = {
  id: "p1",
  name: "Novo produto",
  description: "Uma equipe conectada",
  color: "#8974eb",
  lead_id: "u1",
  role: "owner" as const,
};
const task = {
  id: "t1",
  project: "p1",
  title: "Desenhar experiência",
  description: "Uma experiência acessível",
  status: "todo" as const,
  priority: "Alta",
  tag: "Design",
  date: "2026-11-30",
  assignee: "u1",
  position: 1,
  revision: 1,
};
const task2 = {
  ...task,
  id: "t2",
  title: "Revisar conteúdo",
  priority: "Baixa",
  tag: "Conteúdo",
  assignee: "u2",
  position: 2,
};
function respond(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const emptyCollaboration = {
  current_user_id: "u1",
  comments: [],
  checklist: [],
  history: [],
};
const snapshot = {
  projects: [project],
  tasks: [task, task2],
  members,
  invitations: [],
  attachments: [],
  migrated: false,
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  history.replaceState(null, "", "/");
  (globalThis as any).confirm = () => true;
});

test("cadastro e login enviam os dados e exibem falhas recuperáveis", async () => {
  const input = userEvent.setup();
  const requests: any[] = [];
  let logged = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/demo/profiles"))
      return respond({ enabled: false, profiles: [] });
    requests.push({ url, body: JSON.parse(String(options?.body)) });
    return requests.length === 1
      ? respond({ error: "E-mail ou senha incorretos." }, 401)
      : respond({ user });
  };
  render(
    <Auth
      onLogin={() => {
        logged = true;
      }}
    />,
  );
  await input.type(screen.getByLabelText("E-mail"), "ana@example.com");
  await input.type(screen.getByLabelText("Senha"), "SenhaIncorreta");
  await input.click(
    screen.getByRole("button", { name: "Entrar no workspace" }),
  );
  assert.match((await screen.findByRole("alert")).textContent!, /incorretos/);
  assert.equal(logged, false);
  await input.click(
    screen.getByRole("button", { name: "Criar conta gratuita" }),
  );
  await input.type(screen.getByLabelText("Seu nome"), "Ana Silva");
  await input.click(screen.getByRole("button", { name: "Criar minha conta" }));
  await waitFor(() => assert.equal(logged, true));
  assert.equal(requests[1].url, "/api/auth/register");
  assert.equal(requests[1].body.name, "Ana Silva");
});

test("quadro filtra tarefas por texto, prioridade, responsável e minhas tarefas", async () => {
  globalThis.fetch = async () => respond(snapshot);
  const input = userEvent.setup();
  render(
    <Workspace
      user={user}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("button", {
    name: "Abrir tarefa Desenhar experiência",
  });
  assert.ok(
    screen.getByRole("button", { name: "Abrir tarefa Revisar conteúdo" }),
  );
  await input.type(screen.getByLabelText("Buscar tarefas"), "conteúdo");
  assert.equal(
    screen.queryByRole("button", { name: "Abrir tarefa Desenhar experiência" }),
    null,
  );
  assert.ok(
    screen.getByRole("button", { name: "Abrir tarefa Revisar conteúdo" }),
  );
  await input.click(screen.getByRole("button", { name: "Limpar" }));
  await input.selectOptions(
    screen.getByLabelText("Filtrar prioridade"),
    "Alta",
  );
  assert.equal(
    screen.queryByRole("button", { name: "Abrir tarefa Revisar conteúdo" }),
    null,
  );
  await input.click(screen.getByRole("button", { name: "Limpar" }));
  await input.selectOptions(screen.getByLabelText("Filtrar responsável"), "u2");
  assert.equal(
    screen.queryByRole("button", { name: "Abrir tarefa Desenhar experiência" }),
    null,
  );
  await input.click(screen.getByRole("button", { name: "Limpar" }));
  await input.click(screen.getByRole("button", { name: /Minhas tarefas/ }));
  assert.ok(
    screen.getByRole("button", { name: "Abrir tarefa Desenhar experiência" }),
  );
  assert.equal(
    screen.queryByRole("button", { name: "Abrir tarefa Revisar conteúdo" }),
    null,
  );
});

test("leitor consulta tarefas e anexos sem controles de escrita", async () => {
  const viewerProject = { ...project, role: "viewer" as const };
  const input = userEvent.setup();
  globalThis.fetch = async (url) =>
    respond(
      String(url).endsWith("/collaboration")
        ? emptyCollaboration
        : { ...snapshot, projects: [viewerProject] },
    );
  render(
    <Workspace
      user={user}
      theme="dark"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("button", {
    name: "Abrir tarefa Desenhar experiência",
  });
  assert.equal(screen.queryByRole("button", { name: "Nova tarefa" }), null);
  assert.match(screen.getByText(/acesso de leitura/).textContent!, /leitura/);
  await input.click(
    screen.getByRole("button", { name: "Abrir tarefa Desenhar experiência" }),
  );
  const dialog = screen.getByRole("dialog");
  assert.equal(
    (within(dialog).getByLabelText("Título") as HTMLInputElement).matches(
      ":disabled",
    ),
    true,
  );
  assert.equal(
    within(dialog).queryByRole("button", { name: "Salvar tarefa" }),
    null,
  );
  assert.equal(within(dialog).queryByRole("button", { name: "Excluir" }), null);
  assert.equal(
    within(dialog).queryByRole("button", { name: "Adicionar arquivo" }),
    null,
  );
});

test("nova tarefa salva responsável e transita para edição; conflito exibe erro", async () => {
  let saved: any;
  let created: any;
  const input = userEvent.setup();
  globalThis.fetch = async (url, options) => {
    saved = JSON.parse(String(options?.body));
    return respond({ ...saved, id: "created", revision: 1 }, 201);
  };
  const result = render(
    <TaskDialog
      task={{ ...task, id: "", title: "", revision: 0 }}
      project={project}
      members={members}
      attachments={[]}
      close={() => {}}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={(t) => {
        created = t;
      }}
    />,
  );
  await input.type(screen.getByLabelText("Título"), "Planejar lançamento");
  await input.click(
    within(
      screen.getByRole("group", { name: "Responsáveis pela tarefa" }),
    ).getByRole("checkbox", { name: "Selecionar Ana Silva" }),
  );
  await input.click(
    within(
      screen.getByRole("group", { name: "Responsáveis pela tarefa" }),
    ).getByRole("checkbox", { name: "Selecionar Bruno Lima" }),
  );
  await input.click(screen.getByRole("button", { name: "Salvar tarefa" }));
  await waitFor(() => assert.ok(created));
  assert.deepEqual(saved.assignees, ["u2"]);
  assert.equal(saved.title, "Planejar lançamento");
  assert.equal(created.id, "created");
  result.unmount();
  globalThis.fetch = async (url) =>
    String(url).endsWith("/collaboration")
      ? respond(emptyCollaboration)
      : respond({ error: "Esta tarefa foi alterada por outra pessoa." }, 409);
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      close={() => {}}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {}}
    />,
  );
  await input.click(screen.getByRole("button", { name: "Salvar tarefa" }));
  assert.match(
    (await screen.findByRole("alert")).textContent!,
    /alterada por outra pessoa/,
  );
  assert.ok(screen.getByRole("dialog"));
});

test("gestão de equipe respeita limites de administrador e mostra link de convite", async () => {
  render(
    <ProjectDialog
      project={{ ...project, role: "admin" }}
      members={[
        ...members,
        {
          id: "u3",
          name: "Outro admin",
          email: "admin@example.com",
          role: "admin",
          project_id: "p1",
        },
      ]}
      invitations={[
        {
          id: "secret-link",
          project_id: "p1",
          email: "nova@example.com",
          role: "editor",
        },
      ]}
      close={() => {}}
      refresh={async () => {}}
      onSaved={() => {}}
    />,
  );
  assert.equal(screen.queryByLabelText("Papel de Ana Silva"), null);
  assert.equal(screen.queryByLabelText("Papel de Outro admin"), null);
  assert.ok(screen.getByLabelText("Papel de Bruno Lima"));
  assert.equal(
    within(screen.getByLabelText("Papel do novo membro")).queryByRole(
      "option",
      { name: "Administrador" },
    ),
    null,
  );
  assert.ok(screen.getByRole("button", { name: "Copiar link" }));
});

test("tema escuro e claro persistem após remontar a aplicação", async () => {
  globalThis.fetch = async () => respond({ error: "Entre na conta" }, 401);
  const input = userEvent.setup();
  const result = render(<App />);
  await screen.findByRole("heading", { name: "Entrar" });
  assert.equal(document.documentElement.dataset.theme, "light");
  await input.click(screen.getByRole("button", { name: "Ativar tema escuro" }));
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(localStorage.getItem("clickdown-theme"), "dark");
  result.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: "Entrar" });
  assert.equal(document.documentElement.dataset.theme, "dark");
});

test("checklist, menções por teclado e histórico funcionam juntos sem perder rascunhos", async () => {
  const input = userEvent.setup();
  let collaboration: any = {
    ...emptyCollaboration,
    comments: [],
    checklist: [],
    history: [],
  };
  const sent: any[] = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (path.endsWith("/collaboration")) return respond(collaboration);
    sent.push({ path, method: options?.method, body });
    if (path.endsWith("/comments")) {
      const comment = {
        id: "c1",
        task_id: "t1",
        user_id: "u1",
        author_name: "Ana Silva",
        created: "2026-11-13T12:00:00Z",
        body: body.body,
        mentions: body.mentions
          .map((id: string) => members.find((m) => m.id === id))
          .map((m: any) => ({ id: m.id, name: m.name })),
      };
      collaboration = { ...collaboration, comments: [comment] };
      return respond(comment, 201);
    }
    if (path.endsWith("/checklist")) {
      const item = {
        id: "i1",
        task_id: "t1",
        title: body.title,
        done: false,
        revision: 1,
        created: "2026-11-13T12:00:00Z",
      };
      collaboration = { ...collaboration, checklist: [item] };
      return respond(item, 201);
    }
    if (path.endsWith("/checklist/i1")) {
      const item = {
        ...collaboration.checklist[0],
        done: body.done,
        revision: 2,
      };
      collaboration = {
        ...collaboration,
        checklist: [item],
        history: [
          {
            id: 1,
            task_id: "t1",
            user_id: "u1",
            actor_name: "Ana Silva",
            kind: "checklist_completed",
            payload: { title: item.title },
            created: "2026-11-13T12:01:00Z",
          },
        ],
      };
      return respond(item);
    }
    return respond({});
  };
  render(
    <TaskCollaboration
      taskId="t1"
      members={members}
      editable
      refresh={async () => {}}
      refreshKey="1"
      onDraftStateChange={() => {}}
    />,
  );
  await screen.findByText("Nenhum item no checklist.");
  await input.type(
    screen.getByLabelText("Novo item do checklist"),
    "Revisar contraste",
  );
  await input.click(screen.getByRole("button", { name: "Adicionar item" }));
  const checkbox = await screen.findByRole("checkbox", {
    name: "Revisar contraste",
  });
  await waitFor(() =>
    assert.equal((checkbox as HTMLInputElement).disabled, false),
  );
  await input.click(checkbox);
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("checkbox") as HTMLInputElement).checked,
      true,
    ),
  );
  assert.equal(
    screen.getByRole("progressbar").getAttribute("aria-valuenow"),
    "1",
  );
  await input.type(
    screen.getByLabelText("Compartilhe uma atualização"),
    "Revisar com @Br",
  );
  await screen.findByRole("button", { name: "Mencionar Bruno Lima" });
  await input.keyboard("{Enter}");
  await waitFor(() =>
    assert.match(
      (
        screen.getByLabelText(
          "Compartilhe uma atualização",
        ) as HTMLTextAreaElement
      ).value,
      /@Bruno Lima/,
    ),
  );
  await input.type(
    screen.getByLabelText("Compartilhe uma atualização"),
    "<script>alert(1)</script>",
  );
  await input.click(screen.getByRole("button", { name: "Comentar" }));
  await screen.findByText("@Bruno Lima", { selector: "mark" });
  assert.equal(
    sent.find((r) => r.path.endsWith("/comments")).body.mentions[0],
    "u2",
  );
  assert.equal(document.querySelector("script"), null);
  assert.match(
    document.querySelector(".comment-body")!.textContent!,
    /<script>/,
  );
  await waitFor(() =>
    assert.equal(
      (
        screen.getByLabelText(
          "Compartilhe uma atualização",
        ) as HTMLTextAreaElement
      ).disabled,
      false,
    ),
  );
  await input.type(
    screen.getByLabelText("Compartilhe uma atualização"),
    "Rascunho preservado",
  );
  await input.click(screen.getByRole("tab", { name: /Histórico/ }));
  assert.ok(screen.getByText(/concluiu um item do checklist/));
  await input.click(screen.getByRole("tab", { name: /Comentários/ }));
  assert.equal(
    (
      screen.getByLabelText(
        "Compartilhe uma atualização",
      ) as HTMLTextAreaElement
    ).value,
    "Rascunho preservado",
  );
});

test("leitores veem menções e histórico, mas não podem comentar nem alterar checklist", async () => {
  const input = userEvent.setup();
  globalThis.fetch = async () =>
    respond({
      current_user_id: "u1",
      comments: [
        {
          id: "c1",
          task_id: "t1",
          user_id: "u2",
          author_name: "Bruno Lima",
          body: "Confira, @Ana Silva",
          mentions: [{ id: "u1", name: "Ana Silva" }],
          created: "2026-11-13T12:00:00Z",
        },
      ],
      checklist: [
        {
          id: "i1",
          task_id: "t1",
          title: "Validar layout",
          done: false,
          revision: 1,
        },
      ],
      history: [
        {
          id: 1,
          task_id: "t1",
          actor_name: "Bruno Lima",
          kind: "task_updated",
          payload: {
            changes: [{ field: "status", before: "todo", after: "doing" }],
          },
          created: "2026-11-13T12:00:00Z",
        },
      ],
    });
  render(
    <TaskCollaboration
      taskId="t1"
      members={members}
      editable={false}
      refresh={async () => {}}
      refreshKey="1"
      onDraftStateChange={() => {}}
    />,
  );
  await screen.findByText("Mencionou você");
  assert.ok(screen.getByText("@Ana Silva", { selector: "mark" }));
  assert.equal(
    (
      screen.getByRole("checkbox", {
        name: "Validar layout",
      }) as HTMLInputElement
    ).disabled,
    true,
  );
  assert.equal(screen.queryByRole("button", { name: "Comentar" }), null);
  assert.equal(screen.queryByLabelText("Novo item do checklist"), null);
  await input.click(screen.getByRole("tab", { name: /Histórico/ }));
  assert.ok(screen.getByText("A fazer"));
  assert.ok(screen.getByText("Em andamento"));
});

test("fechar tarefa protege comentário não enviado e salvar detalhes preserva o rascunho", async () => {
  let closed = false;
  let saved = false;
  let confirmations = 0;
  const input = userEvent.setup();
  globalThis.fetch = async (url, options) =>
    String(url).endsWith("/collaboration")
      ? respond(emptyCollaboration)
      : respond({ ...task, ...JSON.parse(String(options?.body)), revision: 2 });
  (globalThis as any).confirm = () => {
    confirmations++;
    return false;
  };
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      close={() => {
        closed = true;
      }}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {
        saved = true;
      }}
    />,
  );
  const comment = await screen.findByLabelText("Compartilhe uma atualização");
  await input.type(comment, "Preciso terminar esta ideia");
  await input.click(screen.getByRole("button", { name: "Fechar diálogo" }));
  assert.equal(closed, false);
  assert.equal(confirmations, 1);
  await input.click(screen.getByRole("button", { name: "Salvar tarefa" }));
  await waitFor(() => assert.equal(saved, true));
  assert.equal(closed, false);
  assert.equal(
    (comment as HTMLTextAreaElement).value,
    "Preciso terminar esta ideia",
  );
});

test("conflito no checklist atualiza a lista e erro em comentário mantém texto para tentar novamente", async () => {
  const input = userEvent.setup();
  let reads = 0;
  const getState = () => ({
    ...emptyCollaboration,
    checklist: [
      {
        id: "i1",
        task_id: "t1",
        title: "Validar layout",
        done: reads > 1,
        revision: reads > 1 ? 2 : 1,
      },
    ],
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/collaboration")) {
      reads++;
      return respond(getState());
    }
    return respond(
      { error: "Outra pessoa alterou a atividade. Confira a versão atual." },
      409,
    );
  };
  render(
    <TaskCollaboration
      taskId="t1"
      members={members}
      editable
      refresh={async () => {}}
      refreshKey="1"
      onDraftStateChange={() => {}}
    />,
  );
  const checkbox = await screen.findByRole("checkbox", {
    name: "Validar layout",
  });
  await input.click(checkbox);
  await screen.findByRole("alert");
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("checkbox") as HTMLInputElement).checked,
      true,
    ),
  );
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("checkbox") as HTMLInputElement).disabled,
      false,
    ),
  );
  await input.type(
    screen.getByLabelText("Compartilhe uma atualização"),
    "Texto que não pode se perder",
  );
  await input.click(screen.getByRole("button", { name: "Comentar" }));
  await waitFor(() =>
    assert.equal(
      (
        screen.getByLabelText(
          "Compartilhe uma atualização",
        ) as HTMLTextAreaElement
      ).disabled,
      false,
    ),
  );
  assert.equal(
    (
      screen.getByLabelText(
        "Compartilhe uma atualização",
      ) as HTMLTextAreaElement
    ).value,
    "Texto que não pode se perder",
  );
});

test("perfis demo entram sem preencher login e permitem escolher os quatro papéis", async () => {
  const input = userEvent.setup();
  const logins: string[] = [];
  const roles = [
    ["owner", "Ana Costa", "Proprietária"],
    ["admin", "Bruno Lima", "Administrador"],
    ["editor", "Clara Souza", "Editora"],
    ["viewer", "Diego Alves", "Leitor"],
  ];
  const profiles = roles.map(([role, name, title]) => ({
    role,
    name,
    title,
    description: "Teste as permissões deste perfil.",
  }));
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/demo/profiles"))
      return respond({ enabled: true, profiles });
    assert.equal(String(url), "/api/demo/login");
    const role = JSON.parse(String(options?.body)).role;
    logins.push(role);
    return respond({ user: { ...user, is_demo: true, demo_role: role } });
  };
  const received: any[] = [];
  render(<Auth onLogin={(u) => received.push(u)} />);
  await screen.findByRole("button", { name: "Experimentar como Proprietária" });
  for (const [role, , title] of roles) {
    await input.click(
      screen.getByRole("button", { name: "Experimentar como " + title }),
    );
    await waitFor(() => assert.equal(received.at(-1)?.demo_role, role));
  }
  assert.deepEqual(logins, ["owner", "admin", "editor", "viewer"]);
  assert.equal((screen.getByLabelText("E-mail") as HTMLInputElement).value, "");
});

test("workspace mostra notificações não lidas e troca de perfil demo sem reaproveitar identidade", async () => {
  const input = userEvent.setup();
  let switched: any;
  const demoUser = { ...user, is_demo: true, demo_role: "owner" as const };
  globalThis.fetch = async (url, options) =>
    String(url).endsWith("/demo/login")
      ? respond({
          user: {
            ...demoUser,
            id: "new-demo-user",
            demo_role: JSON.parse(String(options?.body)).role,
          },
        })
      : respond({ ...snapshot, unread_notifications: 3, trash_count: 2 });
  render(
    <Workspace
      user={demoUser}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
      onSwitchUser={(u) => {
        switched = u;
      }}
    />,
  );
  await screen.findByRole("button", { name: "Notificações: 3 não lidas" });
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Adicionar projeto",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  await input.selectOptions(
    screen.getByLabelText("Trocar perfil demo"),
    "editor",
  );
  await waitFor(() => assert.equal(switched.demo_role, "editor"));
  assert.equal(switched.id, "new-demo-user");
});

test("notificações filtram não lidas, marcam leitura e abrem a tarefa correta", async () => {
  const input = userEvent.setup();
  let opened = "";
  let refreshes = 0;
  let notices: any[] = [
    {
      id: 2,
      user_id: "u1",
      task_id: "t1",
      kind: "mention",
      actor_name: "Bruno Lima",
      due_date: null,
      created: "2026-11-13T12:00:00Z",
      read_at: null,
      task_title: task.title,
      project_id: "p1",
      project_name: project.name,
    },
    {
      id: 1,
      user_id: "u1",
      task_id: "t2",
      kind: "assignment",
      actor_name: "Bruno Lima",
      due_date: null,
      created: "2026-11-13T11:00:00Z",
      read_at: null,
      task_title: task2.title,
      project_id: "p1",
      project_name: project.name,
    },
  ];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (options?.method === "PATCH") {
      const id = Number(path.split("/").at(-1));
      const read = JSON.parse(String(options.body)).read;
      notices = notices.map((n) =>
        n.id === id
          ? { ...n, read_at: read ? "2026-11-13T13:00:00Z" : null }
          : n,
      );
      return respond({ ok: true });
    }
    if (path.endsWith("/read-all")) {
      notices = notices.map((n) => ({ ...n, read_at: "2026-11-13T13:00:00Z" }));
      return respond({ ok: true });
    }
    return respond({
      items: path.includes("unread=1")
        ? notices.filter((n) => !n.read_at)
        : notices,
      unread_count: notices.filter((n) => !n.read_at).length,
      has_more: false,
    });
  };
  render(
    <NotificationCenter
      close={() => {}}
      refresh={async () => {
        refreshes++;
      }}
      openTask={async (id) => {
        opened = id;
      }}
    />,
  );
  await screen.findByText("Bruno Lima mencionou você em um comentário");
  await input.click(
    screen.getByRole("button", { name: "Marcar como lida: " + task.title }),
  );
  await screen.findByRole("button", {
    name: "Marcar como não lida: " + task.title,
  });
  await input.click(screen.getByRole("button", { name: /Não lidas/ }));
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: task.title }), null),
  );
  assert.ok(screen.getByRole("button", { name: task2.title }));
  await input.click(screen.getByRole("button", { name: "Ler todas" }));
  await screen.findByText("Nenhuma notificação não lida.");
  await input.click(screen.getByRole("button", { name: "Todas", exact: true }));
  await screen.findByRole("button", { name: task.title });
  await input.click(screen.getByRole("button", { name: task.title }));
  await waitFor(() => assert.equal(opened, "t1"));
  assert.ok(refreshes >= 3);
});

test("lixeira restaura com revisão, pede confirmação para exclusão definitiva e respeita papéis", async () => {
  const input = userEvent.setup();
  let lastRequest: any;
  let confirmations = 0;
  let events = 0;
  const removed: any = {
    ...task,
    deleted_at: "2026-11-13T12:00:00Z",
    deleted_by_name: "Ana Silva",
    project_name: project.name,
    role: "editor",
    attachment_count: 1,
    comment_count: 2,
    checklist_total: 3,
  };
  let trash: any[] = [removed];
  globalThis.fetch = async (url, options) => {
    if (options?.method) {
      lastRequest = {
        url: String(url),
        method: options.method,
        body: options.body ? JSON.parse(String(options.body)) : null,
      };
      trash = [];
      return respond(options.method === "POST" ? task : { ok: true });
    }
    return respond({ items: trash });
  };
  const result = render(
    <TrashView
      refresh={async () => {}}
      onRestored={() => {
        events++;
      }}
    />,
  );
  await screen.findByRole("button", { name: "Restaurar " + task.title });
  assert.equal(
    screen.queryByRole("button", {
      name: "Excluir definitivamente " + task.title,
    }),
    null,
  );
  await input.click(
    screen.getByRole("button", { name: "Restaurar " + task.title }),
  );
  await screen.findByText("Nenhuma tarefa na lixeira.");
  assert.equal(lastRequest.url, "/api/trash/t1/restore");
  assert.equal(lastRequest.body.revision, 1);
  assert.equal(events, 1);
  result.unmount();
  trash = [{ ...removed, role: "owner" }];
  (globalThis as any).confirm = () => {
    confirmations++;
    return false;
  };
  render(
    <TrashView
      refresh={async () => {}}
      onRestored={() => {
        events++;
      }}
    />,
  );
  await screen.findByRole("button", {
    name: "Excluir definitivamente " + task.title,
  });
  await input.click(
    screen.getByRole("button", {
      name: "Excluir definitivamente " + task.title,
    }),
  );
  assert.equal(confirmations, 1);
  assert.equal(events, 1);
  (globalThis as any).confirm = () => true;
  await input.click(
    screen.getByRole("button", {
      name: "Excluir definitivamente " + task.title,
    }),
  );
  await screen.findByText("Nenhuma tarefa na lixeira.");
  assert.equal(lastRequest.method, "DELETE");
  assert.equal(lastRequest.url, "/api/trash/t1?revision=1");
});

test("leitor consulta lixeira sem ações e falha de restauração preserva tarefa para tentar novamente", async () => {
  const input = userEvent.setup();
  const removed = {
    ...task,
    deleted_at: "2026-11-13T12:00:00Z",
    deleted_by_name: "Ana",
    project_name: project.name,
    role: "viewer",
    attachment_count: 0,
  };
  globalThis.fetch = async () => respond({ items: [removed] });
  const result = render(
    <TrashView refresh={async () => {}} onRestored={() => {}} />,
  );
  await screen.findByText("Somente leitura");
  assert.equal(
    screen.queryByRole("button", { name: "Restaurar " + task.title }),
    null,
  );
  assert.equal(
    screen.queryByRole("button", {
      name: "Excluir definitivamente " + task.title,
    }),
    null,
  );
  result.unmount();
  globalThis.fetch = async (url, options) =>
    options?.method
      ? respond({ error: "A lixeira mudou. Atualize e tente novamente." }, 409)
      : respond({ items: [{ ...removed, role: "editor" }] });
  render(<TrashView refresh={async () => {}} onRestored={() => {}} />);
  await screen.findByRole("button", { name: "Restaurar " + task.title });
  await input.click(
    screen.getByRole("button", { name: "Restaurar " + task.title }),
  );
  assert.match(
    (await screen.findByRole("alert")).textContent!,
    /lixeira mudou/,
  );
  assert.ok(screen.getByText(task.title));
});

test("configuração de colunas salva nomes, categorias, ordem e migração de atividades", async () => {
  const input = userEvent.setup();
  let payload: any;
  let closed = false;
  const base = defaultColumns.map((c) => ({
    ...c,
    task_count: c.id === "todo" ? 2 : 0,
    subtask_count: 0,
  }));
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") {
      payload = JSON.parse(String(options.body));
      return respond({ revision: 8, columns: payload.columns });
    }
    return respond({ revision: 7, columns: base });
  };
  render(
    <BoardColumnsDialog
      project={project}
      close={() => {
        closed = true;
      }}
      refresh={async () => {}}
      onSaved={() => {}}
    />,
  );
  await screen.findByLabelText("Nome da coluna 1");
  await input.click(
    screen.getByRole("button", { name: "Adicionar coluna 4/12" }),
  );
  await input.clear(screen.getByLabelText("Nome da coluna 5"));
  await input.type(screen.getByLabelText("Nome da coluna 5"), "Bloqueado");
  await input.selectOptions(
    screen.getByLabelText("Categoria da coluna 5"),
    "doing",
  );
  await input.click(
    screen.getByRole("button", { name: "Remover coluna A fazer" }),
  );
  await input.selectOptions(
    screen.getByLabelText("Destino de A fazer"),
    "doing",
  );
  await input.click(
    screen.getByRole("button", { name: "Mover Bloqueado para cima" }),
  );
  await input.click(screen.getByRole("button", { name: "Salvar colunas" }));
  await waitFor(() => assert.equal(closed, true));
  assert.equal(payload.revision, 7);
  assert.equal(payload.transfers.todo, "doing");
  assert.equal(
    payload.columns.some((c: any) => c.id === "todo"),
    false,
  );
  assert.equal(payload.columns[2].name, "Bloqueado");
  assert.equal(payload.columns[2].kind, "doing");
});

test("conflito na configuração mantém as alterações para revisão", async () => {
  const input = userEvent.setup();
  let closed = false;
  globalThis.fetch = async (url, options) =>
    options?.method === "PUT"
      ? respond(
          {
            error:
              "O quadro foi alterado em outro acesso. Reabra a configuração.",
          },
          409,
        )
      : respond({ revision: 1, columns: defaultColumns });
  render(
    <BoardColumnsDialog
      project={project}
      close={() => {
        closed = true;
      }}
      refresh={async () => {}}
      onSaved={() => {}}
    />,
  );
  const name = await screen.findByLabelText("Nome da coluna 1");
  await input.clear(name);
  await input.type(name, "Planejado");
  await input.click(screen.getByRole("button", { name: "Salvar colunas" }));
  assert.match((await screen.findByRole("alert")).textContent!, /outro acesso/);
  assert.equal((name as HTMLInputElement).value, "Planejado");
  assert.equal(closed, false);
});

const customColumns = [
  { id: "queue", name: "Planejado", color: "#9299ad", kind: "todo" as const },
  {
    id: "waiting",
    name: "Aguardando cliente",
    color: "#d79963",
    kind: "doing" as const,
  },
  { id: "shipped", name: "Entregue", color: "#5aab88", kind: "done" as const },
];
test("quadros e listas usam etapas do projeto e minhas tarefas inclui subtarefas atribuídas", async () => {
  const input = userEvent.setup();
  const customProject = { ...project, columns: customColumns };
  const customTask = {
    ...task,
    status: "waiting",
    assignee: "u2",
    subtask_total: 1,
    subtask_done: 0,
  };
  const sub = {
    id: "sub1",
    task_id: "t1",
    project: "p1",
    title: "Aplicar cores",
    description: "Teste",
    status: "queue",
    assignee: "u1",
    date: "",
    revision: 1,
    position: 1,
  };
  globalThis.fetch = async () =>
    respond({
      ...snapshot,
      projects: [customProject],
      tasks: [customTask, { ...task2, status: "shipped", assignee: "u2" }],
      subtasks: [sub],
    });
  render(
    <Workspace
      user={user}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("heading", { name: "Aguardando cliente" });
  assert.ok(screen.getByRole("heading", { name: "Entregue" }));
  assert.equal(screen.queryByRole("heading", { name: "Em revisão" }), null);
  assert.ok(screen.getByLabelText("Subtarefas: 0 de 1 concluídas"));
  await input.click(screen.getByRole("button", { name: "Lista", exact: true }));
  const status = screen.getByLabelText("Status de " + task.title);
  assert.ok(within(status).getByRole("option", { name: "Aguardando cliente" }));
  assert.equal(within(status).queryByRole("option", { name: "A fazer" }), null);
  await input.click(screen.getByRole("button", { name: /Minhas tarefas/ }));
  assert.ok(screen.getByRole("button", { name: new RegExp(task.title) }));
  assert.equal(
    screen.queryByRole("button", { name: new RegExp(task2.title) }),
    null,
  );
  await input.click(
    screen.getByRole("button", { name: "Quadro", exact: true }),
  );
  assert.ok(screen.getByRole("button", { name: "Abrir tarefa " + task.title }));
  assert.ok(screen.getByRole("heading", { name: "Em andamento" }));
});

test("subtarefas salvam responsável, prazo e status; conclusão usa categoria personalizada", async () => {
  const input = userEvent.setup();
  let subtasks: any[] = [];
  const sent: any[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/collaboration"))
      return respond({ ...emptyCollaboration, subtasks });
    const body = JSON.parse(String(options?.body));
    sent.push(body);
    const item = {
      id: "sub1",
      task_id: "t1",
      description: "",
      position: 1,
      ...(subtasks[0] || {}),
      ...body,
      revision: (subtasks[0]?.revision || 0) + 1,
    };
    subtasks = [item];
    return respond(item, options?.method === "POST" ? 201 : 200);
  };
  render(
    <TaskCollaboration
      taskId="t1"
      members={members}
      boardColumns={customColumns}
      editable
      refresh={async () => {}}
      refreshKey="1"
      onDraftStateChange={() => {}}
    />,
  );
  await waitFor(() =>
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Nova subtarefa",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );
  await input.click(screen.getByRole("button", { name: "Nova subtarefa" }));
  await input.type(
    screen.getByLabelText("Título da subtarefa"),
    "Preparar protótipo",
  );
  await input.click(
    within(
      screen.getByRole("group", { name: "Responsáveis pela subtarefa" }),
    ).getByRole("checkbox", { name: "Selecionar Bruno Lima" }),
  );
  await input.type(screen.getByLabelText("Prazo da subtarefa"), "2026-11-30");
  await input.selectOptions(
    screen.getByLabelText("Status da subtarefa"),
    "waiting",
  );
  await input.click(screen.getByRole("button", { name: "Salvar subtarefa" }));
  await screen.findByText("Preparar protótipo");
  assert.deepEqual(sent[0].assignees, ["u2"]);
  assert.equal(sent[0].date, "2026-11-30");
  assert.equal(sent[0].status, "waiting");
  await waitFor(() =>
    assert.equal(
      (
        screen.getByRole("checkbox", {
          name: "Concluir subtarefa Preparar protótipo",
        }) as HTMLInputElement
      ).disabled,
      false,
    ),
  );
  await input.click(
    screen.getByRole("checkbox", {
      name: "Concluir subtarefa Preparar protótipo",
    }),
  );
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("progressbar", { name: "Progresso das subtarefas" })
        .getAttribute("aria-valuenow"),
      "1",
    ),
  );
  assert.equal(sent[1].status, "shipped");
  assert.equal(sent[1].revision, 1);
});

test("leitor consulta subtarefas sem escrita e rascunhos protegem o fechamento da tarefa", async () => {
  const input = userEvent.setup();
  const sub = {
    id: "sub1",
    task_id: "t1",
    title: "Validar a entrega",
    description: "Uma etapa importante",
    status: "waiting",
    assignee: "u2",
    date: "2026-11-30",
    position: 1,
    revision: 1,
  };
  globalThis.fetch = async () =>
    respond({ ...emptyCollaboration, subtasks: [sub] });
  const read = render(
    <TaskCollaboration
      taskId="t1"
      members={members}
      boardColumns={customColumns}
      editable={false}
      refresh={async () => {}}
      refreshKey="1"
      onDraftStateChange={() => {}}
    />,
  );
  await screen.findByText("Validar a entrega");
  assert.equal(
    (
      screen.getByRole("checkbox", {
        name: "Concluir subtarefa Validar a entrega",
      }) as HTMLInputElement
    ).disabled,
    true,
  );
  assert.equal(screen.queryByRole("button", { name: "Nova subtarefa" }), null);
  read.unmount();
  let closed = false;
  (globalThis as any).confirm = () => false;
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      close={() => {
        closed = true;
      }}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {}}
    />,
  );
  await waitFor(() =>
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Nova subtarefa",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );
  await input.click(screen.getByRole("button", { name: "Nova subtarefa" }));
  await input.type(
    screen.getByLabelText("Título da subtarefa"),
    "Rascunho importante",
  );
  await input.click(screen.getByRole("button", { name: "Fechar diálogo" }));
  assert.equal(closed, false);
  assert.equal(
    (screen.getByLabelText("Título da subtarefa") as HTMLInputElement).value,
    "Rascunho importante",
  );
});

test("calendário exibe prazo de subtarefa e abre os detalhes da tarefa principal sem trocar seus dados", async () => {
  const input = userEvent.setup();
  const current = new Date();
  const date = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-15`;
  const parent = {
    ...task,
    title: "Entrega principal",
    status: "waiting",
    date: "",
  };
  const sub = {
    id: "sub-calendar",
    task_id: "t1",
    project: "p1",
    title: "Prazo da aplicação visual",
    description: "Uma etapa",
    status: "queue",
    assignee: "u1",
    date,
    revision: 1,
    position: 1,
  };
  globalThis.fetch = async (url) =>
    String(url).endsWith("/collaboration")
      ? respond({ ...emptyCollaboration, subtasks: [sub] })
      : respond({
          ...snapshot,
          projects: [{ ...project, columns: customColumns }],
          tasks: [parent],
          subtasks: [sub],
        });
  render(
    <Workspace
      user={user}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Abrir tarefa Entrega principal" });
  await input.click(
    within(document.querySelector(".view-tabs") as HTMLElement).getByRole(
      "button",
      { name: "Calendário" },
    ),
  );
  await input.click(
    await screen.findByRole("button", {
      name: "Abrir subtarefa Prazo da aplicação visual",
    }),
  );
  const dialog = screen.getByRole("dialog");
  assert.equal(
    (within(dialog).getByLabelText("Título") as HTMLInputElement).value,
    "Entrega principal",
  );
  assert.equal(
    (within(dialog).getByLabelText("Prazo") as HTMLInputElement).value,
    "",
  );
  assert.equal(
    (within(dialog).getByLabelText("Status") as HTMLSelectElement).value,
    "waiting",
  );
  await within(dialog).findByText("Prazo da aplicação visual");
});

test("tarefa permite selecionar múltiplos responsáveis sem perder o responsável existente", async () => {
  const input = userEvent.setup();
  let sent: any;
  globalThis.fetch = async (url, options) =>
    String(url).endsWith("/collaboration")
      ? respond(emptyCollaboration)
      : ((sent = JSON.parse(String(options?.body))),
        respond({ ...task, ...sent, revision: 2 }));
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      close={() => {}}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {}}
    />,
  );
  const group = screen.getByRole("group", { name: "Responsáveis pela tarefa" });
  assert.equal(
    (
      within(group).getByRole("checkbox", {
        name: "Selecionar Ana Silva",
      }) as HTMLInputElement
    ).checked,
    true,
  );
  await input.click(
    within(group).getByRole("checkbox", { name: "Selecionar Bruno Lima" }),
  );
  await input.click(screen.getByRole("button", { name: "Salvar tarefa" }));
  await waitFor(() =>
    assert.deepEqual(new Set(sent.assignees), new Set(["u1", "u2"])),
  );
});

test("minhas tarefas e filtros consideram responsáveis secundários e a lista mostra todos os nomes", async () => {
  const input = userEvent.setup();
  globalThis.fetch = async () =>
    respond({
      ...snapshot,
      tasks: [
        { ...task, assignee: "u2", assignees: ["u2", "u1"] },
        { ...task2, assignees: ["u2"] },
      ],
    });
  render(
    <Workspace
      user={user}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Abrir tarefa " + task.title });
  await input.selectOptions(screen.getByLabelText("Filtrar responsável"), "u1");
  assert.ok(screen.getByRole("button", { name: "Abrir tarefa " + task.title }));
  assert.equal(
    screen.queryByRole("button", { name: "Abrir tarefa " + task2.title }),
    null,
  );
  await input.click(screen.getByRole("button", { name: "Lista", exact: true }));
  assert.ok(screen.getByText("Ana Silva, Bruno Lima"));
  await input.click(screen.getByRole("button", { name: /Minhas tarefas/ }));
  assert.ok(screen.getByRole("button", { name: new RegExp(task.title) }));
});

test("editar nome atualiza projeto e menu, e não há importação ou exportação na interface", async () => {
  const input = userEvent.setup();
  let current = { ...project, revision: 1 };
  let payload: any;
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    if (options?.method === "PATCH") {
      payload = JSON.parse(String(options.body));
      current = { ...current, ...payload, revision: 2 };
      return respond({ ok: true, revision: 2 });
    }
    return respond({ ...snapshot, projects: [current] });
  };
  localStorage.setItem("clickdown-tasks", JSON.stringify([task]));
  render(
    <Workspace
      user={user}
      theme="light"
      toggleTheme={() => {}}
      logout={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Editar projeto" });
  assert.equal(
    screen.queryByRole("button", { name: /Exportar|Importar/ }),
    null,
  );
  await input.click(screen.getByRole("button", { name: "Editar projeto" }));
  await input.clear(screen.getByLabelText("Nome do projeto"));
  await input.type(
    screen.getByLabelText("Nome do projeto"),
    "Projeto renomeado",
  );
  await input.click(
    screen.getByRole("button", { name: "Salvar configurações" }),
  );
  await screen.findByRole("heading", { name: "Projeto renomeado" });
  assert.equal(payload.revision, 1);
  assert.equal(payload.name, "Projeto renomeado");
  await input.click(screen.getByRole("button", { name: "Fechar diálogo" }));
  assert.ok(screen.getByRole("button", { name: "Projeto renomeado" }));
  await input.click(
    screen.getByRole("button", { name: "Ajuda e informações" }),
  );
  assert.equal(
    screen.queryByRole("button", { name: /Exportar|Importar/ }),
    null,
  );
  assert.equal(
    requests.some((p) => p.includes("/import")),
    false,
  );
});

test("registro mostra autor, horário e antes/depois, mesmo quando a tarefa foi excluída", async () => {
  const input = userEvent.setup();
  const requested: string[] = [];
  const event = {
    id: 10,
    project_id: "p1",
    project_name: project.name,
    user_id: "u2",
    actor_name: "Bruno Lima",
    kind: "task_updated",
    task_id: "removed",
    task_title: "Entrega removida",
    task_available: false,
    payload: {
      changes: [
        {
          field: "assignees",
          before: "Ana Silva",
          after: "Ana Silva, Bruno Lima",
        },
      ],
    },
    created: "2026-11-13T12:34:56Z",
  };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return respond({ items: [event], has_more: false });
  };
  render(
    <ProjectActivity
      projects={[project]}
      openTask={async () => {
        throw new Error("Não deve abrir tarefa excluída");
      }}
    />,
  );
  await screen.findByText("Bruno Lima");
  assert.ok(screen.getByText("Ana Silva, Bruno Lima"));
  assert.ok(screen.getByText("Atividade fora do quadro"));
  assert.equal(
    document.querySelector("time")?.getAttribute("datetime"),
    "2026-11-13T12:34:56Z",
  );
  assert.equal(
    screen.queryByRole("button", { name: /Entrega removida/ }),
    null,
  );
  await input.selectOptions(
    screen.getByLabelText("Filtrar projeto no registro"),
    "p1",
  );
  await waitFor(() =>
    assert.ok(requested.some((p) => p.includes("project=p1"))),
  );
  await input.type(
    screen.getByLabelText("Buscar no registro de atividades"),
    "Ana",
  );
  await waitFor(() =>
    assert.ok(requested.some((p) => p.includes("search=Ana"))),
  );
});

test("notificação de mudança de projeto mostra detalhes sem depender de uma tarefa ativa", async () => {
  const input = userEvent.setup();
  let marked = false;
  const event = {
    id: 9,
    user_id: "u1",
    task_id: null,
    kind: "activity",
    action_kind: "project_updated",
    actor_name: "Bruno Lima",
    task_title: null,
    project_id: "p1",
    project_name: "Novo nome",
    created: "2026-11-13T12:34:56Z",
    read_at: null,
    payload: {
      changes: [{ field: "name", before: "Nome anterior", after: "Novo nome" }],
    },
  };
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PATCH") {
      marked = true;
      return respond({ ok: true });
    }
    return respond({
      items: [{ ...event, read_at: marked ? "2026-11-13T13:00:00Z" : null }],
      unread_count: marked ? 0 : 1,
      has_more: false,
    });
  };
  render(
    <NotificationCenter
      close={() => {}}
      refresh={async () => {}}
      openTask={async () => {
        throw new Error("Projeto não tem tarefa alvo");
      }}
    />,
  );
  await screen.findByText("Bruno Lima editou o projeto");
  assert.ok(screen.getByText("Nome anterior"));
  assert.ok(screen.getByText("Nome do projeto"));
  await input.click(screen.getByRole("button", { name: /Marcar como lida/ }));
  await waitFor(() => assert.equal(marked, true));
});
const { ArchiveView } = await import("../src/ArchiveView");
test("arquivar envia a revisão e fecha os detalhes após salvar", async () => {
  const input = userEvent.setup();
  let archived = false;
  let closed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/archive")) {
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        revision: task.revision,
      });
      archived = true;
      return respond({ ok: true });
    }
    return respond(emptyCollaboration);
  };
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      close={() => {
        closed = true;
      }}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {}}
    />,
  );
  await input.click(
    screen.getByRole("button", { name: "Arquivar", exact: true }),
  );
  await waitFor(() => assert.equal(closed, true));
  assert.equal(archived, true);
});
test("arquivados permitem consultar e restaurar; falha preserva a tarefa", async () => {
  const input = userEvent.setup();
  let consulted = "";
  let fail = true;
  const stored = {
    ...task,
    project_name: project.name,
    role: "owner",
    archived_at: "2026-11-13T12:00:00Z",
    archived_by_name: user.name,
    comment_count: 1,
    attachment_count: 1,
    checklist_total: 1,
  };
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      assert.deepEqual(JSON.parse(String(options.body)), {
        revision: task.revision,
      });
      return fail
        ? respond({ error: "Conflito de revisão" }, 409)
        : respond({});
    }
    return respond({ items: [stored] });
  };
  render(
    <ArchiveView
      refresh={async () => {}}
      onRestored={() => {}}
      openTask={async (id) => {
        consulted = id;
      }}
    />,
  );
  await input.click(
    await screen.findByRole("button", { name: "Consultar " + task.title }),
  );
  assert.equal(consulted, task.id);
  await input.click(
    screen.getByRole("button", { name: "Restaurar " + task.title }),
  );
  assert.match((await screen.findByRole("alert")).textContent!, /Conflito/);
  assert.ok(screen.getByRole("heading", { name: task.title }));
  fail = false;
  await input.click(
    screen.getByRole("button", { name: "Restaurar " + task.title }),
  );
  await screen.findByText("Nenhuma tarefa arquivada.");
});
test("consulta arquivada é somente leitura mesmo para proprietário", async () => {
  globalThis.fetch = async () => respond(emptyCollaboration);
  render(
    <TaskDialog
      task={task}
      project={project}
      members={members}
      attachments={[]}
      archived
      close={() => {}}
      refresh={async () => {}}
      onSaved={() => {}}
      onCreated={() => {}}
    />,
  );
  assert.equal(
    (screen.getByLabelText("Título") as HTMLInputElement).matches(":disabled"),
    true,
  );
  for (const name of ["Arquivar", "Salvar tarefa", "Mover para lixeira"])
    assert.equal(screen.queryByRole("button", { name, exact: true }), null);
  assert.ok(screen.getByRole("heading", { name: "Tarefa arquivada" }));
});
