import { PermissionFlags } from '@fluxerjs/core';
import { getCommandRule } from '../db/index.js';

export async function evaluateCommandAccess(guild, userId, commandName) {
  const rule = getCommandRule(guild.id, commandName);
  if (!rule.enabled) return { allowed: false, reason: 'disabled', granted: false };
  if (!rule.roles.length && !rule.members.length) return { allowed: true, granted: false };

  if (guild.ownerId === userId) return { allowed: true, granted: false };

  const member =
    guild.members.get(userId) ?? (await guild.fetchMember(userId).catch(() => null));
  if (!member) return { allowed: false, reason: 'no_access', granted: false };

  if (member.permissions?.has(PermissionFlags.Administrator)) return { allowed: true, granted: false };

  const byMember = rule.members.includes(String(userId));
  const memberRoles = member.roles?.roleIds ?? [];
  const byRole = rule.roles.some((r) => memberRoles.includes(r));
  if (byMember || byRole) return { allowed: true, granted: true };

  return { allowed: false, reason: 'no_access', granted: false };
}

/** Is this command switched off in the guild? (used to tidy the help embed) */
export const isCommandDisabled = (guildId, commandName) => !getCommandRule(guildId, commandName).enabled;
