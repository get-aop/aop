interface SSERepo {
  id: string;
  name: string | null;
  path: string;
}

export interface SSEServerStatus {
  repos: SSERepo[];
}
