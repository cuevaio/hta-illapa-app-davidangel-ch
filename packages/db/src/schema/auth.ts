import { defineRelationsPart } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	int,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/mysql-core";

import { mysqlTable } from "./_table";
import {
	ID_LENGTH_CHARS,
	STATUS_LENGTH_CHARS,
	TEXT_LENGTH_CHARS,
	TIMESTAMP_PRECISION_DIGITS,
} from "./constants";

export const USER_ROLES = ["fleet", "engineer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// No FOREIGN KEY constraints: the database is shared with other projects, so
// relationships live in drizzle relations only and join columns get indexes.
export const user = mysqlTable("user", {
	id: varchar("id", { length: 36 }).primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	email: varchar("email", { length: 255 }).notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text("image"),
	role: varchar("role", { length: STATUS_LENGTH_CHARS }).$type<UserRole>(),
	createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { fsp: 3 })
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = mysqlTable(
	"session",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
		token: varchar("token", { length: 255 }).notNull().unique(),
		createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { fsp: 3 })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: varchar("user_id", { length: 36 }).notNull(),
		activeOrganizationId: varchar("active_organization_id", {
			length: ID_LENGTH_CHARS,
		}),
	},
	(table) => [
		index("session_userId_idx").on(table.userId),
		index("session_activeOrganizationId_idx").on(table.activeOrganizationId),
	],
);

export const account = mysqlTable(
	"account",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: varchar("user_id", { length: 36 }).notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { fsp: 3 }),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { fsp: 3 }),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { fsp: 3 })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = mysqlTable(
	"verification",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		identifier: varchar("identifier", { length: 255 }).notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { fsp: 3 }).notNull(),
		createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { fsp: 3 })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

// better-auth rate limiter rows (`rateLimit.storage: "database"`): Workers keep
// no memory between isolates. `lastRequest` is an epoch-millisecond number, as
// the library stores it.
export const rateLimit = mysqlTable("rate_limit", {
	id: varchar("id", { length: 36 }).primaryKey(),
	key: varchar("key", { length: 255 }).notNull().unique(),
	count: int("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const organization = mysqlTable("organization", {
	id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
	name: varchar("name", { length: TEXT_LENGTH_CHARS }).notNull(),
	slug: varchar("slug", { length: TEXT_LENGTH_CHARS }).notNull().unique(),
	logo: text("logo"),
	metadata: text("metadata"),
	createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
		.defaultNow()
		.notNull(),
});

export const member = mysqlTable(
	"member",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		userId: varchar("user_id", { length: ID_LENGTH_CHARS }).notNull(),
		role: varchar("role", { length: TEXT_LENGTH_CHARS })
			.default("member")
			.notNull(),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("member_organizationId_userId_idx").on(
			table.organizationId,
			table.userId,
		),
		index("member_userId_idx").on(table.userId),
	],
);

export const invitation = mysqlTable(
	"invitation",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		email: varchar("email", { length: TEXT_LENGTH_CHARS }).notNull(),
		role: varchar("role", { length: TEXT_LENGTH_CHARS }),
		status: varchar("status", { length: STATUS_LENGTH_CHARS })
			.default("pending")
			.notNull(),
		expiresAt: timestamp("expires_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}).notNull(),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
		inviterId: varchar("inviter_id", { length: ID_LENGTH_CHARS }).notNull(),
	},
	(table) => [
		index("invitation_organizationId_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
		index("invitation_inviterId_idx").on(table.inviterId),
	],
);

export const authRelations = defineRelationsPart(
	{ user, session, account, verification, organization, member, invitation },
	(r) => ({
		user: {
			sessions: r.many.session({
				from: r.user.id,
				to: r.session.userId,
			}),
			accounts: r.many.account({
				from: r.user.id,
				to: r.account.userId,
			}),
			members: r.many.member({
				from: r.user.id,
				to: r.member.userId,
			}),
			invitations: r.many.invitation({
				from: r.user.id,
				to: r.invitation.inviterId,
			}),
		},
		session: {
			user: r.one.user({
				from: r.session.userId,
				to: r.user.id,
			}),
			activeOrganization: r.one.organization({
				from: r.session.activeOrganizationId,
				to: r.organization.id,
			}),
		},
		account: {
			user: r.one.user({
				from: r.account.userId,
				to: r.user.id,
			}),
		},
		organization: {
			members: r.many.member({
				from: r.organization.id,
				to: r.member.organizationId,
			}),
			invitations: r.many.invitation({
				from: r.organization.id,
				to: r.invitation.organizationId,
			}),
		},
		member: {
			organization: r.one.organization({
				from: r.member.organizationId,
				to: r.organization.id,
			}),
			user: r.one.user({
				from: r.member.userId,
				to: r.user.id,
			}),
		},
		invitation: {
			organization: r.one.organization({
				from: r.invitation.organizationId,
				to: r.organization.id,
			}),
			inviter: r.one.user({
				from: r.invitation.inviterId,
				to: r.user.id,
			}),
		},
	}),
);
