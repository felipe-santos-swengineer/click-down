import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "./api";
import { activityFields, activityLabels, activityValue } from "./activity";
import { type Project, type ProjectEvent } from "./types";
export function ProjectActivity({
  projects,
  openTask,
  refreshToken = 0,
}: {
  projects: Project[];
  openTask: (id: string) => Promise<void>;
  refreshToken?: number;
}) {
  const [project, setProject] = useState("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ProjectEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(
    async (before?: number) => {
      const request = ++sequence.current;
      const query = new URLSearchParams({ project, search });
      if (before) query.set("before", String(before));
      const result = await api<{ items: ProjectEvent[]; has_more: boolean }>(
        "/activity?" + query,
      );
      if (request !== sequence.current) return;
      setItems((prev) =>
        before
          ? [
              ...prev,
              ...result.items.filter(
                (e) => !prev.some((old) => old.id === e.id),
              ),
            ]
          : result.items,
      );
      setHasMore(result.has_more);
    },
    [project, search],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      load()
        .then(() => {
          if (active) setError("");
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      ++sequence.current;
    };
  }, [load, refreshToken]);
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
  return (
    <section className="project-activity">
      <div className="title-row">
        <h1>
          <History size={26} />
          Registro de atividades
        </h1>
        <button
          className="outline-button"
          disabled={busy || loading}
          onClick={() => action(() => load())}
        >
          <RefreshCw size={15} />
          Atualizar registro
        </button>
      </div>
      <p className="subtitle">
        Alterações dos projetos e tarefas, com autor, data e detalhes.
      </p>
      <div className="activity-page-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar no registro de atividades"
            placeholder="Buscar pessoa, atividade ou alteração…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filter">
          <select
            aria-label="Filtrar projeto no registro"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="all">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="panel-loading">
          <LoaderCircle size={23} className="spin" />
          Carregando registro…
        </div>
      ) : !items.length ? (
        <div className="inbox-empty trash-empty">
          <span>
            <History size={28} />
          </span>
          <h3>Nenhuma atividade encontrada.</h3>
          <p>
            As alterações registradas a partir desta atualização aparecem aqui.
            Ajuste os filtros ou faça uma mudança no projeto.
          </p>
        </div>
      ) : (
        <ol className="project-event-list">
          {items.map((event) => (
            <li key={event.id}>
              <div className="event-marker">
                <History size={16} />
              </div>
              <div className="project-event-main">
                <span className="notification-project">
                  {event.project_name}
                </span>
                <p>
                  <strong>{event.actor_name}</strong>{" "}
                  {activityLabels[event.kind] || "atualizou a atividade"}.
                </p>
                <time dateTime={event.created}>
                  {new Date(event.created).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
                {event.task_title &&
                  (event.task_available && event.task_id ? (
                    <button
                      className="event-task-link"
                      disabled={busy}
                      onClick={() => action(() => openTask(event.task_id!))}
                    >
                      {event.task_title}
                      <ArrowUpRight size={13} />
                    </button>
                  ) : (
                    <span className="event-subject">
                      {event.task_title}{" "}
                      <small>Atividade fora do quadro</small>
                    </span>
                  ))}
                {event.payload.name && (
                  <span className="event-subject">{event.payload.name}</span>
                )}
                {event.payload.title && (
                  <span className="event-subject">{event.payload.title}</span>
                )}
                {event.payload.changes?.map((change, i) => (
                  <div className="event-change" key={i}>
                    <b>{activityFields[change.field] || change.field}</b>
                    <span>{activityValue(change.field, change.before)}</span>
                    <span>→</span>
                    <span>{activityValue(change.field, change.after)}</span>
                  </div>
                ))}
                {event.payload.reason && (
                  <p className="event-reason">{event.payload.reason}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {hasMore && !loading && (
        <button
          className="outline-button history-more"
          disabled={busy}
          onClick={() => action(() => load(items.at(-1)?.id))}
        >
          Carregar alterações anteriores
        </button>
      )}
    </section>
  );
}
