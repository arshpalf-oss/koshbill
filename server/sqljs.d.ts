declare module 'sql.js' {
  export interface Statement {
    bind(values?: any[] | Record<string, any>): boolean;
    step(): boolean;
    getAsObject(params?: any[] | Record<string, any>): Record<string, any>;
    free(): boolean;
    reset(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: any[] | Record<string, any>): Database;
    exec(sql: string, params?: any[] | Record<string, any>): QueryExecResult[];
    prepare(sql: string, params?: any[] | Record<string, any>): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }): Promise<SqlJsStatic>;
}
