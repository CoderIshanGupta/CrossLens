import axios from "axios"

const API_BASE = "http://localhost:8000"

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
})

export type PostgresConnection = {
  host: string
  port: number
  database: string
  username: string
  password: string
}

export type MongoConnection = {
  connection_uri: string
  database_name: string
}

export type ConnectionTestResult = {
  success: boolean
  database?: string
  version?: string
  collection_count?: number
  error?: string
}

export type FieldInfo = {
  name: string
  type: string
}

export type MatchResult = {
  total_source_fields: number
  total_target_fields: number
  matched_fields: number
  mappings: Array<{
    source_field: string
    source_type: string
    suggested_matches: Array<{
      target_field: string
      target_type: string
      confidence: number
      match_reason: string
      name_similarity: number
      type_similarity: number
    }>
  }>
}

export type PostgresColumn = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
}

export type PostgresForeignKey = {
  column_name: string
  references_table: string
  references_column: string
}

export type PostgresTable = {
  schema: string
  table_name: string
  columns: PostgresColumn[]
  primary_keys: string[]
  foreign_keys: PostgresForeignKey[]
  sample_data: Record<string, any>[]
  row_count: number
  size: string
}

export type PostgresSchema = {
  database: string
  total_tables: number
  tables: PostgresTable[]
}

export type MongoField = {
  field_name: string
  detected_types: string[]
  occurrence_count: number
  occurrence_percentage: number
  sample_values: string[]
}

export type MongoCollection = {
  collection_name: string
  sampled_documents: number
  total_fields_detected: number
  fields: MongoField[]
  sample_data: Record<string, any>[]
  document_count: number
  size_bytes: number
}

export type MongoSchema = {
  database: string
  total_collections: number
  collections: MongoCollection[]
}

export type UnifiedSchema = {
  type: "postgresql" | "mongodb"
  database: string
  total_entities: number
  entities: Array<{
    name: string
    schema?: string
    row_count: number
    field_count: number
    size?: string
    fields: Array<{
      name: string
      type: string
      nullable?: boolean
      is_primary?: boolean
    }>
    sample_data: Record<string, any>[]
  }>
}

export const normalizeSchema = (
  dbType: "postgresql" | "mongodb",
  rawSchema: PostgresSchema | MongoSchema
): UnifiedSchema => {
  if (dbType === "postgresql") {
    const pg = rawSchema as PostgresSchema
    return {
      type: "postgresql",
      database: pg.database,
      total_entities: pg.total_tables,
      entities: pg.tables.map((table) => ({
        name: table.table_name,
        schema: table.schema,
        row_count: table.row_count,
        field_count: table.columns.length,
        size: table.size,
        fields: table.columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === "YES",
          is_primary: table.primary_keys.includes(col.column_name),
        })),
        sample_data: table.sample_data,
      })),
    }
  }

  const mongo = rawSchema as MongoSchema
  return {
    type: "mongodb",
    database: mongo.database,
    total_entities: mongo.total_collections,
    entities: mongo.collections.map((coll) => ({
      name: coll.collection_name,
      row_count: coll.document_count,
      field_count: coll.total_fields_detected,
      fields: coll.fields.map((f) => ({
        name: f.field_name,
        type: f.detected_types.join(" | "),
        nullable: f.occurrence_percentage < 100,
      })),
      sample_data: coll.sample_data,
    })),
  }
}

export type ApprovedMappingPayload = {
  source_field: string
  target_field: string
  confidence: number
}

export type CompareSummary = {
  overall_similarity: number
  total_fields_compared: number
  aligned: number
  partial_mismatch: number
  critical_mismatch: number
  low_overlap: number
  avg_overlap_percentage: number
}

export type FieldCompareResult = {
  source_field: string
  target_field: string
  mapping_confidence: number
  status: string
  field_similarity_score: number
  error?: string
  source: {
    total_sampled?: number
    non_null?: number
    null_percentage?: number
    unique_values?: number
    types?: string[]
  }
  target: {
    total_sampled?: number
    non_null?: number
    null_percentage?: number
    unique_values?: number
    types?: string[]
  }
  overlap: {
    common_values: number
    source_only: number
    target_only: number
    overlap_percentage: number
    sample_common: string[]
    sample_source_only: string[]
    sample_target_only: string[]
  }
  numeric_stats: any
}

export type CompareResponse = {
  summary: CompareSummary
  insights: string[]
  field_results: FieldCompareResult[]
  snapshot?: any
}

export type ReconciliationRecommendation = {
  id: string
  category: string
  priority: "critical" | "high" | "medium" | "low"
  source_field: string
  target_field: string
  title: string
  problem: string
  action: string
  scripts: Record<string, any>
  risk: string
}

