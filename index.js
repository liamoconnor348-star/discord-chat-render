// index.js — Discord Chat Viewer (Pixel-Perfect + Reactions + Hover Preview)

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Format timestamp
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

// Deterministic bubble color per user
function getUserBubbleColor(userId, avatarUrl) {
  const str = userId + '|' + avatarUrl;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const r = (hash >> 16) & 0xFF;
  const g = (hash >> 8) & 0xFF;
  const b = hash & 0xFF;
  const clamp = v => Math.max(60, Math.min(220, v));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

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

// Render message block
async function renderMessageBlock(msg) {
  try {
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 }) || '';
    const bubbleColor = getUserBubbleColor(msg.author.id, avatar);
    const grad = `linear-gradient(135deg, ${bubbleColor}CC, rgba(0,0,0,0.55))`;
    const authorName = escapeHtml(msg.author.username || 'Unknown');

    // Highest role & emoji
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

    const isReply = msg.reference && msg.reference.messageId;
    const indentPx = isReply ? 50 : 0;
    const replyClass = isReply ? 'reply' : '';

    let replyPreview = '';
    if (isReply) {
      try {
        const parentMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (parentMsg) {
          const preview = escapeHtml(parentMsg.content || '[Embed/Attachment]');
          const parentAvatar = parentMsg.author.displayAvatarURL({ extension:'png', size:32 });
          replyPreview = `<div class="reply-preview"><img src="${parentAvatar}" />↪ ${preview}</div>`;
        }
      } catch {}
    }

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(att => {
        const contentType = att.contentType || '';
        if (contentType.startsWith && contentType.startsWith('image')) {
          attachmentsHtml += `<img class="inline-img" src="${att.url}" title="${escapeHtml(att.name || '')}" />`;
        } else {
          attachmentsHtml += `<div><a href="${att.url}" target="_blank" data-preview="File: ${escapeHtml(att.name || '')}">${escapeHtml(att.name || 'Attachment')}</a></div>`;
        }
      });
    }

    // Reactions
    let reactionsHtml = '';
    if (msg.reactions.cache.size > 0) {
      reactionsHtml = '<div class="reactions">';
      msg.reactions.cache.forEach(r => {
        reactionsHtml += `<span class="reaction">${escapeHtml(r.emoji.name)} ${r.count}</span>`;
      });
      reactionsHtml += '</div>';
    }

    const contentEscaped = escapeHtml(msg.content || '');

    return `
      <div class="message ${replyClass}" data-id="${msg.id}" style="margin-left:${indentPx}px">
        <img class="avatar" src="${avatar}" alt="avatar"/>
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
        <form method="POST" action="/delete" class="delete-form">
          <input type="hidden" name="messageId" value="${msg.id}" />
          <button class="delete-btn" type="submit">Delete</button>
        </form>
      </div>
    `;
  } catch { return ''; }
}

