import { integer, real, sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const spaces = sqliteTable('spaces', {id:text('id').primaryKey(),name:text('name').notNull(),owner:text('owner').notNull(),invite:text('invite').notNull().unique(),created:text('created').notNull()});
export const members=sqliteTable('members',{space:text('space').notNull(),user:text('user').notNull()},t=>[primaryKey({columns:[t.space,t.user]})]);
export const captures=sqliteTable('captures',{id:text('id').primaryKey(),space:text('space').notNull(),owner:text('owner').notNull(),label:text('label').notNull(),created:text('created').notNull(),frames:text('frames').notNull(),objects:text('objects').notNull().default('[]'),mode:text('mode').notNull().default('manual')},t=>[index('captures_space').on(t.space)]);
export const ledger=sqliteTable('ledger',{id:text('id').primaryKey(),space:text('space').notNull(),kind:text('kind').notNull(),cost:real('cost').notNull(),input:integer('input').notNull().default(0),output:integer('output').notNull().default(0),status:text('status').notNull(),created:text('created').notNull()});
export const config=sqliteTable('config',{key:text('key').primaryKey(),value:text('value').notNull()});
export const feedback=sqliteTable('feedback',{id:text('id').primaryKey(),space:text('space').notNull(),user:text('user').notNull(),found:integer('found').notNull(),intent:text('intent').notNull(),seconds:real('seconds').notNull(),created:text('created').notNull()});
export const missingReports=sqliteTable('missing_reports',{
 id:text('id').notNull(),space:text('space').notNull(),user:text('user').notNull(),
 query:text('query').notNull(),queryKey:text('query_key').notNull(),kind:text('kind').notNull(),
 capture:text('capture').notNull().default(''),label:text('label').notNull().default(''),
 capturedAt:text('captured_at').notNull().default(''),image:text('image').notNull().default(''),
 note:text('note').notNull().default(''),created:text('created').notNull(),
 resolvedAt:text('resolved_at').notNull().default('')
},t=>[primaryKey({columns:[t.space,t.id]}),index('missing_reports_pending').on(t.space,t.resolvedAt,t.created)]);

export const rateLimits=sqliteTable('rate_limits',{scope:text('scope').primaryKey(),windowStart:integer('window_start').notNull(),count:integer('count').notNull()});
export const aiLocks=sqliteTable('ai_locks',{space:text('space').primaryKey(),token:text('token').notNull(),expires:integer('expires').notNull()});
