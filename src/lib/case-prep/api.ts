// Client for /api/case-prep. Uses the same session token as the rest of the app.
import { getApiUrl } from '@/utils/apiUrl';
import type {
  BriefResponse,
  BriefSection,
  CasePrepStatus,
  CaseDocument,
  Fact,
  FactType,
  Issue,
  MatterType,
  Passage,
  ReviewStatus,
  UploadResult,
  Workspace,
  WorkspacePayload,
  WorkspaceSummary,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, message: string, code = 'ERROR', details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function token(): string | null {
  try {
    const raw = localStorage.getItem('auth_session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session?.access_token || session?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = token();
  if (!auth) throw new ApiError(401, 'Your session has ended. Sign in again.', 'NO_SESSION');
  const headers: Record<string, string> = { Authorization: `Bearer ${auth}` };
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${getApiUrl(true)}/case-prep${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.', 'NETWORK');
  }

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (res.ok) return (await res.blob()) as unknown as T;
    throw new ApiError(res.status, `The server returned an unexpected response (${res.status}).`, 'BAD_RESPONSE');
  }
  const body = await res.json();
  if (!res.ok) {
    const message = res.status === 401 ? 'Your session has ended. Sign in again.' : body?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body?.code || 'ERROR', body || {});
  }
  return body as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const casePrepApi = {
  status: () => request<CasePrepStatus>('/status'),

  listWorkspaces: () => request<WorkspaceSummary[]>('/workspaces'),
  createWorkspace: (data: { title: string; matter_type: MatterType; forum?: string; client_side?: string; description?: string }) =>
    request<Workspace>('/workspaces', { method: 'POST', body: json(data) }),
  getWorkspace: (id: string) => request<WorkspacePayload>(`/workspaces/${id}`),
  deleteWorkspace: (id: string) => request<{ deleted: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),

  uploadDocuments: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));
    return request<{ results: UploadResult[] }>(`/workspaces/${id}/documents`, { method: 'POST', body: form });
  },
  documentText: (docId: string) => request<{ document: CaseDocument; passages: Passage[] }>(`/documents/${docId}/text`),
  documentFile: async (docId: string): Promise<Blob> => {
    const auth = token();
    if (!auth) throw new ApiError(401, 'Your session has ended. Sign in again.', 'NO_SESSION');
    const res = await fetch(`${getApiUrl(true)}/case-prep/documents/${docId}/file`, { headers: { Authorization: `Bearer ${auth}` } });
    if (!res.ok) throw new ApiError(res.status, 'The original file could not be opened.', 'FILE_ERROR');
    return res.blob();
  },
  deleteDocument: (docId: string) => request<{ deleted: boolean }>(`/documents/${docId}`, { method: 'DELETE' }),

  analyse: (id: string, scope: 'pending' | 'all' = 'pending') =>
    request<{ started: boolean; documents: number }>(`/workspaces/${id}/analyse`, { method: 'POST', body: json({ scope }) }),

  updateFact: (factId: string, data: { review_status?: ReviewStatus; statement?: string; reviewer_note?: string | null; event_date?: string | null }) =>
    request<Fact>(`/facts/${factId}`, { method: 'PATCH', body: json(data) }),
  addFact: (id: string, data: { statement: string; fact_type: FactType; event_date?: string | null; document_id?: string | null; quote?: string | null }) =>
    request<Fact>(`/workspaces/${id}/facts`, { method: 'POST', body: json(data) }),

  updateIssue: (issueId: string, data: { review_status?: ReviewStatus; title?: string; analysis?: string; reviewer_note?: string | null }) =>
    request<Issue>(`/issues/${issueId}`, { method: 'PATCH', body: json(data) }),

  getBrief: (id: string) => request<BriefResponse>(`/workspaces/${id}/brief`),
  generateBrief: (id: string, overwrite = false) => request<BriefResponse>(`/workspaces/${id}/brief/generate`, { method: 'POST', body: json({ overwrite }) }),
  saveBrief: (id: string, revision: number, sections: BriefSection[]) =>
    request<BriefResponse>(`/workspaces/${id}/brief`, { method: 'PUT', body: json({ revision, sections }) }),
  approveBrief: (id: string, revision: number, reviewerName: string) =>
    request<BriefResponse>(`/workspaces/${id}/brief/approve`, { method: 'POST', body: json({ revision, attestation: true, reviewer_name: reviewerName }) }),
  logExport: (id: string, format: 'pdf' | 'markdown') =>
    request<{ logged: boolean }>(`/workspaces/${id}/brief/export-log`, { method: 'POST', body: json({ format }) }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
