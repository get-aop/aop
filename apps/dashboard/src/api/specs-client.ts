const API_BASE = "/api";

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data as T;
};

export const fetchChangeFiles = async (repoId: string, taskId: string): Promise<string[]> => {
  const data = await request<{ files: string[] }>(`/repos/${repoId}/tasks/${taskId}/files`);
  return data.files;
};

export const fetchChangeFile = async (
  repoId: string,
  taskId: string,
  path: string,
): Promise<string> => {
  const data = await request<{ content: string }>(
    `/repos/${repoId}/tasks/${taskId}/files/${encodeURIComponent(path)}`,
  );
  return data.content;
};

export type ReviewNote = {
  id: string;
  filePath: string;
  selectedText: string;
  textOccurrence?: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
};

export const fetchReviewNotes = async (repoId: string, taskId: string): Promise<ReviewNote[]> => {
  const data = await request<{ notes: ReviewNote[] }>(
    `/repos/${repoId}/tasks/${taskId}/review-notes`,
  );
  return data.notes;
};

export const createReviewNote = async (
  repoId: string,
  taskId: string,
  input: {
    filePath: string;
    selectedText: string;
    textOccurrence?: number;
    note: string;
  },
): Promise<ReviewNote> => {
  const data = await request<{ note: ReviewNote }>(
    `/repos/${repoId}/tasks/${taskId}/review-notes`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.note;
};

export const updateReviewNote = async (
  repoId: string,
  taskId: string,
  noteId: string,
  input: {
    note: string;
  },
): Promise<ReviewNote> => {
  const data = await request<{ note: ReviewNote }>(
    `/repos/${repoId}/tasks/${taskId}/review-notes/${noteId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return data.note;
};

export const deleteReviewNote = async (
  repoId: string,
  taskId: string,
  noteId: string,
): Promise<void> => {
  await request<{ ok: true }>(`/repos/${repoId}/tasks/${taskId}/review-notes/${noteId}`, {
    method: "DELETE",
  });
};

export const submitReviewNotes = async (
  repoId: string,
  taskId: string,
): Promise<{ filePath: string; submittedCount: number; regenerating: boolean }> => {
  return request<{ filePath: string; submittedCount: number; regenerating: boolean }>(
    `/repos/${repoId}/tasks/${taskId}/review-notes/submit`,
    {
      method: "POST",
    },
  );
};
