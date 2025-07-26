// Import the functions you need from the Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider, // Import GoogleAuthProvider
    signInWithPopup     // Import signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
    getDatabase,
    ref,
    set,
    push,
    onValue,
    onChildAdded,
    query,
    orderByChild,
    equalTo,
    off,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";


// Your web app's Firebase configuration (provided by the user)
const firebaseConfig = {
    apiKey: "AIzaSyBgjYwXN5auLvE0-hoMqlHHqRJwEqgn4sA",
    authDomain: "callvideo-51a89.firebaseapp.com",
    projectId: "callvideo-51a89",
    storageBucket: "callvideo-51a89.firebasestorage.app",
    messagingSenderId: "192849987114",
    appId: "1:192849987114:web:f9b32d637bfc5b61632553",
    measurementId: "G-W7DZRLYP3F"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app); // Initialize analytics (optional, but included as per config)

// Get Firebase service instances
const auth = getAuth(app);
const db = getDatabase(app);

// UI Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const registerBtn = document.getElementById('register-btn');
const loginBtn = document.getElementById('login-btn');
const googleLoginBtn = document.getElementById('google-login-btn'); // New Google button
const authErrorMessage = document.getElementById('auth-error-message');
const userDisplayName = document.getElementById('user-display-name');
const logoutBtn = document.getElementById('logout-btn');
const onlineUsersList = document.getElementById('online-users-list');
const callEmailInput = document.getElementById('call-email-input');
const startCallBtn = document.getElementById('start-call-btn');
const incomingCallSection = document.getElementById('incoming-call-section');
const incomingCallerInfo = document.getElementById('incoming-caller-info');
const acceptCallBtn = document.getElementById('accept-call-btn');
const rejectCallBtn = document.getElementById('reject-call-btn');
const callControls = document.getElementById('call-controls');
const muteAudioBtn = document.getElementById('mute-audio-btn');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const hangUpBtn = document.getElementById('hang-up-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

// WebRTC Variables
let localStream;
let peerConnection;
let currentCallId = null; // To keep track of the active call
let isAudioMuted = false;
let isVideoOff = false;

// STUN servers (Google's public STUN server is common)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // You might add more STUN/TURN servers here for better reliability
    ]
};

// --- Authentication Functions ---

registerBtn.addEventListener('click', async () => {
    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    try {
        await createUserWithEmailAndPassword(auth, email, password);
        authErrorMessage.textContent = '';
    } catch (error) {
        authErrorMessage.textContent = error.message;
        console.error("Register error:", error);
    }
});

loginBtn.addEventListener('click', async () => {
    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        authErrorMessage.textContent = '';
    } catch (error) {
        authErrorMessage.textContent = error.message;
        console.error("Login error:", error);
    }
});

// Google Sign-In
googleLoginBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        authErrorMessage.textContent = '';
    } catch (error) {
        authErrorMessage.textContent = error.message;
        console.error("Google Sign-In error:", error);
    }
});


logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        // UI will update via onAuthStateChanged listener
    } catch (error) {
        console.error("Logout error:", error);
    }
});

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is signed in.
        authSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        // Use user.displayName if available (from Google or if set manually), otherwise fallback to email
        userDisplayName.textContent = `Welcome, ${user.displayName || user.email}!`;

        // Set user's online status
        await set(ref(db, `users/${user.uid}/online`), true);
        // Set last online timestamp (optional, good for showing last active)
        await set(ref(db, `users/${user.uid}/lastOnline`), serverTimestamp());
        // Store user email for lookup (and display name/photoURL if available)
        await set(ref(db, `users/${user.uid}/email`), user.email);
        if (user.displayName) {
            await set(ref(db, `users/${user.uid}/displayName`), user.displayName);
        }
        if (user.photoURL) {
            await set(ref(db, `users/${user.uid}/photoURL`), user.photoURL);
        }


        // Listen for online users
        listenForOnlineUsers();
        // Listen for incoming calls
        listenForIncomingCalls(user.uid);
    } else {
        // User is signed out.
        authSection.classList.remove('hidden');
        appSection.classList.add('hidden');
        // Clear any active calls/streams if user logs out
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
            localVideo.srcObject = null;
            remoteVideo.srcObject = null;
        }
        incomingCallSection.classList.add('hidden');
        callControls.classList.add('hidden');
        currentCallId = null;

        // When user logs out, clear their online status from the database
        // For a more robust "online" status that handles browser closes/crashes,
        // use Firebase's `onDisconnect()` feature.
        // Example (typically set when a user logs in):
        // if (user) {
        //     onDisconnect(ref(db, `users/${user.uid}/online`)).set(false);
        // }
    }
});

// --- User Management (Online Status) ---

