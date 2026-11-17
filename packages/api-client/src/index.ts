import type {
  AddInvoiceItemInput,
  AdjustmentInput,
  AiLogDto,
  AiLogListInput,
  AiOverviewDto,
  ApiErrorBody,
  AuditListQuery,
  AuditLogDto,
  AuthResponse,
  CategoryDto,
  ChangePasswordInput,
  CheckDuplicatesInput,
  ConfidenceThresholds,
  ContractorDto,
  ConversionDto,
  CreateCategoryInput,
  CreateContractorInput,
  CreateConversionInput,
  CreateLocationInput,
  CreateMaterialInput,
  CreateStoreInput,
  CreateUnitInput,
  CreateSupplierInput,
  CreateUserInput,
  DashboardSummaryDto,
  DuplicateCheckResult,
  ErrorCode,
  InvoiceDetailDto,
  InvoiceListInput,
  InvoiceSummaryDto,
  IssueInput,
  LocationDto,
  MaterialDto,
  MappingListInput,
  MaterialListQuery,
  MeResponse,
  MemberDto,
  MergeContractorInput,
  Paginated,
  PostingDto,
  ProjectDto,
  QuickReceiveInput,
  ReportDefinition,
  ReportDto,
  ReportFormat,
  ReportKey,
  ReportQueryInput,
  ReceiptInput,
  ReconciliationDto,
  RejectVerificationInput,
  ReturnInput,
  ReverseInput,
  ReviewVerificationInput,
  StockDetailDto,
  StockListInput,
  StockRowDto,
  StoreDto,
  SupplierDto,
  SupplierListInput,
  SupplierMappingDto,
  SubmitVerificationInput,
  TransactionDto,
  TransactionListInput,
  UnitDto,
  UpdateCategoryInput,
  UpdateContractorInput,
  UpdateInvoiceHeaderInput,
  UpdateInvoiceItemInput,
  UpdateLocationInput,
  UpdateMaterialInput,
  UpdateProjectInput,
  UpdateStoreInput,
  UpdateSupplierInput,
  UpdateUnitInput,
  UpdateUserInput,
  VerificationDto,
  VerificationListInput,
} from '@kavach/shared';

/**
 * Typed client for the KAVACH API, shared by web and mobile (ARCHITECTURE §2).
 *
 * - The access token lives in memory only.
 * - web: the refresh token is an httpOnly cookie the browser sends by itself.
 * - mobile: the refresh token is kept by the `tokenStore` the app provides (SecureStore).
 * - A 401 triggers one refresh and one retry; parallel requests share that refresh.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  mode: 'web' | 'mobile';
  /** The project every scoped request is made in. */
  getProjectId: () => string | null;
  /** mobile only */
  tokenStore?: TokenStore;
  /** Called when the session cannot be refreshed: show the login screen. */
  onSessionExpired?: () => void;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | Date | undefined | null>;

interface RequestOptions {
  body?: unknown;
  /** A file sent as the raw request body (document upload). */
  file?: { data: Blob | ArrayBuffer | Uint8Array; contentType: string };
  /** Read the response as a file instead of JSON (document download). */
  blob?: boolean;
  query?: Query;
  headers?: Record<string, string>;
  /** false for login / refresh: no bearer token, no project header, no retry. */
  auth?: boolean;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  let accessToken: string | null = null;
  let refreshing: Promise<AuthResponse | null> | null = null;

