// Capacitor ใน Android จะรันอยู่บน localhost 
const isMobileApp = window.location.hostname === 'localhost' || window.location.protocol === 'capacitor:';
const BASE_URL = isMobileApp ? "http://10.150.106.101:3000" : "";


// ==========================================
// 1. ระบบจัดการหน้าเว็บ (Router & Auth Guard)
// ==========================================
async function checkAuth() {
    try {
        const response = await fetch(`${BASE_URL}/api/check-auth`, { credentials: 'include' });
        return await response.json(); 
    } catch (error) {
        console.error('Error checking auth:', error);
        return { isLoggedIn: false };
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const url = window.location.href;
    const isDashboardPage = url.includes('dashboard.html');
    const isLoginPage = !isDashboardPage; 

    const savedUser = localStorage.getItem('user');

    if (isDashboardPage && !savedUser) {
        window.location.replace('index.html');
        return;
    }

    if (isLoginPage && savedUser) {
        window.location.replace('dashboard.html');
        return;
    }

    if (isDashboardPage && savedUser) {
        const user = JSON.parse(savedUser);
        console.log('🚀 ยินดีต้อนรับคุณ:', user.username || user.email);
        
        // ตรวจสอบชื่อตัวแปร ID ให้ชัวร์ (id หรือ userId)
        const userId = user.id || user.userId || user.user_id;
        
        fetchDevices(userId);
        setupWebSocket();

        checkAuth().then(authData => {
            if (!authData.isLoggedIn) {
                console.warn("⚠️ Server session expired.");
            }
        });
    }
});

// ==========================================
// 2. ระบบเข้าสู่ระบบ (Login)
// ==========================================
window.handleLogin = async function(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const emailError = document.getElementById('email-error');
    
    if(emailError) emailError.style.display = 'none'; 

    try {
        const response = await fetch(`${BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (data.status === 'ok') {
            localStorage.setItem('user', JSON.stringify(data.user));
            window.location.href = 'dashboard.html'; 
        } else {
            if(emailError) {
                emailError.innerText = data.message;
                emailError.style.display = 'block';
            } else { alert(data.message); }
        }
    } catch (err) {
        console.error('Login Error:', err);
        alert(`🚨 อาการที่แท้จริง: ${err.message}`);
    }
};

window.togglePasswordVisibility = function() {
    const passwordInput = document.getElementById('login-password');
    const toggleIcon = document.querySelector('.toggle-password');
   
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.textContent = 'visibility';
    } else {
        passwordInput.type = 'password';
        toggleIcon.textContent = 'visibility_off';
    }
};

// ==========================================
// 3. ระบบจัดการอุปกรณ์ (Devices)
// ==========================================
function fetchDevices(userId) {
    console.log(`📡 กำลังดึงข้อมูลสำหรับ User ID: ${userId}`);
    const container = document.getElementById('device-list');
    
    fetch(`${BASE_URL}/api/devices/${userId}`, { credentials: 'include' })
        .then(response => {
            if (!response.ok) throw new Error('ติดต่อ Database ไม่ได้ (404/500)');
            return response.json();
        })
        .then(data => {
            console.log('📦 ข้อมูลที่ได้รับ:', data);
            if (data.status === 'ok') { 
                renderDevices(data.devices); 
            }
        })
        .catch(err => {
            console.error('❌ Fetch Error:', err);
            if(container) container.innerHTML = `<p style="color:red; padding:20px;">🚨 พังตรงนี้: ${err.message}</p>`;
        });
}

function renderDevices(devices) {
    const container = document.getElementById('device-list'); 
    if (!container) {
        console.error("🚨 หา <div id='device-list'> ไม่เจอในหน้า HTML");
        return;
    }

    container.innerHTML = ''; // ล้างค่า CONNECTING... ออก

    // ตรวจสอบว่ามีข้อมูลส่งมาจริงไหม
    if (!devices || devices.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p>🔍 ไม่พบอุปกรณ์ของคุณในระบบ</p>
                <p style="font-size: 12px; color: #888;">(เช็ค user_id ในตาราง devices ว่าตรงกับ ID ผู้ใช้ที่ล็อกอินไหม)</p>
            </div>`;
        return;
    }

    devices.forEach(device => {
        // 🛠 เช็คชื่อตัวแปร: ลองดูใน DB ของคุณว่าใช้ชื่ออะไร 
        // ถ้าใช้ device_name ก็ปล่อยไว้ แต่ถ้าใช้ name ให้แก้ตรงนี้
        const name = device.device_name || device.name || "Unknown Device";
        const id = device.id || device.device_id;
        const status = (device.status === 1 || device.status === true) ? 1 : 0;

        const card = document.createElement('div');
        card.className = 'room-card'; // หรือ 'device-card' ตาม CSS ของคุณ
        card.innerHTML = `
            <h3>${name}</h3>
            <div class="toggle-wrapper">
                <span class="toggle-label">OFF</span>
                <label class="toggle-switch">
                    <input type="checkbox" 
                           id="toggle-${id}" 
                           onchange="toggleDeviceStatus(${id}, this.checked)"
                           ${status === 1 ? 'checked' : ''}>
                    <span class="toggle-track"></span>
                    <span class="toggle-thumb"></span>
                </label>
                <span class="toggle-label">ON</span>
            </div>
            <div class="room-status" id="status-${id}" style="color: ${status === 1 ? '#ff7043' : '#888888'}">
                ● Light ${status === 1 ? 'ON' : 'OFF'}
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================
// 4. ระบบ WebSocket (Real-time)
// ==========================================
function setupWebSocket() {
    const host = isMobileApp ? "10.150.106.101:3000" : window.location.host;
    const wsUrl = `ws://${host}`; 
    window.ws = new WebSocket(wsUrl);

    const statusText = document.getElementById("statusText");
    const statusBadge = document.getElementById("statusBadge");

    window.ws.onopen = () => {
        console.log("✅ WebSocket Connected!");
        if (statusText && statusBadge) {
            statusText.innerText = "CONNECTED";
            statusBadge.className = "status-badge connected";
        }
    };

    window.ws.onclose = () => {
        if (statusText && statusBadge) {
            statusText.innerText = "DISCONNECTED";
            statusBadge.className = "status-badge disconnected";
        }
        setTimeout(setupWebSocket, 3000); 
    };
}

// ==========================================
// 5. ระบบควบคุมไฟ
// ==========================================
window.toggleDeviceStatus = async function(deviceId, isChecked) {
    const statusTextDiv = document.getElementById(`status-${deviceId}`);
    if (statusTextDiv) {
        statusTextDiv.innerText = isChecked ? '● Light ON' : '● Light OFF';
        statusTextDiv.style.color = isChecked ? '#ff7043' : '#888888'; 
    }

    try {
        await fetch(`${BASE_URL}/api/devices/${deviceId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ status: isChecked ? 1 : 0 })
        });
    } catch (err) {
        console.error('❌ DB Update Error:', err);
    }

    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        const action = isChecked ? 'OPEN_TRUNON' : 'CLOSE_TRUNOFF';
        const command = `${action}_ROOM${deviceId}`;
        window.ws.send(command);
    }
};

// ==========================================
// 6. ระบบ Logout
// ==========================================
window.handleLogout = async function(event) {
    event.preventDefault();
    localStorage.removeItem('user');
    try {
        await fetch(`${BASE_URL}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) { console.error(err); }
    window.location.href = 'index.html'; 
};