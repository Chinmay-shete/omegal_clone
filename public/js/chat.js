// ─────────────────────────────────────────────────────────────
//  CHAT STATE MACHINE
//  States: 'waiting' | 'connected' | 'disconnected'
// ─────────────────────────────────────────────────────────────
const socketUrl = window.SOCKET_SERVER_URL || window.location.origin;
const socket = io(socketUrl, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
const messagebox    = document.querySelector('#messagebox');
const messageContainer = document.querySelector('#message-container');
const sendBtn       = document.querySelector('#send-btn');
const inputWrapper  = document.querySelector('#input-wrapper');
const charCounter   = document.querySelector('#char-counter');

let room = null;
let currentState = 'waiting';

// ── Helpers to enable/disable input ──────────────────────────
function enableInput() {
    messagebox.disabled = false;
    inputWrapper.classList.remove('opacity-50', 'pointer-events-none');
    sendBtn.classList.remove('opacity-50', 'pointer-events-none');
    if (charCounter) charCounter.classList.remove('hidden');
}

function disableInput() {
    messagebox.disabled = true;
    inputWrapper.classList.add('opacity-50', 'pointer-events-none');
    sendBtn.classList.add('opacity-50', 'pointer-events-none');
    if (charCounter) {
        charCounter.classList.add('hidden');
        charCounter.textContent = '0/1000';
    }
}

// ── UI State transitions ──────────────────────────────────────
function setWaiting() {
    currentState = 'waiting';
    // Video panel: show spinner
    document.querySelector('#waiting-overlay').classList.remove('hidden');
    document.querySelector('#connected-badge').classList.add('hidden');
    document.querySelector('#local-pip').classList.add('hidden');
    document.querySelector('#call-controls').classList.add('hidden');

    // Chat panel
    document.querySelector('#chat-status-dot').className = 'w-2 h-2 rounded-full bg-neutral-400';
    document.querySelector('#chat-status-label').textContent = 'Conversation';
    document.querySelector('#chat-status-sub').textContent = 'Waiting for connection...';
    clearMessages();
    document.querySelector('#chat-waiting-placeholder').classList.remove('hidden');
    disableInput();
}

function setConnected(roomname) {
    currentState = 'connected';
    room = roomname;

    // Video panel: hide spinner, show badge
    document.querySelector('#waiting-overlay').classList.add('hidden');
    document.querySelector('#connected-badge').classList.remove('hidden');

    // Chat panel: update header
    document.querySelector('#chat-status-dot').className = 'w-2 h-2 rounded-full bg-green-500';
    document.querySelector('#chat-status-label').textContent = 'Stranger';
    document.querySelector('#chat-status-sub').textContent = 'Live chat';
    document.querySelector('#chat-waiting-placeholder').classList.add('hidden');
    enableInput();

    // Show "You are now chatting..." system message
    addSystemMessage('You are now chatting with a random stranger');
}

function setDisconnected() {
    currentState = 'disconnected';
    room = null;
    disableInput();
    document.querySelector('#disconnected-overlay').classList.remove('hidden');

    // Update chat status
    document.querySelector('#chat-status-dot').className = 'w-2 h-2 rounded-full bg-red-500';
    document.querySelector('#chat-status-label').textContent = 'Conversation';
    document.querySelector('#chat-status-sub').textContent = 'Ended';

    // Hang up video if in call
    if (typeof hangup === 'function') hangup();
}

// ── Clear all chat messages ───────────────────────────────────
function clearMessages() {
    const msgs = messageContainer.querySelectorAll('.chat-msg, .chat-system');
    msgs.forEach(m => m.remove());
}

// ── System message (centered pill) ───────────────────────────
function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'chat-system flex flex-col items-center';
    el.innerHTML = `<span class="font-medium rounded-full bg-neutral-100 text-neutral-500 text-xs px-3 py-1">${text}</span>`;
    messageContainer.appendChild(el);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// ── Sent message (right-aligned, blue) ───────────────────────
function attachMessage(message) {
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg flex flex-col items-end gap-1';
    wrap.innerHTML = `
        <div class="max-w-xs sm:max-w-sm rounded-tl-2xl rounded-tr-sm rounded-bl-2xl rounded-br-2xl bg-blue-600 text-white text-sm leading-5 px-4 py-2.5 break-words">${escapeHtml(message)}</div>
        <span class="text-neutral-500 text-[10px] px-1">${time}</span>
    `;
    messageContainer.appendChild(wrap);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// ── Received message (left-aligned, gray) ────────────────────
function receiveMessage(message) {
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    const wrap = document.createElement('div');
    wrap.className = 'chat-msg flex flex-col items-start gap-1';
    wrap.innerHTML = `
        <div class="max-w-xs sm:max-w-sm rounded-tl-sm rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-neutral-100 text-neutral-950 text-sm leading-5 px-4 py-2.5 break-words">${escapeHtml(message)}</div>
        <span class="text-neutral-500 text-[10px] px-1">${time}</span>
    `;
    messageContainer.appendChild(wrap);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Character counter validation ──────────────────────────────
if (messagebox) {
    messagebox.addEventListener('input', () => {
        const len = messagebox.value.length;
        if (charCounter) {
            charCounter.textContent = `${len}/1000`;
            if (len > 1000) {
                charCounter.className = 'text-xs text-red-500 font-bold select-none';
                sendBtn.classList.add('opacity-50', 'pointer-events-none');
            } else {
                charCounter.className = 'text-xs text-neutral-400 font-medium select-none';
                sendBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────
//  SOCKET EVENTS
// ─────────────────────────────────────────────────────────────
socket.on('connect', () => {
    if (currentState === 'waiting') {
        socket.emit('joinroom');
    }
});

socket.on('disconnect', () => {
    if (currentState === 'connected') {
        setDisconnected();
    }
});

socket.on('joined', function(roomname) {
    setConnected(roomname);
});

socket.on('partnerDisconnected', function() {
    setDisconnected();
});

socket.on('message', function(message) {
    receiveMessage(message);
});

socket.on('error_msg', function(err) {
    addSystemMessage(`Error: ${err}`);
});

socket.on('connect_error', function(err) {
    console.error('Socket connection error:', err);
    addSystemMessage(`Connection Error: ${err.message}`);
});

// ─────────────────────────────────────────────────────────────
//  SEND MESSAGE (both via chat-panel form and footer)
// ─────────────────────────────────────────────────────────────
function sendMessage() {
    if (!room) return;
    const msg = messagebox.value.trim();
    if (!msg || msg.length > 1000) return;
    socket.emit('message', { room, message: msg });
    attachMessage(msg);
    messagebox.value = '';
    if (charCounter) {
        charCounter.textContent = '0/1000';
    }
}

messagebox.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
sendBtn.addEventListener('click', sendMessage);

// ─────────────────────────────────────────────────────────────
//  NEXT BUTTON (skip to new stranger)
// ─────────────────────────────────────────────────────────────
function doNext() {
    if (typeof hangup === 'function') hangup();
    // Hide any open overlay
    document.querySelector('#disconnected-overlay').classList.add('hidden');
    clearMessages();
    setWaiting();
    socket.emit('nextStranger');
}

document.querySelector('#next-btn')?.addEventListener('click', doNext);
document.querySelector('#footer-next-btn')?.addEventListener('click', doNext);

// ─────────────────────────────────────────────────────────────
//  STOP BUTTON (leave chat, go to landing page)
// ─────────────────────────────────────────────────────────────
document.querySelector('#stop-btn').addEventListener('click', function() {
    if (typeof hangup === 'function') hangup();
    window.location.href = '/';
});

// ─────────────────────────────────────────────────────────────
//  DISCONNECTED OVERLAY — "Find a New Stranger" button
// ─────────────────────────────────────────────────────────────
document.querySelector('#find-new-btn').addEventListener('click', function() {
    document.querySelector('#disconnected-overlay').classList.add('hidden');
    clearMessages();
    setWaiting();
    socket.emit('joinroom');
});

// Initialize on load
setWaiting();
