import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Folder,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  MessageSquare,
  ListChecks,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Target,
  Users,
  X,
  Bell,
  Trash2,
  History,
  Pencil,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api, ApiError, json } from "./api";
import { Auth, Dialog, ProjectDialog, TaskDialog } from "./components";
import { ArchiveView } from "./ArchiveView";
import { NotificationCenter, TrashView } from "./InboxAndTrash";
import { BoardColumnsDialog } from "./BoardsAndSubtasks";
import { ProjectActivity } from "./ProjectActivity";
import {
  canEdit,
  assigneeIds,
  canManage,
  projectColumns,
  initialStatus,
  columns,
  formatDate,
  initials,
  roles,
  type ArchivedDetails,
  type Project,
  type State,
  type Status,
  type Task,
  type User,
  type Subtask,
} from "./types";
const emptyState: State = {
  projects: [],
  tasks: [],
  members: [],
  invitations: [],
  attachments: [],
};
type CalendarEntry = Task & {
  calendar_key?: string;
  is_subtask?: boolean;
  parent_title?: string;
};
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("clickdown-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("clickdown-theme", theme);
  }, [theme]);
  const check = useCallback(async () => {
    setChecking(true);
    setInitialError("");
    try {
      setUser((await api("/auth/me")).user);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401)
        setInitialError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    check();
  }, [check]);
  const logout = useCallback(() => setUser(null), []);
  if (checking)
    return (
      <div className="loading-screen">
        <span className="brand-mark">
          <CheckCheck size={26} />
        </span>
        <LoaderCircle size={24} className="spin" />
        <p>Carregando…</p>
      </div>
    );
  if (initialError)
    return (
      <div className="loading-screen">
        <CircleHelp size={30} />
        <h2>
          {import.meta.env.MODE === "pages"
            ? "API necessária para acessar o aplicativo"
            : "Não conseguimos acessar o servidor"}
        </h2>
        <p>
          {import.meta.env.MODE === "pages"
            ? "Esta publicação no GitHub Pages contém a interface. Login, projetos e anexos dependem da API Node e do banco SQLite em um servidor."
            : "Confira se a API está em execução e tente novamente."}
        </p>
        {import.meta.env.MODE === "pages" && (
          <a
            className="outline-button"
            href="https://github.com/felipe-santos-swengineer/click-down#readme"
          >
            Código e instruções de execução
          </a>
        )}
        <button className="primary-button" onClick={check}>
          <RefreshCw size={16} />
          Tentar novamente
        </button>
      </div>
    );
  return (
    <>
      {!user && (
        <button
          className="auth-theme icon-button"
          aria-label={
            theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
          }
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
      )}
      {user ? (
        <Workspace
          key={user.id}
          user={user}
          theme={theme}
          toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
          logout={logout}
          onSwitchUser={setUser}
        />
      ) : (
        <Auth onLogin={setUser} />
      )}
    </>
  );
}
export function Workspace({
  user,
  theme,
  toggleTheme,
  logout,
  onSwitchUser,
}: {
  user: User;
  theme: string;
  toggleTheme: () => void;
  logout: () => void;
  onSwitchUser?: (user: User) => void;
}) {
  const [data, setData] = useState<State>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [section, setSection] = useState("projects");
  const [view, setView] = useState("board");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("Todas");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [archivedDetails, setArchivedDetails] =
    useState<ArchivedDetails | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [settings, setSettings] = useState(false);
  const [boardSettings, setBoardSettings] = useState(false);
  const [projectModal, setProjectModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [help, setHelp] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [dragTarget, setDragTarget] = useState("");
  const [dragging, setDragging] = useState("");
  const [overCard, setOverCard] = useState("");
  const fetching = useRef(false);
  const acceptingInvite = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const result = await api<State>("/state");
      if (result.current_user && result.current_user.id !== user.id) {
        if (onSwitchUser) onSwitchUser(result.current_user);
        else logout();
        return;
      }
      setData(result);
      setLoaded(true);
      setSyncError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        return;
      }
      throw e;
    }
  }, [logout, onSwitchUser, user.id]);
  useEffect(() => {
    let active = true;
    async function load() {
      if (fetching.current) return;
      fetching.current = true;
      try {
        await refresh();
      } catch (e) {
        if (active) {
          setSyncError((e as Error).message);
          setLoaded(true);
        }
      } finally {
        fetching.current = false;
      }
    }
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 10000);
    const focus = () => load();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const invitation = new URLSearchParams(location.search).get("invite");
    if (!invitation || acceptingInvite.current) return;
    acceptingInvite.current = true;
    (async () => {
      try {
        const result = await api(
          "/invitations/" + encodeURIComponent(invitation) + "/accept",
          json("POST", {}),
        );
        await refresh();
        setProjectId(result.project_id);
        setSection("projects");
        setToast("Convite aceito.");
        const url = new URL(location.href);
        url.searchParams.delete("invite");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (data.projects.length && !data.projects.some((p) => p.id === projectId))
      setProjectId(data.projects[0].id);
  }, [data.projects, projectId]);
  const project =
    data.projects.find((p) => p.id === projectId) || data.projects[0];
  const members = data.members.filter((m) => m.project_id === project?.id);
  const colsFor = (id: string) =>
    projectColumns(data.projects.find((p) => p.id === id));
  const kindOf = (t: Task) =>
    colsFor(t.project).find((c) => c.id === t.status)?.kind || "todo";
  const childrenByTask = new Map<string, Subtask[]>();
  for (const s of data.subtasks || [])
    childrenByTask.set(s.task_id, [
      ...(childrenByTask.get(s.task_id) || []),
      s,
    ]);
  const childrenOf = (t: Task) => childrenByTask.get(t.id) || [];
  const shownColumns =
    section === "projects" ? projectColumns(project) : columns;
  const groupOf = (t: Task) => (section === "projects" ? t.status : kindOf(t));
  const scoped = data.tasks.filter((t) =>
    section === "mine"
      ? assigneeIds(t).includes(user.id) ||
        childrenOf(t).some((s) => assigneeIds(s).includes(user.id))
      : section === "overview"
        ? true
        : t.project === project?.id,
  );
  const filtered = scoped.filter(
    (t) =>
      (
        t.title +
        " " +
        t.description +
        " " +
        t.tag +
        " " +
        childrenOf(t)
          .map((s) => s.title + " " + s.description)
          .join(" ")
      )
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()) &&
      (priority === "Todas" || t.priority === priority) &&
      (assigneeFilter === "all" ||
        (assigneeFilter === "none"
          ? assigneeIds(t).length === 0
          : assigneeIds(t).includes(assigneeFilter) ||
            childrenOf(t).some((s) =>
              assigneeIds(s).includes(assigneeFilter),
            ))),
  );
  const completed = scoped.filter((t) => kindOf(t) === "done").length;
  const progress = scoped.length
    ? Math.round((completed / scoped.length) * 100)
    : 0;
  const editable = canEdit(project?.role);
  const currentTaskProject =
    task && data.projects.find((p) => p.id === task.project);
  const today = new Date().toLocaleDateString("sv");
  const overdueChildren = (t: Task) =>
    kindOf(t) === "done"
      ? []
      : childrenOf(t).filter(
          (s) =>
            s.date &&
            s.date < today &&
            colsFor(t.project).find((c) => c.id === s.status)?.kind !== "done",
        );
  const needsAttention = (t: Task) =>
    kindOf(t) !== "done" &&
    ((t.date && t.date < today) || overdueChildren(t).length > 0);
  const calendarEntries: CalendarEntry[] = filtered.flatMap((t) => {
    const include = (ids: string[]) =>
      (section !== "mine" || ids.includes(user.id)) &&
      (assigneeFilter === "all" ||
        (assigneeFilter === "none"
          ? !ids.length
          : ids.includes(assigneeFilter)));
    return [
      ...(include(assigneeIds(t)) ? [t] : []),
      ...childrenOf(t)
        .filter((s) => include(assigneeIds(s)))
        .map((s) => ({
          ...t,
          title: s.title,
          description: s.description,
          status: s.status,
          date: s.date,
          assignee: s.assignee,
          assignees: assigneeIds(s),
          calendar_key: s.id,
          is_subtask: true,
          parent_title: t.title,
        })),
    ];
  });
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openNotificationTask(id: string) {
    const latest = await api<State>("/state");
    setData(latest);
    const target = latest.tasks.find((t) => t.id === id);
    if (!target)
      throw new Error(
        "Esta tarefa não está mais disponível. Ela pode estar na lixeira ou seu acesso ao projeto mudou.",
      );
    setProjectId(target.project);
    setSection("projects");
    setTask(target);
    setNotifications(false);
  }
  function newTask(status?: Status, date = "") {
    if (!project || !editable) return;
    const selected = status
      ? section === "projects"
        ? status
        : projectColumns(project).find((c) => c.kind === status)?.id
      : initialStatus(projectColumns(project));
    if (!selected || !projectColumns(project).some((c) => c.id === selected)) {
      setError(
        "Este projeto não possui uma coluna desta categoria. Selecione outra etapa no quadro do projeto.",
      );
      return;
    }
    setTask({
      id: "",
      project: project.id,
      title: "",
      description: "",
      status: selected,
      priority: "Média",
      tag: "Geral",
      date,
      assignee: null,
      assignees: [],
      position: 0,
      revision: 0,
    });
  }
  function selectProject(p: Project) {
    setProjectId(p.id);
    setSection("projects");
    setAssigneeFilter("all");
    setSidebar(false);
    setSettings(false);
  }
  async function move(
    id: string,
    status: Status,
    beforeId?: string,
    byKind = false,
  ) {
    if (busy || id === beforeId) return;
    const current = data.tasks.find((t) => t.id === id);
    if (
      !current ||
      !canEdit(data.projects.find((p) => p.id === current.project)?.role)
    )
      return;
    const target = byKind
      ? colsFor(current.project).find((c) => c.kind === status)?.id
      : status;
    if (!target || !colsFor(current.project).some((c) => c.id === target)) {
      setError(
        "Este projeto não tem uma coluna dessa categoria. Abra a tarefa e selecione uma etapa do próprio projeto.",
      );
      return;
    }
    status = target;
    const others = data.tasks
      .filter(
        (t) =>
          t.id !== id && t.project === current.project && t.status === status,
      )
      .sort((a, b) => a.position - b.position);
    const idx = beforeId ? others.findIndex((t) => t.id === beforeId) : -1;
    const position =
      idx === 0
        ? others[0].position - 1
        : idx > 0
          ? (others[idx - 1].position + others[idx].position) / 2
          : (others.at(-1)?.position || 0) + 1;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Task>(
        "/tasks/" + id,
        json("PATCH", { status, position, revision: current.revision }),
      );
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks
          .map((t) => (t.id === id ? updated : t))
          .sort((a, b) => a.position - b.position),
      }));
      await refresh();
      setToast(
        "Tarefa movida para " +
          colsFor(current.project).find((c) => c.id === status)?.name,
      );
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function endDrag() {
    setDragging("");
    setDragTarget("");
    setOverCard("");
  }
  function taskCard(t: Task) {
    const assigned = data.members.filter(
      (m) => assigneeIds(t).includes(m.id) && m.project_id === t.project,
    );
    const files = data.attachments.filter((a) => a.task_id === t.id);
    const image = files.find((a) => a.type.startsWith("image/"));
    const writable = canEdit(
      data.projects.find((p) => p.id === t.project)?.role,
    );
    const overdue = t.date && t.date < today && kindOf(t) !== "done";
    return (
      <article
        className={`task-card ${kindOf(t) === "done" ? "completed " : ""}${dragging === t.id ? "dragging " : ""}${overCard === t.id && dragging !== t.id ? "drop-before" : ""}`}
        key={t.id}
        draggable={writable && !busy}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", t.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(t.id);
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (writable && dragging && dragging !== t.id) {
            e.preventDefault();
            setOverCard(t.id);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData("text/plain");
          const source = data.tasks.find((s) => s.id === id);
          move(
            id,
            source?.project === t.project ? t.status : kindOf(t),
            source?.project === t.project ? t.id : undefined,
            source?.project !== t.project,
          );
          endDrag();
        }}
        onClick={() => setTask(t)}
        tabIndex={0}
        role="button"
        aria-label={`Abrir tarefa ${t.title}`}
        onKeyDown={(e) => {
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            setTask(t);
          }
        }}
      >
        <div className="card-top">
          <span className={"tag tag-" + t.tag.toLowerCase()}>{t.tag}</span>
          <span className="card-menu">
            <MoreHorizontal size={18} />
          </span>
        </div>
        {image && (
          <div className="card-cover">
            <img src={"/api/attachments/" + image.id} alt="" loading="lazy" />
          </div>
        )}
        <h3>{t.title}</h3>
        {t.description && <p>{t.description}</p>}
        {!!overdueChildren(t).length && (
          <span className="subtask-alert">
            {overdueChildren(t).length} subtarefa(s) com prazo vencido
          </span>
        )}
        {section !== "projects" && (
          <span className="card-project">
            {data.projects.find((p) => p.id === t.project)?.name}
          </span>
        )}
        <div className="task-meta">
          <span className={"priority priority-" + t.priority}>
            {t.priority === "Alta" ? (
              <ArrowUpRight size={13} />
            ) : t.priority === "Baixa" ? (
              <ArrowDown size={13} />
            ) : (
              <span>≋</span>
            )}
            {t.priority}
          </span>
          {t.date && (
            <span className={"due " + (overdue ? "overdue" : "")}>
              <CalendarDays size={12} />
              {formatDate(t.date)}
              {overdue && " · Atrasada"}
            </span>
          )}
        </div>
        <div className="card-footer">
          {!!t.subtask_total && (
            <span
              className="attachment-count"
              title="Subtarefas concluídas"
              aria-label={`Subtarefas: ${t.subtask_done || 0} de ${t.subtask_total} concluídas`}
            >
              <GitBranch size={13} />
              {t.subtask_done || 0}/{t.subtask_total}
            </span>
          )}
          {!!t.checklist_total && (
            <span
              className="attachment-count checklist-summary"
              title="Itens concluídos"
              aria-label={`Checklist: ${t.checklist_done || 0} de ${t.checklist_total} concluídos`}
            >
              <ListChecks size={13} />
              {t.checklist_done || 0}/{t.checklist_total}
            </span>
          )}
          {!!t.comment_count && (
            <span
              className="attachment-count"
              title="Comentários"
              aria-label={`${t.comment_count} comentários`}
            >
              <MessageSquare size={13} />
              {t.comment_count}
            </span>
          )}
          {files.length > 0 ? (
            <span className="attachment-count">
              <Paperclip size={13} />
              {files.length}
            </span>
          ) : (
            <span className="card-id">#{t.id.slice(0, 6)}</span>
          )}
          <span
            className="assignee-label"
            title={assigned.map((m) => m.name).join(", ")}
          >
            {assigned.length
              ? `${assigned.length} responsável(is)`
              : "Não atribuído"}
          </span>
          <span className="task-assignee-stack">
            {assigned.slice(0, 3).map((person) => (
              <span className="avatar tiny" title={person.name} key={person.id}>
                {initials(person.name)}
              </span>
            ))}
            {assigned.length > 3 && (
              <span
                className="avatar tiny"
                title={assigned
                  .slice(3)
                  .map((m) => m.name)
                  .join(", ")}
              >
                +{assigned.length - 3}
              </span>
            )}
            {!assigned.length && (
              <span className="avatar tiny unassigned">
                <Users size={12} />
              </span>
            )}
          </span>
        </div>
      </article>
    );
  }
  return (
    <div className={"app" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
      <button
        className={"sidebar-scrim " + (sidebar ? "open" : "")}
        aria-label="Fechar menu"
        onClick={() => setSidebar(false)}
      />
      <aside
        id="workspace-sidebar"
        aria-label="Barra lateral"
        className={"sidebar " + (sidebar ? "mobile-open" : "")}
      >
        <a
          className="brand"
          aria-label="ClickDown — Visão geral"
          title="Visão geral"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setSection("overview");
          }}
        >
          <span className="brand-mark">
            <CheckCheck size={24} />
          </span>
          <span className="sidebar-label">clickdown</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">{initials(user.name)[0]}</span>
          <span>
            Workspace de {user.name.split(" ")[0]}
            <small>Projetos & pessoas</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          <button
            aria-label="Visão geral"
            title="Visão geral"
            className={section === "overview" ? "active" : ""}
            onClick={() => {
              setSection("overview");
              setSidebar(false);
            }}
          >
            <LayoutDashboard size={18} />
            <span className="sidebar-label">Visão geral</span>
          </button>
          <button
            aria-label="Minhas tarefas"
            title="Minhas tarefas"
            className={section === "mine" ? "active" : ""}
            onClick={() => {
              setSection("mine");
              setAssigneeFilter("all");
              setSidebar(false);
            }}
          >
            <CheckCheck size={18} />
            <span className="sidebar-label">Minhas tarefas</span>
            <span className="nav-count">
              {
                data.tasks.filter(
                  (t) =>
                    (assigneeIds(t).includes(user.id) ||
                      childrenOf(t).some(
                        (s) =>
                          assigneeIds(s).includes(user.id) &&
                          colsFor(t.project).find((c) => c.id === s.status)
                            ?.kind !== "done",
                      )) &&
                    kindOf(t) !== "done",
                ).length
              }
            </span>
          </button>
          <button
            aria-label="Calendário"
            title="Calendário"
            className={
              view === "calendar" &&
              section !== "trash" &&
              section !== "activity" &&
              section !== "archive"
                ? "active"
                : ""
            }
            onClick={() => {
              setView("calendar");
              if (
                section === "trash" ||
                section === "activity" ||
                section === "archive"
              )
                setSection("projects");
              setSidebar(false);
            }}
          >
            <CalendarDays size={18} />
            <span className="sidebar-label">Calendário</span>
          </button>
          <button
            type="button"
            aria-label="Arquivados"
            title="Arquivados"
            className={section === "archive" ? "active" : ""}
            onClick={() => {
              setSection("archive");
              setSidebar(false);
            }}
          >
            <Archive size={19} />
            <span className="sidebar-label">Arquivados</span>
            {!!data.archived_count && (
              <span className="nav-count">{data.archived_count}</span>
            )}
          </button>
          <button
            aria-label="Lixeira"
            title="Lixeira"
            className={section === "trash" ? "active" : ""}
            onClick={() => {
              setSection("trash");
              setSidebar(false);
            }}
          >
            <Trash2 size={18} />
            <span className="sidebar-label">Lixeira</span>
            {!!data.trash_count && (
              <span className="nav-count">{data.trash_count}</span>
            )}
          </button>
          <button
            aria-label="Registro de atividades"
            title="Registro de atividades"
            className={section === "activity" ? "active" : ""}
            onClick={() => {
              setSection("activity");
              setSidebar(false);
            }}
          >
            <History size={18} />
            <span className="sidebar-label">Registro de atividades</span>
          </button>
        </nav>
        <div className="nav-caption project-caption">
          <span className="sidebar-label">MEUS PROJETOS</span>
          <button
            aria-label="Adicionar projeto"
            disabled={!!user.is_demo}
            title={
              user.is_demo
                ? "Crie projetos na sua conta pessoal"
                : "Novo projeto"
            }
            onClick={() => setProjectModal(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="project-nav">
          {data.projects.map((p) => (
            <button
              key={p.id}
              aria-label={p.name}
              title={p.name}
              className={
                project?.id === p.id && section === "projects" ? "selected" : ""
              }
              onClick={() => selectProject(p)}
            >
              <span className="project-dot" style={{ background: p.color }}>
                <span className="project-initial" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              </span>
              <span className="sidebar-label">{p.name}</span>
              {project?.id === p.id && section === "projects" && (
                <ChevronRight size={14} />
              )}
            </button>
          ))}
          <button
            className="add-project"
            aria-label="Novo projeto"
            disabled={!!user.is_demo}
            title={
              user.is_demo
                ? "Crie projetos na sua conta pessoal"
                : "Novo projeto"
            }
            onClick={() => setProjectModal(true)}
          >
            <Plus size={16} />
            <span className="sidebar-label">Novo projeto</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className="help-link"
            aria-label="Ajuda e informações"
            title="Ajuda e informações"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={17} />
            <span className="sidebar-label">Ajuda e informações</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar" title={user.name + " · " + user.email}>
              {initials(user.name)}
            </span>
            <span className="profile-details">
              {user.name}
              <small title={user.email}>{user.email}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sair da conta"
              title="Sair da conta"
              onClick={() =>
                action(async () => {
                  await api("/auth/logout", { method: "POST" });
                  logout();
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            aria-label={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            title={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            aria-controls="workspace-sidebar"
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
          <button
            className="mobile-menu icon-button"
            aria-label="Abrir menu"
            aria-controls="workspace-sidebar"
            aria-expanded={sidebar}
            onClick={() => setSidebar(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <Folder size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {section === "projects"
                ? project?.name || "Seus projetos"
                : section === "mine"
                  ? "Minhas tarefas"
                  : section === "archive"
                    ? "Arquivados"
                    : section === "trash"
                      ? "Lixeira"
                      : section === "activity"
                        ? "Registro de atividades"
                        : "Visão geral"}
            </strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-button inbox-bell"
              aria-label={`Notificações${data.unread_notifications ? ": " + data.unread_notifications + " não lidas" : ""}`}
              onClick={() => setNotifications(true)}
            >
              <Bell size={18} />
              {!!data.unread_notifications && (
                <span>
                  {data.unread_notifications > 9
                    ? "9+"
                    : data.unread_notifications}
                </span>
              )}
            </button>
            <span className={"saved " + (syncError ? "sync-failed" : "")}>
              <span />
              {syncError ? "Sem conexão" : "Conectado ao workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="Atualizar dados"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  await refresh();
                  setToast("Workspace atualizado");
                } catch (e) {
                  setSyncError((e as Error).message);
                } finally {
                  setSyncing(false);
                }
              }}
            >
              <RefreshCw size={16} className={syncing ? "spin" : ""} />
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label={
                theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
              }
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="avatar small" title={user.name}>
              {initials(user.name)}
            </span>
          </div>
        </header>
        <div className="content">
          {user.is_demo && (
            <div className="demo-banner">
              <span className="demo-banner-icon">✧</span>
              <div>
                <strong>Ambiente de demonstração</strong>
                <p>
                  Dados fictícios e ambiente separado por navegador. Troque de
                  perfil para testar as permissões.
                </p>
              </div>
              <label>
                <span>Explorar como</span>
                <select
                  aria-label="Trocar perfil demo"
                  value={user.demo_role || "owner"}
                  disabled={busy}
                  onChange={(e) => {
                    const role = e.target.value;
                    action(async () => {
                      const result = await api(
                        "/demo/login",
                        json("POST", { role }),
                      );
                      onSwitchUser?.(result.user);
                    });
                  }}
                >
                  {Object.entries(roles).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {syncError && (
            <div className="error-message sync-alert" role="alert">
              Não foi possível atualizar: {syncError}{" "}
              <button onClick={() => action(refresh)}>Tentar novamente</button>
            </div>
          )}
          {error && (
            <div className="error-message dismissible" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Fechar aviso"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="loading-screen inline">
              <LoaderCircle size={25} className="spin" />
              <p>Carregando projetos e tarefas…</p>
            </div>
          ) : section === "activity" ? (
            <ProjectActivity
              refreshToken={data.activity_cursor || 0}
              projects={data.projects}
              openTask={openNotificationTask}
            />
          ) : section === "archive" ? (
            <ArchiveView
              refreshToken={data.activity_cursor}
              refresh={refresh}
              onRestored={setToast}
              openTask={async (id) => {
                setArchivedDetails(
                  await api<ArchivedDetails>(`/archive/${id}`),
                );
              }}
            />
          ) : section === "trash" ? (
            <TrashView refresh={refresh} onRestored={setToast} />
          ) : !project ? (
            <div className="onboarding">
              <span className="onboarding-icon">
                <LayoutGrid size={38} />
              </span>
              <h1>Nenhum projeto disponível</h1>
              <p>Crie um projeto para adicionar tarefas e membros.</p>
              <button
                className="primary-button"
                disabled={!!user.is_demo}
                onClick={() => setProjectModal(true)}
              >
                <Plus size={18} />
                Criar projeto
              </button>
              <div className="onboarding-features">
                <span>
                  <Users size={16} />
                  Pessoas e papéis
                </span>
                <span>
                  <Paperclip size={16} />
                  Mídias e arquivos
                </span>
                <span>
                  <CheckCheck size={16} />
                  Status e prazos
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div className="title-row">
                  <h1>
                    {section === "projects"
                      ? project.name
                      : section === "mine"
                        ? "Minhas tarefas"
                        : "Visão geral"}
                    <span className="title-star" aria-hidden="true">
                      ✳
                    </span>
                  </h1>
                  <div className="heading-actions">
                    {section === "projects" && canManage(project.role) && (
                      <button
                        className="outline-button edit-project-button"
                        onClick={() => setSettings(true)}
                      >
                        <Pencil size={15} />
                        Editar projeto
                      </button>
                    )}
                    {section === "projects" && canManage(project.role) && (
                      <button
                        className="outline-button"
                        onClick={() => setBoardSettings(true)}
                      >
                        <Settings2 size={15} />
                        Colunas
                      </button>
                    )}
                    {section === "projects" && (
                      <button
                        className="outline-button team-button"
                        onClick={() => setSettings(true)}
                      >
                        <Users size={16} />
                        Equipe<span>{members.length}</span>
                      </button>
                    )}
                  </div>
                </div>
                <p className="subtitle">
                  {section === "projects"
                    ? project.description || "Tarefas e equipe do projeto."
                    : section === "mine"
                      ? "Todas as tarefas atribuídas a você, em um só lugar."
                      : "Resumo dos projetos e tarefas."}
                </p>
                {section === "projects" && (
                  <div className="project-subline">
                    <button
                      className="member-stack"
                      onClick={() => setSettings(true)}
                      aria-label="Ver equipe"
                    >
                      {members.slice(0, 4).map((m) => (
                        <span className="avatar tiny" key={m.id} title={m.name}>
                          {initials(m.name)}
                        </span>
                      ))}
                      {members.length > 4 && (
                        <span className="avatar tiny">
                          +{members.length - 4}
                        </span>
                      )}
                    </button>
                    <span className="project-lead">
                      Responsável:{" "}
                      <strong>
                        {members.find((m) => m.id === project.lead_id)?.name ||
                          "Não definido"}
                      </strong>
                    </span>
                    <span className="role-badge">{roles[project.role]}</span>
                  </div>
                )}
              </div>
              <div className="stats">
                <div>
                  <span className="stat-icon purple">
                    <Folder size={20} />
                  </span>
                  <span>
                    <small>Total de tarefas</small>
                    <strong>{String(scoped.length).padStart(2, "0")}</strong>
                  </span>
                </div>
                <div>
                  <span className="stat-icon amber">
                    <Circle size={20} />
                  </span>
                  <span>
                    <small>Em andamento</small>
                    <strong>
                      {String(
                        scoped.filter((t) => kindOf(t) === "doing").length,
                      ).padStart(2, "0")}
                    </strong>
                  </span>
                </div>
                <div>
                  <span className="stat-icon green">
                    <CheckCheck size={21} />
                  </span>
                  <span>
                    <small>Concluídas</small>
                    <strong>{String(completed).padStart(2, "0")}</strong>
                  </span>
                </div>
                <div className="progress-stat">
                  <div>
                    <small>
                      Progresso{" "}
                      {section === "projects" ? "do projeto" : "das tarefas"}
                    </small>
                    <strong>
                      {progress}
                      <span>%</span>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: progress + "%" }} />
                  </div>
                  <small>
                    {scoped.filter(needsAttention).length > 0
                      ? `${scoped.filter(needsAttention).length} tarefa(s) precisam de atenção`
                      : "Nenhuma tarefa atrasada."}
                  </small>
                </div>
              </div>
              <div className="view-toolbar">
                <div className="view-tabs">
                  {[
                    { id: "board", label: "Quadro", icon: LayoutGrid },
                    { id: "list", label: "Lista", icon: List },
                    { id: "calendar", label: "Calendário", icon: CalendarDays },
                  ].map((v) => (
                    <button
                      key={v.id}
                      className={view === v.id ? "active" : ""}
                      onClick={() => setView(v.id)}
                    >
                      <v.icon size={16} />
                      {v.label}
                    </button>
                  ))}
                </div>
                <span className="private-label">
                  <span />
                  Atualização automática · 10s
                </span>
              </div>
              <div className="board-toolbar">
                <div className="filter-controls">
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Buscar tarefas"
                      placeholder="Buscar por tarefa ou etiqueta…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Limpar busca"
                        onClick={() => setSearch("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <label className="filter">
                    <Settings2 size={15} />
                    <select
                      aria-label="Filtrar prioridade"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      <option value="Todas">Prioridade</option>
                      <option>Alta</option>
                      <option>Média</option>
                      <option>Baixa</option>
                    </select>
                  </label>
                  <label className="filter assignee-filter">
                    <Users size={15} />
                    <select
                      aria-label="Filtrar responsável"
                      value={assigneeFilter}
                      onChange={(e) => setAssigneeFilter(e.target.value)}
                    >
                      <option value="all">Responsável</option>
                      <option value="none">Não atribuído</option>
                      {[
                        ...new Map(
                          (section === "projects" ? members : data.members).map(
                            (m) => [m.id, m],
                          ),
                        ).values(),
                      ].map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(priority !== "Todas" ||
                    assigneeFilter !== "all" ||
                    search) && (
                    <button
                      className="clear-filter"
                      onClick={() => {
                        setPriority("Todas");
                        setAssigneeFilter("all");
                        setSearch("");
                      }}
                    >
                      Limpar
                    </button>
                  )}
                </div>
                {editable && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => newTask()}
                  >
                    <Plus size={17} />
                    Nova tarefa
                  </button>
                )}
              </div>
              {section === "projects" && !editable && (
                <div className="readonly-note">
                  <CircleHelp size={14} />
                  Você tem acesso de leitura. Peça a um administrador para
                  alterar seu papel.
                </div>
              )}
              {view === "board" ? (
                <>
                  <div
                    className="board"
                    style={{
                      gridTemplateColumns: `repeat(${shownColumns.length}, minmax(245px, 1fr))`,
                    }}
                  >
                    {shownColumns.map((col) => (
                      <section
                        className={
                          "column " + (dragTarget === col.id ? "drag-over" : "")
                        }
                        key={col.id}
                        onDragOver={(e) => {
                          if (dragging) {
                            e.preventDefault();
                            setDragTarget(col.id);
                          }
                        }}
                        onDragLeave={(e) => {
                          if (
                            !e.currentTarget.contains(e.relatedTarget as Node)
                          )
                            setDragTarget("");
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          move(
                            e.dataTransfer.getData("text/plain"),
                            col.id,
                            undefined,
                            section !== "projects",
                          );
                          endDrag();
                        }}
                      >
                        <div className="column-header">
                          <span
                            className="status-dot"
                            style={{ background: col.color }}
                          />
                          <h2>{col.name}</h2>
                          <span className="column-count">
                            {
                              filtered.filter((t) => groupOf(t) === col.id)
                                .length
                            }
                          </span>
                          {editable && (
                            <button
                              className="icon-button"
                              aria-label={"Adicionar em " + col.name}
                              onClick={() => newTask(col.id)}
                            >
                              <Plus size={18} />
                            </button>
                          )}
                        </div>
                        <div className="column-cards">
                          {filtered
                            .filter((t) => groupOf(t) === col.id)
                            .sort((a, b) => a.position - b.position)
                            .map(taskCard)}
                          {!filtered.some((t) => groupOf(t) === col.id) && (
                            <div className="column-empty">
                              <ColIcon status={col.kind} />
                              <span>
                                {search ||
                                priority !== "Todas" ||
                                assigneeFilter !== "all"
                                  ? "Nenhuma tarefa com estes filtros"
                                  : col.kind === "done"
                                    ? "Nenhuma tarefa concluída."
                                    : "Nenhuma tarefa nesta coluna."}
                              </span>
                            </div>
                          )}
                          {editable && (
                            <button
                              className="add-task"
                              onClick={() => newTask(col.id)}
                            >
                              <Plus size={15} />
                              Adicionar tarefa
                            </button>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                  <div className="board-hint">
                    <span>
                      <span className="footer-dot" />
                      {editable
                        ? "Arraste para mover ou reordenar. Abra uma tarefa para editar todos os detalhes."
                        : "Abra uma tarefa para consultar detalhes e anexos."}
                    </span>
                    <span>
                      {filtered.length} tarefa{filtered.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </>
              ) : view === "list" ? (
                <div className="list-view">
                  <div className="list-heading">
                    <span>Tarefa</span>
                    <span>Status</span>
                    <span>Responsável</span>
                    <span>Prazo</span>
                  </div>
                  {filtered.length ? (
                    filtered.map((t) => (
                      <div className="list-row" key={t.id}>
                        <button
                          className="list-task"
                          onClick={() => setTask(t)}
                        >
                          {kindOf(t) === "done" ? (
                            <Check size={17} />
                          ) : (
                            <Circle size={17} />
                          )}
                          <strong>{t.title}</strong>
                          <span className={"priority priority-" + t.priority}>
                            {t.priority}
                          </span>
                        </button>
                        <select
                          aria-label={"Status de " + t.title}
                          disabled={
                            busy ||
                            !canEdit(
                              data.projects.find((p) => p.id === t.project)
                                ?.role,
                            )
                          }
                          value={t.status}
                          onChange={(e) => move(t.id, e.target.value as Status)}
                        >
                          {colsFor(t.project).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <span>
                          {data.members
                            .filter(
                              (m) =>
                                assigneeIds(t).includes(m.id) &&
                                m.project_id === t.project,
                            )
                            .map((m) => m.name)
                            .join(", ") || "Não atribuído"}
                        </span>
                        <span
                          className={
                            t.date && t.date < today && kindOf(t) !== "done"
                              ? "overdue"
                              : ""
                          }
                        >
                          {t.date ? formatDate(t.date) : "Sem prazo"}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <Search size={26} />
                      <strong>Nenhuma tarefa por aqui.</strong>
                      <span>Ajuste os filtros ou comece uma nova tarefa.</span>
                    </div>
                  )}
                </div>
              ) : (
                <CalendarView
                  tasks={calendarEntries}
                  taskKind={kindOf}
                  edit={(item) => {
                    const parent = data.tasks.find((t) => t.id === item.id);
                    if (parent) setTask(parent);
                  }}
                  create={
                    editable ? (date) => newTask(undefined, date) : undefined
                  }
                />
              )}
            </>
          )}
        </div>
      </main>
      {archivedDetails && (
        <TaskDialog
          task={archivedDetails.task}
          project={archivedDetails.project}
          members={archivedDetails.members}
          attachments={archivedDetails.attachments}
          archived
          close={() => setArchivedDetails(null)}
          refresh={refresh}
          onSaved={setToast}
          onCreated={() => {}}
        />
      )}
      {task && currentTaskProject && (
        <TaskDialog
          key={task.id || "new"}
          task={task}
          project={currentTaskProject}
          members={data.members.filter((m) => m.project_id === task.project)}
          attachments={data.attachments}
          close={() => setTask(null)}
          refresh={refresh}
          onSaved={setToast}
          onCreated={setTask}
        />
      )}
      {boardSettings && project && (
        <BoardColumnsDialog
          project={project}
          close={() => setBoardSettings(false)}
          refresh={refresh}
          onSaved={setToast}
        />
      )}
      {notifications && (
        <NotificationCenter
          refreshToken={data.activity_cursor || 0}
          close={() => setNotifications(false)}
          refresh={refresh}
          openTask={openNotificationTask}
        />
      )}
      {settings && project && (
        <ProjectDialog
          key={project.id}
          project={project}
          members={members}
          invitations={data.invitations.filter(
            (i) => i.project_id === project.id,
          )}
          close={() => setSettings(false)}
          refresh={refresh}
          onSaved={setToast}
        />
      )}
      {projectModal && (
        <Dialog
          title="Um novo projeto"
          close={() => {
            if (!busy) setProjectModal(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const result = await api(
                  "/projects",
                  json("POST", {
                    name: projectName,
                    description: projectDescription,
                  }),
                );
                await refresh();
                setProjectId(result.id);
                setSection("projects");
                setProjectModal(false);
                setProjectName("");
                setProjectDescription("");
                setError("");
                setToast("Projeto criado.");
              });
            }}
          >
            <p className="dialog-intro">
              Informe o nome e a descrição do projeto.
            </p>
            <label>
              Nome do projeto
              <input
                autoFocus
                required
                maxLength={80}
                placeholder="Ex.: Lançamento do novo produto"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Descrição
              <textarea
                rows={3}
                maxLength={1000}
                placeholder="Descrição do projeto"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                disabled={busy}
              />
            </label>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <button className="primary-button full-width" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Plus size={16} />
              )}
              Criar projeto
            </button>
          </form>
        </Dialog>
      )}
      {help && (
        <Dialog title="Ajuda" close={() => setHelp(false)}>
          <div className="help-content">
            <p>
              Crie projetos, adicione pessoas em <b>Equipe</b> e organize as
              tarefas arrastando os cartões. No celular ou teclado, abra a
              tarefa e altere o campo Status.
            </p>
            <p>
              Seu trabalho e seus anexos são salvos automaticamente no
              workspace. As atualizações de outras pessoas aparecem a cada 10
              segundos, e conflitos de edição são sinalizados.
            </p>
            <h3>Dados do workspace</h3>
            <p>
              Projetos, responsáveis, tarefas, subtarefas, anexos, notificações
              e registros de atividades continuam disponíveis nos seus acessos
              ao aplicativo.
            </p>
            <p>
              O sino reúne suas notificações pessoais. O Registro de atividades
              mostra as alterações dos projetos a que você tem acesso, com
              autor, data e detalhes, inclusive após excluir uma tarefa
              definitivamente.
            </p>
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Fechar notificação"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function ColIcon({ status }: { status: Status }) {
  return status === "done" ? (
    <CheckCheck size={24} />
  ) : status === "doing" ? (
    <Target size={24} />
  ) : status === "review" ? (
    <Search size={24} />
  ) : (
    <Plus size={24} />
  );
}
function CalendarView({
  tasks,
  edit,
  create,
  taskKind,
}: {
  tasks: CalendarEntry[];
  edit: (t: Task) => void;
  create?: (date: string) => void;
  taskKind?: (t: Task) => string;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date().toLocaleDateString("sv");
  return (
    <div className="calendar">
      <div className="calendar-heading">
        <h2>
          {month.toLocaleDateString("pt-BR", {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div>
          <button
            className="icon-button"
            aria-label="Mês anterior"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="outline-button"
            onClick={() =>
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
          >
            Hoje
          </button>
          <button
            className="icon-button"
            aria-label="Próximo mês"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
          <strong className="weekday" key={d}>
            {d}
          </strong>
        ))}
        {Array.from({ length: Math.ceil((days + offset) / 7) * 7 }, (_, i) => {
          const day = i - offset + 1;
          const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return (
            <div
              key={i}
              className={
                "calendar-day " +
                (day < 1 || day > days ? "outside" : "") +
                (date === today ? " today" : "")
              }
            >
              {day > 0 && day <= days && (
                <>
                  <button
                    className="day-number"
                    aria-label={(create ? "Criar tarefa em " : "Dia ") + date}
                    disabled={!create}
                    onClick={() => create?.(date)}
                  >
                    {day}
                    {create && <Plus size={12} />}
                  </button>
                  {tasks
                    .filter((t) => t.date === date)
                    .map((t) => (
                      <button
                        className={
                          "calendar-task status-" + (taskKind?.(t) || t.status)
                        }
                        key={t.calendar_key || t.id}
                        onClick={() => edit(t)}
                        title={
                          t.is_subtask
                            ? `${t.title} · Subtarefa de ${t.parent_title}`
                            : t.title
                        }
                        aria-label={
                          t.is_subtask
                            ? "Abrir subtarefa " + t.title
                            : undefined
                        }
                      >
                        {t.is_subtask && <GitBranch size={10} />}
                        {t.title}
                      </button>
                    ))}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="local-note">
        {tasks.filter((t) => !t.date).length} atividade(s) sem prazo. Abra uma
        tarefa para adicionar uma data.
      </p>
    </div>
  );
}
