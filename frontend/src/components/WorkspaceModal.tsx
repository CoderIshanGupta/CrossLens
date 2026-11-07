import React, { useEffect, useState } from "react"
import {
  X,
  FolderFolder,
  Save,
  Trash2,
  ExternalLink,
  Loader2,
  Database,
  CheckCircle2,
} from "lucide-react"
import {
  saveProject,
  listProjects,
  deleteProject,
  type SavedProject,
  type PostgresConnection,
  type MongoConnection,
  type ApprovedMappingPayload,
} from "../utils/api"

type ConnectedDb = {
  dbType: "postgresql" | "mongodb"
  connection: PostgresConnection | MongoConnection
}

type Props = {
  isOpen: boolean
  onClose: () => void
  sourceDb: ConnectedDb | null
  targetDb: ConnectedDb | null
  approvedMappings: ApprovedMappingPayload[]
  onLoadProject: (project: SavedProject) => void
}

export default function WorkspaceModal({
  isOpen,
  onClose,
  sourceDb,
  targetDb,
  approvedMappings,
  onLoadProject,
}: Props) {
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const res = await listProjects()
      setProjects(res.projects || [])
    } catch {
      setMsg({ type: "error", text: "Could not fetch saved projects" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchProjects()
      setMsg(null)
    }
  }, [isOpen])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    if (!sourceDb || !targetDb) {
      setMsg({ type: "error", text: "Must connect both databases before saving a workspace" })
      return
    }

    setSaving(true)
    setMsg(null)
    try {
      await saveProject({
        name: name.trim(),
        description: description.trim(),
        source_type: sourceDb.dbType,
        target_type: targetDb.dbType,
        source_connection: sourceDb.connection,
        target_connection: targetDb.connection,
        approved_mappings: approvedMappings,
      })
      setMsg({ type: "success", text: "Workspace saved successfully!" })
      setName("")
      setDescription("")
      fetchProjects()
    } catch (err: any) {
      setMsg({ type: "error", text: err.response?.data?.detail ?? "Failed to save project" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this workspace?")) return
    try {
      await deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch {
      alert("Failed to delete workspace")
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <FolderFolder className="text-blue-400" size={22} />
            <h2 className="text-xl font-bold">Saved Workspaces</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status Message */}
        {msg && (
          <div
            className={`mt-4 rounded-lg p-3 text-xs ${
              msg.type === "success"
                ? "border border-green-500/40 bg-green-500/10 text-green-300"
                : "border border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Save Current Session */}
        {sourceDb && targetDb && (
          <form onSubmit={handleSave} className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Save size={14} className="text-blue-400" /> Save Current Workspace
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                required
                placeholder="Workspace Name (e.g. Billing Audit)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="mt-3 flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Workspace
            </button>
          </form>
        )}

        {/* Projects List */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Existing Workspaces ({projects.length})
          </h3>

          {loading ? (
            <div className="flex items-center justify-center p-8 text-slate-500">
              <Loader2 className="animate-spin" size={24} />
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-sm text-slate-500">
              No saved workspaces yet. Connect databases and save a session above!
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5 transition hover:border-slate-700"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-200">{p.name}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                        {p.config?.source_type} ↔ {p.config?.target_type}
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                      <span>Saved: {new Date(p.updated_at).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{p.config?.approved_mappings?.length || 0} mapped fields</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onLoadProject(p)
                        onClose()
                      }}
                      className="flex items-center gap-1 rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-300 transition hover:bg-blue-500 hover:text-white"
                      title="Load this workspace"
                    >
                      <ExternalLink size={14} /> Load
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/20 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}