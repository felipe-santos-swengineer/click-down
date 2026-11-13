import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Check,
  CheckCheck,
  Download,
  FileText,
  LoaderCircle,
  LogIn,
  Paperclip,
  Plus,
  Shield,
  Trash2,
  UploadCloud,
  Users,
  X,
  Archive,
} from "lucide-react";
import { api, json } from "./api";
import { TaskCollaboration } from "./TaskCollaboration";
import { AssigneePicker } from "./AssigneePicker";
import {
  canEdit,
  assigneeIds,
  canManage,
  columns,
  projectColumns,
  initials,
  roles,
  type Attachment,
  type Invitation,
  type Member,
  type Project,
  type Role,
  type Task,
  type User,
  type DemoProfile,
} from "./types";

export function Dialog({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const container = ref.current!;
    const selector =
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],video[controls],audio[controls]";
    (
      (container.querySelector("[autofocus]") as HTMLElement) ||
      (container.querySelector(selector) as HTMLElement)
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const elements = [
          ...container.querySelectorAll<HTMLElement>(selector),
        ].filter((el) => el.offsetParent !== null);
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Fechar diálogo"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoProfiles, setDemoProfiles] = useState<DemoProfile[]>([]);
  useEffect(() => {
    let active = true;
    api<{ enabled: boolean; profiles: DemoProfile[] }>("/demo/profiles")
      .then((result) => {
        if (active && result.enabled) setDemoProfiles(result.profiles);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function enterDemo(role: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/demo/login", json("POST", { role }));
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/auth/" + (register ? "register" : "login"),
        json("POST", Object.fromEntries(data)),
      );
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <a className="brand">
          <span className="brand-mark">
            <CheckCheck size={25} />
          </span>
          clickdown<span className="brand-dot">.</span>
        </a>
        <h1>Gerenciamento de projetos e tarefas</h1>
        <p>Organize tarefas, responsáveis, prazos e arquivos da equipe.</p>
        <div className="auth-demo">
          <div className="demo-column">
            <span>
              Em andamento <b>2</b>
            </span>
            <div>
              <span className="tag">Design</span>
              <strong>Revisar interface</strong>
              <p>Verificar navegação e formulários.</p>
              <span className="avatar tiny">AM</span>
              <span className="avatar tiny">JP</span>
            </div>
          </div>
          <div className="demo-column">
            <span>
              Concluído <b>1</b>
            </span>
            <div>
              <span className="tag green">Estratégia</span>
              <strong>
                <Check size={14} /> Escopo aprovado
              </strong>
              <div className="demo-progress" />
            </div>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-badge">
            <Shield size={15} />
            Acesso à conta
          </span>
          <h2>{register ? "Criar conta" : "Entrar"}</h2>
          <p>
            {register
              ? new URLSearchParams(location.search).has("invite")
                ? "Você recebeu um convite. Cadastre-se com o e-mail convidado."
                : "Crie uma conta para acessar os projetos."
              : "Informe seu e-mail e senha."}
          </p>
          {register && (
            <label>
              Seu nome
              <input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                placeholder="Nome completo"
              />
            </label>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="voce@exemplo.com"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              required
              minLength={register ? 10 : 1}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={register ? "Pelo menos 10 caracteres" : "Sua senha"}
            />
          </label>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <LogIn size={17} />
            )}{" "}
            {register ? "Criar minha conta" : "Entrar no workspace"}
          </button>
          <div className="auth-switch">
            {register ? "Já tem uma conta?" : "Sua primeira vez por aqui?"}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Entrar" : "Criar conta gratuita"}
            </button>
          </div>
          <div className="auth-footnote">
            <Shield size={14} />
            Seus projetos são acessíveis apenas aos membros convidados.
          </div>
          {!!demoProfiles.length && (
            <section className="demo-login" aria-label="Perfis de demonstração">
              <div className="demo-login-heading">
                <span aria-hidden="true" className="demo-sparkle">
                  ✧
                </span>
                <strong>Perfis de demonstração</strong>
                <span>SEM CADASTRO</span>
              </div>
              <p>
                Escolha um perfil e explore um projeto com dados fictícios,
                separado das contas pessoais.
              </p>
              <div className="demo-profile-grid">
                {demoProfiles.map((profile) => (
                  <button
                    key={profile.role}
                    type="button"
                    disabled={busy}
                    aria-label={`Experimentar como ${profile.title}`}
                    onClick={() => enterDemo(profile.role)}
                  >
                    <span className={"demo-avatar role-" + profile.role}>
                      {initials(profile.name)}
                    </span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.title}</small>
                    </span>
                    <span className="demo-profile-arrow">↗</span>
                    <span className="demo-role-description">
                      {profile.description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </form>
      </section>
    </div>
  );
}

export function TaskDialog({
  task,
  project,
  members,
  attachments,
  close,
  refresh,
  onSaved,
  onCreated,
  archived = false,
}: {
  task: Task;
  project: Project;
  members: Member[];
  attachments: Attachment[];
  close: () => void;
  refresh: () => Promise<void>;
  onSaved: (message: string) => void;
  onCreated: (task: Task) => void;
  archived?: boolean;
}) {
  const [draft, setDraft] = useState(task);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [collaborationState, setCollaborationState] = useState({
    dirty: false,
    pending: false,
  });
  const editable = canEdit(project.role) && !archived;
  const isNew = !task.revision;
  const files = attachments.filter((a) => a.task_id === task.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = JSON.stringify(task) !== JSON.stringify(draft);
  function attemptClose() {
    if (busy || uploading || collaborationState.pending) return;
    if (
      (changed || collaborationState.dirty) &&
      !confirm("Descartar as alterações não salvas?")
    )
      return;
    close();
  }
  function set<K extends keyof Task>(key: K, value: Task[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await api<Task>(
        isNew ? "/tasks" : "/tasks/" + task.id,
        json(isNew ? "POST" : "PATCH", draft),
      );
      if (isNew || collaborationState.dirty) {
        setDraft(saved);
        onCreated(saved);
        onSaved(
          isNew
            ? "Tarefa criada. Adicione anexos, checklist e comentários."
            : "Detalhes salvos. Seu rascunho de atividade foi preservado.",
        );
      } else {
        onSaved("Tarefa atualizada");
        close();
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !confirm(
        "Mover esta tarefa para a lixeira? Anexos, comentários, subtarefas e checklist serão preservados para restauração.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/tasks/${task.id}?revision=${task.revision}`, {
        method: "DELETE",
      });
      await refresh();
      onSaved(
        "Tarefa movida para a lixeira. Você pode restaurá-la pelo menu Lixeira.",
      );
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archiveTask() {
    if (
      (changed || collaborationState.dirty) &&
      !confirm("Arquivar sem salvar as alterações pendentes?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/tasks/${task.id}/archive`,
        json("POST", { revision: task.revision }),
      );
      onSaved("Tarefa arquivada. Consulte ou restaure pelo menu Arquivados.");
      close();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setFileError("");
    if (file.size > 20 * 1024 * 1024) {
      setFileError("O arquivo deve ter até 20 MB.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/tasks/${task.id}/attachments`, {
        method: "POST",
        body: form,
      });
      await refresh();
      onSaved("Anexo adicionado");
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function removeFile(a: Attachment) {
    if (!confirm(`Remover o anexo “${a.name}”?`)) return;
    setUploading(true);
    try {
      await api("/attachments/" + a.id, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <Dialog
      title={
        archived
          ? "Tarefa arquivada"
          : isNew
            ? "Nova tarefa"
            : editable
              ? "Detalhes da tarefa"
              : "Visualizar tarefa"
      }
      close={attemptClose}
      wide
    >
      {archived && (
        <p className="archive-readonly-note">
          <Archive size={15} />
          Consulta de tarefa arquivada. Restaure em Arquivados para editar.
        </p>
      )}
      <form onSubmit={save}>
        <div className="task-project-label">
          <span className="project-dot" style={{ background: project.color }} />
          {project.name}
          <span className="role-badge">{roles[project.role]}</span>
        </div>
        <fieldset disabled={!editable || busy || collaborationState.pending}>
          <label>
            Título
            <input
              autoFocus
              required
              maxLength={160}
              placeholder="Título da tarefa"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              rows={4}
              maxLength={10000}
              placeholder="Descrição da tarefa"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) =>
                  set("status", e.target.value as Task["status"])
                }
              >
                {!projectColumns(project).some(
                  (c) => c.id === draft.status,
                ) && (
                  <option value={draft.status} disabled>
                    Etapa removida. Escolha outra.
                  </option>
                )}
                {projectColumns(project).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridade
              <select
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                {["Alta", "Média", "Baixa"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <div className="span-two">
              <AssigneePicker
                label="Responsáveis pela tarefa"
                value={assigneeIds(draft)}
                members={members}
                onChange={(ids) => set("assignees", ids)}
                disabled={!editable || busy || collaborationState.pending}
              />
            </div>
            <label>
              Prazo
              <input
                type="date"
                value={draft.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </label>
            <label className="span-two">
              Etiqueta
              <input
                list="task-tags"
                maxLength={40}
                required
                value={draft.tag}
                onChange={(e) => set("tag", e.target.value)}
              />
              <datalist id="task-tags">
                {[
                  "Design",
                  "Desenvolvimento",
                  "Conteúdo",
                  "Pesquisa",
                  "Estratégia",
                  "Organização",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </datalist>
            </label>
          </div>
        </fieldset>
        <section className="attachments">
          <div className="section-heading">
            <h3>
              <Paperclip size={16} />
              Anexos <span>{files.length}/10</span>
            </h3>
            {editable && !isNew && (
              <button
                type="button"
                className="outline-button"
                disabled={
                  uploading ||
                  busy ||
                  collaborationState.pending ||
                  files.length >= 10
                }
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Plus size={15} />
                )}
                Adicionar arquivo
              </button>
            )}
          </div>
          {isNew ? (
            <div className="attachment-empty">
              <UploadCloud size={22} />
              <span>
                Salve a tarefa para adicionar imagens, vídeos, áudios e
                documentos.
              </span>
            </div>
          ) : files.length ? (
            <div className="attachment-grid">
              {files.map((a) => (
                <div className="attachment-card" key={a.id}>
                  {a.type.startsWith("image/") ? (
                    <a
                      href={"/api/attachments/" + a.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={"/api/attachments/" + a.id}
                        alt={a.name}
                        loading="lazy"
                      />
                    </a>
                  ) : a.type.startsWith("video/") ? (
                    <video
                      controls
                      preload="metadata"
                      src={"/api/attachments/" + a.id}
                    />
                  ) : a.type.startsWith("audio/") ? (
                    <audio
                      controls
                      preload="metadata"
                      src={"/api/attachments/" + a.id}
                    />
                  ) : (
                    <div className="pdf-preview">
                      <FileText size={26} />
                      <span>Documento PDF</span>
                    </div>
                  )}
                  <div className="attachment-info">
                    <span title={a.name}>
                      {a.name}
                      <small>
                        {a.size >= 1024 * 1024
                          ? (a.size / 1024 / 1024).toFixed(1) + " MB"
                          : Math.ceil(a.size / 1024) + " KB"}
                      </small>
                    </span>
                    <a
                      href={"/api/attachments/" + a.id + "?download=1"}
                      className="icon-button"
                      aria-label={"Baixar " + a.name}
                    >
                      <Download size={15} />
                    </a>
                    {editable && (
                      <button
                        type="button"
                        disabled={
                          uploading || busy || collaborationState.pending
                        }
                        className="icon-button danger"
                        aria-label={"Remover " + a.name}
                        onClick={() => removeFile(a)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              disabled={
                !editable || uploading || busy || collaborationState.pending
              }
              className="upload-zone"
              onClick={() => fileRef.current?.click()}
            >
              <UploadCloud size={24} />
              <strong>
                {uploading ? "Enviando arquivo…" : "Adicionar anexo"}
              </strong>
              <span>
                Imagens, vídeos, áudios ou PDF · até 20 MB por arquivo
              </span>
            </button>
          )}
          <input
            type="file"
            hidden
            ref={fileRef}
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          {fileError && (
            <div className="error-message" role="alert">
              {fileError}
            </div>
          )}
        </section>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          {editable && !isNew && (
            <button
              type="button"
              className="outline-button"
              disabled={busy || uploading || collaborationState.pending}
              onClick={archiveTask}
            >
              <Archive size={15} />
              Arquivar
            </button>
          )}
          {editable && !isNew && (
            <button
              type="button"
              className="delete-button"
              disabled={busy || uploading || collaborationState.pending}
              onClick={remove}
            >
              <Trash2 size={15} />
              Mover para lixeira
            </button>
          )}
          <button
            type="button"
            className="outline-button"
            disabled={busy || uploading || collaborationState.pending}
            onClick={attemptClose}
          >
            {editable ? "Cancelar" : "Fechar"}
          </button>
          {editable && (
            <button
              className="primary-button"
              disabled={busy || uploading || collaborationState.pending}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Salvar tarefa
            </button>
          )}
        </div>
      </form>
      {!isNew && (
        <TaskCollaboration
          taskId={task.id}
          boardColumns={projectColumns(project)}
          members={members}
          editable={editable && !busy && !uploading}
          refresh={refresh}
          refreshKey={`${task.revision}:${files.map((f) => f.id).join(",")}`}
          onDraftStateChange={setCollaborationState}
        />
      )}
    </Dialog>
  );
}

export function ProjectDialog({
  project,
  members,
  invitations,
  close,
  refresh,
  onSaved,
}: {
  project: Project;
  members: Member[];
  invitations: Invitation[];
  close: () => void;
  refresh: () => Promise<void>;
  onSaved: (s: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [lead, setLead] = useState(project.lead_id || "");
  const [revision, setRevision] = useState(project.revision || 1);
  const [baseline, setBaseline] = useState({
    name: project.name,
    description: project.description,
    lead: project.lead_id || "",
  });
  const projectDirty =
    name !== baseline.name ||
    description !== baseline.description ||
    lead !== baseline.lead;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = canManage(project.role);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (message) onSaved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Equipe e configurações"
      close={() => {
        if (
          !busy &&
          (!projectDirty ||
            confirm("Descartar as alterações não salvas do projeto?"))
        )
          close();
      }}
      wide
    >
      <div className="project-settings-intro">
        <Users size={20} />
        <p>Configure o projeto e os papéis dos membros.</p>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(
            () =>
              api(
                "/projects/" + project.id,
                json("PATCH", {
                  name,
                  description,
                  lead_id: lead || null,
                  revision,
                }),
              ).then((result) => {
                if (result.revision) setRevision(result.revision);
                setBaseline({ name, description, lead });
              }),
            "Projeto atualizado",
          );
        }}
      >
        <fieldset disabled={!manage || busy}>
          <label>
            Nome do projeto
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Descrição
            <textarea
              rows={2}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Responsável pelo quadro
            <select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Não definido</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {manage && (
          <button className="outline-button" disabled={busy}>
            <Check size={15} />
            Salvar configurações
          </button>
        )}
      </form>
      <div className="section-heading team-heading">
        <h3>
          Equipe do projeto <span>{members.length}</span>
        </h3>
        <span className="role-badge">Você: {roles[project.role]}</span>
      </div>
      <div className="member-list">
        {members.map((m) => (
          <div className="member-row" key={m.id}>
            <span className="avatar">{initials(m.name)}</span>
            <div className="member-info">
              <strong>{m.name}</strong>
              <small>{m.email}</small>
            </div>
            {manage &&
            m.role !== "owner" &&
            (project.role === "owner" || m.role !== "admin") ? (
              <>
                <select
                  aria-label={"Papel de " + m.name}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) =>
                    action(
                      () =>
                        api(
                          `/projects/${project.id}/members/${m.id}`,
                          json("PATCH", { role: e.target.value }),
                        ),
                      "Papel atualizado",
                    )
                  }
                >
                  {(project.role === "owner"
                    ? ["admin", "editor", "viewer"]
                    : ["editor", "viewer"]
                  ).map((r) => (
                    <option key={r} value={r}>
                      {roles[r as Role]}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button danger"
                  disabled={busy}
                  aria-label={"Remover " + m.name}
                  onClick={() => {
                    if (
                      confirm(
                        `Remover ${m.name} do projeto? Essa pessoa perderá acesso ao quadro e anexos.`,
                      )
                    )
                      action(
                        () =>
                          api(`/projects/${project.id}/members/${m.id}`, {
                            method: "DELETE",
                          }),
                        "Membro removido",
                      );
                  }}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <span className="role-badge">{roles[m.role]}</span>
            )}
          </div>
        ))}
      </div>
      {invitations.length > 0 && (
        <>
          <h4 className="pending-heading">Convites pendentes</h4>
          {invitations.map((i) => (
            <div className="member-row" key={i.id}>
              <span className="avatar">
                <Users size={15} />
              </span>
              <div className="member-info">
                <strong>{i.email}</strong>
                <small>Aguardando aceite · {roles[i.role]}</small>
              </div>
              <button
                className="outline-button invite-copy"
                disabled={busy}
                onClick={async () => {
                  const link =
                    location.origin + location.pathname + "?invite=" + i.id;
                  try {
                    await navigator.clipboard.writeText(link);
                    onSaved(
                      "Link copiado. Envie diretamente à pessoa convidada.",
                    );
                  } catch {
                    window.prompt(
                      "Copie e compartilhe o link do convite:",
                      link,
                    );
                  }
                }}
              >
                Copiar link
              </button>
              {(project.role === "owner" || i.role !== "admin") && (
                <button
                  className="icon-button danger"
                  aria-label={"Cancelar convite de " + i.email}
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/projects/${project.id}/invitations/${i.id}`, {
                          method: "DELETE",
                        }),
                      "Convite cancelado",
                    )
                  }
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {manage && (
        <form
          className="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const result = await api(
                `/projects/${project.id}/members`,
                json("POST", { email, role }),
              );
              setEmail("");
              onSaved(
                result.pending
                  ? "Convite registrado. Copie o link na lista de convites pendentes."
                  : "Membro adicionado ao projeto",
              );
            }, "");
          }}
        >
          <h3>Traga alguém para o projeto</h3>
          <div className="invite-inputs">
            <input
              aria-label="E-mail do novo membro"
              type="email"
              required
              maxLength={254}
              placeholder="pessoa@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <select
              aria-label="Papel do novo membro"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={busy}
            >
              {(project.role === "owner"
                ? ["admin", "editor", "viewer"]
                : ["editor", "viewer"]
              ).map((r) => (
                <option key={r} value={r}>
                  {roles[r as Role]}
                </option>
              ))}
            </select>
            <button className="primary-button" disabled={busy}>
              <Plus size={16} />
              Adicionar
            </button>
          </div>
          <p>
            Quem já tem conta recebe acesso imediato. Para novos usuários, copie
            o link do convite e envie diretamente à pessoa. Ela deve criar conta
            com este e-mail e aceitar o link. Não enviamos e-mails.
          </p>
        </form>
      )}
      <div className="permissions-guide">
        <Shield size={16} />
        <div>
          <strong>Permissões por papel</strong>
          <p>
            <b>Proprietário:</b> gerencia todo o projeto e os administradores.
            <br />
            <b>Administrador:</b> configura o quadro e gerencia editores e
            leitores.
            <br />
            <b>Editor:</b> cria e edita tarefas, responsáveis e anexos.
            <br />
            <b>Leitor:</b> consulta tarefas e baixa anexos.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
