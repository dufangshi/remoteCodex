import { eq } from 'drizzle-orm';

import { DatabaseClient, getDefaultHostRecord } from './client';
import { hosts, policies } from './schema';

const defaultPolicies = [
  {
    id: 'policy-workspace-root',
    key: 'workspace_root',
    valueJson: JSON.stringify({ enforceWithinRoot: true })
  },
  {
    id: 'policy-dotfiles',
    key: 'tree_defaults',
    valueJson: JSON.stringify({ showHidden: false })
  }
];

export function seedDefaults(db: DatabaseClient) {
  const host = getDefaultHostRecord();

  const existingHost = db.select().from(hosts).where(eq(hosts.id, host.id)).get();

  if (!existingHost) {
    db.insert(hosts).values(host).run();
  } else {
    db.update(hosts)
      .set({
        hostname: host.hostname,
        platform: host.platform,
        lastSeenAt: host.lastSeenAt
      })
      .where(eq(hosts.id, host.id))
      .run();
  }

  for (const policy of defaultPolicies) {
    const existingPolicy = db.select().from(policies).where(eq(policies.key, policy.key)).get();

    if (!existingPolicy) {
      const now = new Date().toISOString();
      db.insert(policies)
        .values({
          ...policy,
          createdAt: now,
          updatedAt: now
        })
        .run();
    }
  }
}
