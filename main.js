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
// UI ELEMENTS & DATA STORAGE
// ==========================================
const terminal = document.getElementById('terminal');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const nodeFilter = document.getElementById('nodeFilter');
const chartNodeFilter = document.getElementById('chartNodeFilter');
const chartTimeFilter = document.getElementById('chartTimeFilter');
const pageTitle = document.getElementById('page-title');
const statusGrid = document.getElementById('status-grid');

let masterEventLog = [];
let batteryHistory = []; // Raw battery datapoints: { channel, voltage, timestamp }
let battChart = null;    // Chart.js instance

// ==========================================
// CHART INITIALIZATION & RENDERING
// ==========================================

// Helper function to format timestamp to MM/DD/HH
function formatChartDate(timestamp) {
    const d = new Date(timestamp);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    return `${mm}/${dd}/${hh}`;
}

function initChart() {
    const ctx = document.getElementById('batteryChart').getContext('2d');
    battChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'category',
                    title: { display: true, text: 'Time (MM/DD/HH)', color: '#888' },
                    ticks: { color: '#aaa', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                    grid: { color: '#333' }
                },
                y: {
                    title: { display: true, text: 'Voltage (V)', color: '#888' },
                    ticks: { color: '#aaa' },
                    grid: { color: '#333' },
                    suggestedMin: 2.8,
                    suggestedMax: 4.2
                }
            },
            plugins: {
                legend: { labels: { color: '#fff' } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` Node ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} V`
                    }
                }
            }
        }
    });
}

function updateChart() {
    if (!battChart) return;

    const selectedNode = chartNodeFilter.value; // 'all', '1', '2', '3'
    const selectedTime = chartTimeFilter.value; // '1h', '24h', '7d', 'all'
    
    const now = new Date().getTime();
    let timeLimitMs = 0;
    if (selectedTime === '1h') timeLimitMs = 60 * 60 * 1000;
    if (selectedTime === '24h') timeLimitMs = 24 * 60 * 60 * 1000;
    if (selectedTime === '7d') timeLimitMs = 7 * 24 * 60 * 60 * 1000;

    // Filter data by time frame
    const filteredByTime = batteryHistory.filter(entry => {
        if (selectedTime === 'all') return true;
        const entryTime = new Date(entry.timestamp).getTime();
        return (now - entryTime) <= timeLimitMs;
    });

    const colors = {
        1: { border: '#4CAF50', bg: 'rgba(76, 175, 80, 0.1)' },
        2: { border: '#2196F3', bg: 'rgba(33, 150, 243, 0.1)' },
        3: { border: '#FF9800', bg: 'rgba(255, 152, 0, 0.1)' }
    };

    let channelsToRender = selectedNode === 'all' ? [1, 2, 3] : [parseInt(selectedNode)];

    // Sort the raw data chronologically first
    const sortedData = [...filteredByTime].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Get unique labels in MM/DD/HH format for the X-axis
    const timestamps = Array.from(new Set(sortedData.map(d => formatChartDate(d.timestamp))));

    const datasets = channelsToRender.map(ch => {
        const chData = sortedData.filter(d => d.channel === ch);

        return {
            label: `Node ${ch}`,
            data: chData.map(d => ({
                x: formatChartDate(d.timestamp),
                y: d.voltage
            })),
            borderColor: colors[ch]?.border || '#ffffff',
            backgroundColor: colors[ch]?.bg || 'transparent',
            tension: 0.2,
            fill: false,
            pointRadius: 3
        };
    });

    battChart.data.labels = timestamps;
    battChart.data.datasets = datasets;
    battChart.update();
}

