// index.js — Discord Chat Viewer with proper try/catch everywhere

const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!TOKEN || !CHANNEL_ID) {
  console.error('Please set TOKEN and CHANNEL_ID environment variables.');
  process.exit(1);
}

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Format timestamps
function formatTime(date) {
  try {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return 'Invalid Date';
  }
}

// Escape HTML
function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Deterministic color generator
function colorFromString(str) {
  try {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & 0xffffffff;
    }
    const r = (hash & 0xFF0000) >> 16;
    const g = (hash & 0x00FF00) >> 8;
    const b = (hash & 0x0000FF);
    const to255 = v => Math.max(60, Math.min(230, v));
    return { r: to255(r), g: to255(g), b: to255(b), rgb: `rgb(${to255(r)},${to255(g)},${to255(b)})` };
  } catch {
    return { r: 100, g: 100, b: 100, rgb: 'rgb(100,100,100)' };
  }
}
const colorCache = new Map();
function getCachedColor(key) {
  if (colorCache.has(key)) return colorCache.get(key);
  const c = colorFromString(key);
  colorCache.set(key, c);
  return c;
}

// Map roles to emojis
const roleEmojiMap = {
  "YourRoleName": "👑", // Replace with your role
  "Admin": "⭐",
  "Moderator": "🔹",
  "Member": "🔸"
};

// Delete message endpoint
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  if (!messageId) return res.status(400).send('messageId required');

  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return res.send('❌ Invalid CHANNEL_ID');

    try {
      await channel.messages.delete(messageId);
      res.redirect('back');
    } catch (err) {
      res.send(`<p>Cannot delete message: ${escapeHtml(err.message)}</p>`);
    }
  } catch (err) {
    console.error('Delete error', err);
    res.send(`<p>Error deleting message: ${escapeHtml(err.message)}</p>`);
  }
});

// Render single message
async function renderMessageBlock(msg) {
  try {
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 }) || '';
    const key = (msg.author.id || '') + '|' + avatar;
    const c = getCachedColor(key);
    const grad = `linear-gradient(135deg, rgba(${c.r},${c.g},${c.b},0.92), rgba(0,0,0,0.55))`;
    const authorName = escapeHtml(msg.author.username || 'Unknown');

    // Highest role & emoji
    let roleColor = '#ffffff';
    let roleEmoji = '';
    try {
      if (msg.member && msg.member.roles && msg.member.roles.highest) {
        const roleName = msg.member.roles.highest.name || '';
        roleColor = msg.member.roles.highest.hexColor || '#ffffff';
        if (roleColor === '#000000') roleColor = '#ffffff';
        roleEmoji = roleEmojiMap[roleName] || '';
      }
    } catch {
      roleColor = '#ffffff';
      roleEmoji = '';
    }

    const isMe = msg.author.id === client.user.id;
    const indentPx = (msg.reference && msg.reference.messageId) ? 40 : 0;

    let attachmentsHtml = '';
    try {
      if (msg.attachments && msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          const contentType = att.contentType || '';
          if (contentType.startsWith && contentType.startsWith('image')) {
            attachmentsHtml += `<img class="inline-img" src="${att.url}" />`;
          } else {
            attachmentsHtml += `<div><a href="${escapeHtml(att.url)}" target="_blank">Attachment</a></div>`;
          }
        });
      }
    } catch {}

    const contentEscaped = escapeHtml(msg.content || '');

    return `
      <div class="message ${isMe ? 'me' : ''}" data-id="${msg.id}" style="margin-left:${indentPx}px">
        <img class="avatar" src="${avatar}" alt="avatar"/>
        <div>
          <div class="bubble" style="background:${grad}">
            <div class="meta">
              <b style="color:${roleColor}">${authorName}</b> ${roleEmoji} • ${formatTime(msg.createdAt)}
            </div>
            <div class="text">${contentEscaped}</div>
            ${attachmentsHtml}
          </div>
        </div>
        <form method="POST" action="/delete" class="delete-form">
          <input type="hidden" name="messageId" value="${msg.id}" />
          <button class="delete-btn" type="submit">Delete</button>
        </form>
      </div>
    `;
  } catch {
    return '';
  }
}

// Main page
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return res.send("❌ Invalid CHANNEL_ID");

    const searchRaw = req.query.search || '';
    const search = String(searchRaw).trim().toLowerCase();

    const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => []);
    let messages = Array.from(fetched.values()).reverse();

    if (search) messages = messages.filter(m => (m.content || '').toLowerCase().includes(search));

    let blocks = '';
    for (const m of messages) blocks += await renderMessageBlock(m);

    const oldestId = messages.length > 0 ? messages[0].id : '';

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discord Chat Viewer</title>
<meta http-equiv="refresh" content="10">
<style>
/* Minimal CSS for bubbles, avatars, dark/light theme */
:root{--bg:#111;--text:#fff;--bubble-text:#fff;}
.light{--bg:#f2f2f2;--text:#000;--bubble-text:#000;}
body{margin:0;padding:20px;font-family:Arial;background:var(--bg);color:var(--text);}
.avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;}
.bubble{padding:10px 14px;border-radius:14px;max-width:70%;color:var(--bubble-text);box-shadow:0 2px 6px rgba(0,0,0,0.4);}
.meta{font-size:12px;margin-bottom:6px;opacity:0.95;}
.inline-img{max-width:360px;border-radius:10px;margin-top:8px;display:block;}
.delete-btn{background:#c44;color:white;border:none;padding:6px 10px;border-radius:6px;cursor:pointer;}
</style>
</head>
<body data-oldest="${oldestId}">
<h1>Discord Chat Viewer</h1>
<form method="GET">
<input name="search" placeholder="Search messages..." value="${escapeHtml(searchRaw)}"/>
<button type="submit">Search</button>
</form>
<div id="chat">${blocks}</div>
<script>
function toggleTheme(){document.body.classList.toggle('light');}
</script>
</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.send(`<p>Error: ${escapeHtml(err.message)}</p>`);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Discord login
client.login(TOKEN).catch(err => {
  console.error('Discord login failed:', err);
  process.exit(1);
});
