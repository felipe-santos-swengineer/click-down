import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArrowUpRight,
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  CircleAlert,
  Inbox,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Trash2,
  UserRoundCheck,
  GitBranch,
  History,
} from "lucide-react";
import { api, json } from "./api";
import { Dialog } from "./components";
import { activityLabels, activityFields, activityValue } from "./activity";
import {
  canEdit,
  canManage,
  formatDate,
  type AppNotification,
  type TrashTask,
} from "./types";
const stamp = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function notificationText(n: AppNotification) {
  if (n.kind === "activity")
    return `${n.actor_name} ${activityLabels[n.action_kind || ""] || "atualizou o projeto"}`;
  if (n.kind === "mention")
    return `${n.actor_name} mencionou você em um comentário`;
  if (n.kind === "assignment")
    return `${n.actor_name} atribuiu uma ${n.subtask_id ? "subtarefa" : "tarefa"} a você`;
  if (n.kind === "overdue") return "Esta tarefa passou do prazo";
  return "O prazo desta tarefa está chegando";
}
function NotificationIcon({ kind }: { kind: AppNotification["kind"] }) {
  if (kind === "activity") return <History size={18} />;
  return kind === "mention" ? (
    <AtSign size={18} />
  ) : kind === "assignment" ? (
    <UserRoundCheck size={18} />
  ) : kind === "overdue" ? (
    <CircleAlert size={18} />
  ) : (
    <CalendarClock size={18} />
  );
}
export function NotificationCenter({
  close,
  refresh,
  openTask,
  refreshToken = 0,
}: {
  close: () => void;
  refresh: () => Promise<void>;
  openTask: (id: string) => Promise<void>;
  refreshToken?: number;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const load = useCallback(
    async (before?: number) => {
      const request = ++sequence.current;
      const result = await api<{
        items: AppNotification[];
        unread_count: number;
        has_more: boolean;
      }>(
        `/notifications?unread=${unreadOnly ? "1" : "0"}${before ? "&before=" + before : ""}`,
      );
      if (request !== sequence.current) return;
      setItems((prev) =>
        before
          ? [
              ...prev,
              ...result.items.filter(
                (n) => !prev.some((old) => old.id === n.id),
              ),
            ]
          : result.items,
      );
      setUnreadCount(result.unread_count);
      setHasMore(result.has_more);
    },
    [unreadOnly],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      ++sequence.current;
    };
  }, [load, refreshToken]);
  async function action(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      title="Sua caixa de notificações"
      close={() => {
        if (!pending) close();
      }}
      wide
    >
      <p className="dialog-intro">
        Menções, novas atribuições e prazos que merecem sua atenção.
      </p>
      <div className="inbox-toolbar">
        <div className="inbox-filters">
          <button
            type="button"
            className={!unreadOnly ? "active" : ""}
            disabled={pending}
            onClick={() => setUnreadOnly(false)}
          >
            Todas
          </button>
          <button
            type="button"
            className={unreadOnly ? "active" : ""}
            disabled={pending}
            onClick={() => setUnreadOnly(true)}
          >
            Não lidas <span>{unreadCount}</span>
          </button>
        </div>
        <div>
          <button
            type="button"
            className="icon-button"
            disabled={pending}
            aria-label="Atualizar notificações"
            onClick={() =>
              action(async () => {
                await load();
                await refresh();
              })
            }
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            className="outline-button"
            disabled={pending || !unreadCount}
            onClick={() =>
              action(async () => {
                await api("/notifications/read-all", { method: "POST" });
                await load();
                await refresh();
              })
            }
          >
            <CheckCheck size={15} />
            Ler todas
          </button>
        </div>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          Carregando notificações…
        </div>
      ) : !items.length ? (
        <div className="inbox-empty">
          <span>
            <Bell size={28} />
          </span>
          <h3>
            {unreadOnly
              ? "Nenhuma notificação não lida."
              : "Nenhuma notificação."}
          </h3>
          <p>
            {unreadOnly
              ? "Você já leu todas as notificações disponíveis."
              : "Novas menções, atribuições e lembretes de prazo aparecem aqui."}
          </p>
        </div>
      ) : (
        <ul className="notification-list">
          {items.map((n) => (
            <li
              key={n.id}
              className={
                (n.read_at ? "" : "unread ") + "notification-kind-" + n.kind
              }
            >
              <span className="notification-symbol">
                <NotificationIcon kind={n.kind} />
              </span>
              <div className="notification-main">
                <span className="notification-project">{n.project_name}</span>
                <strong>{notificationText(n)}</strong>
                {n.task_id && n.task_available !== false ? (
                  <button
                    type="button"
                    className="notification-task"
                    disabled={pending}
                    onClick={() =>
                      action(async () => {
                        if (!n.read_at)
                          await api(
                            "/notifications/" + n.id,
                            json("PATCH", { read: true }),
                          );
                        await refresh();
                        await openTask(n.task_id!);
                      })
                    }
                  >
                    {n.task_title}
                    <ArrowUpRight size={13} />
                  </button>
                ) : n.task_title ? (
                  <span className="notification-removed-target">
                    {n.task_title} · fora do quadro
                  </span>
                ) : null}
                {n.kind === "activity" && (
                  <div className="notification-event-details">
                    {n.payload?.name && <span>{n.payload.name}</span>}
                    {n.payload?.title && <span>{n.payload.title}</span>}
                    {n.payload?.changes?.map((c, i) => (
                      <div key={i}>
                        <b>{activityFields[c.field] || c.field}</b>
                        <span>{activityValue(c.field, c.before)}</span>
                        <span>→</span>
                        <span>{activityValue(c.field, c.after)}</span>
                      </div>
                    ))}
                    {n.payload?.reason && <span>{n.payload.reason}</span>}
                  </div>
                )}
                {n.subtask_id && (
                  <span className="notification-parent">
                    Subtarefa de {n.parent_title}
                  </span>
                )}
                {n.due_date && (
                  <span className="notification-due">
                    Prazo: {formatDate(n.due_date)}
                  </span>
                )}
                <time dateTime={n.created}>{stamp(n.created)}</time>
              </div>
              <button
                type="button"
                className={"notification-read " + (n.read_at ? "is-read" : "")}
                disabled={pending}
                aria-label={
                  (n.read_at
                    ? "Marcar como não lida: "
                    : "Marcar como lida: ") + (n.task_title || n.project_name)
                }
                title={n.read_at ? "Marcar como não lida" : "Marcar como lida"}
                onClick={() =>
                  action(async () => {
                    await api(
                      "/notifications/" + n.id,
                      json("PATCH", { read: !n.read_at }),
                    );
                    await load();
                    await refresh();
                  })
                }
              >
                {n.read_at ? <CheckCheck size={15} /> : <span />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasMore && !loading && (
        <button
          type="button"
          className="outline-button history-more"
          disabled={pending}
          onClick={() => action(() => load(items.at(-1)?.id))}
        >
          Carregar notificações anteriores
        </button>
      )}
      <p className="panel-footnote">
        <Inbox size={13} />
        As notificações são pessoais. Não enviamos e-mails ou alertas do
        navegador.
      </p>
    </Dialog>
  );
}
export function TrashView({
  refresh,
  onRestored,
}: {
  refresh: () => Promise<void>;
  onRestored: (message: string) => void;
}) {
  const [items, setItems] = useState<TrashTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const load = useCallback(async () => {
    const result = await api<{ items: TrashTask[] }>("/trash");
    setItems(result.items);
  }, []);
  useEffect(() => {
    let active = true;
    load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);
  async function action(task: TrashTask, purge = false) {
    if (busy) return;
    if (
      purge &&
      !confirm(
        task.entity_type === "subtask"
          ? `Excluir definitivamente a subtarefa “${task.title}”? Esta ação não pode ser desfeita. O histórico da tarefa principal será preservado.`
          : `Excluir definitivamente “${task.title}”? Comentários, checklist, subtarefas, anexos e histórico serão apagados. Esta ação não pode ser desfeita.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(
        purge
          ? `/trash/${task.entity_type === "subtask" ? "subtasks/" : ""}${task.id}?revision=${task.revision}`
          : `/trash/${task.entity_type === "subtask" ? "subtasks/" : ""}${task.id}/restore`,
        purge
          ? { method: "DELETE" }
          : json("POST", { revision: task.revision }),
      );
      setItems((prev) => prev.filter((t) => t.id !== task.id));
      onRestored(
        purge
          ? `${task.entity_type === "subtask" ? "Subtarefa" : "Tarefa"} excluída definitivamente.`
          : `${task.entity_type === "subtask" ? "Subtarefa" : "Tarefa"} restaurada no projeto ${task.project_name}.`,
      );
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const filtered = items.filter(
    (t) =>
      (project === "all" || t.project === project) &&
      (t.title + " " + t.project_name)
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="trash-page">
      <div className="title-row">
        <h1>
          <Trash2 size={26} />
          Lixeira
        </h1>
        <button
          type="button"
          className="outline-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await load();
              await refresh();
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={15} />
          Atualizar lixeira
        </button>
      </div>
      <p className="subtitle">
        Restaure as tarefas removidas ou exclua-as definitivamente.
      </p>
      <div className="trash-info">
        <ArchiveRestore size={20} />
        <p>
          As tarefas ficam aqui até serem restauradas ou excluídas
          definitivamente. Editores podem restaurar; proprietários e
          administradores também podem excluir definitivamente.
        </p>
      </div>
      <div className="trash-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar na lixeira"
            placeholder="Buscar tarefa ou projeto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filter">
          <select
            aria-label="Filtrar projeto na lixeira"
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
        <div className="panel-loading">
          <LoaderCircle className="spin" size={23} />
          Carregando lixeira…
        </div>
      ) : filtered.length ? (
        <ul className="trash-list">
          {filtered.map((t) => (
            <li key={t.id}>
              <span className="trash-item-icon">
                <Trash2 size={19} />
              </span>
              <div className="trash-item-main">
                <span className="notification-project">
                  {t.project_name}
                  {t.entity_type === "subtask" && (
                    <> · Subtarefa de {t.parent_title}</>
                  )}
                </span>
                <h3>{t.title}</h3>
                <p>
                  Movida por {t.deleted_by_name} · {stamp(t.deleted_at)}
                </p>
                <div className="trash-item-meta">
                  {!!t.subtask_total && (
                    <span>
                      <GitBranch size={12} />
                      {t.subtask_total} subtarefa(s)
                    </span>
                  )}
                  <span>
                    <MessageSquare size={12} />
                    {t.comment_count || 0} comentário(s)
                  </span>
                  <span>
                    <Paperclip size={12} />
                    {t.attachment_count || 0} anexo(s)
                  </span>
                  <span>
                    <CheckCheck size={12} />
                    {t.checklist_total || 0} etapa(s)
                  </span>
                </div>
              </div>
              <div className="trash-item-actions">
                {canEdit(t.role) && (
                  <button
                    type="button"
                    className="outline-button restore-button"
                    disabled={busy}
                    aria-label={"Restaurar " + t.title}
                    onClick={() => action(t)}
                  >
                    <ArchiveRestore size={15} />
                    Restaurar
                  </button>
                )}
                {canManage(t.role) && (
                  <button
                    type="button"
                    className="icon-button danger"
                    disabled={busy}
                    aria-label={"Excluir definitivamente " + t.title}
                    onClick={() => action(t, true)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {!canEdit(t.role) && (
                  <span className="role-badge">Somente leitura</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="inbox-empty trash-empty">
          <span>
            <ArchiveRestore size={30} />
          </span>
          <h3>
            {items.length
              ? "Nenhuma tarefa com estes filtros."
              : "Nenhuma tarefa na lixeira."}
          </h3>
          <p>
            {items.length
              ? "Experimente buscar outro título ou selecionar outro projeto."
              : "As tarefas que você remover do quadro aparecerão aqui para restauração."}
          </p>
        </div>
      )}
    </div>
  );
}
