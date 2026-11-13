import { randomBytes, randomUUID } from "node:crypto";

export function installDemo(app, ctx) {
  const {
    enabled,
    profiles,
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
    ensureBoard,
    auditProject,
    setAssignees,
    getAssignees,
    assigneeNames,
  } = ctx;
  run(
    "CREATE TABLE IF NOT EXISTS demo_feature_versions (sandbox_id TEXT PRIMARY KEY REFERENCES demo_sandboxes(id) ON DELETE CASCADE,version INTEGER NOT NULL)",
  );
  app.get("/api/demo/profiles", (req, res) =>
    res.json({ enabled, profiles: enabled ? profiles : [] }),
  );
  app.post("/api/demo/login", limitAuth, async (req, res) => {
    if (!enabled) fail(404, "Demonstração indisponível neste servidor.");
    const selected = profiles.find((p) => p.role === req.body.role);
    if (!selected) fail(400, "Selecione um perfil de demonstração válido.");
    const prefix = "cd_demo_space=";
    let token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(prefix))
      ?.slice(prefix.length);
    let sandbox = token
      ? one("SELECT id FROM demo_sandboxes WHERE token_hash=?", hash(token))
      : null;
    if (!sandbox) {
      const id = randomUUID();
      token = randomBytes(32).toString("hex");
      const people = await Promise.all(
        profiles.map(async (profile) => {
          const salt = randomBytes(16).toString("hex");
          const password = await scrypt(
            randomBytes(32).toString("hex"),
            salt,
            64,
          );
          return {
            ...profile,
            id: randomUUID(),
            email: `${profile.role}.${id.slice(0, 8)}@demo.clickdown.local`,
            password: `${salt}:${password.toString("hex")}`,
          };
        }),
      );
      transaction(() => {
        run(
          "INSERT INTO demo_sandboxes VALUES (?,?,?)",
          id,
          hash(token),
          now(),
        );
        for (const person of people) {
          run(
            "INSERT INTO users VALUES (?,?,?,?,?)",
            person.id,
            person.name,
            person.email,
            person.password,
            now(),
          );
          run(
            "INSERT INTO demo_profiles VALUES (?,?,?)",
            person.id,
            id,
            person.role,
          );
        }
        const owner = people.find((p) => p.role === "owner"),
          admin = people.find((p) => p.role === "admin"),
          editor = people.find((p) => p.role === "editor"),
          viewer = people.find((p) => p.role === "viewer");
        const project = randomUUID();
        run(
          "INSERT INTO projects VALUES (?,?,?,?,?,?)",
          project,
          "Lançamento Aurora",
          "#8974eb",
          "Uma marca nova, uma equipe conectada. Explore o quadro, troque de perfil e veja as permissões em ação.",
          admin.id,
          now(),
        );
        run("INSERT INTO project_sandboxes VALUES (?,?)", project, id);
        ensureBoard(project);
        for (const person of people)
          run(
            "INSERT INTO members VALUES (?,?,?)",
            project,
            person.id,
            person.role,
          );
        auditProject(project, owner, "project_created", {
          name: "Lançamento Aurora",
        });
        function task(
          title,
          status,
          priority,
          tag,
          assignee,
          date,
          description,
        ) {
          const taskId = randomUUID();
          run(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)",
            taskId,
            project,
            title,
            description,
            status,
            priority,
            tag,
            date,
            assignee,
            ++position,
            now(),
            now(),
          );
          record(taskId, owner, "task_created");
          notify(
            assignee,
            taskId,
            "assignment",
            owner,
            `assignment:${taskId}:1:${assignee}`,
          );
          return taskId;
        }
        let position = 0;
        const design = task(
          "Criar a identidade visual",
          "doing",
          "Alta",
          "Design",
          editor.id,
          dayAt(1),
          "Explorar cores, tipografia e elementos para uma marca com personalidade.",
        );
        task(
          "Validar a página de apresentação",
          "review",
          "Alta",
          "Design",
          owner.id,
          dayAt(),
          "Conferir a hierarquia visual e a mensagem principal antes de publicar.",
        );
        task(
          "Organizar o calendário de conteúdo",
          "todo",
          "Média",
          "Conteúdo",
          admin.id,
          dayAt(1),
          "Planejar as publicações e distribuir os próximos passos da campanha.",
        );
        task(
          "Revisar acessibilidade do formulário",
          "doing",
          "Alta",
          "Desenvolvimento",
          editor.id,
          dayAt(-1),
          "Verificar contraste, navegação por teclado e mensagens dos campos.",
        );
        task(
          "Acompanhar indicadores do lançamento",
          "todo",
          "Média",
          "Pesquisa",
          viewer.id,
          dayAt(),
          "Consultar as entregas e reunir observações para a próxima reunião.",
        );
        task(
          "Documentar o escopo do projeto",
          "done",
          "Baixa",
          "Organização",
          owner.id,
          dayAt(-2),
          "Objetivos, entregáveis e prioridades alinhados com toda a equipe.",
        );
        task(
          "Preparar os materiais de divulgação",
          "todo",
          "Média",
          "Conteúdo",
          admin.id,
          dayAt(3),
          "Reunir os textos e as peças para apresentar a nova marca.",
        );
        const feedback = task(
          "Consolidar o feedback da equipe",
          "review",
          "Média",
          "Estratégia",
          owner.id,
          dayAt(1),
          "Transformar as observações em decisões claras para o lançamento.",
        );
        for (const [title, done] of [
          ["Pesquisar referências visuais", true],
          ["Definir paleta e tipografia", true],
          ["Validar contraste e aplicações", false],
        ]) {
          const item = randomUUID();
          run(
            "INSERT INTO checklist VALUES (?,?,?,?,1,?)",
            item,
            design,
            title,
            done ? 1 : 0,
            now(),
          );
          record(
            design,
            editor,
            done ? "checklist_completed" : "checklist_added",
            { item_id: item, title },
          );
        }
        const comment = randomUUID();
        const mentions = [
          { id: editor.id, name: editor.name },
          { id: owner.id, name: owner.name },
        ];
        run(
          "INSERT INTO comments VALUES (?,?,?,?,?,?,?)",
          comment,
          design,
          admin.id,
          admin.name,
          `@${editor.name}, podemos revisar o contraste? @${owner.name}, a direção visual está pronta para sua avaliação.`,
          JSON.stringify(mentions),
          now(),
        );
        record(design, admin, "comment_added", {
          comment_id: comment,
          mentions,
        });
        for (const m of mentions)
          notify(m.id, design, "mention", admin, `mention:${comment}:${m.id}`);
        run(
          "INSERT INTO comments VALUES (?,?,?,?,?,?,?)",
          randomUUID(),
          feedback,
          editor.id,
          editor.name,
          "As sugestões foram organizadas por prioridade. Vamos começar pelas melhorias de navegação.",
          "[]",
          now(),
        );
        record(feedback, editor, "comment_added");
        for (const title of [
          "Rascunho da campanha anterior",
          "Ideia antiga de página inicial",
        ]) {
          const taskId = task(
            title,
            "todo",
            "Baixa",
            "Organização",
            admin.id,
            "",
            "Uma atividade de exemplo na lixeira. Restaure para continuar de onde parou.",
          );
          run(
            "INSERT INTO checklist VALUES (?,?,?,0,1,?)",
            randomUUID(),
            taskId,
            "Conferir os materiais reaproveitáveis",
            now(),
          );
          run(
            "INSERT INTO task_trash VALUES (?,?,?,?)",
            taskId,
            owner.id,
            owner.name,
            now(),
          );
          run("UPDATE tasks SET revision=revision+1 WHERE id=?", taskId);
          record(taskId, owner, "task_trashed");
        }
      });
      sandbox = { id };
    }
    if (
      !one("SELECT 1 FROM demo_feature_versions WHERE sandbox_id=?", sandbox.id)
    )
      transaction(() => {
        const project = one(
          "SELECT project_id AS id FROM project_sandboxes WHERE sandbox_id=?",
          sandbox.id,
        );
        const owner = one(
          "SELECT u.* FROM users u JOIN demo_profiles d ON d.user_id=u.id WHERE d.sandbox_id=? AND d.role='owner'",
          sandbox.id,
        );
        const editor = one(
          "SELECT u.* FROM users u JOIN demo_profiles d ON d.user_id=u.id WHERE d.sandbox_id=? AND d.role='editor'",
          sandbox.id,
        );
        if (project) {
          const current = all(
            "SELECT * FROM project_columns WHERE project_id=? ORDER BY position",
            project.id,
          );
          if (
            current.length < 12 &&
            !current.some((c) => c.name === "Aguardando cliente")
          ) {
            run(
              "INSERT INTO project_columns VALUES (?,?,?,?,?,?)",
              project.id,
              "waiting_" + randomUUID(),
              "Aguardando cliente",
              "#dc9f62",
              "doing",
              current.length,
            );
            run(
              "UPDATE board_settings SET revision=revision+1 WHERE project_id=?",
              project.id,
            );
          }
          const parent = one(
            "SELECT t.* FROM tasks t WHERE t.project=? AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) ORDER BY t.position LIMIT 1",
            project.id,
          );
          if (
            parent &&
            !one("SELECT 1 FROM subtasks WHERE task_id=?", parent.id)
          ) {
            const active =
              current.find((c) => c.kind === "doing") ||
              current.find((c) => c.kind !== "done");
            const done = current.find((c) => c.kind === "done");
            for (const [i, title] of [
              "Explorar referências de tipografia",
              "Preparar aplicações da marca",
              "Revisar contraste com a equipe",
            ].entries()) {
              const id = randomUUID();
              run(
                "INSERT INTO subtasks (id,task_id,title,description,status,assignee,date,position,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                id,
                parent.id,
                title,
                "Uma etapa da entrega, com responsável e prazo próprios.",
                i === 0 ? done.id : active.id,
                i === 2 ? owner.id : editor.id,
                dayAt(i === 2 ? 0 : 1),
                i,
                now(),
                now(),
              );
              record(parent.id, owner, "subtask_created", { title });
              notify(
                i === 2 ? owner.id : editor.id,
                parent.id,
                "assignment",
                owner,
                `subtask-assignment:${id}:1`,
                null,
                id,
              );
            }
          }
        }
        run("INSERT INTO demo_feature_versions VALUES (?,1)", sandbox.id);
      });
    if (
      Number(
        one(
          "SELECT version FROM demo_feature_versions WHERE sandbox_id=?",
          sandbox.id,
        )?.version || 0,
      ) < 2
    )
      transaction(() => {
        const owner = one(
          "SELECT u.* FROM users u JOIN demo_profiles d ON d.user_id=u.id WHERE d.sandbox_id=? AND d.role='owner'",
          sandbox.id,
        );
        const task = one(
          "SELECT t.* FROM tasks t JOIN project_sandboxes p ON p.project_id=t.project WHERE p.sandbox_id=? AND NOT EXISTS(SELECT 1 FROM task_trash x WHERE x.task_id=t.id) AND NOT EXISTS(SELECT 1 FROM task_archive a WHERE a.task_id=t.id) ORDER BY t.position LIMIT 1",
          sandbox.id,
        );
        if (task) {
          const people = all(
            "SELECT m.user_id FROM members m JOIN demo_profiles d ON d.user_id=m.user_id WHERE m.project_id=? AND d.role IN ('owner','editor')",
            task.project,
          ).map((p) => p.user_id);
          const before = getAssignees(task.id);
          const after = [...new Set([...before, ...people])].sort();
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            setAssignees(task.id, after);
            run(
              "UPDATE tasks SET revision=revision+1,updated=? WHERE id=?",
              now(),
              task.id,
            );
            record(task.id, owner, "task_updated", {
              changes: [
                {
                  field: "assignees",
                  before: assigneeNames(before),
                  after: assigneeNames(after),
                },
              ],
              reason:
                "Exemplo de responsabilidade compartilhada no ambiente demo",
            });
          }
        }
        run(
          "UPDATE demo_feature_versions SET version=2 WHERE sandbox_id=?",
          sandbox.id,
        );
      });
    const user = one(
      "SELECT u.* FROM users u JOIN demo_profiles d ON d.user_id=u.id WHERE d.sandbox_id=? AND d.role=?",
      sandbox.id,
      selected.role,
    );
    createSession(res, user.id);
    res.append(
      "Set-Cookie",
      `cd_demo_space=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
    res.json({ user: publicUser(user) });
  });
}
