import { DurableObject } from "cloudflare:workers";
import { randomBytes } from "node:crypto";
import { timingSafeStringEqual } from "./auth.ts";
import type {
  ArtifactRecord,
  CommentRecord,
  Env,
  ShareRecord,
  StoredUser,
} from "./types.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_CODES_PER_EMAIL = 5;
const MAX_CODES_GLOBAL = 60;
const MAX_VERIFY_ATTEMPTS = 5;

type UserRow = {
  email: string;
  name: string;
  created_at: number;
  last_seen_at: number;
};

type LoginCodeRow = {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
};

type ArtifactRow = {
  token: string;
  title: string;
  entry: string;
  public_link: number;
  file_count: number;
  total_bytes: number;
  created_at: number;
  updated_at: number;
};

type ArtifactWithCountsRow = ArtifactRow & {
  share_count: number;
  open_comment_count: number;
  total_comment_count: number;
};

type ShareRow = {
  email: string;
  invited_by: string | null;
  created_at: number;
  name: string | null;
};

type CommentRow = {
  id: string;
  token: string;
  parent_id: string | null;
  author_email: string;
  author_name: string;
  author_kind: string;
  body: string;
  pin_x: number | null;
  pin_y: number | null;
  pin_label: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  created_at: number;
  updated_at: number;
};

type CommentWithUserRow = CommentRow & {
  user_name: string | null;
};