export type ReconciliationResponse = {
  summary: {
    total_recommendations: number
    critical: number
    high: number
    medium: number
    low: number
    fields_needing_action: number
    message: string
  }
  recommendations: ReconciliationRecommendation[]
}

export type DriftPoint = {
  id?: string
  project_label: string
  source_label: string
  target_label: string
  overall_similarity: number
  total_fields: number
  critical_mismatch: number
  created_at: string
}

export type DriftHistoryResponse = {
  count: number
  points: DriftPoint[]
}

export type KafkaJobResponse = {
  job_id: string
  status: string
  jobs_topic: string
  events_topic: string
}

export type JobStatusEvent = {
  job_id: string
  type: string
  status: string
  message?: string
  summary?: CompareSummary
  created_at?: string
}

export type JobStatusResponse = {
  job_id: string
  status: string
  events: JobStatusEvent[]
  latest?: JobStatusEvent | null
}

export type SavedProject = {
  id: string
  name: string
  description?: string
  config: {
    source_type: "postgresql" | "mongodb"
    target_type: "postgresql" | "mongodb"
    source_connection: PostgresConnection | MongoConnection
    target_connection: PostgresConnection | MongoConnection
    approved_mappings: ApprovedMappingPayload[]
  }
  created_at: string
  updated_at: string
}

export const testPostgresConnection = async (
  conn: PostgresConnection
): Promise<ConnectionTestResult> => {
  const res = await api.post("/api/connections/postgres/test", conn)
  return res.data
}

export const discoverPostgresSchema = async (conn: PostgresConnection) => {
  const res = await api.post("/api/connections/postgres/discover", conn)
  return res.data
}

export const testMongoConnection = async (
  conn: MongoConnection
): Promise<ConnectionTestResult> => {
  const res = await api.post("/api/connections/mongodb/test", conn)
  return res.data
}

export const discoverMongoSchema = async (conn: MongoConnection) => {
  const res = await api.post("/api/connections/mongodb/discover", conn)
  return res.data
}

export const matchFields = async (
  sourceFields: FieldInfo[],
  targetFields: FieldInfo[],
  minConfidence = 0.5
): Promise<MatchResult> => {
  const res = await api.post("/api/mappings/match", {
    source_fields: sourceFields,
    target_fields: targetFields,
    min_confidence: minConfidence,
  })
  return res.data
}

export const getHealth = async () => {
  const res = await api.get("/health")
  return res.data
}

export const runComparison = async (payload: {
  source_type: string
  target_type: string
  source_connection: PostgresConnection | MongoConnection
  target_connection: PostgresConnection | MongoConnection
  mappings: ApprovedMappingPayload[]
  sample_size?: number
  save_snapshot?: boolean
  project_label?: string
}): Promise<CompareResponse> => {
  const res = await api.post("/api/compare/run", payload)
  return res.data
}

export const generateReconciliation = async (payload: {
  source_type: string
  target_type: string
  field_results: FieldCompareResult[]
}): Promise<ReconciliationResponse> => {
  const res = await api.post("/api/compare/reconcile", payload)
  return res.data
}

export const getDriftHistory = async (
  projectLabel?: string
): Promise<DriftHistoryResponse> => {
  const res = await api.get("/api/compare/drift", {
    params: projectLabel ? { project_label: projectLabel } : {},
  })
  return res.data
}

export const enqueueComparisonJob = async (payload: {
  source_type: string
  target_type: string
  source_connection: PostgresConnection | MongoConnection
  target_connection: PostgresConnection | MongoConnection
  mappings: ApprovedMappingPayload[]
  sample_size?: number
  project_label?: string
}): Promise<KafkaJobResponse> => {
  const res = await api.post("/api/jobs/compare", payload)
  return res.data
}

export const getJobStatus = async (jobId: string): Promise<JobStatusResponse> => {
  const res = await api.get(`/api/jobs/${jobId}`)
  return res.data
}

// Workspace / Project Management APIs
export const saveProject = async (payload: {
  name: string
  description?: string
  source_type: string
  target_type: string
  source_connection: PostgresConnection | MongoConnection
  target_connection: PostgresConnection | MongoConnection
  approved_mappings: ApprovedMappingPayload[]
}) => {
  const res = await api.post("/api/projects", payload)
  return res.data
}

export const listProjects = async (): Promise<{ count: number; projects: SavedProject[] }> => {
  const res = await api.get("/api/projects")
  return res.data
}

export const deleteProject = async (projectId: string) => {
  const res = await api.delete(`/api/projects/${projectId}`)
  return res.data
}