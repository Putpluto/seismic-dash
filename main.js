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
// BATTERY PREDICTION MODEL (EVE 35V & TPS799)
// ==========================================
const batteryTracking = { 1: [], 2: [], 3: [] };

// OCV Lookup Table for EVE 35V (ICR18650-35V) mapped for TPS799 LDO (3.393V output -> 3.45V cutoff)
const ocvLookupTable = [
    { v: 4.20, soc: 100.0 }, // Full charge
    { v: 4.10, soc: 94.0 },  
    { v: 4.00, soc: 84.0 },
    { v: 3.90, soc: 72.0 },
    { v: 3.80, soc: 60.0 },
    { v: 3.70, soc: 48.0 },  // Middle of nominal plateau
    { v: 3.60, soc: 30.0 },
    { v: 3.50, soc: 10.0 },  // Plateau knee
    { v: 3.45, soc: 0.0 }    // Hardware dropout cutoff
];

function calculateSOC(voltage) {
    if (voltage >= 4.20) return 100.0;
    if (voltage <= 3.45) return 0.0;
    
    for (let i = 0; i < ocvLookupTable.length - 1; i++) {
        let upper = ocvLookupTable[i];
        let lower = ocvLookupTable[i + 1];

        if (voltage <= upper.v && voltage >= lower.v) {
            let vRange = upper.v - lower.v;
            let socRange = upper.soc - lower.soc;
            let vOffset = voltage - lower.v;
            
            return lower.soc + ((vOffset / vRange) * socRange);
        }
    }
    return 0;
}

// ==========================================
// DATE FORMATTERS (DD/MM/YYYY)
// ==========================================
function formatChartDate(timestamp) {
    const d = new Date(timestamp);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    return `${dd}/${mm}/${hh}`; // DD/MM/HH
}

function formatLogDate(timestamp) {
    const d = timestamp ? new Date(timestamp) : new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

// ==========================================
// CHART INITIALIZATION & RENDERING
// ==========================================
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
                    title: { display: true, text: 'Time (DD/MM/HH)', color: '#888' },
                    ticks: { color: '#aaa', maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                    grid: { color: '#333' }
                },
                y: {
                    title: { display: true, text: 'Voltage (V)', color: '#888' },
                    ticks: { color: '#aaa' },
                    grid: { color: '#333' },
                    suggestedMin: 3.4,
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

    const selectedNode = chartNodeFilter.value;
    const selectedTime = chartTimeFilter.value;
    
    const now = new Date().getTime();
    let timeLimitMs = 0;
    if (selectedTime === '1h') timeLimitMs = 60 * 60 * 1000;
    if (selectedTime === '24h') timeLimitMs = 24 * 60 * 60 * 1000;
    if (selectedTime === '7d') timeLimitMs = 7 * 24 * 60 * 60 * 1000;

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

    const sortedData = [...filteredByTime].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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

[1, 2, 3].forEach(ch => {
    const card = document.getElementById(`card-ch${ch}`);
    if (card) {
        card.addEventListener('click', () => {
            chartNodeFilter.value = String(ch);
            nodeFilter.value = String(ch);
            renderLogs();
            updateChart();
            document.getElementById('chart-section').scrollIntoView({ behavior: 'smooth' });
        });
    }
});

chartNodeFilter.addEventListener('change', updateChart);
chartTimeFilter.addEventListener('change', updateChart);
nodeFilter.addEventListener('change', renderLogs);

initChart();

// ==========================================
// SHARED UI HELPER FUNCTIONS
// ==========================================
function updateBatteryUI(ch, voltage, timestampDate) {
    const volt = parseFloat(voltage);
    if (ch >= 1 && ch <= 3) {
        // Track history for dynamic calculations
        batteryTracking[ch].push({ time: timestampDate.getTime(), volt: volt });

        const battEl = document.getElementById(`batt-ch${ch}`);
        const predictEl = document.getElementById(`predict-ch${ch}`);
        if (!battEl) return;
        
        battEl.innerText = `${volt.toFixed(2)} V`;
        
        // Calculate non-linear State of Charge (SOC)
        const currentSOC = calculateSOC(volt);
        let predictionText = `${Math.round(currentSOC)}% | Gathering data...`;
        let isCritical = false;

        // Dynamic Database Prediction
        const history = batteryTracking[ch];
        if (history.length > 1) {
            const oldest = history[0];
            const newest = history[history.length - 1];
            
            const daysElapsed = (newest.time - oldest.time) / (1000 * 60 * 60 * 24);
            const socDrop = calculateSOC(oldest.volt) - calculateSOC(newest.volt);
            
            if (daysElapsed >= 0.5 && socDrop > 0) {
                const dynamicDailyBurnRate = socDrop / daysElapsed;
                const estimatedDays = Math.round(currentSOC / dynamicDailyBurnRate);
                
                predictionText = `${Math.round(currentSOC)}% | ~${estimatedDays} days left`;
                if (estimatedDays <= 14) isCritical = true;
            }
        }

        if (predictEl) {
            predictEl.innerText = predictionText;
            if (isCritical) {
                predictEl.style.color = '#ff3333';
                predictEl.style.fontWeight = 'bold';
            } else {
                predictEl.style.color = '#888';
                predictEl.style.fontWeight = 'normal';
            }
        }
        
        if (volt >= 3.70) battEl.className = 'batt-val';
        else if (volt >= 3.50) battEl.className = 'batt-val batt-low';
        else battEl.className = 'batt-val batt-crit';

        const timeStr = formatLogDate(timestampDate).split(' ')[1];
        document.getElementById(`status-ch${ch}`).innerText = `Last updated: ${timeStr}`;
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
        
        const timeStr = formatLogDate(event.created_at);
        
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
        
        batteryHistory.push({ channel: ch, voltage: volt, timestamp: nowIso });
        updateChart();

        addEvent(`🔋 LIVE: Channel ${ch} reported ${volt.toFixed(2)} V`, 'batt', null, ch, `Battery ${volt.toFixed(2)}V`);
    }
});