import type { CustdevState, Need, Quote, Sources } from "./custdev-contract.ts";
export type AiAction = "quotes" | "needs" | "company" | "positioning" | "usp";
export interface WordingProposal {
  text: string;
  used_sources: string[];
  missing_evidence: string[];
}
export type AiOutput = Quote[] | Need[] | WordingProposal;
export interface AiResult {
  output: AiOutput;
  baseHash: string;
  inputHash: string;
}
export interface Workspace {
  id: string;
  user_id: string;
  lesson_id: string;
  block_id: string;
  state: CustdevState;
  revision: number;
  status: "draft" | "submitted" | "approved" | "changes_requested";
  review_notes: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}
export interface StoredRun {
  id: string;
  action: AiAction;
  segment_id: string | null;
  target_id: string | null;
  source_hash: string;
  created_at: string;
  status: "running" | "succeeded" | "failed";
  result: AiResult | null;
  error_code?: string;
}
export interface SavedVersion {
  id: string;
  revision: number;
  status: Workspace["status"];
  created_at: string;
  state: CustdevState;
}
export interface WorkspaceResponse {
  workspace: Workspace | null;
  state: CustdevState;
  hashes: Record<string, string>;
  sources: Sources;
  canEdit: boolean;
  isAdmin: boolean;
  runs: StoredRun[];
  versions: SavedVersion[];
  run?: StoredRun;
  version?: SavedVersion;
  error?: string;
  historyMore?: { runs: boolean; versions: boolean };
}
interface DbError {
  code?: string;
  message: string;
}
interface QueryResult<T> {
  data: T | null;
  error: DbError | null;
}
/** Narrow adapter for the standard Supabase fluent API; data is typed at each query. */
export interface DbQuery<T> extends PromiseLike<QueryResult<T[]>> {
  select(columns?: string): DbQuery<T>;
  eq(column: string, value: unknown): DbQuery<T>;
  lt(column: string, value: unknown): DbQuery<T>;
  in(column: string, values: unknown[]): DbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>;
  limit(n: number): DbQuery<T>;
  range(from: number, to: number): DbQuery<T>;
  update(value: Record<string, unknown>): DbQuery<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
  single(): PromiseLike<QueryResult<T>>;
}
export interface CustdevDb {
  from<T = Record<string, unknown>>(table: string): DbQuery<T>;
  rpc<T = unknown>(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<QueryResult<T>>;
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}
