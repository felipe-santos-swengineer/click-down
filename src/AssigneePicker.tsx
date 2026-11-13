import { useState } from "react";
import { Search, Users } from "lucide-react";
import { initials, type Member } from "./types";
export function AssigneePicker({
  label,
  value,
  members,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string[];
  members: Member[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const visible = members.filter((m) =>
    (m.name + " " + m.email)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <fieldset
      className="assignee-picker"
      disabled={disabled}
      aria-label={label}
    >
      <legend>
        <Users size={14} />
        {label}
        <span>{value.length} selecionado(s)</span>
      </legend>
      <div className="assignee-picker-search">
        <Search size={14} />
        <input
          aria-label={"Buscar pessoas em " + label.toLowerCase()}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar pessoa da equipe…"
        />
      </div>
      <div className="assignee-options">
        {visible.map((m) => (
          <label key={m.id} className={value.includes(m.id) ? "picked" : ""}>
            <input
              type="checkbox"
              aria-label={"Selecionar " + m.name}
              checked={value.includes(m.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, m.id]
                    : value.filter((id) => id !== m.id),
                )
              }
            />
            <span className="avatar tiny" aria-hidden="true">
              {initials(m.name)}
            </span>
            <span>
              <strong>{m.name}</strong>
              <small>{m.email}</small>
            </span>
          </label>
        ))}
        {!visible.length && <p>Nenhuma pessoa encontrada.</p>}
      </div>
      <div className="assignee-selection">
        {value.length ? (
          members
            .filter((m) => value.includes(m.id))
            .map((m) => <span key={m.id}>{m.name}</span>)
        ) : (
          <span>Nenhum responsável atribuído</span>
        )}
      </div>
    </fieldset>
  );
}
