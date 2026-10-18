export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Anything that can run a parameterised query: the pool or an open transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** Run several statements (no parameters), e.g. a migration. */
  exec(sql: string): Promise<void>;
  /** Run `fn` inside one transaction. Commits on success, rolls back on any throw. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
