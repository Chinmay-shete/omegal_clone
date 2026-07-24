// WEBRTC
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let inCall = false;
let permissionGranted = false;
let candidateQueue = [];

// Helper to get ICE Servers (with working TURN fallback for cross-network/mobile connections)
function getIceServers() {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ];

    if (window.TURN_URL && window.TURN_USERNAME) {
        iceServers.push({
            urls: window.TURN_URL,
            username: window.TURN_USERNAME,
            credential: window.TURN_CREDENTIAL || ''
        });
    } else {
        // Free openrelay fallback credentials for cross-network relay (Wi-Fi <-> Cellular)
        iceServers.push(
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        );
    }
    return iceServers;
}

// ── Show/hide video call UI elements ──────────────────────────
function showVideoCallUI() {
    document.querySelector('#local-pip')?.classList.remove('hidden');
    document.querySelector('#call-controls')?.classList.remove('hidden');
}

function hideVideoCallUI() {
    document.querySelector('#local-pip')?.classList.add('hidden');
    document.querySelector('#call-controls')?.classList.add('hidden');
}

// ── Queue ICE Candidates until remote description is set ──────
async function processCandidateQueue() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (candidateQueue.length > 0) {
        const candidate = candidateQueue.shift();
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('Error adding queued ICE candidate:', err);
        }
    }
}

// ── Initialize media & WebRTC ──────────────────────────────────
const initialize = async (isCaller = false) => {
    socket.off('signalingMessage');
    socket.on('signalingMessage', handleSignalingMessage);

    permissionGranted = false;
    candidateQueue = [];

    try {
        // Request camera and microphone access with mobile-friendly constraints
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });
        } catch (e) {
            // Fallback for devices without strict constraint support
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        }

        permissionGranted = true;

        const localVideo = document.querySelector('#localVideo');
        if (localVideo) {
            localVideo.muted = true;
            localVideo.playsInline = true;
            localVideo.srcObject = localStream;
            localVideo.style.display = 'block';
            localVideo.play().catch(err => console.warn('localVideo play error:', err));
        }

        showVideoCallUI();

        if (isCaller) {
            await initiateOffer();
        }
        inCall = true;
        return true;
    } catch (err) {
        console.error('Camera/mic access denied or failed:', err);
        alert('Camera and microphone permissions are required for video calls. Please allow access in browser settings.');
        if (room) {
            socket.emit('signalingMessage', { room, message: JSON.stringify({ type: 'hangup' }) });
        }
        hangup();
        return false;
    }
};

const initiateOffer = async () => {
    if (!permissionGranted || !localStream) {
        console.warn('Cannot initiate offer: permission not granted or stream missing.');
        return;
    }
    await createPeerConnection();
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signalingMessage', {
            room,
            message: JSON.stringify({ type: 'offer', offer })
        });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
};

const createPeerConnection = () => {
    if (!localStream) {
        console.warn('Aborting peer connection creation: localStream is empty.');
        return;
    }
    const rtcSettings = { iceServers: getIceServers() };
    peerConnection = new RTCPeerConnection(rtcSettings);
    remoteStream = new MediaStream();

    const remoteVideo = document.querySelector('#remoteVideo');
    if (remoteVideo) {
        remoteVideo.playsInline = true;
        remoteVideo.srcObject = remoteStream;
        remoteVideo.style.display = 'block';
    }

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        const rVideo = document.querySelector('#remoteVideo');
        if (event.streams && event.streams[0]) {
            if (rVideo) rVideo.srcObject = event.streams[0];
        } else {
            event.track && remoteStream.addTrack(event.track);
            if (rVideo) rVideo.srcObject = remoteStream;
        }
        if (rVideo) {
            rVideo.style.display = 'block';
            rVideo.play().catch(err => console.warn('remoteVideo play error:', err));
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && room) {
            socket.emit('signalingMessage', {
                room,
                message: JSON.stringify({ type: 'candidate', candidate: event.candidate })
            });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection && ['failed', 'closed'].includes(peerConnection.connectionState)) {
            console.warn('WebRTC connection state:', peerConnection.connectionState);
            hangup();
        }
    };
};

