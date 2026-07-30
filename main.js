import mqtt from 'mqtt';

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

const client = mqtt.connect(brokerUrl, options);

// ==========================================
// UI ELEMENTS & STORAGE
// ==========================================
const terminal = document.getElementById('terminal');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const nodeFilter = document.getElementById('nodeFilter');

let masterEventLog = [];

// Attach event listener for the dropdown
nodeFilter.addEventListener('change', renderLogs);

function renderLogs() {
    terminal.innerHTML = '';
    const selectedFilter = nodeFilter.value;

    masterEventLog.forEach(event => {
        if (selectedFilter !== 'all') {
            const targetNode = parseInt(selectedFilter);
            const matchesChannel = event.channel === targetNode;
            const matchesDetails = event.details && event.details.includes(`Node ${targetNode}`);
            if (!matchesChannel && !matchesDetails) return; 
        }

        const div = document.createElement('div');
        div.className = 'log-entry';
        
        const timeStr = event.created_at ? new Date(event.created_at).toLocaleTimeString() : new Date().toLocaleTimeString();
        
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
        
        const card = document.getElementById(`card-ch${ch}`);
        if (card) {
            card.classList.add('node-triggered');
            setTimeout(() => card.classList.remove('node-triggered'), 2000);
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
        const volt = parseFloat(payload.voltage).toFixed(2);
        
        if (ch >= 1 && ch <= 3) {
            const battEl = document.getElementById(`batt-ch${ch}`);
            battEl.innerText = `${volt} V`;
            
            if (volt >= 3.6) battEl.className = 'batt-val';
            else if (volt >= 3.3) battEl.className = 'batt-val batt-low';
            else battEl.className = 'batt-val batt-crit';

            document.getElementById(`status-ch${ch}`).innerText = `Last updated: ${new Date().toLocaleTimeString()}`;
            addEvent(`🔋 LIVE: Channel ${ch} reported ${volt} V`, 'batt', null, ch, `Battery ${volt}V`);
        }
    }
});