function listenForOnlineUsers() {
    // Detach any previous listener to avoid duplicates if auth state changes multiple times
    off(ref(db, 'users'));

    onValue(ref(db, 'users'), (snapshot) => {
        onlineUsersList.innerHTML = ''; // Clear existing list
        const users = snapshot.val();
        const currentUser = auth.currentUser;
        const currentUserEmail = currentUser ? currentUser.email : null;

        if (!users) {
            onlineUsersList.innerHTML = '<li>No one online yet.</li>';
            return;
        }

        let foundOnlineUser = false;
        for (const uid in users) {
            const user = users[uid];
            // Only show online users who are not the current user
            if (user.online && user.email && user.email !== currentUserEmail) {
                foundOnlineUser = true;
                const li = document.createElement('li');
                // Display user's display name or email, and photo if available
                const userName = user.displayName || user.email;
                const userPhoto = user.photoURL ? `<img src="${user.photoURL}" alt="User Photo" class="user-photo">` : '';

                li.innerHTML = `
                    <div class="user-info">
                        ${userPhoto}
                        <span>${userName}</span>
                    </div>
                    <button data-email="${user.email}" data-uid="${uid}" class="call-user-btn">Call</button>
                `;
                onlineUsersList.appendChild(li);
            }
        }

        if (!foundOnlineUser) {
            onlineUsersList.innerHTML = '<li>No other users online.</li>';
        }

        // Add event listeners to the dynamically created call buttons
        document.querySelectorAll('.call-user-btn').forEach(button => {
            button.onclick = (e) => {
                const recipientEmail = e.target.dataset.email;
                const recipientUid = e.target.dataset.uid;
                callEmailInput.value = recipientEmail; // Pre-fill for convenience
                startCall(recipientUid, recipientEmail); // Directly start call
            };
        });
    });
}

// --- WebRTC Functions ---

async function startCall(recipientUid, recipientEmail) {
    if (!auth.currentUser) {
        alert("Please log in to make a call.");
        return;
    }
    if (!recipientUid) {
        alert("Please select a user to call or enter their email.");
        return;
    }

    try {
        // Get local media stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        // Initialize PeerConnection
        peerConnection = new RTCPeerConnection(rtcConfig);

        // Add local tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Push candidate to Firebase
                push(ref(db, `calls/${currentCallId}/candidates/${auth.currentUser.uid}`), event.candidate.toJSON());
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        };

        // Create an offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Generate a unique call ID
        currentCallId = push(ref(db, 'calls')).key; // Use push to get a new key

        // Send offer to the recipient via Firebase
        await set(ref(db, `calls/${currentCallId}`), {
            callerUid: auth.currentUser.uid,
            callerEmail: auth.currentUser.email,
            callerDisplayName: auth.currentUser.displayName || auth.currentUser.email, // Include display name
            callerPhotoURL: auth.currentUser.photoURL || '', // Include photo URL
            recipientUid: recipientUid,
            recipientEmail: recipientEmail,
            offer: offer.toJSON(),
            status: 'ringing',
            timestamp: serverTimestamp()
        });

        alert(`Calling ${recipientEmail}...`);
        incomingCallSection.classList.add('hidden'); // Hide incoming call if active
        callControls.classList.remove('hidden'); // Show call controls
        startCallBtn.textContent = 'Calling...';
        startCallBtn.disabled = true; // Disable until call resolves

        // Listen for answer
        onValue(ref(db, `calls/${currentCallId}/answer`), async (snapshot) => {
            const answer = snapshot.val();
            if (answer && peerConnection && peerConnection.remoteDescription === null) {
                console.log("Received answer:", answer);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                startCallBtn.textContent = 'Start Call';
                startCallBtn.disabled = false;
                alert("Call connected!");
            }
        }, { onlyOnce: true }); // Listen only once for the answer

        // Listen for recipient's ICE candidates
        onChildAdded(ref(db, `calls/${currentCallId}/candidates/${recipientUid}`), (snapshot) => {
            const candidate = snapshot.val();
            if (candidate && peerConnection) {
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        });

        // Listen for call hangup by recipient
        onValue(ref(db, `calls/${currentCallId}/status`), (snapshot) => {
            if (snapshot.val() === 'ended' && currentCallId === snapshot.key) {
                alert("Call ended by the other party.");
                hangUp(); // Clean up local resources
            }
        });

    } catch (error) {
        console.error("Error starting call:", error);
        authErrorMessage.textContent = "Could not start call: " + error.message;
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        startCallBtn.textContent = 'Start Call';
        startCallBtn.disabled = false;
        callControls.classList.add('hidden');
    }
}

