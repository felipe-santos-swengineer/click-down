import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Eye, RefreshCw, Search } from "lucide-react";
import { api, json } from "./api";
import { canEdit, type ArchivedTask } from "./types";

export function ArchiveView({
  refresh,
  onRestored,
  openTask,
  refreshToken,
}: {
  refreshToken?: number;
  refresh: () => Promise<void>;
  onRestored: (message: string) => void;
  openTask: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<ArchivedTask[]>([]);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function load() {
    const n = ++request.current;
    try {
      const result = await api<{ items: ArchivedTask[] }>("/archive");
      if (n === request.current) {
        setItems(result.items);
        setError("");
      }
    } catch (e) {
      if (n === request.current) setError((e as Error).message);
    } finally {
      if (n === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [refreshToken]);
  async function restore(task: ArchivedTask) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/archive/${task.id}/restore`,
        json("POST", { revision: task.revision }),
      );
      setItems((current) => current.filter((t) => t.id !== task.id));
      onRestored(`Tarefa restaurada no projeto ${task.project_name}.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function consult(id: string) {
    setBusy(true);
    setError("");
    try {
      await openTask(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = items.filter(
    (t) =>
      (project === "all" || t.project === project) &&
      (t.title + " " + t.description + " " + t.project_name)
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="trash-page">
      <div className="title-row">
        <h1>
          <Archive size={26} />
          Arquivados
        </h1>
        <button
          className="outline-button"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          Atualizar arquivados
        </button>
      </div>
      <p className="subtitle">
        Tarefas fora do quadro, disponíveis para consulta e restauração.
      </p>
      <div className="trash-info">
        <Archive size={20} />
        <p>
          Comentários, anexos, subtarefas e histórico são preservados. Editores,
          administradores e proprietários podem restaurar tarefas na coluna de
          origem.
        </p>
      </div>
      <div className="trash-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar nos arquivados"
            placeholder="Buscar tarefa ou projeto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filter">
          <select
            aria-label="Filtrar projeto nos arquivados"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="all">Todos os projetos</option>
            {[
              ...new Map(
                items.map((t) => [t.project, t.project_name]),
              ).entries(),
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span>{filtered.length} tarefa(s)</span>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">Carregando arquivados…</p>
      ) : filtered.length ? (
        <ul className="trash-list">
          {filtered.map((t) => (
            <li key={t.id}>
              <span className="trash-item-icon">
                <Archive size={19} />
              </span>
              <div className="trash-item-main">
                <span className="notification-project">{t.project_name}</span>
                <h3>{t.title}</h3>
                <p>
                  Arquivada por {t.archived_by_name} ·{" "}
                  {new Date(t.archived_at).toLocaleString("pt-BR")}
                </p>
                <div className="trash-item-meta">
                  <span>{t.comment_count} comentário(s)</span>
                  <span>{t.attachment_count} anexo(s)</span>
                  <span>{t.subtask_total || 0} subtarefa(s)</span>
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  className="outline-button"
                  disabled={busy}
                  onClick={() => void consult(t.id)}
                  aria-label={"Consultar " + t.title}
                >
                  <Eye size={15} />
                  Consultar
                </button>
                {canEdit(t.role) && (
                  <button
                    className="outline-button restore-button"
                    disabled={busy}
                    onClick={() => void restore(t)}
                    aria-label={"Restaurar " + t.title}
                  >
                    <ArchiveRestore size={15} />
                    Restaurar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="inbox-empty trash-empty">
          <Archive size={30} />
          <h3>
            {items.length
              ? "Nenhuma tarefa com estes filtros."
              : "Nenhuma tarefa arquivada."}
          </h3>
          <p>Use Arquivar nos detalhes de uma tarefa para guardá-la aqui.</p>
        </div>
      )}
    </div>
  );
}
