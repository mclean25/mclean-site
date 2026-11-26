import type { Store } from "./store.ts";

export interface EmailMessage {
  from: string | { name: string; email: string };
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface EmailBinding {
  send(message: EmailMessage): Promise<unknown>;
}

export interface Env {
  FILES: R2Bucket;
  STORE: DurableObjectNamespace<Store>;
  EMAIL?: EmailBinding;
  UPLOAD_TOKEN?: string;
  SESSION_SECRET?: string;
  OWNER_EMAIL?: string;
  MAIL_FROM?: string;
  APEX_ORIGIN?: string;
}

export interface ViewerUser {
  email: string;
  name: string;
  isOwner: boolean;
}

export interface StoredUser {
  email: string;
  name: string;
  hasCustomName: boolean;
  createdAt: number;
  lastSeenAt: number;
}

export interface ArtifactRecord {
  token: string;
  title: string;
  entry: string;
  publicLink: boolean;
  fileCount: number;
  totalBytes: number;
  createdAt: number;
  updatedAt: number;
  shareCount?: number;
  openCommentCount?: number;
  totalCommentCount?: number;
}

export interface ShareRecord {
  email: string;
  name: string;
  invitedBy: string | null;
  createdAt: number;
}

export interface CommentRecord {
  id: string;
  token: string;
  parentId: string | null;
  authorEmail: string;
  authorName: string;
  authorKind: "user" | "agent";
  body: string;
  pinX: number | null;
  pinY: number | null;
  pinLabel: string | null;
  pinNumber: number | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BundleFile {
  path: string;
  type: string;
  data: string;
}

export interface ArtifactBundle {
  entry: string;
  files: BundleFile[];
  title?: string;
  publicLink?: boolean;
  shares?: string[];
  notify?: boolean;
}