async function listenForIncomingCalls(myUid) {
    // Detach any previous listener to avoid duplicates
    off(query(ref(db, 'calls'), orderByChild('recipientUid'), equalTo(myUid)));

    onChildAdded(query(ref(db, 'calls'), orderByChild('recipientUid'), equalTo(myUid)), async (snapshot) => {
        const callData = snapshot.val();
        const callId = snapshot.key;

        // Ensure it's a new call and not already handled or an outbound call we initiated
        if (callData.status === 'ringing' && callData.callerUid !== myUid && currentCallId !== callId) {
            currentCallId = callId; // Set current active call

            incomingCallerInfo.textContent = `Incoming call from ${callData.callerDisplayName || callData.callerEmail}`;
            incomingCallSection.classList.remove('hidden');
            callControls.classList.add('hidden'); // Hide controls until accepted

            // Play a ringing sound (optional)
            // const audio = new Audio('path/to/ringing.mp3');
            // audio.play();

            // Set up listener for answer/reject button clicks (ensure only one listener per button)
            acceptCallBtn.onclick = () => acceptCall(callData, callId);
            rejectCallBtn.onclick = () => rejectCall(callId);
        }
    });

    // Listen for status changes on calls where I am the recipient (e.g., if caller hangs up)
    onValue(query(ref(db, 'calls'), orderByChild('recipientUid'), equalTo(myUid)), (snapshot) => {
        snapshot.forEach((childSnapshot) => {
            const callData = childSnapshot.val();
            const callId = childSnapshot.key;
            if (callId === currentCallId) { // Only act on the current call
                if (callData.status === 'ended' || callData.status === 'rejected') {
                    if (callData.status === 'ended') {
                        alert("Call ended by the other party.");
                    } else {
                        alert("Call rejected by the other party.");
                    }
                    hangUp(); // Clean up local resources
                }
            }
        });
    });
}

async function acceptCall(callData, callId) {
    try {
        incomingCallSection.classList.add('hidden'); // Hide incoming call UI
        callControls.classList.remove('hidden'); // Show call controls

        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Push candidate to Firebase
                push(ref(db, `calls/${callId}/candidates/${auth.currentUser.uid}`), event.candidate.toJSON());
            }
        };

        peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            }
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Send answer back to caller
        await set(ref(db, `calls/${callId}/answer`), answer.toJSON());
        await set(ref(db, `calls/${callId}/status`), 'connected');

        // Listen for caller's ICE candidates
        onChildAdded(ref(db, `calls/${callId}/candidates/${callData.callerUid}`), (snapshot) => {
            const candidate = snapshot.val();
            if (candidate && peerConnection) {
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        });

    } catch (error) {
        console.error("Error accepting call:", error);
        authErrorMessage.textContent = "Could not accept call: " + error.message;
        // Clean up on error
        hangUp();
    }
}

async function rejectCall(callId) {
    await set(ref(db, `calls/${callId}/status`), 'rejected');
    incomingCallSection.classList.add('hidden');
    currentCallId = null; // Clear current call
    alert("Call rejected.");
    // No stream to stop if we didn't get it yet
    hangUp(); // Ensure all resources are cleaned up
}

async function hangUp() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }
    remoteVideo.srcObject = null; // Clear remote video

    if (currentCallId) {
        // Update call status in Firebase
        // Only set to 'ended' if it's not already rejected by the other party
        const callRef = ref(db, `calls/${currentCallId}/status`);
        onValue(callRef, (snapshot) => {
            if (snapshot.val() !== 'rejected') {
                set(callRef, 'ended');
            }
        }, { onlyOnce: true }); // Use { onlyOnce: true } to prevent infinite loops if hangUp is called multiple times

        // Detach all listeners for this specific call (important to prevent memory leaks)
        off(ref(db, `calls/${currentCallId}/answer`));
        off(ref(db, `calls/${currentCallId}/candidates`));
        off(ref(db, `calls/${currentCallId}/status`));
        currentCallId = null;
    }

    callControls.classList.add('hidden');
    incomingCallSection.classList.add('hidden'); // Ensure hidden if was visible
    startCallBtn.textContent = 'Start Call';
    startCallBtn.disabled = false;
    console.log("Call ended.");
}

// --- Media Controls ---

muteAudioBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
            isAudioMuted = !track.enabled;
            muteAudioBtn.textContent = isAudioMuted ? 'Unmute Audio' : 'Mute Audio';
        });
    }
});

toggleVideoBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = !track.enabled;
            isVideoOff = !track.enabled;
            toggleVideoBtn.textContent = isVideoOff ? 'Turn On Video' : 'Turn Off Video';
        });
    }
});

hangUpBtn.addEventListener('click', hangUp);

// Initial state
authSection.classList.remove('hidden');
appSection.classList.add('hidden');