// Main page
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(()=>null);
    if (!channel) return res.send("❌ Invalid CHANNEL_ID");

    const searchRaw = req.query.search || '';
    const search = String(searchRaw).trim().toLowerCase();

    const fetched = await channel.messages.fetch({ limit: 50 }).catch(()=>[]);
    let messages = Array.from(fetched.values()).reverse();
    if (search) messages = messages.filter(m => (m.content || '').toLowerCase().includes(search));

    const blocks = await Promise.all(messages.map(m => renderMessageBlock(m)));
    const oldestId = messages.length > 0 ? messages[0].id : '';

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discord Chat Viewer</title>
<meta http-equiv="refresh" content="10">
<style>
/* Full pixel-perfect CSS including hover previews and reactions */
body {font-family:'Whitney','Segoe UI',sans-serif;background:#36393f;color:#dcddde;margin:0;padding:20px;}
.light{background:#f2f3f5;color:#050505;}
h1{margin-bottom:20px;font-weight:500;}
#chat{display:flex;flex-direction:column;gap:8px;max-height:80vh;overflow-y:auto;padding-bottom:10px;}
.message{display:flex;align-items:flex-start;position:relative;gap:8px;transition:transform 0.1s;}
.message:hover{transform:scale(1.01);}
.message.reply{margin-left:50px;position:relative;}
.message.reply::before{content:'';position:absolute;left:-30px;top:12px;bottom:0;width:2px;background:rgba(255,255,255,0.15);border-radius:2px;}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-top:2px;}
.bubble{padding:8px 12px;border-radius:16px;max-width:70%;background:#40444b;word-break:break-word;position:relative;box-shadow:0 1px 2px rgba(0,0,0,0.3);transition:background 0.2s;}
.bubble:hover{background:#4f545c;}
.meta{font-size:12px;opacity:0.7;margin-bottom:2px;display:flex;align-items:center;gap:4px;}
.meta b{font-weight:500;}
.inline-img{max-width:280px;border-radius:8px;margin-top:4px;display:block;cursor:zoom-in;transition:transform 0.2s;}
.inline-img:hover{transform:scale(1.05);}
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}
.reaction{background:rgba(255,255,255,0.1);color:#fff;padding:2px 6px;border-radius:12px;font-size:11px;cursor:default;transition:background 0.2s;}
.reaction:hover{background:rgba(255,255,255,0.2);}
.delete-form{display:flex;align-items:center;margin-left:4px;opacity:0;transition:opacity 0.2s;}
.message:hover .delete-form{opacity:1;}
.delete-btn{background:#f04747;border:none;color:white;padding:2px 6px;border-radius:4px;font-size:11px;cursor:pointer;transition:background 0.2s;}
.delete-btn:hover{background:#d93b3b;}
.search-bar{margin-bottom:20px;display:flex;gap:6px;}
input,button{font-family:'Whitney','Segoe UI',sans-serif;font-size:14px;border-radius:6px;border:none;padding:6px 8px;}
button{background:#7289da;color:white;cursor:pointer;transition:background 0.2s;}
button:hover{background:#5b6eae;}
.reply-preview{display:flex;align-items:center;font-size:11px;opacity:0.6;border-left:2px solid rgba(255,255,255,0.2);padding-left:4px;margin-bottom:4px;gap:4px;color:#b9bbbe;}
.reply-preview img{width:16px;height:16px;border-radius:50%;flex-shrink:0;}
a:hover::after{content:attr(data-preview);position:absolute;background:#2f3136;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;white-space:pre-wrap;max-width:300px;z-index:100;}
</style>
</head>
<body data-oldest="${oldestId}">
<h1>Discord Chat Viewer</h1>
<button onclick="downloadChat()">Download TXT</button>
<button onclick="toggleTheme()">Toggle Theme</button>
<form method="GET" class="search-bar">
<input name="search" placeholder="Search messages..." value="${escapeHtml(searchRaw)}"/>
<button type="submit">Search</button>
</form>
<div id="chat">${blocks.join('')}</div>
<script>
let loadingOlder=false;
let oldestId=document.body.dataset.oldest;
const chatContainer=document.getElementById('chat');
function smoothScrollToBottom(){chatContainer.scrollTo({top:chatContainer.scrollHeight,behavior:'smooth'});}
async function loadOlderMessages(){if(loadingOlder||!oldestId)return;loadingOlder=true;const res=await fetch('/messages?before='+oldestId);const data=await res.json();if(data.blocks.length>0){const div=document.createElement('div');div.innerHTML=data.blocks.join('');chatContainer.prepend(div);oldestId=data.oldestId;document.body.dataset.oldest=oldestId;}loadingOlder=false;}
chatContainer.addEventListener('scroll',()=>{if(chatContainer.scrollTop<100)loadOlderMessages();});
let lastMessageId=chatContainer.lastElementChild?.dataset.id||null;
async function fetchNewMessages(){if(!lastMessageId)return;const res=await fetch('/messages?after='+lastMessageId);const data=await res.json();if(data.blocks.length>0){const div=document.createElement('div');div.innerHTML=data.blocks.join('');chatContainer.appendChild(div);lastMessageId=data.latestId;smoothScrollToBottom();}}
setInterval(fetchNewMessages,5000);
function downloadChat(){window.location.href='/download';}
function toggleTheme(){document.body.classList.toggle('light');}
window.onload=()=>{smoothScrollToBottom();};
</script>
</body>
</html>
    `);
  } catch (err) { res.send(`<p>Error: ${escapeHtml(err.message)}</p>`); }
});

// Messages API
app.get('/messages', async (req, res) => {
  const beforeId = req.query.before;
  const afterId = req.query.after;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(400).send('Invalid channel');

    const options = { limit: 50 };
    if (beforeId) options.before = beforeId;
    if (afterId) options.after = afterId;

    const fetched = await channel.messages.fetch(options);
    const messages = Array.from(fetched.values()).reverse();
    const blocks = await Promise.all(messages.map(m => renderMessageBlock(m)));

    const newestId = messages.length > 0 ? messages[messages.length-1].id : null;
    const oldestId = messages.length > 0 ? messages[0].id : null;

    res.json({ blocks, newestId, oldestId, latestId: newestId });
  } catch (err) { res.status(500).send({ error: err.message }); }
});

// Download chat TXT
app.get('/download', async (req,res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(400).send('Invalid channel');

    let allMessages=[], lastId;
    while(true){
      const opts={limit:100};
      if(lastId)opts.before=lastId;
      const fetched=await channel.messages.fetch(opts);
      if(fetched.size===0)break;
      allMessages.push(...fetched.values());
      lastId=fetched.last().id;
    }
    allMessages.reverse();
    const txt = allMessages.map(m=>`[${formatTime(m.createdAt)}] ${m.author.username}: ${m.content.replace(/\n/g,' ')}`).join('\n');
    res.setHeader('Content-Disposition','attachment; filename="chat.txt"');
    res.setHeader('Content-Type','text/plain');
    res.send(txt);
  } catch(err){res.status(500).send('Error: '+err.message);}
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));

// Discord login
client.login(TOKEN).catch(err=>{console.error('Discord login failed:',err); process.exit(1);});
