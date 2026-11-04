export const COMMAND_CATEGORIES = [
  {
    id: 'setup',
    label: 'Setup',
    icon: 'wrench',
    commands: [
      { name: 'setup', base: 'manage', description: 'Create the Join-to-Create system' },
      { name: 'setup-wizard', base: 'manage', description: 'Guided setup wizard' },
      { name: 'delete-setup', base: 'manage', description: 'Remove the Join-to-Create setup' },
      { name: 'settings', base: 'manage', description: 'Server settings and channel-name template' },
      { name: 'delay', base: 'manage', description: 'Empty-channel deletion delay' },
      { name: 'language', base: 'manage', description: 'Change Voicey’s language (viewing is open)' },
      { name: 'prefix', base: 'manage', description: 'Change the server prefix (viewing is open)' },
    ],
  },
  {
    id: 'control',
    label: 'Voice channel controls',
    icon: 'sliders-horizontal',
    commands: [
      { name: 'name', base: 'everyone', description: 'Rename your temporary channel' },
      { name: 'limit', base: 'everyone', description: 'Set the user limit' },
      { name: 'privacy', base: 'everyone', description: 'Lock or unlock the channel' },
      { name: 'members', base: 'everyone', description: 'List everyone in the channel' },
      { name: 'add', base: 'everyone', description: 'Allow a user to always join' },
      { name: 'block', base: 'everyone', description: 'Block a user from the channel' },
      { name: 'unblock', base: 'everyone', description: 'Remove a user’s block' },
      { name: 'invite', base: 'everyone', description: 'Invite a user to the channel' },
      { name: 'kick', base: 'everyone', description: 'Remove a user from the channel' },
      { name: 'ban', base: 'everyone', description: 'Block and disconnect a user' },
      { name: 'unban', base: 'everyone', description: 'Remove a user’s ban' },
      { name: 'claim', base: 'everyone', description: 'Claim an available channel' },
      { name: 'transfer', base: 'everyone', description: 'Transfer channel ownership' },
      { name: 'delete', base: 'everyone', description: 'Delete your temporary channel' },
    ],
  },
  {
    id: 'info',
    label: 'Info',
    icon: 'info',
    commands: [
      { name: 'help', base: 'everyone', description: 'Show the command list' },
      { name: 'check', base: 'manage', description: 'Health, setup and permission check' },
      { name: 'uptime', base: 'everyone', description: 'How long Voicey has been running' },
      { name: 'botinfo', base: 'everyone', description: 'Stats about Voicey' },
      { name: 'ping', base: 'everyone', description: 'Connection latency' },
    ],
  },
];

const BY_NAME = new Map(COMMAND_CATEGORIES.flatMap((c) => c.commands.map((cmd) => [cmd.name, cmd])));

export const getCommandMeta = (name) => BY_NAME.get(name) ?? null;
export const isKnownCommand = (name) => BY_NAME.has(name);
