const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

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
const driveLink = 'https://drive.google.com/drive/u/0/folders/1XRpBr_LuGvjX10e7i6NC4hvveuHC1zf4';
if (!token) throw new Error('Missing DISCORD_TOKEN in .env');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function ensureText(guild, channels, parentId, name, topic) {
  let ch = channels.find((c) => c && c.name === name && c.type === ChannelType.GuildText);
  if (!ch) {
    ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, topic, reason: 'TDGAMES Marketing/BD workspace split' });
    return { action: 'created', id: ch.id, name: ch.name };
  }
  const changed = [];
  if (ch.parentId !== parentId) {
    await ch.setParent(parentId, { lockPermissions: false, reason: 'TDGAMES Marketing/BD workspace split' });
    changed.push('parent');
  }
  if ('setTopic' in ch && ch.topic !== topic) {
    await ch.setTopic(topic, 'TDGAMES Marketing/BD workspace split');
    changed.push('topic');
  }
  return { action: changed.length ? `updated:${changed.join(',')}` : 'exists', id: ch.id, name: ch.name };
}

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    let channels = await guild.channels.fetch();
    const marketing = channels.find((ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === 'marketing') ||
      channels.find((ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('marketing'));
    if (!marketing) throw new Error('Không tìm thấy category MARKETING');

    let bd = channels.find((ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === 'bd');
    const results = [];
    if (!bd) {
      bd = await guild.channels.create({ name: 'BD', type: ChannelType.GuildCategory, reason: 'TDGAMES split Marketing and BD workspace' });
      results.push({ action: 'created-category', id: bd.id, name: bd.name });
    } else {
      results.push({ action: 'exists-category', id: bd.id, name: bd.name });
    }

    channels = await guild.channels.fetch();

    // Remove Châu personal hybrid channel as requested.
    const chau = channels.find((ch) => ch && ch.name === 'chau-hybrid-marketing-bd');
    if (chau) {
      await chau.delete('TDGAMES requested to remove personal hybrid channel');
      results.push({ action: 'deleted', id: chau.id, name: chau.name });
    } else {
      results.push({ action: 'not-found', name: 'chau-hybrid-marketing-bd' });
    }

    channels = await guild.channels.fetch();

    // Marketing side: keep/report marketing in Marketing category.
    const report = channels.find((ch) => ch && ch.name === 'reports-kpi' && ch.type === ChannelType.GuildText);
    if (report) {
      await report.edit({ name: 'marketing-reports-kpi', parent: marketing.id, topic: 'Báo cáo Marketing: content, reach/engagement, portfolio, seeding, blockers, next actions.' }, 'TDGAMES Marketing/BD workspace split');
      results.push({ action: 'renamed', id: report.id, from: 'reports-kpi', to: 'marketing-reports-kpi' });
    }

    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, marketing.id, 'marketing-general', `Trao đổi chung Marketing Team TD GAMES. Drive Marketing Team: ${driveLink}`));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, marketing.id, 'content-calendar', `Lịch content 8 kênh. Drive Marketing Team: ${driveLink}`));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, marketing.id, 'portfolio-showcase', `Asset/showcase/breakdown đã duyệt public. Drive Marketing Team: ${driveLink}`));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, marketing.id, 'marketing-reports-kpi', 'Báo cáo Marketing: bài đăng, kênh, reach/engagement, content tốt nhất, blocker, next actions.'));

    // BD side: move existing BD channels out of Marketing category and add BD report/general channels.
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, bd.id, 'bd-general', 'Trao đổi chung Business Development: lead, outreach, brief, proposal, follow-up.'));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, bd.id, 'bd-leads-outreach', 'Lead quốc tế, cold outreach, phản hồi khách, studio/publisher/game developer tiềm năng.'));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, bd.id, 'upwork-fiverr', 'Job hunting, proposal, bid tracking và tin nhắn khách trên Upwork/Fiverr.'));
    channels = await guild.channels.fetch();
    results.push(await ensureText(guild, channels, bd.id, 'bd-reports-kpi', 'Báo cáo BD: lead mới, outreach, reply, proposal, brief, won/lost, blockers, next actions.'));

    const fresh = await guild.channels.fetch();
    const summarize = (cat) => [...fresh.values()]
      .filter((ch) => ch && ch.parentId === cat.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type, position: ch.position }));

    console.log(JSON.stringify({
      guild: { id: guild.id, name: guild.name },
      marketing: { id: marketing.id, name: marketing.name, children: summarize(marketing) },
      bd: { id: bd.id, name: bd.name, children: summarize(bd) },
      driveLink,
      results
    }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