  async function raw<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    // Built by hand: `URL.searchParams` is not fully implemented on every React Native runtime.
    const params: string[] = [];
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      const text = v instanceof Date ? v.toISOString() : String(v);
      params.push(`${encodeURIComponent(k)}=${encodeURIComponent(text)}`);
    }
    const url =
      options.baseUrl.replace(/\/$/, '') + path + (params.length > 0 ? `?${params.join('&')}` : '');
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.file) headers['Content-Type'] = opts.file.contentType;
    if (opts.auth !== false) {
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const projectId = options.getProjectId();
      if (projectId) headers['X-Project-Id'] = projectId;
    }
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: opts.file
          ? (opts.file.data as RequestInit['body'])
          : opts.body === undefined
            ? undefined
            : JSON.stringify(opts.body),
        credentials: options.mode === 'web' ? 'include' : 'omit',
        signal: AbortSignal.timeout(opts.file ? 60_000 : 15_000),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
    }
    if (res.status === 204) return undefined as T;
    if (res.ok && opts.blob) return (await res.blob()) as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const error = (data as ApiErrorBody | null)?.error;
      throw new ApiError(
        res.status,
        error?.code ?? 'INTERNAL',
        error?.message ?? 'Something went wrong. Please try again.',
        error?.details,
      );
    }
    return data as T;
  }

  async function adopt(auth: AuthResponse): Promise<AuthResponse> {
    accessToken = auth.accessToken;
    if (options.mode === 'mobile' && auth.refreshToken) {
      await options.tokenStore?.set(auth.refreshToken);
    }
    return auth;
  }

  async function clear(): Promise<void> {
    accessToken = null;
    if (options.mode === 'mobile') await options.tokenStore?.set(null);
  }

  /** Gets a new access token from the refresh token. Returns null when there is no session. */
  function refresh(): Promise<AuthResponse | null> {
    refreshing ??= (async () => {
      try {
        let body: { refreshToken?: string } = {};
        if (options.mode === 'mobile') {
          const stored = await options.tokenStore?.get();
          if (!stored) return null;
          body = { refreshToken: stored };
        }
        return await adopt(await raw<AuthResponse>('POST', '/auth/refresh', { body, auth: false }));
      } catch (e) {
        // A network failure is not a logout: keep the stored token and let the caller retry.
        if (e instanceof ApiError && e.code === 'NETWORK') throw e;
        await clear();
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    try {
      return await raw<T>(method, path, opts);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || e.code !== 'UNAUTHENTICATED') throw e;
      if (opts.auth === false) throw e;
      const session = await refresh();
      if (!session) {
        options.onSessionExpired?.();
        throw e;
      }
      return raw<T>(method, path, opts);
    }
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
  const post = <T>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
    request<T>('POST', path, { body, headers });
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });

  return {
    auth: {
      async login(identifier: string, password: string): Promise<AuthResponse> {
        const body = { identifier, password, client: options.mode };
        return adopt(await raw<AuthResponse>('POST', '/auth/login', { body, auth: false }));
      },
      /** Call once at start-up: resumes the session if a refresh token exists. */
      restore: (): Promise<MeResponse | null> => refresh(),
      async logout(): Promise<void> {
        const refreshToken =
          options.mode === 'mobile' ? ((await options.tokenStore?.get()) ?? undefined) : undefined;
        await raw<void>('POST', '/auth/logout', { body: { refreshToken }, auth: false }).catch(
          () => undefined,
        );
        await clear();
      },
      async changePassword(input: ChangePasswordInput): Promise<AuthResponse> {
        return adopt(await post<AuthResponse>('/auth/change-password', input));
      },
      me: () => get<MeResponse>('/auth/me'),
      isSignedIn: () => accessToken !== null,
    },
    dashboard: { get: () => get<DashboardSummaryDto>('/dashboard') },
    project: {
      get: () => get<ProjectDto>('/projects/current'),
      update: (input: UpdateProjectInput) => patch<ProjectDto>('/projects/current', input),
    },
    stores: {
      list: () => get<StoreDto[]>('/stores'),
      create: (input: CreateStoreInput) => post<StoreDto>('/stores', input),
      update: (id: string, input: UpdateStoreInput) => patch<StoreDto>(`/stores/${id}`, input),
    },
    locations: {
      list: () => get<LocationDto[]>('/locations'),
      create: (input: CreateLocationInput) => post<LocationDto>('/locations', input),
      update: (id: string, input: UpdateLocationInput) =>
        patch<LocationDto>(`/locations/${id}`, input),
    },
    categories: {
      list: () => get<CategoryDto[]>('/categories'),
      create: (input: CreateCategoryInput) => post<CategoryDto>('/categories', input),
      update: (id: string, input: UpdateCategoryInput) =>
        patch<CategoryDto>(`/categories/${id}`, input),
    },
    units: {
      list: () => get<UnitDto[]>('/units'),
      create: (input: CreateUnitInput) => post<UnitDto>('/units', input),
      update: (id: string, input: UpdateUnitInput) => patch<UnitDto>(`/units/${id}`, input),
    },
    conversions: {
      list: () => get<ConversionDto[]>('/unit-conversions'),
      create: (input: CreateConversionInput) => post<ConversionDto>('/unit-conversions', input),
      setActive: (id: string, isActive: boolean) =>
        patch<ConversionDto>(`/unit-conversions/${id}`, { isActive }),
    },
    materials: {
      list: (query: MaterialListQuery = {}) =>
        get<Paginated<MaterialDto>>('/materials', query as Query),
      get: (id: string) => get<MaterialDto>(`/materials/${id}`),
      checkDuplicates: (input: CheckDuplicatesInput) =>
        post<DuplicateCheckResult>('/materials/check-duplicates', input),
      create: (input: CreateMaterialInput) => post<MaterialDto>('/materials', input),
      update: (id: string, input: UpdateMaterialInput) =>
        patch<MaterialDto>(`/materials/${id}`, input),
      deactivate: (id: string) => post<MaterialDto>(`/materials/${id}/deactivate`),
      activate: (id: string) => post<MaterialDto>(`/materials/${id}/activate`),
    },
    users: {
      list: () => get<MemberDto[]>('/users'),
      create: (input: CreateUserInput) => post<MemberDto>('/users', input),
      update: (userId: string, input: UpdateUserInput) =>
        patch<MemberDto>(`/users/${userId}`, input),
      resetPassword: (userId: string, password: string) =>
        post<void>(`/users/${userId}/reset-password`, { password }),
    },
    auditLogs: {
      list: (query: Omit<AuditListQuery, 'from' | 'to'> & { from?: Date; to?: Date } = {}) =>
        get<Paginated<AuditLogDto>>('/audit-logs', query as Query),
    },
    inventory: {
      receipt: (input: ReceiptInput, idempotencyKey: string) =>
        post<PostingDto>('/inventory/receipts', input, { 'Idempotency-Key': idempotencyKey }),
      quickReceive: (input: QuickReceiveInput, idempotencyKey: string) =>
        post<PostingDto>('/inventory/quick-receive', input, { 'Idempotency-Key': idempotencyKey }),
      issue: (input: IssueInput, idempotencyKey: string) =>
        post<PostingDto>('/inventory/issues', input, { 'Idempotency-Key': idempotencyKey }),
      return: (input: ReturnInput, idempotencyKey: string) =>
        post<PostingDto>('/inventory/returns', input, { 'Idempotency-Key': idempotencyKey }),
      adjustment: (input: AdjustmentInput, idempotencyKey: string) =>
        post<PostingDto>('/inventory/adjustments', input, { 'Idempotency-Key': idempotencyKey }),
      reverse: (id: string, input: ReverseInput, idempotencyKey: string) =>
        post<PostingDto>(`/inventory/postings/${id}/reverse`, input, {
          'Idempotency-Key': idempotencyKey,
        }),
      getPosting: (id: string) => get<PostingDto>(`/inventory/postings/${id}`),
    },
    stock: {
      list: (query: StockListInput = {}) => get<Paginated<StockRowDto>>('/stock', query as Query),
      getDetail: (materialId: string) => get<StockDetailDto>(`/stock/${materialId}`),
      reconciliation: () => get<ReconciliationDto>('/stock/reconciliation'),
    },
    verifications: {
      list: (query: VerificationListInput = {}) =>
        get<Paginated<VerificationDto>>('/stock-verifications', query as Query),
      submit: (input: SubmitVerificationInput) =>
        post<VerificationDto>('/stock-verifications', input),
      approve: (id: string, input: ReviewVerificationInput) =>
        post<VerificationDto>(`/stock-verifications/${id}/approve`, input),
      reject: (id: string, input: RejectVerificationInput) =>
        post<VerificationDto>(`/stock-verifications/${id}/reject`, input),
    },
    transactions: {
      list: (query: TransactionListInput = {}) =>
        get<Paginated<TransactionDto>>('/transactions', query as Query),
    },
    suppliers: {
      list: (query: SupplierListInput = {}) => get<SupplierDto[]>('/suppliers', query as Query),
      create: (input: CreateSupplierInput) => post<SupplierDto>('/suppliers', input),
      update: (id: string, input: UpdateSupplierInput) =>
        patch<SupplierDto>(`/suppliers/${id}`, input),
    },
    supplierMappings: {
      list: (query: MappingListInput = {}) =>
        get<Paginated<SupplierMappingDto>>('/supplier-mappings', query as Query),
      disable: (id: string, reason: string) =>
        post<SupplierMappingDto>(`/supplier-mappings/${id}/disable`, { reason }),
    },
    /** Material In from a scanned invoice or challan (PRD §10.2). */
    invoices: {
      list: (query: InvoiceListInput = {}) =>
        get<Paginated<InvoiceSummaryDto>>('/invoices', query as Query),
      get: (id: string) => get<InvoiceDetailDto>(`/invoices/${id}`),
      create: (storeId: string) => post<InvoiceDetailDto>('/invoices', { storeId }),
      /** Sends one file (JPG, PNG or PDF) of the document. Call once per page, in order. */
      uploadPage: (
        id: string,
        data: Blob | ArrayBuffer | Uint8Array,
        contentType: string,
        fileName?: string,
      ) =>
        request<InvoiceDetailDto>('POST', `/invoices/${id}/pages`, {
          file: { data, contentType },
          headers: fileName ? { 'X-File-Name': encodeURIComponent(fileName) } : undefined,
        }),
      submit: (id: string, overrideQuality = false) =>
        post<InvoiceDetailDto>(`/invoices/${id}/submit`, { overrideQuality }),
      reprocess: (id: string, overrideQuality = false) =>
        post<InvoiceDetailDto>(`/invoices/${id}/reprocess`, { overrideQuality }),
      manualEntry: (id: string) => post<InvoiceDetailDto>(`/invoices/${id}/manual-entry`),
      discard: (id: string) => post<InvoiceDetailDto>(`/invoices/${id}/discard`),
      updateHeader: (id: string, input: UpdateInvoiceHeaderInput) =>
        patch<InvoiceDetailDto>(`/invoices/${id}`, input),
      addItem: (id: string, input: AddInvoiceItemInput) =>
        post<InvoiceDetailDto>(`/invoices/${id}/items`, input),
      updateItem: (id: string, itemId: string, input: UpdateInvoiceItemInput) =>
        patch<InvoiceDetailDto>(`/invoices/${id}/items/${itemId}`, input),
      overrideDuplicate: (id: string, note: string) =>
        post<InvoiceDetailDto>(`/invoices/${id}/duplicate-override`, { note }),
      /** CONFIRM & RECEIVE. Keep the key for retries: the same key returns the same receipt. */
      confirm: (id: string, version: number, idempotencyKey: string) =>
        post<PostingDto>(
          `/invoices/${id}/confirm`,
          { version },
          { 'Idempotency-Key': idempotencyKey },
        ),
      /**
       * Address and headers of a stored page, for a native image component that loads the file
       * itself (React Native `Image`). Refreshes the session first, so the token is current.
       */
      pageSource: async (id: string, pageNo: number) => {
        if (!accessToken) await refresh();
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const projectId = options.getProjectId();
        if (projectId) headers['X-Project-Id'] = projectId;
        return {
          uri: `${options.baseUrl.replace(/\/$/, '')}/invoices/${id}/pages/${pageNo}/content`,
          headers,
        };
      },
      /** The stored page, fetched with the session so it never needs a public link. */
      pageContent: (id: string, pageNo: number) =>
        request<Blob>('GET', `/invoices/${id}/pages/${pageNo}/content`, { blob: true }),
    },
    /** Reports (PRD §19). The server decides which ones a role may open. */
    reports: {
      list: () => get<ReportDefinition[]>('/reports'),
      run: (key: ReportKey, query: ReportQueryInput = {}) =>
        get<ReportDto>(`/reports/${key}`, query as Query),
      /** The Excel or PDF file, fetched with the session. */
      export: (key: ReportKey, query: ReportQueryInput, format: ReportFormat) =>
        request<Blob>('GET', `/reports/${key}/export`, {
          blob: true,
          query: { ...(query as Query), format },
        }),
      /** Address and headers of the file, for a native download that fetches it itself. */
      exportSource: async (key: ReportKey, query: ReportQueryInput, format: ReportFormat) => {
        if (!accessToken) await refresh();
        const headers: Record<string, string> = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const projectId = options.getProjectId();
        if (projectId) headers['X-Project-Id'] = projectId;
        const all: Query = { ...(query as Query), format };
        const params = Object.entries(all)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&');
        return {
          uri: `${options.baseUrl.replace(/\/$/, '')}/reports/${key}/export?${params}`,
          headers,
        };
      },
    },
    aiLogs: {
      list: (query: AiLogListInput = {}) => get<Paginated<AiLogDto>>('/ai-logs', query as Query),
      overview: () => get<AiOverviewDto>('/ai-logs/overview'),
    },
    settings: {
      getConfidence: () => get<ConfidenceThresholds>('/settings/confidence'),
      setConfidence: (input: ConfidenceThresholds) =>
        patch<ConfidenceThresholds>('/settings/confidence', input),
    },
    contractors: {
      list: () => get<ContractorDto[]>('/contractors'),
      create: (input: CreateContractorInput) => post<ContractorDto>('/contractors', input),
      update: (id: string, input: UpdateContractorInput) =>
        patch<ContractorDto>(`/contractors/${id}`, input),
      merge: (id: string, input: MergeContractorInput) =>
        post<ContractorDto>(`/contractors/${id}/merge`, input),
    },
  };
}