function makeId(prefix = ""): string {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

function defaultNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "Viewer";
  return local
    .replace(/[._+-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export class Store extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY
      );
    `);
    const row = this.sql
      .exec<{ version: number | null }>(
        "SELECT MAX(version) AS version FROM schema_meta",
      )
      .toArray()[0];
    const current = row?.version ?? 0;
    if (current < 1) {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          token TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          entry TEXT NOT NULL,
          public_link INTEGER NOT NULL DEFAULT 1,
          file_count INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shares (
          token TEXT NOT NULL,
          email TEXT NOT NULL,
          invited_by TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (token, email)
        );
        CREATE INDEX IF NOT EXISTS idx_shares_email ON shares(email);

        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS login_codes (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          used_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);

        CREATE TABLE IF NOT EXISTS comments (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          parent_id TEXT,
          author_email TEXT NOT NULL,
          author_name TEXT NOT NULL DEFAULT '',
          author_kind TEXT NOT NULL DEFAULT 'user',
          body TEXT NOT NULL,
          pin_x REAL,
          pin_y REAL,
          pin_label TEXT,
          resolved_at INTEGER,
          resolved_by TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comments_token ON comments(token, created_at);

        INSERT INTO schema_meta (version) VALUES (1);
      `);
    }
  }

  // --- Users & Auth ---

  async getUser(email: string): Promise<StoredUser | null> {
    await this.ready;
    const normalized = email.toLowerCase();
    const row = this.sql
      .exec<UserRow>(
        "SELECT email, name, created_at, last_seen_at FROM users WHERE email = ?",
        normalized,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      email: row.email,
      name: row.name || defaultNameFromEmail(row.email),
      hasCustomName: Boolean(row.name),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async upsertUser(email: string, name = ""): Promise<StoredUser> {
    await this.ready;
    const normalized = email.toLowerCase();
    const now = Date.now();
    const existing = this.sql
      .exec<Pick<UserRow, "email" | "name" | "created_at">>(
        "SELECT email, name, created_at FROM users WHERE email = ?",
        normalized,
      )
      .toArray()[0];
    if (existing) {
      const nextName = name ? name.trim().slice(0, 80) : existing.name;
      this.sql.exec(
        "UPDATE users SET name = ?, last_seen_at = ? WHERE email = ?",
        nextName,
        now,
        normalized,
      );
    } else {
      this.sql.exec(
        "INSERT INTO users (email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        normalized,
        name.trim().slice(0, 80),
        now,
        now,
      );
    }
    const user = await this.getUser(normalized);
    if (!user) throw new Error("Failed to load upserted user");
    return user;
  }

  async updateUserName(email: string, name: string): Promise<StoredUser> {
    await this.ready;
    const normalized = email.toLowerCase();
    const cleaned = name.trim().slice(0, 80);
    const now = Date.now();
    const existing = this.sql
      .exec<{ email: string }>(
        "SELECT email FROM users WHERE email = ?",
        normalized,
      )
      .toArray()[0];
    if (existing) {
      this.sql.exec(
        "UPDATE users SET name = ?, last_seen_at = ? WHERE email = ?",
        cleaned,
        now,
        normalized,
      );
    } else {
      this.sql.exec(
        "INSERT INTO users (email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        normalized,
        cleaned,
        now,
        now,
      );
    }
    const user = await this.getUser(normalized);
    if (!user) throw new Error("Failed to load updated user");
    return user;
  }

  async createLoginCode(
    email: string,
    codeHash: string,
  ): Promise<
    | { ok: true; id: string; expiresAt: number }
    | { ok: false; status: number; error: string }
  > {
    await this.ready;
    const normalized = email.toLowerCase();
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;

    this.sql.exec(
      "DELETE FROM login_codes WHERE created_at < ?",
      now - 24 * 60 * 60 * 1000,
    );

    const perEmail =
      this.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM login_codes WHERE email = ? AND created_at >= ?",
          normalized,
          windowStart,
        )
        .toArray()[0]?.count ?? 0;
    if (perEmail >= MAX_CODES_PER_EMAIL) {
      return {
        ok: false,
        status: 429,
        error: "Too many sign-in codes requested. Please wait a few minutes.",
      };
    }

    const globalCount =
      this.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM login_codes WHERE created_at >= ?",
          windowStart,
        )
        .toArray()[0]?.count ?? 0;
    if (globalCount >= MAX_CODES_GLOBAL) {
      return {
        ok: false,
        status: 429,
        error: "Sign-in is temporarily busy. Please try again shortly.",
      };
    }

    const id = makeId("otp_");
    this.sql.exec(
      "INSERT INTO login_codes (id, email, code_hash, expires_at, attempts, used_at, created_at) VALUES (?, ?, ?, ?, 0, NULL, ?)",
      id,
      normalized,
      codeHash,
      now + CODE_TTL_MS,
      now,
    );
    return { ok: true, id, expiresAt: now + CODE_TTL_MS };
  }

  async verifyLoginCode(
    email: string,
    codeHash: string,
  ): Promise<
    | { ok: true; user: StoredUser }
    | { ok: false; status: number; error: string }
  > {
    await this.ready;
    const normalized = email.toLowerCase();
    const now = Date.now();

    const rows = this.sql
      .exec<LoginCodeRow>(
        `SELECT id, code_hash, attempts, expires_at
         FROM login_codes
         WHERE email = ? AND used_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 5`,
        normalized,
        now,
      )
      .toArray();

    if (!rows.length) {
      return {
        ok: false,
        status: 400,
        error: "Code is invalid or expired. Request a new code.",
      };
    }

    const active = rows.filter((r) => r.attempts < MAX_VERIFY_ATTEMPTS);
    if (!active.length) {
      return {
        ok: false,
        status: 429,
        error: "Too many incorrect attempts. Request a new code.",
      };
    }

    let matched: LoginCodeRow | null = null;
    for (const row of active) {
      if (timingSafeStringEqual(row.code_hash, codeHash)) {
        matched = row;
        break;
      }
    }

    if (!matched) {
      for (const row of active) {
        this.sql.exec(
          "UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?",
          row.id,
        );
      }
      return {
        ok: false,
        status: 400,
        error: "Incorrect code. Please try again.",
      };
    }

    this.sql.exec(
      "UPDATE login_codes SET used_at = ? WHERE id = ?",
      now,
      matched.id,
    );
    const user = await this.upsertUser(normalized);
    return { ok: true, user };
  }

  // --- Artifacts ---

  private formatArtifact(
    row: ArtifactRow | ArtifactWithCountsRow | undefined,
  ): ArtifactRecord | null {
    if (!row) return null;
    const withCounts = "share_count" in row ? row : null;
    return {
      token: row.token,
      title: row.title,
      entry: row.entry,
      publicLink: Boolean(row.public_link),
      fileCount: row.file_count,
      totalBytes: row.total_bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(withCounts
        ? {
            shareCount: withCounts.share_count,
            openCommentCount: withCounts.open_comment_count,
            totalCommentCount: withCounts.total_comment_count,
          }
        : {}),
    };
  }

  async upsertArtifact(input: {
    token: string;
    title?: string;
    entry: string;
    publicLink?: boolean;
    fileCount: number;
    totalBytes: number;
    shares?: string[];
    invitedBy?: string;
  }): Promise<{ artifact: ArtifactRecord; newlyAddedShares: string[] }> {
    await this.ready;
    const now = Date.now();
    const existing = this.sql
      .exec<ArtifactRow>(
        "SELECT * FROM artifacts WHERE token = ?",
        input.token,
      )
      .toArray()[0];

    const resolvedTitle =
      typeof input.title === "string" && input.title.trim()
        ? input.title.trim().slice(0, 140)
        : existing?.title || input.entry || "Untitled artifact";

    const resolvedPublic =
      typeof input.publicLink === "boolean"
        ? input.publicLink
          ? 1
          : 0
        : existing
          ? existing.public_link
          : 1;

    if (existing) {
      this.sql.exec(
        `UPDATE artifacts
         SET title = ?, entry = ?, public_link = ?, file_count = ?, total_bytes = ?, updated_at = ?
         WHERE token = ?`,
        resolvedTitle,
        input.entry,
        resolvedPublic,
        input.fileCount,
        input.totalBytes,
        now,
        input.token,
      );
    } else {
      this.sql.exec(
        `INSERT INTO artifacts (token, title, entry, public_link, file_count, total_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.token,
        resolvedTitle,
        input.entry,
        resolvedPublic,
        input.fileCount,
        input.totalBytes,
        now,
        now,
      );
    }

    const newlyAddedShares: string[] = [];
    if (Array.isArray(input.shares)) {
      for (const email of input.shares) {
        const normalized = email.trim().toLowerCase();
        if (!normalized) continue;
        const already = this.sql
          .exec<{ "1": number }>(
            "SELECT 1 FROM shares WHERE token = ? AND email = ?",
            input.token,
            normalized,
          )
          .toArray()[0];
        if (!already) {
          this.sql.exec(
            "INSERT INTO shares (token, email, invited_by, created_at) VALUES (?, ?, ?, ?)",
            input.token,
            normalized,
            input.invitedBy || null,
            now,
          );
          newlyAddedShares.push(normalized);
        }
      }
    }

    const artifact = await this.getArtifact(input.token);
    if (!artifact) throw new Error("Failed to load upserted artifact");
    return { artifact, newlyAddedShares };
  }

  async ensureArtifact(input: {
    token: string;
    entry: string;
    fileCount: number;
    totalBytes: number;
  }): Promise<ArtifactRecord | null> {
    await this.ready;
    const existing = this.sql
      .exec<ArtifactRow>(
        "SELECT * FROM artifacts WHERE token = ?",
        input.token,
      )
      .toArray()[0];
    if (existing) return this.formatArtifact(existing);
    const now = Date.now();
    this.sql.exec(
      `INSERT OR IGNORE INTO artifacts (token, title, entry, public_link, file_count, total_bytes, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      input.token,
      input.entry || "Untitled artifact",
      input.entry || "index.html",
      input.fileCount,
      input.totalBytes,
      now,
      now,
    );
    return this.getArtifact(input.token);
  }

  async getArtifact(token: string): Promise<ArtifactRecord | null> {
    await this.ready;
    const row = this.sql
      .exec<ArtifactWithCountsRow>(
        `SELECT a.*,
          (SELECT COUNT(*) FROM shares s WHERE s.token = a.token) AS share_count,
          (SELECT COUNT(*) FROM comments c WHERE c.token = a.token AND c.parent_id IS NULL AND c.resolved_at IS NULL) AS open_comment_count,
          (SELECT COUNT(*) FROM comments c WHERE c.token = a.token) AS total_comment_count
         FROM artifacts a
         WHERE a.token = ?`,
        token,
      )
      .toArray()[0];
    return this.formatArtifact(row);
  }

  async listArtifacts(input: {
    email: string | null;
    isOwner: boolean;
  }): Promise<ArtifactRecord[]> {
    await this.ready;
    let rows: ArtifactWithCountsRow[];
    if (input.isOwner) {
      rows = this.sql
        .exec<ArtifactWithCountsRow>(
          `SELECT a.*,
            (SELECT COUNT(*) FROM shares s WHERE s.token = a.token) AS share_count,
            (SELECT COUNT(*) FROM comments c WHERE c.token = a.token AND c.parent_id IS NULL AND c.resolved_at IS NULL) AS open_comment_count,
            (SELECT COUNT(*) FROM comments c WHERE c.token = a.token) AS total_comment_count
           FROM artifacts a
           ORDER BY a.updated_at DESC`,
        )
        .toArray();
    } else if (input.email) {
      rows = this.sql
        .exec<ArtifactWithCountsRow>(
          `SELECT a.*,
            (SELECT COUNT(*) FROM shares s WHERE s.token = a.token) AS share_count,
            (SELECT COUNT(*) FROM comments c WHERE c.token = a.token AND c.parent_id IS NULL AND c.resolved_at IS NULL) AS open_comment_count,
            (SELECT COUNT(*) FROM comments c WHERE c.token = a.token) AS total_comment_count
           FROM artifacts a
           INNER JOIN shares sh ON sh.token = a.token
           WHERE sh.email = ?
           ORDER BY a.updated_at DESC`,
          input.email.toLowerCase(),
        )
        .toArray();
    } else {
      rows = [];
    }
    return rows
      .map((row) => this.formatArtifact(row))
      .filter((item): item is ArtifactRecord => item !== null);
  }

  async updateArtifact(
    token: string,
    patch: { title?: string; publicLink?: boolean },
  ): Promise<ArtifactRecord | null> {
    await this.ready;
    const existing = this.sql
      .exec<ArtifactRow>("SELECT * FROM artifacts WHERE token = ?", token)
      .toArray()[0];
    if (!existing) return null;
    const title =
      typeof patch.title === "string" && patch.title.trim()
        ? patch.title.trim().slice(0, 140)
        : existing.title;
    const publicLink =
      typeof patch.publicLink === "boolean"
        ? patch.publicLink
          ? 1
          : 0
        : existing.public_link;
    this.sql.exec(
      "UPDATE artifacts SET title = ?, public_link = ?, updated_at = ? WHERE token = ?",
      title,
      publicLink,
      Date.now(),
      token,
    );
    return this.getArtifact(token);
  }

  async deleteArtifact(token: string): Promise<{ ok: true }> {
    await this.ready;
    this.sql.exec("DELETE FROM comments WHERE token = ?", token);
    this.sql.exec("DELETE FROM shares WHERE token = ?", token);
    this.sql.exec("DELETE FROM artifacts WHERE token = ?", token);
    return { ok: true };
  }

  // --- Shares ---

  async listShares(token: string): Promise<ShareRecord[]> {
    await this.ready;
    const rows = this.sql
      .exec<ShareRow>(
        `SELECT s.email, s.invited_by, s.created_at, u.name
         FROM shares s
         LEFT JOIN users u ON u.email = s.email
         WHERE s.token = ?
         ORDER BY s.created_at ASC`,
        token,
      )
      .toArray();
    return rows.map((r) => ({
      email: r.email,
      name: r.name || defaultNameFromEmail(r.email),
      invitedBy: r.invited_by,
      createdAt: r.created_at,
    }));
  }

  async addShare(
    token: string,
    email: string,
    invitedBy: string | null,
  ): Promise<{ added: boolean; shares: ShareRecord[] }> {
    await this.ready;
    const normalized = email.toLowerCase();
    const existing = this.sql
      .exec<{ "1": number }>(
        "SELECT 1 FROM shares WHERE token = ? AND email = ?",
        token,
        normalized,
      )
      .toArray()[0];
    const now = Date.now();
    if (!existing) {
      this.sql.exec(
        "INSERT INTO shares (token, email, invited_by, created_at) VALUES (?, ?, ?, ?)",
        token,
        normalized,
        invitedBy,
        now,
      );
    }
    return {
      added: !existing,
      shares: await this.listShares(token),
    };
  }

  async removeShare(
    token: string,
    email: string,
  ): Promise<{ shares: ShareRecord[] }> {
    await this.ready;
    this.sql.exec(
      "DELETE FROM shares WHERE token = ? AND email = ?",
      token,
      email.toLowerCase(),
    );
    return { shares: await this.listShares(token) };
  }

  async isSharedWith(token: string, email: string): Promise<boolean> {
    await this.ready;
    if (!email) return false;
    const row = this.sql
      .exec<{ "1": number }>(
        "SELECT 1 FROM shares WHERE token = ? AND email = ?",
        token,
        email.toLowerCase(),
      )
      .toArray()[0];
    return Boolean(row);
  }

  // --- Comments ---

  async listComments(token: string): Promise<CommentRecord[]> {
    await this.ready;
    const rows = this.sql
      .exec<CommentWithUserRow>(
        `SELECT c.*, u.name AS user_name
         FROM comments c
         LEFT JOIN users u ON u.email = c.author_email
         WHERE c.token = ?
         ORDER BY c.created_at ASC`,
        token,
      )
      .toArray();

    let pinSeq = 0;
    return rows.map((r) => {
      const isPin =
        !r.parent_id &&
        typeof r.pin_x === "number" &&
        typeof r.pin_y === "number";
      const pinNumber = isPin ? ++pinSeq : null;
      const authorKind: "user" | "agent" =
        r.author_kind === "agent" ? "agent" : "user";
      const authorName =
        authorKind === "agent"
          ? r.author_name || "Agent"
          : r.user_name || r.author_name || defaultNameFromEmail(r.author_email);
      return {
        id: r.id,
        token: r.token,
        parentId: r.parent_id,
        authorEmail: r.author_email,
        authorName,
        authorKind,
        body: r.body,
        pinX: r.pin_x,
        pinY: r.pin_y,
        pinLabel: r.pin_label,
        pinNumber,
        resolvedAt: r.resolved_at,
        resolvedBy: r.resolved_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async getComment(
    token: string,
    id: string,
  ): Promise<Omit<CommentRecord, "pinNumber"> | null> {
    await this.ready;
    const r = this.sql
      .exec<CommentRow>(
        "SELECT * FROM comments WHERE token = ? AND id = ?",
        token,
        id,
      )
      .toArray()[0];
    if (!r) return null;
    return {
      id: r.id,
      token: r.token,
      parentId: r.parent_id,
      authorEmail: r.author_email,
      authorName: r.author_name,
      authorKind: r.author_kind === "agent" ? "agent" : "user",
      body: r.body,
      pinX: r.pin_x,
      pinY: r.pin_y,
      pinLabel: r.pin_label,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createComment(input: {
    token: string;
    parentId?: string | null;
    authorEmail: string;
    authorName?: string;
    authorKind?: "user" | "agent";
    body: unknown;
    pinX?: unknown;
    pinY?: unknown;
    pinLabel?: unknown;
  }): Promise<
    | { ok: true; comment: CommentRecord; comments: CommentRecord[] }
    | { ok: false; status: number; error: string }
  > {
    await this.ready;
    const text = typeof input.body === "string" ? input.body.trim() : "";
    if (!text || text.length > 8000) {
      return {
        ok: false,
        status: 400,
        error: "Comment must be between 1 and 8000 characters.",
      };
    }

    let resolvedParentId: string | null = null;
    if (input.parentId) {
      const parent = this.sql
        .exec<{ id: string; parent_id: string | null }>(
          "SELECT id, parent_id FROM comments WHERE token = ? AND id = ?",
          input.token,
          input.parentId,
        )
        .toArray()[0];
      if (!parent) {
        return { ok: false, status: 404, error: "Parent comment not found." };
      }
      resolvedParentId = parent.parent_id || parent.id;
    }

    let px: number | null = null;
    let py: number | null = null;
    let pLabel: string | null = null;
    if (
      !resolvedParentId &&
      input.pinX !== null &&
      input.pinX !== undefined &&
      input.pinY !== null &&
      input.pinY !== undefined
    ) {
      const nx = Number(input.pinX);
      const ny = Number(input.pinY);
      if (
        !Number.isFinite(nx) ||
        !Number.isFinite(ny) ||
        nx < 0 ||
        nx > 1 ||
        ny < 0 ||
        ny > 1
      ) {
        return {
          ok: false,
          status: 400,
          error: "Pin coordinates must be between 0 and 1.",
        };
      }
      px = Math.round(nx * 10000) / 10000;
      py = Math.round(ny * 10000) / 10000;
      pLabel =
        typeof input.pinLabel === "string" && input.pinLabel.trim()
          ? input.pinLabel.trim().slice(0, 120)
          : null;
    }

    const now = Date.now();
    const id = makeId("cmt_");
    const email = input.authorEmail.toLowerCase();
    this.sql.exec(
      `INSERT INTO comments
       (id, token, parent_id, author_email, author_name, author_kind, body, pin_x, pin_y, pin_label, resolved_at, resolved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      id,
      input.token,
      resolvedParentId,
      email,
      (input.authorName || "").trim().slice(0, 80),
      input.authorKind === "agent" ? "agent" : "user",
      text,
      px,
      py,
      pLabel,
      now,
      now,
    );

    const comments = await this.listComments(input.token);
    const created = comments.find((c) => c.id === id);
    if (!created) throw new Error("Failed to load created comment");
    return { ok: true, comment: created, comments };
  }

  async updateComment(input: {
    token: string;
    id: string;
    body?: unknown;
    resolved?: boolean;
    actorEmail: string;
    canEditBody: boolean;
  }): Promise<
    | { ok: true; comment: CommentRecord; comments: CommentRecord[] }
    | { ok: false; status: number; error: string }
  > {
    await this.ready;
    const existing = this.sql
      .exec<CommentRow>(
        "SELECT * FROM comments WHERE token = ? AND id = ?",
        input.token,
        input.id,
      )
      .toArray()[0];
    if (!existing) {
      return { ok: false, status: 404, error: "Comment not found." };
    }

    const now = Date.now();
    let nextBody = existing.body;
    if (input.body !== undefined) {
      if (!input.canEditBody) {
        return {
          ok: false,
          status: 403,
          error: "You cannot edit this comment.",
        };
      }
      const trimmed = typeof input.body === "string" ? input.body.trim() : "";
      if (!trimmed || trimmed.length > 8000) {
        return {
          ok: false,
          status: 400,
          error: "Comment must be between 1 and 8000 characters.",
        };
      }
      nextBody = trimmed;
    }

    let nextResolvedAt = existing.resolved_at;
    let nextResolvedBy = existing.resolved_by;
    if (typeof input.resolved === "boolean") {
      if (existing.parent_id) {
        return {
          ok: false,
          status: 400,
          error: "Only top-level threads can be resolved.",
        };
      }
      nextResolvedAt = input.resolved ? now : null;
      nextResolvedBy = input.resolved ? input.actorEmail.toLowerCase() : null;
    }

    this.sql.exec(
      "UPDATE comments SET body = ?, resolved_at = ?, resolved_by = ?, updated_at = ? WHERE token = ? AND id = ?",
      nextBody,
      nextResolvedAt,
      nextResolvedBy,
      now,
      input.token,
      input.id,
    );

    const comments = await this.listComments(input.token);
    const updated = comments.find((c) => c.id === input.id);
    if (!updated) throw new Error("Failed to load updated comment");
    return { ok: true, comment: updated, comments };
  }

  async deleteComment(
    token: string,
    id: string,
  ): Promise<
    | { ok: true; comments: CommentRecord[] }
    | { ok: false; status: number; error: string }
  > {
    await this.ready;
    const existing = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM comments WHERE token = ? AND id = ?",
        token,
        id,
      )
      .toArray()[0];
    if (!existing) {
      return { ok: false, status: 404, error: "Comment not found." };
    }
    this.sql.exec(
      "DELETE FROM comments WHERE token = ? AND (id = ? OR parent_id = ?)",
      token,
      id,
      id,
    );
    return { ok: true, comments: await this.listComments(token) };
  }
}
