import { useState } from "react"
import {
  Table,
  ChevronRight,
  ChevronDown,
  Key,
  Hash,
  Type,
  Database,
} from "lucide-react"
import type { UnifiedSchema } from "../utils/api"

type Props = {
  schema: UnifiedSchema
  color: "blue" | "purple"
  label: string
}

export default function SchemaExplorer({ schema, color, label }: Props) {
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)

  const accent =
    color === "blue"
      ? { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" }
      : { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" }

  const totalRows = schema.entities.reduce((sum, e) => sum + (e.row_count || 0), 0)
  const totalFields = schema.entities.reduce((sum, e) => sum + e.field_count, 0)

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  return (
    <div className={`rounded-2xl border-2 ${accent.border} bg-slate-900 p-6`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className={accent.text} size={22} />
          <div>
            <h2 className="text-lg font-semibold">{label}</h2>
            <p className="text-xs text-slate-400">
              {schema.type === "postgresql" ? "PostgreSQL" : "MongoDB"} •{" "}
              {schema.database}
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className={`rounded-lg ${accent.bg} p-3`}>
          <div className="text-xs text-slate-400">
            {schema.type === "postgresql" ? "Tables" : "Collections"}
          </div>
          <div className={`mt-1 text-xl font-bold ${accent.text}`}>
            {schema.total_entities}
          </div>
        </div>
        <div className={`rounded-lg ${accent.bg} p-3`}>
          <div className="text-xs text-slate-400">Fields</div>
          <div className={`mt-1 text-xl font-bold ${accent.text}`}>
            {totalFields}
          </div>
        </div>
        <div className={`rounded-lg ${accent.bg} p-3`}>
          <div className="text-xs text-slate-400">Rows</div>
          <div className={`mt-1 text-xl font-bold ${accent.text}`}>
            {formatCount(totalRows)}
          </div>
        </div>
      </div>

      {/* Entity List */}
      <div className="mt-4 max-h-[600px] space-y-2 overflow-y-auto pr-1">
        {schema.entities.map((entity) => {
          const isExpanded = expandedEntity === entity.name
          return (
            <div
              key={entity.name}
              className="rounded-lg border border-slate-800 bg-slate-950/60"
            >
              <button
                onClick={() =>
                  setExpandedEntity(isExpanded ? null : entity.name)
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-slate-500" />
                  ) : (
                    <ChevronRight size={16} className="text-slate-500" />
                  )}
                  <Table size={16} className={accent.text} />
                  <div>
                    <div className="text-sm font-medium">{entity.name}</div>
                    {entity.schema && (
                      <div className="text-xs text-slate-500">
                        schema: {entity.schema}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>{entity.field_count} fields</span>
                  <span>{formatCount(entity.row_count)} rows</span>
                  {entity.size && <span>{entity.size}</span>}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-800 bg-slate-950/40 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fields
                  </div>
                  <div className="space-y-1">
                    {entity.fields.map((field) => (
                      <div
                        key={field.name}
                        className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-slate-800/40"
                      >
                        <div className="flex items-center gap-2">
                          {field.is_primary ? (
                            <Key size={12} className="text-yellow-400" />
                          ) : (
                            <Hash size={12} className="text-slate-600" />
                          )}
                          <span className="font-mono text-slate-200">
                            {field.name}
                          </span>
                          {field.nullable === false && (
                            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
                              NOT NULL
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Type size={12} className="text-slate-600" />
                          <span className="font-mono text-slate-400">
                            {field.type}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {entity.sample_data.length > 0 && (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Sample Data ({entity.sample_data.length} rows)
                      </div>
                      <div className="overflow-x-auto rounded border border-slate-800">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-900 text-slate-400">
                            <tr>
                              {Object.keys(entity.sample_data[0]).map((key) => (
                                <th
                                  key={key}
                                  className="px-2 py-1.5 text-left font-mono"
                                >
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {entity.sample_data.map((row, i) => (
                              <tr
                                key={i}
                                className="border-t border-slate-800 text-slate-300"
                              >
                                {Object.values(row).map((val, j) => (
                                  <td
                                    key={j}
                                    className="max-w-[200px] truncate px-2 py-1.5 font-mono"
                                    title={String(val)}
                                  >
                                    {val === null ? (
                                      <span className="text-slate-600">
                                        null
                                      </span>
                                    ) : (
                                      String(val)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}