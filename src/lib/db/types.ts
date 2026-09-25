import type {
  User, Project, ProjectVersion, Story, Screenplay, Character, Location, WorldBible,
  Scene, Shot, Asset, GenerationJob, Provider, ModelDescriptor, ApiCredential, ModelPreset,
  Timeline, Track, Clip, VoiceLine, SoundCue, ExportJob, Automation, AutomationRun,
  Subscription, CreditTx, ApiKey
} from '@/types';

/** Every persisted entity carries at least an id. */
export interface Entity { id: string; [k: string]: unknown }

export interface StoryboardRow extends Entity {
  id: string; shotId: string; projectId: string; prompt: string;
  seed: number; approved: boolean; rejected: boolean; createdAt: string;
}
export interface InvoiceRow extends Entity {
  id: string; userId: string; number: string; amount: number; currency: string;
  status: string; planName: string; periodStart: string; periodEnd: string;
  issuedAt: string; pdfKey: string | null;
}
export interface AuditRow extends Entity {
  id: string; userId: string | null; action: string; entity: string; entityId: string | null;
  ip: string | null; meta: Record<string, unknown>; createdAt: string;
}
export interface SessionRow extends Entity {
  id: string; userId: string; token: string; userAgent: string | null;
  ip: string | null; expiresAt: string; createdAt: string;
}
export interface KvRow extends Entity { id: string; key: string; value: unknown; updatedAt: string }
export interface TeamRow extends Entity { id: string; name: string; ownerId: string; seats: number; createdAt: string }
export interface TeamMemberRow extends Entity { id: string; teamId: string; userId: string; role: string }

/** Collection name → entity type. Mirrors the Prisma schema 1:1. */
export interface Collections {
  users: User & Entity;
  sessions: SessionRow;
  teams: TeamRow;
  teamMembers: TeamMemberRow;
  projects: Project & Entity;
  projectVersions: ProjectVersion & Entity;
  stories: Story & Entity;
  scripts: Screenplay & Entity;
  characters: Character & Entity;
  locations: Location & Entity;
  worldBibles: WorldBible & Entity;
  scenes: Scene & Entity;
  shots: Shot & Entity;
  storyboards: StoryboardRow;
  assets: Asset & Entity;
  jobs: GenerationJob & Entity;
  providers: Provider & Entity;
  models: ModelDescriptor & Entity;
  credentials: ApiCredential & Entity;
  apiKeys: ApiKey & Entity;
  presets: ModelPreset & Entity;
  timelines: Timeline & Entity;
  tracks: Track & Entity;
  clips: Clip & Entity;
  voices: VoiceLine & Entity;
  sounds: SoundCue & Entity;
  exports: ExportJob & Entity;
  automations: Automation & Entity;
  runs: AutomationRun & Entity;
  subscriptions: Subscription & Entity;
  creditTxs: CreditTx & Entity;
  invoices: InvoiceRow;
  auditLogs: AuditRow;
  kv: KvRow;
}

export type CollectionName = keyof Collections;
export type EntityOf<K extends CollectionName> = Collections[K];

export type WhereValue =
  | string | number | boolean | null
  | { $in?: unknown[]; $nin?: unknown[]; $contains?: string; $mode?: 'insensitive'; $gt?: number; $lt?: number; $gte?: number; $lte?: number; $ne?: unknown };

export interface Query<T = unknown> {
  where?: Partial<Record<keyof T & string, WhereValue>> & Record<string, WhereValue | undefined>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  take?: number;
  skip?: number;
}

export interface Repo<T extends Entity> {
  findMany(q?: Query<T>): Promise<T[]>;
  findFirst(q?: Query<T>): Promise<T | null>;
  findUnique(id: string): Promise<T | null>;
  create(data: Partial<T> & { id?: string }): Promise<T>;
  createMany(rows: (Partial<T> & { id?: string })[]): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  upsert(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<boolean>;
  deleteWhere(q: Query<T>): Promise<number>;
  count(q?: Query<T>): Promise<number>;
}