const handleSignalingMessage = async (message) => {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        const { type, offer, answer, candidate } = data;

        if (type === 'offer') await handleOffer(offer);
        if (type === 'answer') await handleAnswer(answer);
        if (type === 'candidate') {
            if (peerConnection && peerConnection.remoteDescription) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate directly:', e);
                }
            } else {
                candidateQueue.push(candidate);
            }
        }
        if (type === 'hangup') hangup();
    } catch (err) {
        console.error('Error handling signaling message:', err);
    }
};

const handleOffer = async (offer) => {
    if (!permissionGranted || !localStream) {
        console.warn('Aborting offer handling: localStream missing.');
        return;
    }
    await createPeerConnection();
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        await processCandidateQueue();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signalingMessage', { room, message: JSON.stringify({ type: 'answer', answer }) });
        inCall = true;
    } catch (e) {
        console.error('Failed to handle offer:', e);
    }
};

const handleAnswer = async (answer) => {
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            await processCandidateQueue();
        } catch (e) {
            console.error('Failed to handle answer:', e);
        }
    }
};

// ── Hang up ────────────────────────────────────────────────────
function hangup() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    permissionGranted = false;
    candidateQueue = [];

    const localVideo = document.querySelector('#localVideo');
    const remoteVideo = document.querySelector('#remoteVideo');
    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
    }
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
    }

    if (room && inCall) {
        socket.emit('signalingMessage', { room, message: JSON.stringify({ type: 'hangup' }) });
    }
    inCall = false;
    hideVideoCallUI();

    isAudioMuted = false;
    isVideoMuted = false;
    updateMicBtn();
    updateCamBtn();
}

// ── Video call button ──────────────────────────────────────────
document.querySelector('#video-call-btn')?.addEventListener('click', function() {
    if (!room) {
        alert('You need to be connected to a stranger first.');
        return;
    }
    socket.emit('startVideoCall', { room });
});

// ── Incoming call ──────────────────────────────────────────────
socket.on('incomingCall', function() {
    document.querySelector('#incoming-call')?.classList.remove('hidden');
});

socket.on('callAccepted', function() {
    initialize(true);
});

document.querySelector('#accept-call')?.addEventListener('click', async function() {
    document.querySelector('#incoming-call')?.classList.add('hidden');
    const success = await initialize(false);
    if (success) {
        socket.emit('acceptCall', { room });
    } else {
        socket.emit('rejectCall', { room });
    }
});

document.querySelector('#reject-call')?.addEventListener('click', function() {
    document.querySelector('#incoming-call')?.classList.add('hidden');
    socket.emit('rejectCall', { room });
});

socket.on('callRejected', function() {
    alert('Call was rejected by the other user.');
});

// ── Hang up button ─────────────────────────────────────────────
document.querySelector('#hangup')?.addEventListener('click', hangup);

// ── Media toggles ─────────────────────────────────────────────
let isAudioMuted = false;
let isVideoMuted = false;

function updateMicBtn() {
    const btn = document.querySelector('#mic-toggle');
    if (btn) btn.style.backgroundColor = isAudioMuted ? '#ef4444' : '';
    const pipMic = document.querySelector('#micButton');
    if (pipMic) pipMic.style.backgroundColor = isAudioMuted ? 'rgba(239,68,68,0.5)' : '';
}

function updateCamBtn() {
    const btn = document.querySelector('#cam-toggle');
    if (btn) btn.style.backgroundColor = isVideoMuted ? '#ef4444' : '';
    const pipCam = document.querySelector('#cameraButton');
    if (pipCam) pipCam.style.backgroundColor = isVideoMuted ? 'rgba(239,68,68,0.5)' : '';
}

document.querySelector('#mic-toggle')?.addEventListener('click', () => {
    if (localStream) {
        isAudioMuted = !isAudioMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
        updateMicBtn();
    }
});

document.querySelector('#cam-toggle')?.addEventListener('click', () => {
    if (localStream) {
        isVideoMuted = !isVideoMuted;
        localStream.getVideoTracks().forEach(t => t.enabled = !isVideoMuted);
        updateCamBtn();
    }
});

document.querySelector('#micButton')?.addEventListener('click', () => {
    if (localStream) {
        isAudioMuted = !isAudioMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
        updateMicBtn();
    }
});

document.querySelector('#cameraButton')?.addEventListener('click', () => {
    if (localStream) {
        isVideoMuted = !isVideoMuted;
        localStream.getVideoTracks().forEach(t => t.enabled = !isVideoMuted);
        updateCamBtn();
    }
});
