const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const token = env.DISCORD_TOKEN;
const guildId = process.argv[2] || '1482946149538201652';
if (!token) throw new Error('Missing DISCORD_TOKEN in .env');

const ROLE_CONFIG = [
  { name: 'Marketing', color: 0x2A9DF4, reason: 'TDGAMES Marketing workspace permissions' },
  { name: 'BD', color: 0xF8AE00, reason: 'TDGAMES BD workspace permissions' },
];

const CATEGORY_CONFIG = [
  { categoryName: 'MARKETING', roleName: 'Marketing' },
  { categoryName: 'BD', roleName: 'BD' },
];

const allow = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.AddReactions,
  PermissionsBitField.Flags.UseExternalEmojis,
];

const deny = [PermissionsBitField.Flags.ViewChannel];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function ensureRole(guild, cfg) {
  await guild.roles.fetch();
  let role = guild.roles.cache.find((r) => r.name === cfg.name);
  if (!role) {
    role = await guild.roles.create({ name: cfg.name, color: cfg.color, mentionable: true, reason: cfg.reason });
    return { role, action: 'created-role' };
  }
  const changed = [];
  if (role.color !== cfg.color) {
    await role.setColor(cfg.color, cfg.reason);
    changed.push('color');
  }
  if (!role.mentionable) {
    await role.setMentionable(true, cfg.reason);
    changed.push('mentionable');
  }
  return { role, action: changed.length ? `updated-role:${changed.join(',')}` : 'exists-role' };
}

async function applyCategoryPermissions(guild, category, targetRole, rolesByName) {
  const everyone = guild.roles.everyone;
  const overwrites = [
    { id: everyone.id, deny },
    { id: targetRole.id, allow },
  ];

  // Explicitly deny the other department role from this private category.
  for (const [name, role] of rolesByName.entries()) {
    if (name !== targetRole.name) overwrites.push({ id: role.id, deny });
  }

  await category.permissionOverwrites.set(overwrites, `TDGAMES ${targetRole.name} category permissions`);

  const children = (await guild.channels.fetch()).filter((ch) => ch && ch.parentId === category.id);
  const childResults = [];
  for (const child of children.values()) {
    await child.lockPermissions(`Sync permissions from ${category.name}`);
    childResults.push({ id: child.id, name: child.name, action: 'synced-permissions' });
  }
  return childResults;
}

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    let channels = await guild.channels.fetch();

    const results = [];
    const rolesByName = new Map();
    for (const cfg of ROLE_CONFIG) {
      const { role, action } = await ensureRole(guild, cfg);
      rolesByName.set(cfg.name, role);
      results.push({ action, id: role.id, name: role.name });
    }

    channels = await guild.channels.fetch();
    for (const cfg of CATEGORY_CONFIG) {
      const category = channels.find(
        (ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === cfg.categoryName.toLowerCase()
      );
      if (!category) {
        results.push({ action: 'category-not-found', name: cfg.categoryName });
        continue;
      }
      const role = rolesByName.get(cfg.roleName);
      const children = await applyCategoryPermissions(guild, category, role, rolesByName);
      results.push({ action: 'category-permissions-set', id: category.id, name: category.name, role: role.name, children });
    }

    const finalChannels = await guild.channels.fetch();
    const summary = {};
    for (const cfg of CATEGORY_CONFIG) {
      const category = finalChannels.find(
        (ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === cfg.categoryName.toLowerCase()
      );
      if (!category) continue;
      summary[cfg.categoryName] = [...finalChannels.values()]
        .filter((ch) => ch && ch.parentId === category.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((ch) => ({ id: ch.id, name: ch.name, synced: ch.permissionsLocked }));
    }

    console.log(JSON.stringify({ guild: { id: guild.id, name: guild.name }, results, summary }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
