import mqtt from 'mqtt/dist/mqtt.min.js';
// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

const brokerUrl = import.meta.env.VITE_MQTT_BROKER;
const clientId = 'WebClient_' + Math.random().toString(16).substr(2, 8);

const options = {
    clientId: clientId,
    username: import.meta.env.VITE_MQTT_USER,
    password: import.meta.env.VITE_MQTT_PASS
};


// ==========================================
// UI ELEMENTS & STORAGE
// ==========================================
const terminal = document.getElementById('terminal');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const nodeFilter = document.getElementById('nodeFilter');
const pageTitle = document.getElementById('page-title');
const statusGrid = document.getElementById('status-grid');

let masterEventLog = [];

// ==========================================
// URL PARAMETER HANDLING (For New Windows)
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const singleNodeView = urlParams.get('node');

if (singleNodeView) {
    nodeFilter.value = singleNodeView;
    pageTitle.innerText = `Node ${singleNodeView} Event History`;
    statusGrid.style.display = 'none'; // Hide the grid in dedicated node view
}

// Add click listeners to cards to open new tab
document.getElementById('card-ch1').addEventListener('click', () => window.open('?node=1', '_blank'));
document.getElementById('card-ch2').addEventListener('click', () => window.open('?node=2', '_blank'));
document.getElementById('card-ch3').addEventListener('click', () => window.open('?node=3', '_blank'));

nodeFilter.addEventListener('change', renderLogs);

// ==========================================
// SHARED UI HELPER FUNCTIONS
// ==========================================
function updateBatteryUI(ch, voltage, timestampDate) {
    const volt = parseFloat(voltage).toFixed(2);
    if (ch >= 1 && ch <= 3) {
        const battEl = document.getElementById(`batt-ch${ch}`);
        if (!battEl) return;
        
        battEl.innerText = `${volt} V`;
        
        if (volt >= 3.6) battEl.className = 'batt-val';
        else if (volt >= 3.3) battEl.className = 'batt-val batt-low';
        else battEl.className = 'batt-val batt-crit';

        document.getElementById(`status-ch${ch}`).innerText = `Last updated: ${timestampDate.toLocaleString()}`;
    }
}