function updateChart() {
    if (!battChart) return;

    const selectedNode = chartNodeFilter.value; // 'all', '1', '2', '3'
    const selectedTime = chartTimeFilter.value; // '1h', '24h', '7d', 'all'
    
    const now = new Date().getTime();
    let timeLimitMs = 0;
    if (selectedTime === '1h') timeLimitMs = 60 * 60 * 1000;
    if (selectedTime === '24h') timeLimitMs = 24 * 60 * 60 * 1000;
    if (selectedTime === '7d') timeLimitMs = 7 * 24 * 60 * 60 * 1000;

    // Filter data by time frame
    const filteredByTime = batteryHistory.filter(entry => {
        if (selectedTime === 'all') return true;
        const entryTime = new Date(entry.timestamp).getTime();
        return (now - entryTime) <= timeLimitMs;
    });

    const colors = {
        1: { border: '#4CAF50', bg: 'rgba(76, 175, 80, 0.1)' },
        2: { border: '#2196F3', bg: 'rgba(33, 150, 243, 0.1)' },
        3: { border: '#FF9800', bg: 'rgba(255, 152, 0, 0.1)' }
    };

    let channelsToRender = selectedNode === 'all' ? [1, 2, 3] : [parseInt(selectedNode)];

    // Get unique sorted labels (timestamps)
    const timestamps = Array.from(new Set(filteredByTime.map(d => new Date(d.timestamp).toLocaleTimeString())))
        .sort((a, b) => new Date(a) - new Date(b));

    const datasets = channelsToRender.map(ch => {
        const chData = filteredByTime
            .filter(d => d.channel === ch)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        return {
            label: `Node ${ch}`,
            data: chData.map(d => ({
                x: new Date(d.timestamp).toLocaleTimeString(),
                y: d.voltage
            })),
            borderColor: colors[ch]?.border || '#ffffff',
            backgroundColor: colors[ch]?.bg || 'transparent',
            tension: 0.2,
            fill: false,
            pointRadius: 3
        };
    });

    battChart.data.labels = timestamps;
    battChart.data.datasets = datasets;
    battChart.update();
}

// ==========================================
// URL PARAMETER HANDLING & CLICK EVENTS
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const singleNodeView = urlParams.get('node');

if (singleNodeView) {
    nodeFilter.value = singleNodeView;
    chartNodeFilter.value = singleNodeView;
    pageTitle.innerText = `Node ${singleNodeView} Event History`;
    statusGrid.style.display = 'none';
}

// Node Card Click Handler: Scroll to & filter graph
[1, 2, 3].forEach(ch => {
    const card = document.getElementById(`card-ch${ch}`);
    if (card) {
        card.addEventListener('click', () => {
            chartNodeFilter.value = String(ch);
            nodeFilter.value = String(ch);
            renderLogs();
            updateChart();
            
            // Scroll smoothly to graph view
            document.getElementById('chart-section').scrollIntoView({ behavior: 'smooth' });
        });
    }
});

chartNodeFilter.addEventListener('change', updateChart);
chartTimeFilter.addEventListener('change', updateChart);
nodeFilter.addEventListener('change', renderLogs);

// Initialize Chart
initChart();

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

        document.getElementById(`status-ch${ch}`).innerText = `Last updated: ${timestampDate.toLocaleTimeString()}`;
    }
}

function renderLogs() {
    terminal.innerHTML = '';
    const selectedFilter = nodeFilter.value;

    masterEventLog.forEach(event => {
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
        const fetchHeaders = {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        };

        const batteryPromise = fetch(`${SUPABASE_URL}?select=*&event_type=eq.BATTERY_UPDATE`, { headers: fetchHeaders });
        const triggerPromise = fetch(`${SUPABASE_URL}?select=*&event_type=neq.BATTERY_UPDATE&order=created_at.desc&limit=100`, { headers: fetchHeaders });

        const [batteryRes, triggerRes] = await Promise.all([batteryPromise, triggerPromise]);
        if (!batteryRes.ok || !triggerRes.ok) throw new Error('Network response failed');
        
        const batteryData = await batteryRes.json();
        const triggerData = await triggerRes.json();
        
        let combinedData = [...batteryData, ...triggerData];
        combinedData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        combinedData.forEach(event => {
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
                
                const vNum = parseFloat(event.value);
                const time = event.created_at;

                // Push to chart telemetry repository
                batteryHistory.push({ channel: event.channel, voltage: vNum, timestamp: time });

                updateBatteryUI(event.channel, vNum, new Date(time));

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
        updateChart();
        
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
    let payload;
    try { payload = JSON.parse(message.toString()); } 
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
        const volt = parseFloat(payload.voltage);
        const nowIso = new Date().toISOString();
        
        updateBatteryUI(ch, volt, new Date());
        
        // Save live reading to chart data & refresh chart
        batteryHistory.push({ channel: ch, voltage: volt, timestamp: nowIso });
        updateChart();

        addEvent(`🔋 LIVE: Channel ${ch} reported ${volt.toFixed(2)} V`, 'batt', null, ch, `Battery ${volt.toFixed(2)}V`);
    }
});