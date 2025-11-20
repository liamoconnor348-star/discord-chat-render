// index.js — Fully safe Discord Chat Viewer
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageReactions
  ]
});

// Escape any HTML or special characters in messages
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function formatTime(date) {
  try {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return 'Invalid Date';
  }
}

// Deterministic bubble color per user
function getUserBubbleColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash &= hash;
  }
  const r = Math.max(60, Math.min(220, (hash >> 16) & 0xff));
  const g = Math.max(60, Math.min(220, (hash >> 8) & 0xff));
  const b = Math.max(60, Math.min(220, hash & 0xff));
  return `rgb(${r},${g},${b})`;
}

// Delete message
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  if (!messageId) return res.status(400).send('messageId required');
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.messages.delete(messageId);
    res.redirect('back');
  } catch (err) {
    res.send(`<p>Error deleting: ${escapeHtml(err.message)}</p>`);
  }
});

// React to message
app.post('/react', async (req, res) => {
  const { messageId, emoji } = req.body;
  if (!messageId || !emoji) return res.status(400).send('Missing messageId or emoji');

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const message = await channel.messages.fetch(messageId);
    const existing = message.reactions.cache.get(emoji);
    if (existing && existing.me) {
      await existing.users.remove(client.user.id);
    } else {
      await message.react(emoji);
    }
    res.redirect('back');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

// Render a single message
async function renderMessageBlock(msg) {
  try {
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 }) || '';
    const bubbleColor = getUserBubbleColor(msg.author.id);
    const grad = `linear-gradient(135deg, ${bubbleColor}CC, rgba(0,0,0,0.55))`;
    const authorName = escapeHtml(msg.author.username || 'Unknown');

    // Role emoji
    let roleEmoji = '⬤';
    let roleColor = '#ffffff';
    try {
      const member = msg.member || await msg.guild.members.fetch(msg.author.id);
      if (member && member.roles && member.roles.highest) {
        roleColor = member.roles.highest.hexColor || '#ffffff';
        if (roleColor === '#000000') roleColor = '#ffffff';
        const emojiMap = { "Owner":"👑", "Admin":"⭐", "Moderator":"🔹" };
        roleEmoji = emojiMap[member.roles.highest.name] || '⬤';
      }
    } catch {}

    // Reply preview
    let replyPreview = '';
    if (msg.reference && msg.reference.messageId) {
      try {
        const parentMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (parentMsg) {
          const parentAvatar = parentMsg.author.displayAvatarURL({ extension:'png', size:32 });
          const preview = escapeHtml(parentMsg.content || '[Embed/Attachment]');
          replyPreview = `<div class="reply-preview"><img src="${parentAvatar}" />↪ ${preview}</div>`;
        }
      } catch {}
    }

    // Attachments
    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(att => {
        const contentType = att.contentType || '';
        if (contentType.startsWith && contentType.startsWith('image')) {
          attachmentsHtml += `<img class="inline-img" src="${att.url}" title="${escapeHtml(att.name || '')}" />`;
        } else {
          attachmentsHtml += `<div><a href="${att.url}" target="_blank">${escapeHtml(att.name || 'Attachment')}</a></div>`;
        }
      });
    }

    // Reactions
    let reactionsHtml = '';
    if (msg.reactions.cache.size > 0) {
      reactionsHtml = '<div class="reactions">';
      msg.reactions.cache.forEach(r => {
        reactionsHtml += `<span class="reaction" data-message-id="${msg.id}" data-emoji="${escapeHtml(r.emoji.name)}">${escapeHtml(r.emoji.name)} ${r.count}</span>`;
      });
      reactionsHtml += '</div>';
    }

    const contentEscaped = escapeHtml(msg.content || '');

    const indentPx = msg.reference && msg.reference.messageId ? 50 : 0;

    return `<div class="message" data-id="${msg.id}" style="margin-left:${indentPx}px">
      <img class="avatar" src="${avatar}" />
      <div>
        <div class="bubble" style="background:${grad}">
          ${replyPreview}
          <div class="meta">
            <b style="color:${roleColor}">${authorName}</b> ${roleEmoji} • ${formatTime(msg.createdAt)}
          </div>
          <div class="text">${contentEscaped}</div>
          ${attachmentsHtml}
          ${reactionsHtml}
        </div>
      </div>
      <form method="POST" action="/delete">
        <input type="hidden" name="messageId" value="${msg.id}" />
        <button class="delete-btn" type="submit">Delete</button>
      </form>
    </div>`;
  } catch {
    return '';
  }
}

// Main page
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    let messages = await channel.messages.fetch({ limit: 50 });
    messages = Array.from(messages.values()).reverse();

    const searchRaw = req.query.search || '';
    const search = String(searchRaw).toLowerCase();
    if (search) messages = messages.filter(m => (m.content || '').toLowerCase().includes(search));

    const blocks = await Promise.all(messages.map(m => renderMessageBlock(m)));

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discord Chat Viewer</title>
<meta http-equiv="refresh" content="10">
<style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#1e1e1e;color:white;margin:0;padding:20px;}
h1{margin-bottom:10px;}
#chat{display:flex;flex-direction:column;gap:12px;}
.message{display:flex;align-items:flex-start;transition:transform 0.15s;}
.message:hover{transform:scale(1.02);}
.avatar{width:42px;height:42px;border-radius:50%;margin-right:10px;flex-shrink:0;}
.bubble{padding:10px 14px;border-radius:16px;max-width:70%;font-size:14px;line-height:1.4;position:relative;word-wrap:break-word;color:white;}
.meta{font-size:12px;margin-bottom:4px;opacity:0.85;}
.delete-btn{margin-left:10px;background:#ff4c4c;color:white;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;}
.inline-img{max-width:300px;margin-top:6px;border-radius:10px;}
.reactions{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;}
.reaction{background:#333;padding:2px 6px;border-radius:12px;cursor:pointer;font-size:12px;}
.reply-preview{font-size:12px;opacity:0.7;margin-bottom:4px;display:flex;align-items:center;gap:4px;}
.reply-preview img{width:20px;height:20px;border-radius:50%;}
</style>
</head>
<body>
<h1>Discord Chat Viewer</h1>
<button onclick="downloadChat()">Download TXT</button>
<button onclick="toggleTheme()">Toggle Theme</button>
<form method="GET" class="search-bar">
<input name="search" placeholder="Search messages..." value="${escapeHtml(searchRaw)}"/>
<button type="submit">Search</button>
</form>
<div id="chat">
${blocks.join('')}
</div>
<script>
function toggleTheme(){if(document.body.style.background==='white'){document.body.style.background='#1e1e1e';document.body.style.color='white';}else{document.body.style.background='white';document.body.style.color='black';}}
function downloadChat(){const text=Array.from(document.querySelectorAll('.message .bubble .text')).map(el=>el.innerText).join('\\n');const blob=new Blob([text],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chat.txt';a.click();URL.revokeObjectURL(a.href);}
document.addEventListener('click',async e=>{if(e.target.classList.contains('reaction')){const messageId=e.target.dataset.messageId;const emoji=e.target.dataset.emoji;fetch('/react',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'messageId='+encodeURIComponent(messageId)+'&emoji='+encodeURIComponent(emoji)}).then(()=>location.reload());}});
window.onload=()=>{window.scrollTo(0,document.body.scrollHeight);}
</script>
</body>
</html>
    `);
  } catch (err) {
    res.send(`<p>Error: ${escapeHtml(err.message)}</p>`);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('Server running on port',PORT));
client.login(TOKEN).catch(err=>{console.error('Discord login failed:',err); process.exit(1);});