function renderLogs() {
    terminal.innerHTML = '';
    const selectedFilter = nodeFilter.value;

    masterEventLog.forEach(event => {
        // Evaluate filter logic
        if (selectedFilter === 'system') {
            if (event.type !== 'system' && event.type !== 'health' && event.type !== 'alarm') return;
        } else if (selectedFilter !== 'all') {
            const targetNode = parseInt(selectedFilter);
            const matchesChannel = event.channel === targetNode;
            const matchesDetails = event.details && event.details.includes(`Node ${targetNode}`);
            if (!matchesChannel && !matchesDetails) return; 
        }

        const div = document.createElement('div');
        div.className = 'log-entry';
        
        // Use toLocaleString() to include both Date and Time
        const timeStr = event.created_at ? new Date(event.created_at).toLocaleString() : new Date().toLocaleString();
        
        let colorClass = '';
        if (event.type === 'alarm') colorClass = 'log-alarm';
        if (event.type === 'node') colorClass = 'log-node';
        if (event.type === 'health') colorClass = 'log-health';
        if (event.type === 'batt') colorClass = 'log-batt';
        if (event.type === 'system') colorClass = 'log-system';

        div.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="${colorClass}">${event.message}</span>`;
        terminal.appendChild(div);
    });

    terminal.scrollTop = terminal.scrollHeight;
}

function addEvent(message, type = 'normal', timestamp = null, channel = null, details = '') {
    masterEventLog.push({
        message: message,
        type: type,
        created_at: timestamp,
        channel: channel,
        details: details
    });
    renderLogs();
}

// ==========================================
// FETCH HISTORICAL DATA ON LOAD
// ==========================================
async function loadHistory() {
    try {
        const response = await fetch(`${SUPABASE_URL}?select=*&order=created_at.asc&limit=100`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        data.forEach(event => {
            let msg = '';
            let type = 'normal';
            
            if (event.event_type === 'FULL_NETWORK_ALARM') {
                msg = `🚨 DB: ALARM TRIGGERED! Source: ${event.details}`;
                type = 'alarm';
            } else if (event.event_type === 'NODE_MOTION') {
                msg = `⚠️ DB: Node ${event.channel} Detected Motion`;
                type = 'node';
            } else if (event.event_type === 'BATTERY_UPDATE') {
                msg = `🔋 DB: Channel ${event.channel} reported ${event.value} V`;
                type = 'batt';
                
                // Populate the UI card with the latest database voltage as we iterate
                updateBatteryUI(event.channel, event.value, new Date(event.created_at));

            } else if (event.event_type.includes('HEALTH') || event.event_type.includes('DEAD')) {
                msg = `🩺 DB: ${event.details}`;
                type = 'health';
            } else if (event.event_type === 'SYSTEM_BOOT') {
                msg = `⚙️ DB: Gateway Powered On`;
                type = 'system';
            }

            if (msg) {
                masterEventLog.push({
                    message: msg,
                    type: type,
                    created_at: event.created_at,
                    channel: event.channel,
                    details: event.details
                });
            }
        });
        
        renderLogs();
        
    } catch (error) {
        addEvent(`Failed to load history from Supabase: ${error.message}`, 'health');
    }
}

loadHistory();

// ==========================================
// LIVE CONNECTION HANDLING
// ==========================================
client.on('connect', () => {
    connDot.className = 'status-dot connected';
    connText.innerText = 'Connected to HiveMQ';
    
    client.subscribe('seismic/gateway/alarm');
    client.subscribe('seismic/gateway/health');
    client.subscribe('seismic/gateway/battery');
    client.subscribe('seismic/gateway/node_trigger');
});

client.on('offline', () => {
    connDot.className = 'status-dot disconnected';
    connText.innerText = 'Disconnected';
});

// ==========================================
// LIVE INCOMING MESSAGE ROUTING
// ==========================================
client.on('message', (topic, message) => {
    const payloadStr = message.toString();
    let payload;
    try { payload = JSON.parse(payloadStr); } 
    catch (e) { return; }

    if (topic === 'seismic/gateway/alarm') {
        if (payload.alarm) {
            document.body.style.backgroundColor = '#4a0000';
            addEvent(`🚨 LIVE: ALARM TRIGGERED! Source: ${payload.source}`, 'alarm', null, null, payload.source);
        } else {
            document.body.style.backgroundColor = '#121212';
            addEvent(`Alarm Reset / Cleared.`, 'normal');
        }
    }
    
    else if (topic === 'seismic/gateway/node_trigger') {
        const ch = payload.node;
        addEvent(`⚠️ LIVE: Node ${ch} Detected Motion!`, 'node', null, ch, `Node ${ch} motion`);
        
        if (!singleNodeView) {
            const card = document.getElementById(`card-ch${ch}`);
            if (card) {
                card.classList.add('node-triggered');
                setTimeout(() => card.classList.remove('node-triggered'), 2000);
            }
        }
    }

    else if (topic === 'seismic/gateway/health') {
        if (payload.status === "warning_dead_node") {
            addEvent(`⚠️ LIVE: WARNING: A node has gone silent/dead.`, 'health');
        } else if (payload.status === "all_healthy") {
            addEvent(`System stabilized: All nodes healthy.`, 'health');
        }
    }
    
    else if (topic === 'seismic/gateway/battery') {
        const ch = payload.channel;
        const volt = payload.voltage;
        
        // Update the card UI using the shared helper function
        updateBatteryUI(ch, volt, new Date());
        
        addEvent(`🔋 LIVE: Channel ${ch} reported ${parseFloat(volt).toFixed(2)} V`, 'batt', null, ch, `Battery ${parseFloat(volt).toFixed(2)}V`);
    }
});