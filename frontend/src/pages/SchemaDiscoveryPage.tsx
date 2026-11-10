import { useState } from "react"
import { Loader2, ArrowLeft, Search } from "lucide-react"
import {
  discoverPostgresSchema,
  discoverMongoSchema,
  normalizeSchema,
  type PostgresConnection,
  type MongoConnection,
  type UnifiedSchema,
} from "../utils/api"
import SchemaExplorer from "../components/SchemaExplorer"

type ConnectedDb = {
  dbType: "postgresql" | "mongodb"
  connection: PostgresConnection | MongoConnection
}

type Props = {
  sourceDb: ConnectedDb
  targetDb: ConnectedDb
  schemasReady: boolean
  onBack: () => void
  onNext: () => void
  onSchemasReady: (source: UnifiedSchema, target: UnifiedSchema) => void
}

export default function SchemaDiscoveryPage({
  sourceDb,
  targetDb,
  schemasReady,
  onBack,
  onNext,
  onSchemasReady,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string>("")
  const [localSource, setLocalSource] = useState<UnifiedSchema | null>(null)
  const [localTarget, setLocalTarget] = useState<UnifiedSchema | null>(null)
  const [error, setError] = useState<string | null>(null)

  const discoverBoth = async () => {
    setLoading(true)
    setError(null)
    setLocalSource(null)
    setLocalTarget(null)

    try {
      setProgress("Discovering source database schema...")
      const sourceRaw =
        sourceDb.dbType === "postgresql"
          ? await discoverPostgresSchema(sourceDb.connection as PostgresConnection)
          : await discoverMongoSchema(sourceDb.connection as MongoConnection)
      const sourceNorm = normalizeSchema(sourceDb.dbType, sourceRaw)
      setLocalSource(sourceNorm)

      setProgress("Discovering target database schema...")
      const targetRaw =
        targetDb.dbType === "postgresql"
          ? await discoverPostgresSchema(targetDb.connection as PostgresConnection)
          : await discoverMongoSchema(targetDb.connection as MongoConnection)
      const targetNorm = normalizeSchema(targetDb.dbType, targetRaw)
      setLocalTarget(targetNorm)

      setProgress("Complete")
      onSchemasReady(sourceNorm, targetNorm)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    } finally {
      setLoading(false)
    }
  }

  const isReady = schemasReady || (localSource && localTarget)

  return (
    <div>
      {/* Top Nav & Action Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Back to Connections
          </button>
          <h2 className="text-2xl font-bold">Step 2 — Schema Discovery</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            CrossLens connects to both databases to discover their complete structure.
          </p>
        </div>

        {/* Moved the primary action to the top right! */}
        {isReady ? (
          <button
            onClick={onNext}
            className="rounded-lg bg-green-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-green-600"
          >
            Continue to AI Mapping →
          </button>
        ) : (
          <button
            onClick={discoverBoth}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                {progress || "Discovering..."}
              </>
            ) : (
              <>
                <Search size={16} />
                Start Discovery
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {(localSource || localTarget || schemasReady) && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {localSource && (
            <SchemaExplorer schema={localSource} color="blue" label="Source Database (A)" />
          )}
          {localTarget && (
            <SchemaExplorer schema={localTarget} color="purple" label="Target Database (B)" />
          )}
        </div>
      )}
    </div>
  )
}