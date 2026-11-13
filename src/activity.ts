import { roles, columns, type HistoryEntry } from "./types";
export const activityLabels: Record<string, string> = {
  project_created: "criou o projeto",
  project_updated: "editou o projeto",
  member_added: "adicionou uma pessoa à equipe",
  member_joined: "aceitou o convite do projeto",
  member_role_updated: "alterou o papel de uma pessoa",
  member_removed: "removeu uma pessoa da equipe",
  invitation_created: "criou um convite",
  invitation_cancelled: "cancelou um convite",
  columns_updated: "alterou as colunas do quadro",
  column_updated: "atualizou a coluna de uma atividade",
  task_created: "criou uma tarefa",
  task_updated: "atualizou uma tarefa",
  task_trashed: "moveu uma tarefa para a lixeira",
  task_restored: "restaurou uma tarefa",
  task_removed: "excluiu definitivamente uma tarefa",
  task_archived: "arquivou uma tarefa",
  task_unarchived: "restaurou uma tarefa arquivada",
  comment_added: "adicionou um comentário",
  checklist_added: "adicionou uma etapa ao checklist",
  checklist_completed: "concluiu uma etapa do checklist",
  checklist_reopened: "reabriu uma etapa do checklist",
  checklist_renamed: "renomeou uma etapa do checklist",
  checklist_removed: "removeu uma etapa do checklist",
  attachment_added: "adicionou um anexo",
  attachment_removed: "removeu um anexo",
  subtask_created: "criou uma subtarefa",
  subtask_updated: "atualizou uma subtarefa",
  subtask_trashed: "moveu uma subtarefa para a lixeira",
  subtask_restored: "restaurou uma subtarefa",
  subtask_removed: "excluiu definitivamente uma subtarefa",
};
export const activityFields: Record<string, string> = {
  name: "Nome do projeto",
  description: "Descrição",
  lead_id: "Responsável pelo quadro",
  assignees: "Responsáveis",
  assignee: "Responsável",
  role: "Papel",
  columns: "Colunas",
  column: "Coluna",
  category: "Categoria",
  title: "Título",
  status: "Status",
  date: "Prazo",
  tag: "Etiqueta",
  priority: "Prioridade",
  position: "Ordem no quadro",
};
export function activityValue(field: string, v: string | number | null) {
  if (v === null || v === "") return "Não definido";
  if (field === "role") return roles[v as keyof typeof roles] || String(v);
  if (field === "status" || field === "category")
    return columns.find((c) => c.id === v)?.name || String(v);
  if (field === "date")
    return new Date(String(v) + "T12:00:00").toLocaleDateString("pt-BR");
  return String(v);
}
export type EventPayload = HistoryEntry["payload"];
