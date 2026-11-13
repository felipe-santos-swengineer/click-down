import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GitBranch,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api, json } from "./api";
import { Dialog } from "./components";
import { AssigneePicker } from "./AssigneePicker";
import {
  columns,
  assigneeIds,
  formatDate,
  initialStatus,
  type BoardColumn,
  type Member,
  type Project,
  type StatusKind,
  type Subtask,
} from "./types";

export function BoardColumnsDialog({
  project,
  close,
  refresh,
  onSaved,
}: {
  project: Project;
  close: () => void;
  refresh: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<BoardColumn[]>([]);
  const [original, setOriginal] = useState<BoardColumn[]>([]);
  const [revision, setRevision] = useState(0);
  const [transfers, setTransfers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ columns: BoardColumn[]; revision: number }>(
      `/projects/${project.id}/columns`,
    )
      .then((result) => {
        if (active) {
          setDraft(result.columns);
          setOriginal(result.columns);
          setRevision(result.revision);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  function leave() {
    if (busy) return;
    if (dirty && !confirm("Descartar as alterações nas colunas?")) return;
    close();
  }
  const removed = original.filter((c) => !draft.some((n) => n.id === c.id));
  function update(id: string, patch: Partial<BoardColumn>) {
    setDraft((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function reorder(index: number, offset: number) {
    setDraft((prev) => {
      const next = [...prev];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  return (
    <Dialog title="Configurar colunas" close={leave} wide>
      <p className="dialog-intro">
        Defina as etapas do projeto. A categoria indica como cada coluna conta
        no progresso e nos lembretes.
      </p>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p className="collaboration-placeholder">
          <LoaderCircle size={16} className="spin" />
          Carregando colunas…
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api(
                `/projects/${project.id}/columns`,
                json("PUT", { revision, columns: draft, transfers }),
              );
              onSaved("Colunas atualizadas. As atividades foram preservadas.");
              close();
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="column-editor-list">
            {draft.map((c, i) => (
              <div className="column-editor-row" key={c.id}>
                <span className="column-position">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <input
                  className="column-color"
                  type="color"
                  aria-label={"Cor de " + c.name}
                  value={c.color}
                  disabled={busy}
                  onChange={(e) => update(c.id, { color: e.target.value })}
                />
                <div className="column-editor-fields">
                  <label>
                    Nome da coluna
                    <input
                      aria-label={"Nome da coluna " + (i + 1)}
                      required
                      maxLength={40}
                      value={c.name}
                      disabled={busy}
                      onChange={(e) => update(c.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    Conta como
                    <select
                      aria-label={"Categoria da coluna " + (i + 1)}
                      value={c.kind}
                      disabled={busy}
                      onChange={(e) =>
                        update(c.id, { kind: e.target.value as StatusKind })
                      }
                    >
                      {columns.map((type) => (
                        <option key={type.id} value={type.kind}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="column-editor-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy || i === 0}
                    aria-label={"Mover " + c.name + " para cima"}
                    onClick={() => reorder(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy || i === draft.length - 1}
                    aria-label={"Mover " + c.name + " para baixo"}
                    onClick={() => reorder(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    disabled={busy || draft.length <= 2}
                    aria-label={"Remover coluna " + c.name}
                    onClick={() =>
                      setDraft((prev) => prev.filter((n) => n.id !== c.id))
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="outline-button add-column"
            disabled={busy || draft.length >= 12}
            onClick={() =>
              setDraft((prev) => [
                ...prev,
                {
                  id: "col_" + crypto.randomUUID(),
                  name: "Nova etapa",
                  color: "#9a85ef",
                  kind: "todo",
                },
              ])
            }
          >
            <Plus size={15} />
            Adicionar coluna <span>{draft.length}/12</span>
          </button>
          {!!removed.length && (
            <section className="column-migrations">
              <h3>Selecione a coluna de destino</h3>
              <p>
                Tarefas, subtarefas e itens na lixeira serão movidos juntos.
                Nada será excluído.
              </p>
              {removed.map((c) => (
                <label key={c.id}>
                  Ao remover “{c.name}” (
                  {(c.task_count || 0) + (c.subtask_count || 0)} atividades)
                  <select
                    required
                    aria-label={"Destino de " + c.name}
                    value={transfers[c.id] || ""}
                    disabled={busy}
                    onChange={(e) =>
                      setTransfers((prev) => ({
                        ...prev,
                        [c.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione a coluna de destino</option>
                    {draft.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
          )}
          <p className="panel-footnote">
            Mantenha pelo menos uma etapa de trabalho e uma de conclusão.
            Alterações nas colunas exigem papel de proprietário ou
            administrador.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="outline-button"
              disabled={busy}
              onClick={leave}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={busy || !dirty}>
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              Salvar colunas
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export type Perform = <T>(
  operation: () => Promise<T>,
  apply: (result: T) => void,
) => Promise<void>;
export function SubtasksPanel({
  taskId,
  items,
  members,
  boardColumns,
  editable,
  pending,
  loading,
  perform,
  onChange,
  onDirtyChange,
}: {
  taskId: string;
  items: Subtask[];
  members: Member[];
  boardColumns: BoardColumn[];
  editable: boolean;
  pending: boolean;
  loading: boolean;
  perform: Perform;
  onChange: (items: Subtask[]) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const initial = () => ({
    id: "",
    title: "",
    description: "",
    status: initialStatus(boardColumns),
    assignee: "",
    assignees: [] as string[],
    date: "",
    revision: 0,
  });
  const [draft, setDraft] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const dirty =
    expanded &&
    (!!draft.id ||
      !!draft.title.trim() ||
      !!draft.description.trim() ||
      !!draft.assignees.length ||
      !!draft.date ||
      draft.status !== initialStatus(boardColumns));
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const done = (s: Subtask) =>
    boardColumns.find((c) => c.id === s.status)?.kind === "done";
  const completed = items.filter(done).length;
  const today = new Date().toLocaleDateString("sv");
  function clear() {
    setDraft(initial());
    setExpanded(false);
  }
  async function save() {
    const input = {
      title: draft.title,
      description: draft.description,
      status: draft.status,
      assignees: draft.assignees,
      date: draft.date,
      revision: draft.revision,
    };
    await perform(
      () =>
        api<Subtask>(
          draft.id ? "/subtasks/" + draft.id : `/tasks/${taskId}/subtasks`,
          json(draft.id ? "PATCH" : "POST", input),
        ),
      (saved) => {
        onChange(
          draft.id
            ? items.map((s) => (s.id === saved.id ? saved : s))
            : [...items, saved],
        );
        clear();
      },
    );
  }
  function toggle(s: Subtask) {
    const status = done(s)
      ? initialStatus(boardColumns)
      : boardColumns.find((c) => c.kind === "done")?.id;
    if (!status) return;
    perform(
      () =>
        api<Subtask>(
          "/subtasks/" + s.id,
          json("PATCH", { status, revision: s.revision }),
        ),
      (saved) =>
        onChange(items.map((item) => (item.id === saved.id ? saved : item))),
    );
  }
  return (
    <section className="subtasks-section" aria-label="Subtarefas">
      <div className="section-heading">
        <h3>
          <GitBranch size={17} />
          Subtarefas{" "}
          <span>
            {completed}/{items.length}
          </span>
        </h3>
        {editable && !expanded && (
          <button
            type="button"
            className="outline-button"
            disabled={pending || loading || items.length >= 100}
            onClick={() => {
              setDraft(initial());
              setExpanded(true);
            }}
          >
            <Plus size={14} />
            Nova subtarefa
          </button>
        )}
      </div>
      <p className="subtask-intro">
        Distribua a entrega em atividades com responsáveis e prazos próprios.
      </p>
      {items.length > 0 && (
        <div
          className="checklist-track"
          role="progressbar"
          aria-label="Progresso das subtarefas"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={items.length}
        >
          <span style={{ width: (completed / items.length) * 100 + "%" }} />
        </div>
      )}
      <ul className="subtask-list">
        {(showAll ? items : items.slice(0, 6)).map((s) => (
          <li key={s.id} className={done(s) ? "subtask-done" : ""}>
            <input
              type="checkbox"
              aria-label={"Concluir subtarefa " + s.title}
              checked={done(s)}
              disabled={!editable || pending}
              onChange={() => toggle(s)}
            />
            <div>
              <strong>{s.title}</strong>
              {s.description && <p>{s.description}</p>}
              <div className="subtask-meta">
                <span className="subtask-status">
                  <i
                    style={{
                      background: boardColumns.find((c) => c.id === s.status)
                        ?.color,
                    }}
                  />
                  {boardColumns.find((c) => c.id === s.status)?.name ||
                    s.status}
                </span>
                <span>
                  {members
                    .filter((m) => assigneeIds(s).includes(m.id))
                    .map((m) => m.name)
                    .join(", ") || "Não atribuído"}
                </span>
                {s.date && (
                  <span className={!done(s) && s.date < today ? "overdue" : ""}>
                    {formatDate(s.date)}
                  </span>
                )}
              </div>
            </div>
            {editable && (
              <div className="subtask-actions">
                <button
                  type="button"
                  className="icon-button"
                  disabled={pending}
                  aria-label={"Editar subtarefa " + s.title}
                  onClick={() => {
                    if (dirty && !confirm("Descartar o rascunho da subtarefa?"))
                      return;
                    setDraft({
                      id: s.id,
                      title: s.title,
                      description: s.description,
                      status: s.status,
                      assignee: s.assignee || "",
                      assignees: assigneeIds(s),
                      date: s.date,
                      revision: s.revision,
                    });
                    setExpanded(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  disabled={pending}
                  aria-label={"Mover subtarefa " + s.title + " para lixeira"}
                  onClick={() => {
                    if (confirm("Mover esta subtarefa para a lixeira?"))
                      perform(
                        () =>
                          api(`/subtasks/${s.id}?revision=${s.revision}`, {
                            method: "DELETE",
                          }),
                        () => {
                          onChange(items.filter((item) => item.id !== s.id));
                          if (draft.id === s.id) clear();
                        },
                      );
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!loading && !items.length && !expanded && (
        <div className="subtasks-empty">
          <GitBranch size={20} />
          <span>Nenhuma subtarefa.</span>
        </div>
      )}
      {items.length > 6 && (
        <button
          type="button"
          className="subtasks-more"
          onClick={() => setShowAll(!showAll)}
        >
          <ChevronDown size={13} />
          {showAll
            ? "Mostrar menos"
            : `Ver todas as ${items.length} subtarefas`}
        </button>
      )}
      {editable && expanded && (
        <form
          className="subtask-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="section-heading">
            <h3>{draft.id ? "Editar subtarefa" : "Nova subtarefa"}</h3>
            <button
              type="button"
              className="icon-button"
              disabled={pending}
              aria-label="Fechar formulário da subtarefa"
              onClick={() => {
                if (dirty && !confirm("Descartar o rascunho da subtarefa?"))
                  return;
                clear();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <fieldset disabled={pending}>
            <label>
              Título da subtarefa
              <input
                autoFocus
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Título da subtarefa"
              />
            </label>
            <label>
              Descrição da subtarefa
              <textarea
                rows={2}
                maxLength={4000}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            <div className="form-grid">
              <div className="span-two">
                <AssigneePicker
                  label="Responsáveis pela subtarefa"
                  value={draft.assignees}
                  members={members}
                  onChange={(ids) => setDraft({ ...draft, assignees: ids })}
                  disabled={pending}
                />
              </div>
              <label>
                Prazo da subtarefa
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <label className="span-two">
                Status da subtarefa
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value })
                  }
                >
                  {!boardColumns.some((c) => c.id === draft.status) && (
                    <option value={draft.status} disabled>
                      Etapa removida. Selecione outra.
                    </option>
                  )}
                  {boardColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <div className="subtask-form-actions">
            <button
              type="button"
              className="outline-button"
              disabled={pending}
              onClick={() => {
                if (dirty && !confirm("Descartar o rascunho da subtarefa?"))
                  return;
                clear();
              }}
            >
              Cancelar subtarefa
            </button>
            <button
              className="primary-button"
              disabled={pending || !draft.title.trim()}
            >
              {pending ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              Salvar subtarefa
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
