export type Status = string;
export type StatusKind = "todo" | "doing" | "review" | "done";
export type BoardColumn = {
  id: string;
  name: string;
  color: string;
  kind: StatusKind;
  position?: number;
  task_count?: number;
  subtask_count?: number;
};
export type Subtask = {
  assignees?: string[];
  id: string;
  task_id: string;
  project?: string;
  title: string;
  description: string;
  status: string;
  assignee: string | null;
  date: string;
  revision: number;
  position: number;
  created: string;
  updated: string;
  deleted_at?: string | null;
  deleted_by_name?: string | null;
};
export type Role = "owner" | "admin" | "editor" | "viewer";
export type User = {
  id: string;
  name: string;
  email: string;
  is_demo?: boolean;
  demo_role?: Role;
};
export type DemoProfile = {
  role: Role;
  name: string;
  title: string;
  description: string;
};
export type AppNotification = {
  action_kind?: string;
  payload?: HistoryEntry["payload"];
  task_available?: boolean;
  subtask_id?: string | null;
  parent_title?: string;
  id: number;
  user_id: string;
  task_id: string | null;
  kind: "assignment" | "mention" | "due" | "overdue" | "activity";
  actor_name: string | null;
  due_date: string | null;
  created: string;
  read_at: string | null;
  task_title: string;
  project_id: string;
  project_name: string;
};
export type TrashTask = Task & {
  entity_type?: "task" | "subtask";
  parent_task_id?: string;
  parent_title?: string;
  deleted_at: string;
  deleted_by_name: string;
  project_name: string;
  role: Role;
  attachment_count: number;
};
export type ArchivedTask = Task & {
  archived_at: string;
  archived_by_name: string;
  project_name: string;
  role: Role;
  attachment_count: number;
  checklist_total: number;
  comment_count: number;
  status_name?: string;
};
export type ArchivedDetails = {
  task: Task;
  project: Project;
  members: Member[];
  attachments: Attachment[];
};
export type Project = {
  revision?: number;
  columns?: BoardColumn[];
  board_revision?: number;
  id: string;
  name: string;
  color: string;
  description: string;
  lead_id: string | null;
  role: Role;
};
export type Member = User & { project_id: string; role: Role };
export type Invitation = {
  id: string;
  project_id: string;
  email: string;
  role: Role;
};
export type Task = {
  assignees?: string[];
  id: string;
  project: string;
  title: string;
  description: string;
  status: Status;
  priority: string;
  tag: string;
  date: string;
  assignee: string | null;
  position: number;
  revision: number;
  comment_count?: number;
  checklist_total?: number;
  checklist_done?: number;
  subtask_total?: number;
  subtask_done?: number;
};
export type Mention = { id: string; name: string };
export type TaskComment = {
  id: string;
  task_id: string;
  user_id: string;
  author_name: string;
  body: string;
  mentions: Mention[];
  created: string;
};
export type ChecklistItem = {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  revision: number;
  created: string;
};
export type HistoryChange = {
  field: string;
  before: string | number | null;
  after: string | number | null;
};
export type HistoryEntry = {
  id: number;
  task_id: string;
  user_id: string;
  actor_name: string;
  kind: string;
  payload: {
    changes?: HistoryChange[];
    title?: string;
    before?: string;
    after?: string;
    name?: string;
    mentions?: Mention[];
    reason?: string;
  };
  created: string;
};
export type ProjectEvent = {
  id: number;
  project_id: string;
  project_name: string;
  user_id: string;
  actor_name: string;
  kind: string;
  task_id: string | null;
  task_title: string | null;
  payload: HistoryEntry["payload"];
  created: string;
  task_available: boolean;
};
export type Collaboration = {
  subtasks?: Subtask[];
  current_user_id: string;
  comments: TaskComment[];
  checklist: ChecklistItem[];
  history: HistoryEntry[];
};
export type Attachment = {
  id: string;
  task_id: string;
  name: string;
  type: string;
  size: number;
  uploaded_by: string;
  created: string;
};
export type State = {
  subtasks?: Subtask[];
  current_user?: User;
  projects: Project[];
  tasks: Task[];
  members: Member[];
  invitations: Invitation[];
  attachments: Attachment[];
  unread_notifications?: number;
  trash_count?: number;
  archived_count?: number;
  activity_cursor?: number;
};
export const columns: BoardColumn[] = [
  { id: "todo", name: "A fazer", color: "#9299ad", kind: "todo" },
  { id: "doing", name: "Em andamento", color: "#9a85ef", kind: "doing" },
  { id: "review", name: "Em revisão", color: "#eca951", kind: "review" },
  { id: "done", name: "Concluído", color: "#49ab89", kind: "done" },
];
export const projectColumns = (project?: Project) =>
  project?.columns ?? columns;
export const assigneeIds = (entity: {
  assignees?: string[];
  assignee?: string | null;
}) => entity.assignees ?? (entity.assignee ? [entity.assignee] : []);
export const initialStatus = (list: BoardColumn[]) =>
  list.find((c) => c.kind === "todo")?.id ||
  list.find((c) => c.kind !== "done")?.id ||
  list[0]?.id ||
  "todo";
export const roles: Record<Role, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitor",
};
export const canEdit = (role?: Role) => !!role && role !== "viewer";
export const canManage = (role?: Role) => role === "owner" || role === "admin";
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
export const formatDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
