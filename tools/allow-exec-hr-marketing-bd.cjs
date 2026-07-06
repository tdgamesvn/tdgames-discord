const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
  .map((line) => {
    const idx = line.indexOf('=');
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  }));

const token = env.DISCORD_TOKEN;
const guildId = process.argv[2] || '1482946149538201652';
if (!token) throw new Error('Missing DISCORD_TOKEN in .env');

const allow = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.AddReactions,
  PermissionsBitField.Flags.UseExternalEmojis,
];
const denyView = [PermissionsBitField.Flags.ViewChannel];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function findRoleByCandidates(roles, candidates) {
  const lower = candidates.map((x) => x.toLowerCase());
  return roles.find((r) => lower.includes(r.name.toLowerCase())) ||
    roles.find((r) => lower.some((c) => r.name.toLowerCase().includes(c)));
}

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    const roles = guild.roles.cache;
    const roleNames = [...roles.values()].map((r) => ({ id: r.id, name: r.name })).sort((a,b)=>a.name.localeCompare(b.name));

    const marketingRole = findRoleByCandidates(roles, ['Marketing']);
    const bdRole = findRoleByCandidates(roles, ['BD']);
    const execRole = findRoleByCandidates(roles, ['Giám đốc', 'Giam doc', 'Director', 'CEO', 'Ban Giám Đốc', 'Ban Giam Doc']);
    const hrRole = findRoleByCandidates(roles, ['HR', 'Nhân sự', 'Nhan su', 'Human Resources']);

    const missing = [];
    if (!marketingRole) missing.push('Marketing');
    if (!bdRole) missing.push('BD');
    if (!execRole) missing.push('Giám đốc/CEO/Director');
    if (!hrRole) missing.push('HR/Nhân sự');
    if (missing.length) {
      console.log(JSON.stringify({ error: 'missing roles', missing, availableRoles: roleNames }, null, 2));
      process.exitCode = 2;
      return;
    }

    const channels = await guild.channels.fetch();
    const categories = [
      { name: 'MARKETING', primary: marketingRole, other: bdRole },
      { name: 'BD', primary: bdRole, other: marketingRole },
    ];

    const results = [];
    for (const cfg of categories) {
      const category = channels.find((ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === cfg.name.toLowerCase());
      if (!category) { results.push({ action: 'category-not-found', name: cfg.name }); continue; }
      const overwrites = [
        { id: guild.roles.everyone.id, deny: denyView },
        { id: cfg.primary.id, allow },
        { id: execRole.id, allow },
        { id: hrRole.id, allow },
        { id: cfg.other.id, deny: denyView },
      ];
      await category.permissionOverwrites.set(overwrites, `TDGAMES allow Giám đốc/HR to view ${cfg.name}`);
      const fresh = await guild.channels.fetch();
      const children = fresh.filter((ch) => ch && ch.parentId === category.id);
      const childResults = [];
      for (const child of children.values()) {
        await child.lockPermissions(`Sync permissions from ${category.name}`);
        childResults.push({ id: child.id, name: child.name, synced: true });
      }
      results.push({ action: 'category-permissions-updated', category: cfg.name, categoryId: category.id, allowedRoles: [cfg.primary.name, execRole.name, hrRole.name], deniedRole: cfg.other.name, children: childResults });
    }

    console.log(JSON.stringify({ guild: { id: guild.id, name: guild.name }, roles: { marketing: marketingRole.name, bd: bdRole.name, executive: execRole.name, hr: hrRole.name }, results }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
