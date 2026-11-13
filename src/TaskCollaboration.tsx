import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AtSign,
  Check,
  CheckCheck,
  ChevronDown,
  History,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api, json } from "./api";
import {
  columns,
  initials,
  type ChecklistItem,
  type Collaboration,
  type HistoryEntry,
  type Member,
  type Mention,
  type TaskComment,
  type BoardColumn,
} from "./types";
import { SubtasksPanel } from "./BoardsAndSubtasks";

const blank: Collaboration = {
  current_user_id: "",
  comments: [],
  checklist: [],
  history: [],
};
const stamp = (date: string) =>
  new Date(date).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const fieldNames: Record<string, string> = {
  assignees: "Responsáveis",
  column: "Coluna",
  category: "Categoria",
  title: "Título",
  description: "Descrição",
  status: "Status",
  priority: "Prioridade",
  tag: "Etiqueta",
  date: "Prazo",
  assignee: "Responsável",
  position: "Ordem no quadro",
};
function value(field: string, v: string | number | null) {
  if (field === "status" || field === "category")
    return columns.find((c) => c.id === v)?.name || String(v);
  if (!v) return field === "date" ? "Sem prazo" : "Não definido";
  if (field === "date")
    return new Date(String(v) + "T12:00:00").toLocaleDateString("pt-BR");
  return String(v);
}
function eventLabel(h: HistoryEntry) {
  const labels: Record<string, string> = {
    task_created: "criou a tarefa",
    task_imported: "importou a tarefa",
    task_updated: "atualizou a tarefa",
    comment_added: "adicionou um comentário",
    checklist_added: "adicionou um item ao checklist",
    checklist_removed: "removeu um item do checklist",
    checklist_renamed: "renomeou um item do checklist",
    checklist_completed: "concluiu um item do checklist",
    checklist_reopened: "reabriu um item do checklist",
    attachment_added: "adicionou um anexo",
    attachment_removed: "removeu um anexo",
    column_updated: "atualizou a coluna da atividade",
    subtask_created: "criou uma subtarefa",
    subtask_updated: "atualizou uma subtarefa",
    subtask_trashed: "moveu uma subtarefa para a lixeira",
    subtask_restored: "restaurou uma subtarefa",
    subtask_removed: "excluiu definitivamente uma subtarefa",
    subtask_imported: "importou uma subtarefa",
    task_trashed: "moveu a tarefa para a lixeira",
    task_restored: "restaurou a tarefa da lixeira",
    task_archived: "arquivou a tarefa",
    task_unarchived: "restaurou a tarefa arquivada",
  };
  return labels[h.kind] || "atualizou a atividade";
}
export function CommentBody({
  body,
  mentions,
}: {
  body: string;
  mentions: Mention[];
}) {
  const names = [...new Set(mentions.map((m) => "@" + m.name))].sort(
    (a, b) => b.length - a.length,
  );
  const parts: ReactNode[] = [];
  let rest = body;
  let key = 0;
  while (rest) {
    let index = -1;
    let found = "";
    for (const name of names) {
      const at = rest.indexOf(name);
      if (at >= 0 && (index === -1 || at < index)) {
        index = at;
        found = name;
      }
    }
    if (index === -1) {
      parts.push(rest);
      break;
    }
    if (index > 0) parts.push(rest.slice(0, index));
    parts.push(
      <mark className="mention" key={key++}>
        {found}
      </mark>,
    );
    rest = rest.slice(index + found.length);
  }
  return <p className="comment-body">{parts}</p>;
}
export function TaskCollaboration({
  taskId,
  members,
  editable,
  refresh,
  refreshKey,
  onDraftStateChange,
  boardColumns = columns,
}: {
  taskId: string;
  members: Member[];
  editable: boolean;
  refresh: () => Promise<void>;
  refreshKey: string;
  onDraftStateChange: (state: { dirty: boolean; pending: boolean }) => void;
  boardColumns?: BoardColumn[];
}) {
  const [data, setData] = useState<Collaboration>(blank);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState("comments");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [newItem, setNewItem] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [query, setQuery] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [active, setActive] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [subtaskDirty, setSubtaskDirty] = useState(false);
  const dirty =
    !!body.trim() || !!newItem.trim() || editing !== null || subtaskDirty;
  useEffect(() => {
    onDraftStateChange({ dirty, pending });
  }, [dirty, pending, onDraftStateChange]);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await api<Collaboration>(`/tasks/${taskId}/collaboration`);
      if (mounted.current && request === sequence.current) {
        setData(result);
        setLoadError("");
      }
    } catch (e) {
      if (mounted.current && request === sequence.current)
        setLoadError((e as Error).message);
    } finally {
      if (mounted.current && request === sequence.current) setLoading(false);
    }
  }, [taskId]);
  useEffect(() => {
    mounted.current = true;
    load();
    const poll = () => {
      if (!document.hidden && !mutating.current) load();
    };
    const timer = setInterval(poll, 10000);
    window.addEventListener("focus", poll);
    return () => {
      mounted.current = false;
      ++sequence.current;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [load, refreshKey]);
  async function perform<T>(
    operation: () => Promise<T>,
    apply: (result: T) => void,
  ) {
    if (mutating.current) return;
    mutating.current = true;
    ++sequence.current;
    setPending(true);
    setError("");
    try {
      const result = await operation();
      if (mounted.current) apply(result);
      await load();
      try {
        await refresh();
      } catch {
        if (mounted.current)
          setError(
            "Alteração salva. Não foi possível atualizar o resumo do quadro; use o botão Atualizar.",
          );
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      await load();
    } finally {
      mutating.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const completed = data.checklist.filter((c) => c.done).length;
  const percent = data.checklist.length
    ? Math.round((completed / data.checklist.length) * 100)
    : 0;
  const suggestions = query
    ? members
        .filter(
          (m) =>
            m.name
              .toLocaleLowerCase()
              .includes(query.text.toLocaleLowerCase()) ||
            m.email
              .toLocaleLowerCase()
              .includes(query.text.toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
  function inspectMention(text: string, caret: number) {
    const prefix = text.slice(0, caret);
    const match = /(?:^|\s)@([^@\n]*)$/.exec(prefix);
    if (match && match[1].length <= 80) {
      setQuery({
        start: caret - match[1].length - 1,
        end: caret,
        text: match[1],
      });
      setActive(0);
    } else setQuery(null);
  }
  function selectMention(person: Member) {
    if (!query) return;
    const replacement = "@" + person.name + " ";
    setBody(body.slice(0, query.start) + replacement + body.slice(query.end));
    setMentions((prev) => [
      ...prev.filter((m) => m.id !== person.id),
      { id: person.id, name: person.name },
    ]);
    const caret = query.start + replacement.length;
    setQuery(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(caret, caret);
    });
  }
  function addComment() {
    if (!body.trim() || pending) return;
    const selected = mentions.filter((m) => body.includes("@" + m.name));
    perform(
      () =>
        api<TaskComment>(
          `/tasks/${taskId}/comments`,
          json("POST", { body, mentions: selected.map((m) => m.id) }),
        ),
      (comment) => {
        setData((prev) => ({
          ...prev,
          comments: [
            ...prev.comments.filter((c) => c.id !== comment.id),
            comment,
          ],
        }));
        setBody("");
        setMentions([]);
        setQuery(null);
      },
    );
  }
  function toggle(item: ChecklistItem) {
    perform(
      () =>
        api<ChecklistItem>(
          "/checklist/" + item.id,
          json("PATCH", { done: !item.done, revision: item.revision }),
        ),
      (updated) =>
        setData((prev) => ({
          ...prev,
          checklist: prev.checklist.map((c) =>
            c.id === updated.id ? updated : c,
          ),
        })),
    );
  }
  return (
    <section className="task-collaboration" aria-label="Colaboração da tarefa">
      <SubtasksPanel
        taskId={taskId}
        items={data.subtasks || []}
        members={members}
        boardColumns={boardColumns}
        editable={editable}
        pending={pending}
        loading={loading}
        perform={perform}
        onChange={(subtasks) => setData((prev) => ({ ...prev, subtasks }))}
        onDirtyChange={setSubtaskDirty}
      />
      <section className="checklist-section">
        <div className="section-heading">
          <h3>
            <ListChecks size={17} />
            Checklist{" "}
            <span>
              {completed}/{data.checklist.length}
            </span>
          </h3>
          {data.checklist.length > 0 && (
            <span
              className={
                "checklist-percent " + (percent === 100 ? "all-done" : "")
              }
            >
              {percent === 100 && <CheckCheck size={14} />} {percent}%
            </span>
          )}
        </div>
        {data.checklist.length > 0 && (
          <div
            className="checklist-track"
            role="progressbar"
            aria-label="Progresso do checklist"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={data.checklist.length}
          >
            <span style={{ width: percent + "%" }} />
          </div>
        )}
        {loading ? (
          <p className="collaboration-placeholder">
            <LoaderCircle size={15} className="spin" />
            Carregando atividade…
          </p>
        ) : data.checklist.length ? (
          <ul className="checklist-items">
            {data.checklist.map((item) => (
              <li key={item.id} className={item.done ? "is-done" : ""}>
                {editing === item.id && editable ? (
                  <form
                    className="checklist-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editTitle.trim()) return;
                      perform(
                        () =>
                          api<ChecklistItem>(
                            "/checklist/" + item.id,
                            json("PATCH", {
                              title: editTitle,
                              revision: item.revision,
                            }),
                          ),
                        (updated) => {
                          setData((prev) => ({
                            ...prev,
                            checklist: prev.checklist.map((c) =>
                              c.id === updated.id ? updated : c,
                            ),
                          }));
                          setEditing(null);
                        },
                      );
                    }}
                  >
                    <input
                      aria-label="Editar item do checklist"
                      autoFocus
                      required
                      maxLength={240}
                      value={editTitle}
                      disabled={pending}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <button
                      className="icon-button"
                      disabled={pending}
                      aria-label="Salvar item"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={pending}
                      aria-label="Cancelar edição do item"
                      onClick={() => setEditing(null)}
                    >
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <>
                    <label className="checklist-toggle">
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!editable || pending}
                        onChange={() => toggle(item)}
                      />
                      <span>{item.title}</span>
                    </label>
                    {editable && (
                      <div className="checklist-actions">
                        <button
                          type="button"
                          className="icon-button"
                          disabled={pending}
                          aria-label={"Editar " + item.title}
                          onClick={() => {
                            setEditing(item.id);
                            setEditTitle(item.title);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          disabled={pending}
                          aria-label={"Excluir item " + item.title}
                          onClick={() => {
                            if (confirm(`Excluir o item “${item.title}”?`))
                              perform(
                                () =>
                                  api(
                                    `/checklist/${item.id}?revision=${item.revision}`,
                                    { method: "DELETE" },
                                  ),
                                () =>
                                  setData((prev) => ({
                                    ...prev,
                                    checklist: prev.checklist.filter(
                                      (c) => c.id !== item.id,
                                    ),
                                  })),
                              );
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !loadError && (
            <p className="checklist-empty">Nenhum item no checklist.</p>
          )
        )}
        {editable && (
          <form
            className="checklist-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              perform(
                () =>
                  api<ChecklistItem>(
                    `/tasks/${taskId}/checklist`,
                    json("POST", { title: newItem }),
                  ),
                (item) => {
                  setData((prev) => ({
                    ...prev,
                    checklist: [...prev.checklist, item],
                  }));
                  setNewItem("");
                },
              );
            }}
          >
            <Plus size={16} />
            <input
              aria-label="Novo item do checklist"
              maxLength={240}
              placeholder="Novo item do checklist"
              value={newItem}
              disabled={pending || loading || data.checklist.length >= 100}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <button
              className="outline-button"
              disabled={
                pending ||
                loading ||
                !newItem.trim() ||
                data.checklist.length >= 100
              }
            >
              Adicionar item
            </button>
          </form>
        )}
      </section>
      {loadError && (
        <div className="error-message" role="alert">
          Não foi possível carregar a atividade: {loadError}
          <button
            type="button"
            className="icon-button"
            aria-label="Recarregar atividade"
            onClick={load}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <div
        className="activity-tabs"
        role="tablist"
        aria-label="Conversa e histórico"
      >
        <button
          type="button"
          id="comments-tab"
          role="tab"
          aria-selected={tab === "comments"}
          aria-controls="comments-panel"
          className={tab === "comments" ? "active" : ""}
          onClick={() => setTab("comments")}
        >
          <MessageSquare size={16} />
          Comentários<span>{data.comments.length}</span>
        </button>
        <button
          type="button"
          id="history-tab"
          role="tab"
          aria-selected={tab === "history"}
          aria-controls="history-panel"
          className={tab === "history" ? "active" : ""}
          onClick={() => {
            setTab("history");
            setQuery(null);
          }}
        >
          <History size={16} />
          Histórico<span>{data.history.length}</span>
        </button>
      </div>
      <div
        id="comments-panel"
        role="tabpanel"
        aria-labelledby="comments-tab"
        hidden={tab !== "comments"}
      >
        {!loading && !data.comments.length && !loadError && (
          <div className="conversation-empty">
            <MessageSquare size={24} />
            <strong>Nenhum comentário.</strong>
            <p>Adicione um comentário sobre a tarefa.</p>
          </div>
        )}
        <ol className="comment-list">
          {data.comments.map((comment) => (
            <li
              className={
                "comment " +
                (comment.mentions.some((m) => m.id === data.current_user_id)
                  ? "mentions-me"
                  : "")
              }
              key={comment.id}
            >
              <span className="avatar">{initials(comment.author_name)}</span>
              <div className="comment-content">
                <div className="comment-header">
                  <strong>{comment.author_name}</strong>
                  <time dateTime={comment.created}>
                    {stamp(comment.created)}
                  </time>
                </div>
                {comment.mentions.some(
                  (m) => m.id === data.current_user_id,
                ) && (
                  <span className="mentioned-you">
                    <AtSign size={11} />
                    Mencionou você
                  </span>
                )}
                <CommentBody body={comment.body} mentions={comment.mentions} />
              </div>
            </li>
          ))}
        </ol>
        {editable ? (
          <form
            className="comment-composer"
            onSubmit={(e) => {
              e.preventDefault();
              addComment();
            }}
          >
            <label htmlFor="task-comment">Compartilhe uma atualização</label>
            <div className="composer-input">
              <textarea
                id="task-comment"
                ref={textarea}
                rows={3}
                maxLength={4000}
                placeholder="Escreva um comentário… Use @ para mencionar alguém."
                value={body}
                disabled={pending}
                aria-expanded={!!query}
                aria-controls={query ? "mention-suggestions" : undefined}
                aria-describedby="comment-hint"
                onChange={(e) => {
                  setBody(e.target.value);
                  inspectMention(e.target.value, e.target.selectionStart);
                }}
                onClick={(e) =>
                  inspectMention(body, e.currentTarget.selectionStart)
                }
                onKeyDown={(e) => {
                  if (query) {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setQuery(null);
                    }
                    if (
                      suggestions.length &&
                      ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)
                    ) {
                      e.preventDefault();
                      if (e.key === "Enter")
                        selectMention(suggestions[active % suggestions.length]);
                      else
                        setActive(
                          (i) =>
                            (i +
                              (e.key === "ArrowDown"
                                ? 1
                                : suggestions.length - 1)) %
                            suggestions.length,
                        );
                    }
                  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    addComment();
                  }
                }}
              />
              {query && (
                <div
                  id="mention-suggestions"
                  className="mention-suggestions"
                  aria-label="Pessoas para mencionar"
                >
                  <span>MENCIONAR NO PROJETO</span>
                  {suggestions.length ? (
                    suggestions.map((m, i) => (
                      <button
                        type="button"
                        key={m.id}
                        className={active === i ? "active" : ""}
                        aria-label={"Mencionar " + m.name}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectMention(m)}
                      >
                        <span className="avatar tiny">{initials(m.name)}</span>
                        <span>
                          {m.name}
                          <small>{m.email}</small>
                        </span>
                        <AtSign size={13} />
                      </button>
                    ))
                  ) : (
                    <p>Nenhuma pessoa encontrada.</p>
                  )}
                </div>
              )}
            </div>
            <div className="composer-footer">
              <span id="comment-hint">
                <AtSign size={12} />
                Menções ficam destacadas na conversa · {body.length}/4000
              </span>
              <button
                className="primary-button"
                disabled={pending || !body.trim()}
              >
                {pending ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Send size={14} />
                )}
                Comentar
              </button>
            </div>
          </form>
        ) : (
          <p className="collaboration-readonly">
            Seu acesso permite consultar comentários, checklist e histórico.
          </p>
        )}
      </div>
      <div
        id="history-panel"
        role="tabpanel"
        aria-labelledby="history-tab"
        hidden={tab !== "history"}
      >
        {!loading && !data.history.length && !loadError && (
          <div className="conversation-empty">
            <History size={24} />
            <strong>Nenhuma alteração registrada.</strong>
            <p>
              As alterações registradas a partir desta atualização aparecerão
              aqui.
            </p>
          </div>
        )}
        <ol className="history-list">
          {data.history.slice(0, historyLimit).map((h) => (
            <li key={h.id}>
              <span className="history-dot" />
              <div>
                <p>
                  <strong>{h.actor_name}</strong> {eventLabel(h)}.
                </p>
                <time dateTime={h.created}>{stamp(h.created)}</time>
                {h.payload.reason && (
                  <small className="history-reason">{h.payload.reason}</small>
                )}
                {h.payload.changes?.map((change, i) => (
                  <div className="history-change" key={i}>
                    <b>{fieldNames[change.field] || change.field}</b>
                    {change.field === "position" ? (
                      <span>Posição no quadro atualizada</span>
                    ) : (
                      <>
                        <span title={value(change.field, change.before)}>
                          {value(change.field, change.before).slice(0, 200)}
                        </span>
                        <span aria-label="para">→</span>
                        <span title={value(change.field, change.after)}>
                          {value(change.field, change.after).slice(0, 200)}
                        </span>
                      </>
                    )}
                  </div>
                ))}
                {(h.payload.title || h.payload.name) && (
                  <span className="history-subject">
                    {h.payload.title || h.payload.name}
                  </span>
                )}
                {h.kind === "checklist_renamed" && (
                  <div className="history-change">
                    <span>{h.payload.before}</span>
                    <span>→</span>
                    <span>{h.payload.after}</span>
                  </div>
                )}
                {!!h.payload.mentions?.length && (
                  <span className="history-subject">
                    {h.payload.mentions.map((m) => "@" + m.name).join(", ")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        {data.history.length > historyLimit && (
          <button
            type="button"
            className="history-more outline-button"
            onClick={() => setHistoryLimit((n) => n + 20)}
          >
            <ChevronDown size={14} />
            Carregar alterações anteriores
          </button>
        )}
      </div>
    </section>
  );
}
