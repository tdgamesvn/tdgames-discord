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
if (!token) throw new Error('Missing DISCORD_TOKEN in .env');

const desiredChannels = [
  {
    name: 'marketing-general',
    topic: 'Kênh trao đổi chung của Marketing Team TD GAMES: kế hoạch, việc cần xử lý, quyết định nhanh.'
  },
  {
    name: 'content-calendar',
    topic: 'Lịch content 8 kênh: Facebook, Behance, ArtStation, LinkedIn, X, YouTube, Upwork, Fiverr.'
  },
  {
    name: 'portfolio-showcase',
    topic: 'Tư liệu portfolio/showcase/breakdown Spine 2D, VFX, Game Art đã được duyệt public.'
  },
  {
    name: 'bd-leads-outreach',
    topic: 'Theo dõi lead quốc tế, cold outreach, phản hồi khách, studio/publisher/game developer tiềm năng.'
  },
  {
    name: 'upwork-fiverr',
    topic: 'Job hunting, proposal, bid tracking và tin nhắn khách trên Upwork/Fiverr.'
  },
  {
    name: 'reports-kpi',
    topic: 'Báo cáo tuần: content, reach/engagement, lead, outreach, proposal, blockers, next actions.'
  },
  {
    name: 'chau-hybrid-marketing-bd',
    topic: 'Kênh làm việc riêng cho Châu - Hybrid Marketing 60% và BD 40%. Link ClickUp: https://app.clickup.com/9018621527/v/l/li/901819129865'
  }
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    const category = channels.find(
      (ch) => ch && ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('marketing')
    );
    if (!category) throw new Error('Không tìm thấy category có tên chứa "Marketing"');

    const existingByName = new Map();
    channels.forEach((ch) => {
      if (ch && ch.parentId === category.id) existingByName.set(ch.name, ch);
    });

    const results = [];
    for (const item of desiredChannels) {
      const existing = existingByName.get(item.name);
      if (existing) {
        // Keep existing channel, but update topic if missing/different and supported.
        if ('setTopic' in existing && existing.topic !== item.topic) {
          try { await existing.setTopic(item.topic, 'TDGAMES Marketing setup'); } catch (_) {}
        }
        results.push({ action: 'exists', id: existing.id, name: existing.name });
        continue;
      }
      const created = await guild.channels.create({
        name: item.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: item.topic,
        reason: 'TDGAMES Marketing Team workspace setup'
      });
      results.push({ action: 'created', id: created.id, name: created.name });
    }

    const fresh = await guild.channels.fetch();
    const marketingChildren = [...fresh.values()]
      .filter((ch) => ch && ch.parentId === category.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type, position: ch.position }));

    console.log(JSON.stringify({
      guild: { id: guild.id, name: guild.name },
      category: { id: category.id, name: category.name },
      results,
      marketingChildren
    }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
