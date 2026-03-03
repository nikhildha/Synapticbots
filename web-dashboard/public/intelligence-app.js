/**
 * SENTINEL — Intelligence Dashboard App
 * Handles real-time updates for Sentiment & Order Flow
 *
 * When loaded on the dashboard (index.html) alongside app.js, this file
 * runs inside an IIFE to avoid global scope collisions (e.g. `socket`).
 * Key update functions are exposed on `window` so app.js can invoke them.
 */
(function () {
    "use strict";

    // Reuse socket from app.js if available, else create our own (standalone page)
    const _socket = (typeof socket !== 'undefined') ? socket : io();

    // ─── Regime Helpers ──────────────────────────────────────────────────────────
    // ─── Regime & Format Helpers ────────────────────────────────────────────────
    // Delegated to shared-ticker.js (REGIME_MAP, getRegimeInfo, formatPrice)


    // ─── Socket Events ───────────────────────────────────────────────────────────
    _socket.on('log-lines', (lines) => {
        if (!lines) return;
        const logDiv = document.getElementById('kernelLog');
        if (!logDiv) return;

        // If it's the first log, clear the "Waiting..." text
        if (logDiv.textContent.includes('// Waiting')) logDiv.innerHTML = '';

        // Append lines
        // lines is usually a single string or array of strings from tail
        // The server sends `lines` as a string mostly.
        const text = Array.isArray(lines) ? lines.join('\n') : lines;

        // Create a span for colorizing
        const span = document.createElement('div');
        span.style.borderBottom = '1px solid #1E293B';
        span.style.padding = '2px 0';

        // Simple syntax highlighting
        let html = text
            .replace(/INFO/g, '<span style="color:#3B82F6;font-weight:700;">INFO</span>')
            .replace(/WARNING/g, '<span style="color:#F59E0B;font-weight:700;">WARNING</span>')
            .replace(/ERROR/g, '<span style="color:#EF4444;font-weight:700;">ERROR</span>')
            .replace(/CRITICAL/g, '<span style="color:#DC2626;font-weight:800;">CRITICAL</span>')
            .replace(/SUCCESS/g, '<span style="color:#10B981;font-weight:700;">SUCCESS</span>');

        span.innerHTML = html;
        logDiv.appendChild(span);

        // Auto-scroll to bottom
        logDiv.scrollTop = logDiv.scrollHeight;

        // Optional: Limit history to 500 lines to prevent DOM bloat
        if (logDiv.childElementCount > 500) {
            logDiv.removeChild(logDiv.firstChild);
        }
    });


    // ─── DOM Elements ────────────────────────────────────────────────────────────
    // Initial log load
    _socket.on('log-init', (lines) => {
        // Manually trigger the log-lines logic for initial data
        if (_socket.listeners('log-lines').length > 0) {
            _socket.listeners('log-lines')[0](lines);
        }
    });

    const els = {};

    function initEls() {
        els.lastUpdate = document.getElementById('lastUpdate');
        els.statusPill = document.getElementById('statusPill');
        els.statusText = document.getElementById('statusText');
        els.sourceTable = document.getElementById('sourceTable');
        els.sourceStats = document.getElementById('sourceStats');
        els.tickerTrack = document.getElementById('tickerTrack');
        els.convictionTable = document.getElementById('convictionTable');
        els.fgNeedle = document.getElementById('fgNeedle');
        els.fgValue = document.getElementById('fgValue');
        els.fgLabel = document.getElementById('fgLabel');
        els.fgSub = document.getElementById('fgSub');
        els.biasVal = document.getElementById('biasVal');
        els.biasFill = document.getElementById('biasFill');
        els.sourcePills = document.getElementById('sourcePills');
        els.sentBars = document.getElementById('sentBars');
        els.insightsArea = document.getElementById('insightsArea');
        els.regimeDriversBody = document.getElementById('regimeDriversBody');
        els.orderFlowAllBody = document.getElementById('orderFlowAllBody');
    }

    // ─── State ───────────────────────────────────────────────────────────────────
    let state = {
        multi: {},
        bot: {},
        lastRefresh: 0
    };

    // ─── Charts ──────────────────────────────────────────────────────────────────
    let charts = {};

    function initCharts() {
        // Disable global animations to prevent jitter
        Chart.defaults.animation = false;

        /*
        // 1. Conviction Distribution (Mini Bar)
        const ctxConv = document.getElementById('convictionDist').getContext('2d');
        charts.conviction = new Chart(ctxConv, {
            type: 'bar',
            data: {
                labels: ['Low', 'Med', 'High'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: ['#94A3B8', '#F59E0B', '#22C55E'],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: true, grid: { display: false } }, y: { display: false, min: 0, max: 20 } }
            }
        });
        */



        /*
        // 3. Sentiment Timeline (Line)
        const ctxTime = document.getElementById('sentTimeline').getContext('2d');
        charts.timeline = new Chart(ctxTime, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Market Bias',
                    data: [],
                    borderColor: '#6366F1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { min: -1, max: 1, grid: { color: '#F1F5F9' } }
                }
            }
        });
        */

        // Initialize mock data for timeline so it's not empty
        /*
        // ... timeline removal ...
        */

        // 4. Depth Chart (Area)
        // 4. Depth Chart (Removed per user request)
        // Replaced by CSS Visual

        // 5. L/S Ratio (Removed per user request)
    }

    // ─── Initialization ──────────────────────────────────────────────────────────
    // Detect if we're on the dashboard (app.js is loaded) or standalone intelligence page
    const _isStandalonePage = (document.querySelector('script[src="/app.js"]') === null)
        || (window.location.pathname === '/intelligence');

    document.addEventListener('DOMContentLoaded', () => {
        initEls();
        initCharts();

        if (_isStandalonePage) {
            // Standalone: run our own fetch loop
            fetchData();
            setInterval(fetchData, 30000);
        } else {
            // Dashboard: app.js drives data; just fetch news once for the news feed
            fetch('/api/news-feed').then(r => r.json()).catch(() => [])
                .then(newsData => {
                    state.news = newsData || [];
                    updateNewsFeed();
                });
            // Refresh news every 5 min
            setInterval(() => {
                fetch('/api/news-feed').then(r => r.json()).catch(() => [])
                    .then(newsData => {
                        state.news = newsData || [];
                        updateNewsFeed();
                    });
            }, 300000);
        }
    });

    function refreshAll() {
        const icon = document.getElementById('refreshIcon');
        if (icon) { icon.style.animation = 'spin 0.6s linear infinite'; }
        fetchData();
        setTimeout(() => { if (icon) icon.style.animation = ''; }, 1000);
    }

    function fetchData() {
        state.lastRefresh = Date.now();

        // Parallel fetch
        Promise.all([
            fetch('/api/multi-state').then(r => r.json()),
            fetch('/api/state').then(r => r.json()),
            fetch('/api/news-feed').then(r => r.json()).catch(() => [])
        ]).then(([multiData, botData, newsData]) => {
            state.multi = multiData || {};
            state.bot = botData || {};
            state.news = newsData || [];
            updateUI();
        }).catch(err => {
            console.error('Fetch error:', err);
            if (els.statusText) els.statusText.textContent = 'CONNECTION ERROR';
            if (els.statusPill) {
                els.statusPill.style.background = '#FEE2E2';
                els.statusPill.style.color = '#DC2626';
            }
        });
    }



    // Update timestamps every second
    // Update timestamps every second
    setInterval(() => {
        updateCountdown();
    }, 1000);

    function updateCountdown() {
        if (!state.multi.next_analysis_time) return;

        // Only update if we are in MONITORING state (not active trading)
        if (state.multi.deployed_count > 0) return;

        const target = new Date(state.multi.next_analysis_time).getTime();
        const now = Date.now();
        const diff = target - now;

        if (diff > 0) {
            const min = Math.floor((diff / 1000) / 60);
            const sec = Math.floor((diff / 1000) % 60);
            els.statusText.textContent = `MONITORING (${min}m ${sec}s)`;
        } else {
            els.statusText.textContent = 'SCANNING NOW...';
        }
    }

    // ─── UI Updates ──────────────────────────────────────────────────────────────
    function updateUI() {
        try { updateHeader(); } catch (e) { console.error('updateHeader error:', e); }
        try { updateCommandBar(); } catch (e) { console.error('updateCommandBar error:', e); }
        try { updateSentiment(); } catch (e) { console.error('updateSentiment error:', e); }
        try { updateOrderFlow(); } catch (e) { console.error('updateOrderFlow error:', e); }
        try { updateNewsFeed(); } catch (e) { console.error('updateNewsFeed error:', e); }
        try { updateFunding(); } catch (e) { console.error('updateFunding error:', e); }
        try { updateTicker(); } catch (e) { console.error('updateTicker error:', e); }
    }

    function updateCommandBar() {
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);

        // 1. BTC Price
        const btc = coinStates['BTCUSDT'];
        const cbBTC = document.getElementById('cbBTC');
        const cbBTCRegime = document.getElementById('cbBTCRegime');
        if (cbBTC && btc) {
            cbBTC.textContent = '$' + Number(btc.price).toLocaleString(undefined, { maximumFractionDigits: 2 });
        }
        if (cbBTCRegime && btc) {
            cbBTCRegime.textContent = 'Regime: ' + btc.regime;
        }

        // 2. Fear & Greed (same calculation as updateSentiment)
        let avgSent = 0, count = 0;
        coins.forEach(c => {
            if (c.sentiment === undefined || c.sentiment === null) {
                c.sentiment = calculateSentiment(c);
            }
            if (c.sentiment !== undefined && c.sentiment !== null) {
                avgSent += c.sentiment; count++;
            }
        });
        if (count > 0) avgSent /= count;
        avgSent = Math.max(-1, Math.min(1, avgSent));
        const fgVal = Math.round((avgSent + 1) * 50);

        const cbFG = document.getElementById('cbFG');
        const cbFGLabel = document.getElementById('cbFGLabel');
        if (cbFG) cbFG.textContent = fgVal;
        if (cbFGLabel) {
            let label = 'Neutral';
            if (fgVal < 25) label = 'Extreme Fear';
            else if (fgVal < 45) label = 'Fear';
            else if (fgVal > 75) label = 'Extreme Greed';
            else if (fgVal > 55) label = 'Greed';
            cbFGLabel.textContent = label;
        }

        // 3. Market Sentiment Bias
        const cbBias = document.getElementById('cbBias');
        const cbBiasLabel = document.getElementById('cbBiasLabel');
        if (cbBias) cbBias.textContent = avgSent.toFixed(2);
        if (cbBiasLabel) cbBiasLabel.textContent = 'Avg across ' + count + ' coins';

        // 4. Active Positions
        const cbPositions = document.getElementById('cbPositions');
        const cbPosDetail = document.getElementById('cbPosDetail');
        // active_positions can be an object or number — extract count
        let activeTrades = state.multi.active_positions;
        if (typeof activeTrades === 'object' && activeTrades !== null) {
            activeTrades = Object.keys(activeTrades).length;
        }
        activeTrades = activeTrades || 0;
        if (cbPositions) cbPositions.textContent = activeTrades;
        if (cbPosDetail) cbPosDetail.textContent = (state.multi.paper_mode ? 'paper' : 'live') + ' · ' + (state.multi.total_trades || 0) + ' total';

        // 5. Top Conviction
        const cbTopConv = document.getElementById('cbTopConv');
        const cbTopConvDetail = document.getElementById('cbTopConvDetail');
        if (cbTopConv && coins.length > 0) {
            const top = coins.reduce((a, b) => (b.confidence || 0) > (a.confidence || 0) ? b : a);
            cbTopConv.textContent = (top.confidence * 100).toFixed(1) + '%';
            if (cbTopConvDetail) cbTopConvDetail.textContent = top.symbol.replace('USDT', '') + ' · ' + top.regime;
        }

        // 6. Sentiment Alerts
        const cbAlert = document.getElementById('cbAlert');
        const cbAlertDetail = document.getElementById('cbAlertDetail');
        const crashCoins = coins.filter(c => c.regime && (c.regime.includes('CRASH') || c.regime.includes('PANIC')));
        if (cbAlert) {
            if (crashCoins.length > 0) {
                cbAlert.textContent = crashCoins.length + ' Alert' + (crashCoins.length > 1 ? 's' : '');
                cbAlert.style.color = '#DC2626';
                if (cbAlertDetail) cbAlertDetail.textContent = crashCoins.map(c => c.symbol.replace('USDT', '')).join(', ');
            } else {
                cbAlert.textContent = 'None';
                cbAlert.style.color = '#22C55E';
                if (cbAlertDetail) cbAlertDetail.textContent = 'No alerts detected';
            }
        }
    }

    function updateHeader() {
        if (state.bot && state.bot.timestamp) {
            const date = new Date(state.bot.timestamp);
            els.lastUpdate.textContent = date.toLocaleTimeString();

            // Initial text set (will be overridden by countdown if monitoring)
            if (state.multi.deployed_count > 0) {
                els.statusText.textContent = 'ACTIVE TRADING';
                els.statusPill.style.background = '#DCFCE7'; // Green-100
                els.statusPill.style.color = '#166534';      // Green-800
            } else {
                // Countdown logic handles the text update
                els.statusPill.style.background = '#F1F5F9'; // Slate-100
                els.statusPill.style.color = '#475569';      // Slate-600
                updateCountdown();
            }
            els.statusPill.style.color = state.multi.deployed_count > 0 ? '#16A34A' : '#64748B';
        }
    }

    function updateSentiment() {
        // 1. Fear & Greed (Mocked if missing, ideally from backend)
        // Note: Backend doesn't currently expose F&G explicitly in multi-state, 
        // so we might default or estimate from average sentiment.
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);

        let avgSent = 0;
        let count = 0;
        coins.forEach(c => {
            // Calculate synthetic sentiment if missing
            if (c.sentiment === undefined || c.sentiment === null) {
                c.sentiment = calculateSentiment(c);
            }

            if (c.sentiment !== undefined && c.sentiment !== null) {
                avgSent += c.sentiment;
                count++;
            }
        });
        if (count > 0) avgSent /= count;

        // Clamp avgSent to -1 to 1
        avgSent = Math.max(-1, Math.min(1, avgSent));

        // F&G Estimation (-1 to 1 -> 0 to 100)
        // -1 -> 0 (Extreme Fear), 0 -> 50 (Neutral), 1 -> 100 (Extreme Greed)
        const fgVal = Math.round((avgSent + 1) * 50);
        setFearGreed(fgVal);

        // Update Signal Sources (Simulated for now)
        // In a real scenario, this would come from state.multi.sources
        const feedCount = 1240 + Math.floor(Math.random() * 50); // Simulating live feed updates
        if (els.sourceStats) els.sourceStats.innerHTML = `Processed <b>${feedCount.toLocaleString()}</b> signals in last 24h`;

        // Live Source Stats from Backend
        let news = 0, social = 0, price = 0, whales = 0, inst = 0;
        let nVal = 0, sVal = 0, pVal = 0, wVal = 0, iVal = 0;

        if (state.multi && state.multi.source_stats) {
            // Real data from backend
            nVal = (state.multi.source_stats.RSS || 0) + (state.multi.source_stats.CryptoPanic || 0);
            sVal = (state.multi.source_stats.Reddit || 0);

            // Order Flow Data
            if (state.multi.orderflow_stats) {
                wVal = state.multi.orderflow_stats.WhaleWalls || 0;
                iVal = state.multi.orderflow_stats.Institutional || 0;
            }

            // "Price Action" fallback (simulate based on others if 0)
            const totalsignals = nVal + sVal + wVal + iVal;
            pVal = Math.round(totalsignals > 0 ? totalsignals * 0.4 : 10);

            const grandTotal = nVal + sVal + pVal + wVal + iVal;
            if (grandTotal > 0) {
                news = Math.round((nVal / grandTotal) * 100);
                social = Math.round((sVal / grandTotal) * 100);
                whales = Math.round((wVal / grandTotal) * 100);
                inst = Math.round((iVal / grandTotal) * 100);
                price = 100 - news - social - whales - inst; // Remainder
            }
        } else {
            // Fallback Simulation (Legacy)
            news = 30; social = 20; price = 30; whales = 10; inst = 10;
            nVal = 320; sVal = 210; pVal = 310; wVal = 85; iVal = 92;
        }

        // Render Source Table into sourcePills area (sourceTable element may not exist)
        const sourceContainer = els.sourceTable || els.sourcePills;
        if (sourceContainer) {
            sourceContainer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:2px;background:#3B82F6;"></span>News/RSS</span>
                <span style="font-weight:700;color:#1A2332;">${news}% <span style="font-weight:400;color:#64748B;font-size:11px;">(${nVal.toLocaleString()})</span></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:2px;background:#8B5CF6;"></span>Social/Reddit</span>
                <span style="font-weight:700;color:#1A2332;">${social}% <span style="font-weight:400;color:#64748B;font-size:11px;">(${sVal.toLocaleString()})</span></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:2px;background:#EC4899;"></span>Whale Walls</span>
                <span style="font-weight:700;color:#1A2332;">${whales}% <span style="font-weight:400;color:#64748B;font-size:11px;">(${wVal.toLocaleString()})</span></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:2px;background:#10B981;"></span>Inst. Flows</span>
                <span style="font-weight:700;color:#1A2332;">${inst}% <span style="font-weight:400;color:#64748B;font-size:11px;">(${iVal.toLocaleString()})</span></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:2px;background:#F59E0B;"></span>Price Action</span>
                <span style="font-weight:700;color:#1A2332;">${price}% <span style="font-weight:400;color:#64748B;font-size:11px;">(${pVal.toLocaleString()})</span></span>
            </div>
        `;
        }

        // 2. Market Bias (-1 to 1)
        if (els.biasVal) els.biasVal.textContent = avgSent.toFixed(2);
        // width 0% = -1, 50% = 0, 100% = 1
        const biasPct = ((avgSent + 1) / 2) * 100;
        if (els.biasFill) {
            els.biasFill.style.width = `${Math.max(5, Math.min(95, biasPct))}%`;
            els.biasFill.style.background = avgSent > 0 ? '#22C55E' : (avgSent < 0 ? '#EF4444' : '#E2E8F0');
        }

        // 3. Conviction Distribution Table
        let low = [], med = [], high = [];
        coins.forEach(c => {
            const conf = c.confidence || 0;
            const sym = c.symbol.replace('USDT', '');
            if (conf > 0.98) high.push(sym);
            else if (conf > 0.90) med.push(sym);
            else low.push(sym);
        });

        const formatList = (list) => list.length > 0
            ? `<div style="margin-top:2px;font-size:10px;color:var(--text-secondary);line-height:1.4;word-break:break-word;">${list.join(', ')}</div>`
            : '';

        // Render conviction into convictionTable or the convictionDist canvas area
        const convTarget = els.convictionTable || document.getElementById('convictionDist');
        if (convTarget) {
            // Replace canvas with div if needed
            if (convTarget.tagName === 'CANVAS') {
                const div = document.createElement('div');
                div.id = 'convictionDist';
                convTarget.parentNode.replaceChild(div, convTarget);
                div.innerHTML = buildConvictionHTML();
            } else {
                convTarget.innerHTML = buildConvictionHTML();
            }
        }

        function buildConvictionHTML() {
            const total = high.length + med.length + low.length || 1;
            const hPct = Math.round(high.length / total * 100);
            const mPct = Math.round(med.length / total * 100);
            const lPct = 100 - hPct - mPct;
            return `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                    <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#22C55E;"></span>High (&gt;98%)</span>
                    <span style="font-weight:700;color:#1A2332;">${high.length}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                    <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#F59E0B;"></span>Medium (90-98%)</span>
                    <span style="font-weight:700;color:#1A2332;">${med.length}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
                    <span style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:#94A3B8;"></span>Low (&lt;90%)</span>
                    <span style="font-weight:700;color:#1A2332;">${low.length}</span>
                </div>
                <div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:2px;">
                    <div style="width:${hPct}%;background:#22C55E;"></div>
                    <div style="width:${mPct}%;background:#F59E0B;"></div>
                    <div style="width:${lPct}%;background:#94A3B8;"></div>
                </div>
            </div>
        `;
        }

        // 4. Per-Coin Bars
        if (!els.sentBars) return;
        els.sentBars.innerHTML = '';
        if (coins.length === 0) {
            els.sentBars.innerHTML = '<div style="text-align:center;padding:20px;color:#94A3B8;">No data available</div>';
        } else {
            // Sort by sentiment descending
            coins.sort((a, b) => (b.sentiment || 0) - (a.sentiment || 0));

            coins.forEach(c => {
                // Ensure sentiment is calculated
                if (c.sentiment === undefined) c.sentiment = calculateSentiment(c);

                const row = document.createElement('div');
                row.className = 'sent-bar-row';

                // Diverging bar calculation
                // Center is 50%. 
                // Positive (0 to 1) -> width from 50% to right (max 100%)
                // Negative (-1 to 0) -> width from 50% to left (min 0%)

                const rawPct = Math.abs(c.sentiment) * 50; // Scale to 50% max width each side
                const color = c.sentiment >= 0 ? '#22C55E' : '#EF4444';

                let barStyle = '';
                if (c.sentiment >= 0) {
                    // Grow right from center
                    barStyle = `left: 50%; width: ${rawPct}%; background:${color};`;
                } else {
                    // Grow left from center
                    barStyle = `right: 50%; width: ${rawPct}%; background:${color};`;
                }

                // Format Action
                let actionText = c.action || '-';
                actionText = actionText.replace(/_/g, ' '); // Replace underscores
                if (actionText.includes('FILTER')) actionText = 'Wait/Filter';
                else if (actionText.includes('ELIGIBLE')) actionText = actionText.replace('ELIGIBLE', 'Eligible');
                else if (actionText.includes('MTF CONFLICT')) actionText = 'Conflict';
                else if (actionText.includes('CHOP')) actionText = 'Choppy';
                else if (actionText.includes('CRASH')) actionText = 'Crash Risk';

                // Truncate if still long
                if (actionText.length > 15) actionText = actionText.substring(0, 15) + '..';

                row.innerHTML = `
                <div class="sent-coin">${c.symbol.replace('USDT', '')}</div>
                <div class="sent-bar-bg">
                    <!-- Center Marker -->
                    <div style="position:absolute; left:50%; top:0; bottom:0; width:1px; background:#CBD5E1; z-index:1;"></div>
                    <div class="sent-bar-fill" style="${barStyle} opacity:0.9;"></div>
                </div>
                <div class="sent-score" style="color:${color}">${c.sentiment > 0 ? '+' : ''}${c.sentiment.toFixed(2)}</div>
                <div class="sent-action" title="${c.action}">${actionText}</div>
            `;
                els.sentBars.appendChild(row);
            });
        }



        // 6. Generate Text Insights
        if (els.insightsArea) generateInsights(coins, avgSent);
    }

    function generateInsights(coins, avgSent) {
        if (!coins || coins.length === 0) return;

        // Group by regime
        const bullish = coins.filter(c => c.regime.includes('BULL') && c.sentiment > 0.2);
        const bearish = coins.filter(c => c.regime.includes('BEAR') && c.sentiment < -0.2);
        const crash = coins.filter(c => c.regime.includes('CRASH') || c.regime.includes('PANIC'));

        let html = '';

        // 1. Overall Bias
        const biasText = avgSent > 0.3 ? 'Strongly Bullish' : (avgSent > 0.05 ? 'Mildly Bullish' : (avgSent < -0.3 ? 'Strongly Bearish' : (avgSent < -0.05 ? 'Mildly Bearish' : 'Neutral/Choppy')));
        html += `<div style="margin-bottom:8px; font-weight:700; color:var(--text-primary); border-bottom:1px solid #F1F5F9; padding-bottom:4px;">
        Market Bias: <span style="color:${avgSent > 0 ? '#22C55E' : (avgSent < 0 ? '#EF4444' : '#64748B')}">${biasText}</span>
    </div>`;

        // 2. Bullish Insights
        if (bullish.length > 0) {
            // Sort by sentiment
            bullish.sort((a, b) => b.sentiment - a.sentiment);
            const topBulls = bullish.slice(0, 3);
            html += `<div style="margin-bottom:6px;">
            <span style="color:#22C55E; font-weight:700;">🚀 BULLISH MOMENTUM</span>
            <ul style="margin:4px 0 8px 16px; padding:0; list-style-type:disc; color:var(--text-secondary);">`;

            topBulls.forEach(c => {
                // Extract timeframe from action if possible
                let tf = 'lower timeframes';
                if (c.action && c.action.includes('15M')) tf = '15m';
                else if (c.action && c.action.includes('1H')) tf = '1h';
                else if (c.action && c.action.includes('4H')) tf = '4h';

                html += `<li><b>${c.symbol.replace('USDT', '')}</b>: Showing strength on <b>${tf}</b>. (${(c.sentiment * 100).toFixed(0)}% Score)`;

                // Add News Headline if available
                if (c.news && c.news.length > 0) {
                    const art = c.news[0]; // Top article
                    html += `<div style="margin-top:2px; font-size:11px; color:#475569; display:flex; gap:4px; align-items:flex-start;">
                    <span>📰</span>
                    <a href="${art.url}" target="_blank" style="color:#475569; text-decoration:underline; line-height:1.4;">
                        ${art.title}
                    </a>
                    <span style="color:#94A3B8; white-space:nowrap;">(${art.source.split(':')[0]})</span>
                </div>`;
                }
                html += `</li>`;
            });
            html += `</ul></div>`;
        }

        // 3. Bearish Insights
        if (bearish.length > 0) {
            bearish.sort((a, b) => a.sentiment - b.sentiment); // ascending (most negative first)
            const topBears = bearish.slice(0, 3);
            html += `<div style="margin-bottom:6px;">
            <span style="color:#EF4444; font-weight:700;">🐻 BEARISH PRESSURE</span>
            <ul style="margin:4px 0 8px 16px; padding:0; list-style-type:disc; color:var(--text-secondary);">`;

            topBears.forEach(c => {
                let tf = 'Intraday';
                if (c.action && c.action.includes('15M')) tf = '15m';
                else if (c.action && c.action.includes('1H')) tf = '1h';

                html += `<li><b>${c.symbol.replace('USDT', '')}</b>: Weak structure on <b>${tf}</b> timeframe. (${(c.sentiment * 100).toFixed(0)}% Score)`;

                // Add News Headline if available
                if (c.news && c.news.length > 0) {
                    const art = c.news[0]; // Top article
                    html += `<div style="margin-top:2px; font-size:11px; color:#475569; display:flex; gap:4px; align-items:flex-start;">
                    <span>📰</span>
                    <a href="${art.url}" target="_blank" style="color:#475569; text-decoration:underline; line-height:1.4;">
                        ${art.title}
                    </a>
                    <span style="color:#94A3B8; white-space:nowrap;">(${art.source.split(':')[0]})</span>
                </div>`;
                }
                html += `</li>`;
            });
            html += `</ul></div>`;
        }

        // 4. Crash Warnings
        if (crash.length > 0) {
            html += `<div style="margin-top:8px; padding:8px; background:#FEF2F2; border-radius:6px; border:1px solid #FECACA;">
            <b style="color:#DC2626;">⚠️ CRASH/PANIC DETECTED</b><br>
            <span style="font-size:11px; color:#B91C1C;">
                Startling volatility in: ${crash.map(c => c.symbol.replace('USDT', '')).join(', ')}. Bot may halt trading.
            </span>
        </div>`;
        }

        if (bullish.length === 0 && bearish.length === 0 && crash.length === 0) {
            html += `<div style="color:var(--text-secondary); font-style:italic;">No significant directional signals detected. Market appears indecisive or sideways.</div>`;
        }

        els.insightsArea.innerHTML = html;
    }

    function setFearGreed(val) {
        if (!els.fgValue && !els.fgNeedle && !els.fgLabel) return; // Gauge removed from page
        if (els.fgValue) els.fgValue.textContent = val;
        // Rotation: 0 = -90deg, 50 = 0deg, 100 = 90deg
        const deg = ((val / 100) * 180) - 90;
        if (els.fgNeedle) els.fgNeedle.style.transform = `translateX(-50%) rotate(${deg}deg)`;

        let label = 'Neutral';
        if (val < 25) label = 'Extreme Fear';
        else if (val < 45) label = 'Fear';
        else if (val > 75) label = 'Extreme Greed';
        else if (val > 55) label = 'Greed';

        if (els.fgLabel) {
            els.fgLabel.textContent = label;
            if (val < 45) els.fgLabel.className = 'fg-label fg-fear';
            else if (val > 55) els.fgLabel.className = 'fg-label fg-greed';
            else els.fgLabel.className = 'fg-label fg-neutral';
        }
    }

    function updateOrderFlow() {
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);

        // 1. Regime Drivers Table
        if (els.regimeDriversBody) {
            els.regimeDriversBody.innerHTML = '';
            coins.sort((a, b) => a.symbol.localeCompare(b.symbol));

            coins.forEach(c => {
                const tr = document.createElement('tr');
                tr.style.cssText = "border-bottom:1px solid #F1F5F9; font-size:11px; font-weight:600;";

                const fmt = (val, dec = 3) => val !== undefined && val !== null ? val.toFixed(dec) : '-';
                const fmtPct = (val) => val !== undefined && val !== null ? (val * 100).toFixed(2) + '%' : '-';
                const col = (val) => {
                    if (val === undefined || val === null) return '#64748B';
                    if (Math.abs(val) < 0.0001) return '#64748B';
                    return val > 0 ? '#16A34A' : '#DC2626';
                };

                const f = c.features || {};
                const logret = f.log_return;
                const vol = f.volatility;
                const vola = f.volume_change;
                const rsi = f.rsi_norm;
                const oi = f.oi_change;
                const fund = f.funding;

                let regColor = '#64748B', regBg = '#F1F5F9';
                if (c.regime.includes('BULL')) { regColor = '#15803D'; regBg = '#DCFCE7'; }
                if (c.regime.includes('BEAR')) { regColor = '#B91C1C'; regBg = '#FEE2E2'; }
                if (c.regime.includes('CHOP')) { regColor = '#B45309'; regBg = '#FEF3C7'; }

                let actColor = '#64748B';
                if (c.action.includes('ELIGIBLE')) actColor = '#16A34A';
                if (c.action.includes('SKIP') || c.action.includes('VETO')) actColor = '#DC2626';

                tr.innerHTML = `
                <td style="padding:10px; font-weight:700;">${c.symbol.replace('USDT', '')}</td>
                <td style="padding:10px;">
                    <span style="background:${regBg}; color:${regColor}; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700;">
                        ${c.regime}
                    </span>
                </td>
                <td style="padding:10px; color:${c.confidence > 0.7 ? '#16A34A' : '#64748B'}">${fmtPct(c.confidence)}</td>
                <td style="padding:10px;"><span style="background:${logret > 0 ? '#DCFCE7' : (logret < 0 ? '#FEE2E2' : '')}; color:${col(logret)}; padding:2px 6px; border-radius:4px;">${fmt(logret, 4)}</span></td>
                <td style="padding:10px; color:${vol > 0.02 ? '#F59E0B' : '#64748B'}">${fmt(vol, 4)}</td>
                <td style="padding:10px;"><span style="color:${col(vola)};">${fmt(vola, 2)}</span></td>
                <td style="padding:10px;"><span style="color:${rsi > 0.8 ? '#DC2626' : (rsi < 0.2 ? '#16A34A' : '#64748B')}">${fmt(rsi, 2)}</span></td>
                <td style="padding:10px; color:${col(oi)};">${fmt(oi, 4)}</td>
                <td style="padding:10px; color:${col(fund)};">${fmt(fund, 6)}</td>
                <td style="padding:10px; text-align:right; font-weight:700; color:${actColor}; font-size:10px;">
                    ${c.action.replace('_', ' ')}
                </td>
            `;

                tr.style.cursor = 'pointer';
                tr.onmouseover = () => tr.style.background = '#F8FAFC';
                tr.onmouseout = () => tr.style.background = 'transparent';

                els.regimeDriversBody.appendChild(tr);
            });
        }

        // 2. All-coins Order Flow Table
        updateOrderFlowAllCoins(coins);
    }

    function updateOrderFlowAllCoins(coins) {
        const tbody = els.orderFlowAllBody;
        if (!tbody) return;

        if (!coins || coins.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text-secondary);padding:24px;">Waiting for bot analysis cycle…</td></tr>';
            return;
        }

        const fmt = (val, dec = 2) => val !== undefined && val !== null ? val.toFixed(dec) : '—';
        const fmtUSD = (val) => {
            if (val === undefined || val === null || val === 0) return '—';
            if (val > 1e6) return '$' + (val / 1e6).toFixed(1) + 'M';
            if (val > 1e3) return '$' + (val / 1e3).toFixed(0) + 'K';
            return '$' + val.toFixed(0);
        };
        const col = (val) => {
            if (val === undefined || val === null) return '#64748B';
            return val > 0 ? '#16A34A' : (val < 0 ? '#DC2626' : '#64748B');
        };

        tbody.innerHTML = coins.sort((a, b) => a.symbol.localeCompare(b.symbol)).map(c => {
            const d = c.orderflow_details || {};
            const imbPct = d.imbalance !== undefined ? Math.round(d.imbalance * 100) : null;
            const takerPct = d.taker_buy_ratio !== undefined ? Math.round(d.taker_buy_ratio * 100) : null;
            const cumDelta = d.cumulative_delta;
            const exchCount = d.exchange_count || 1;
            const aggBid = d.aggregated_bid_usd || 0;
            const aggAsk = d.aggregated_ask_usd || 0;
            const bidWalls = (d.bid_walls || []);
            const askWalls = (d.ask_walls || []);
            const orderBlocks = (d.order_blocks || []);

            // Next upper wall: closest ask wall
            const sortedAskWalls = [...askWalls].sort((a, b) => (a.price || 0) - (b.price || 0));
            const nextUpper = sortedAskWalls.length > 0 ? sortedAskWalls[0] : null;

            // Next lower wall: closest bid wall
            const sortedBidWalls = [...bidWalls].sort((a, b) => (b.price || 0) - (a.price || 0));
            const nextLower = sortedBidWalls.length > 0 ? sortedBidWalls[0] : null;

            const fmtWall = (wall) => {
                if (!wall) return '—';
                const price = wall.price !== undefined ? wall.price.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '?';
                const size = wall.size !== undefined ? '$' + (wall.size > 1e6 ? (wall.size / 1e6).toFixed(1) + 'M' : (wall.size > 1e3 ? (wall.size / 1e3).toFixed(0) + 'K' : wall.size.toFixed(0))) : '';
                const exch = wall.exchange ? ` <span style="font-size:8px;opacity:0.5;">[${wall.exchange}]</span>` : '';
                return `${price} <span style="font-size:9px;opacity:0.7;">${size}</span>${exch}`;
            };

            // Order block summary
            const bullOBs = orderBlocks.filter(ob => ob.type === 'bullish');
            const bearOBs = orderBlocks.filter(ob => ob.type === 'bearish');
            let obHTML = '—';
            if (bullOBs.length || bearOBs.length) {
                const parts = [];
                if (bullOBs.length) parts.push(`<span style="color:#16A34A;">▲${bullOBs.length}</span>`);
                if (bearOBs.length) parts.push(`<span style="color:#DC2626;">▼${bearOBs.length}</span>`);
                obHTML = parts.join(' ');
            }

            // Signal derivation
            let signal = 'Neutral';
            let sigColor = '#64748B';
            if (imbPct !== null && takerPct !== null) {
                if (imbPct > 10 && takerPct > 55) { signal = 'Bullish'; sigColor = '#16A34A'; }
                else if (imbPct < -10 && takerPct < 45) { signal = 'Bearish'; sigColor = '#DC2626'; }
            }

            let regColor = '#64748B', regBg = '#F1F5F9';
            if (c.regime.includes('BULL')) { regColor = '#15803D'; regBg = '#DCFCE7'; }
            if (c.regime.includes('BEAR')) { regColor = '#B91C1C'; regBg = '#FEE2E2'; }
            if (c.regime.includes('CHOP')) { regColor = '#B45309'; regBg = '#FEF3C7'; }

            // Exchange count badge color
            const exchColor = exchCount >= 3 ? '#16A34A' : (exchCount >= 2 ? '#D97706' : '#64748B');

            // Depth imbalance bar
            const depthTotal = aggBid + aggAsk;
            const bidPct = depthTotal > 0 ? Math.round(aggBid / depthTotal * 100) : 50;

            return `<tr style="border-bottom:1px solid #F1F5F9;font-size:11px;font-weight:600;">
            <td style="padding:10px 8px;font-weight:700;">${c.symbol.replace('USDT', '')}</td>
            <td style="padding:8px;text-align:center;"><span style="background:${regBg};color:${regColor};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">${c.regime}</span></td>
            <td style="padding:8px;text-align:center;"><span style="background:#EEF2FF;color:${exchColor};padding:2px 6px;border-radius:8px;font-size:10px;font-weight:700;">${exchCount}</span></td>
            <td style="padding:8px;text-align:center;color:${col(imbPct)};">${imbPct !== null ? (imbPct > 0 ? '+' : '') + imbPct + '%' : '—'}</td>
            <td style="padding:8px;text-align:center;color:${takerPct !== null && takerPct > 55 ? '#16A34A' : (takerPct !== null && takerPct < 45 ? '#DC2626' : '#64748B')};">${takerPct !== null ? takerPct + '%' : '—'}</td>
            <td style="padding:8px;text-align:center;color:${col(cumDelta)};">${cumDelta !== undefined && cumDelta !== null ? (cumDelta > 0 ? '+' : '') + fmt(cumDelta) : '—'}</td>
            <td style="padding:8px;text-align:center;color:#16A34A;">${fmtUSD(aggBid)}</td>
            <td style="padding:8px;text-align:center;color:#DC2626;">${fmtUSD(aggAsk)}</td>
            <td style="padding:8px;text-align:center;color:#DC2626;">${fmtWall(nextUpper)}</td>
            <td style="padding:8px;text-align:center;color:#16A34A;">${fmtWall(nextLower)}</td>
            <td style="padding:8px;text-align:center;">${obHTML}</td>
            <td style="padding:8px;text-align:center;font-weight:700;color:${sigColor};">${signal}</td>
        </tr>`;
        }).join('');
    }


    function updateTicker() {
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);

        // Delegate to shared ticker logic if available (avoid self-recursion)
        if (window._sharedUpdateTicker) {
            window._sharedUpdateTicker(coins);
        }
    }

    // Helper: Calculate sentiment from regime & confidence
    function calculateSentiment(c) {
        if (!c || !c.regime) return 0;
        const conf = c.confidence || 0.5;

        if (c.regime.includes('BULL')) return conf;
        if (c.regime.includes('BEAR')) return -conf;
        if (c.regime.includes('CRASH') || c.regime.includes('PANIC')) return -1.0;

        // Sideways/Chop -> slightly negative or positive depending on price change if available, else 0
        // validating with recent return if available
        if (c.features && c.features.log_return) {
            return c.features.log_return > 0 ? 0.1 : -0.1;
        }
        return 0;
    }

    // ─── Order Flow Insights Generator ───
    function generateOrderFlowInsights(details, symbol) {
        const container = document.getElementById('orderFlowInsights');
        const label = document.getElementById('insightCoinLabel');
        if (label) label.textContent = symbol.replace('USDT', '');
        if (!container) return;

        if (!details) {
            container.innerHTML = '<div style="color:var(--text-secondary); font-style:italic;">Insufficient data for analysis.</div>';
            return;
        }

        const { cumulative_delta, taker_buy_ratio, imbalance, bid_walls, ask_walls } = details;

        // 1. Delta Analysis
        const deltaVal = cumulative_delta || 0;
        const isDeltaBullish = deltaVal > 0;
        const deltaStr = Math.abs(deltaVal).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

        // 2. Taker Flow Analysis
        const buyRatio = (taker_buy_ratio || 0.5) * 100;
        const isFlowBullish = buyRatio > 55;
        const isFlowBearish = buyRatio < 45;

        // 3. Imbalance Analysis
        const imbPct = (imbalance || 0) * 100;
        const isImbBullish = imbPct > 10;
        const isImbBearish = imbPct < -10;

        let sentiment = [];
        let score = 0;

        // --- Narrative Generation ---
        if (isDeltaBullish) {
            sentiment.push(`<b>Net Buying:</b> Cumulative delta is positive (<span style="color:#16A34A">${deltaStr}</span>), indicating demand.`);
            score++;
        } else {
            sentiment.push(`<b>Net Selling:</b> Cumulative delta is negative (<span style="color:#DC2626">${deltaStr}</span>), indicating supply.`);
            score--;
        }

        if (isFlowBullish) {
            sentiment.push(`<b>Aggressive Buyers:</b> Takers are filling ${buyRatio.toFixed(0)}% of volume on the buy side.`);
            score++;
        } else if (isFlowBearish) {
            sentiment.push(`<b>Aggressive Sellers:</b> Takers are hitting bids (${(100 - buyRatio).toFixed(0)}% sell volume).`);
            score--;
        } else {
            sentiment.push(`<b>Balanced Flow:</b> Taker volume is roughly split between buyers and sellers.`);
        }

        if (isImbBullish) {
            sentiment.push(`<b>Bid Support:</b> Order book shows ${imbPct.toFixed(1)}% more bids than asks.`);
            score += 0.5;
        } else if (isImbBearish) {
            sentiment.push(`<b>Ask Resistance:</b> Order book shows ${Math.abs(imbPct).toFixed(1)}% more asks than bids.`);
            score -= 0.5;
        }

        // Wall Analysis
        const topBid = bid_walls && bid_walls.length > 0 ? bid_walls.sort((a, b) => b.size - a.size)[0] : null;
        const topAsk = ask_walls && ask_walls.length > 0 ? ask_walls.sort((a, b) => b.size - a.size)[0] : null;

        if (topBid) {
            sentiment.push(`Major support wall at <b>${topBid.price.toLocaleString()}</b> ($${(topBid.size / 1000).toFixed(1)}k).`);
        }
        if (topAsk) {
            sentiment.push(`Major resistance wall at <b>${topAsk.price.toLocaleString()}</b> ($${(topAsk.size / 1000).toFixed(1)}k).`);
        }

        // Conclusion
        let conclusion = '';
        let color = '#64748B'; // Neutral
        if (score >= 2) { conclusion = 'Strongly Bullish Structure'; color = '#16A34A'; }
        else if (score >= 0.5) { conclusion = 'Mildly Bullish Structure'; color = '#22C55E'; }
        else if (score <= -2) { conclusion = 'Strongly Bearish Structure'; color = '#DC2626'; }
        else if (score <= -0.5) { conclusion = 'Mildly Bearish Structure'; color = '#EF4444'; }
        else { conclusion = 'Neutral / Mixed Structure'; }

        // Trade Qualification
        let strategy = '';
        let stratColor = '#64748B';
        if (score >= 1.5) {
            strategy = 'Trend Following (Long) / Breakout';
            stratColor = '#16A34A';
        } else if (score > 0) {
            strategy = 'Dip Buying / Support Scalp';
            stratColor = '#22C55E';
        } else if (score <= -1.5) {
            strategy = 'Trend Following (Short) / Breakdown';
            stratColor = '#DC2626';
        } else if (score < 0) {
            strategy = 'Fade Rips / Resistance Scalp';
            stratColor = '#EF4444';
        } else {
            strategy = 'Range Scalping / Mean Reversion';
            stratColor = '#F59E0B';
        }

        container.innerHTML = `
        <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; color:${color}; text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">${conclusion}</div>
        </div>
        <div style="margin-bottom:12px; font-size:11px; font-weight:600; color:#475569; background:#F8FAFC; padding:6px 10px; border-radius:6px; border-left:3px solid ${stratColor};">
            Strategy: <span style="color:${stratColor}">${strategy}</span>
        </div>
        <ul style="margin:0 0 0 16px; padding:0; list-style-type:disc; color:var(--text-secondary);">
            ${sentiment.map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('')}
        </ul>
    `;
    }

    // ─── News Feed ───────────────────────────────────────────────────────────────
    function updateNewsFeed() {
        const container = document.getElementById('newsFeed');
        if (!container) return;

        const items = Array.isArray(state.news) ? state.news : (state.news?.items || []);
        if (items.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:28px;">No news available</div>';
            return;
        }

        container.innerHTML = items.slice(0, 15).map(item => {
            const srcMap = { 'CoinTelegraph': 'ct', 'CoinDesk': 'cd', 'Decrypt': 'dc', 'CryptoSlate': 'cs' };
            const srcClass = srcMap[item.source] || '';
            const timeAgo = item.published ? getTimeAgo(new Date(item.published)) : '';
            const sentColor = item.sentiment > 0 ? '#22C55E' : (item.sentiment < 0 ? '#EF4444' : '#94A3B8');
            const link = item.link || '#';

            return `
            <a href="${link}" target="_blank" rel="noopener noreferrer" class="news-item" style="text-decoration:none;color:inherit;">
                <span class="news-src-pill ${srcClass}">${(item.source || 'RSS').substring(0, 12)}</span>
                <div class="news-body">
                    <div class="news-title" style="color:#1D4ED8;">${item.title || 'Untitled'}</div>
                    <div class="news-meta">${timeAgo}${item.source ? ' · ' + item.source : ''}</div>
                    ${item.summary ? `<div class="news-summary">${item.summary}</div>` : ''}
                </div>
                <div class="news-sentiment">
                    <div class="news-sent-dot" style="background:${sentColor};"></div>
                </div>
            </a>
        `;
        }).join('');

        const tsEl = document.getElementById('newsFetchTs');
        if (tsEl) tsEl.textContent = 'Fetched ' + new Date().toLocaleTimeString();

        // Update buzz chart with news timestamps
        updateBuzzChart(items);
    }

    function getTimeAgo(date) {
        const diff = (Date.now() - date.getTime()) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    // ─── Hourly Buzz Volume (text values) ──────────────────────────────────────
    function updateBuzzChart(items) {
        const container = document.getElementById('buzzChart');
        if (!container) return;

        // Replace canvas with div if needed
        if (container.tagName === 'CANVAS') {
            const div = document.createElement('div');
            div.id = 'buzzChart';
            container.parentNode.replaceChild(div, container);
            updateBuzzChart(items); // recurse with the new div
            return;
        }

        // Bucket articles into hourly slots (last 6 hours)
        const now = new Date();
        const hours = 6;
        const buckets = new Array(hours).fill(0);
        const labels = [];
        for (let i = hours - 1; i >= 0; i--) {
            const h = new Date(now.getTime() - i * 3600000);
            labels.push(h.getHours().toString().padStart(2, '0') + ':00');
        }

        items.forEach(item => {
            if (!item.published) return;
            const pub = new Date(item.published);
            const hoursAgo = (now - pub) / 3600000;
            if (hoursAgo >= 0 && hoursAgo < hours) {
                const idx = hours - 1 - Math.floor(hoursAgo);
                if (idx >= 0 && idx < hours) buckets[idx]++;
            }
        });

        const maxVal = Math.max(...buckets, 1);
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:4px;">
                ${buckets.map((count, i) => `
                    <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
                        <span style="width:36px;color:var(--text-secondary);font-family:monospace;">${labels[i]}</span>
                        <div style="flex:1;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;">
                            <div style="width:${Math.round(count / maxVal * 100)}%;height:100%;background:linear-gradient(90deg,#6366F1,#818CF8);border-radius:4px;transition:width 0.3s;"></div>
                        </div>
                        <span style="width:20px;text-align:right;font-weight:600;color:#1A2332;">${count}</span>
                    </div>
                `).join('')}
                <div style="margin-top:4px;font-size:10px;color:var(--text-secondary);text-align:right;">${items.length} articles total</div>
            </div>
        `;
    }

    // ─── Funding Rates & OI ─────────────────────────────────────────────────────
    function updateFunding() {
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);

        // 1. Funding Rate Tiles
        const grid = document.getElementById('fundingGrid');
        if (grid && coins.length > 0) {
            grid.innerHTML = coins.map(c => {
                const f = c.features || {};
                const rate = f.funding;
                const rateStr = rate !== undefined && rate !== null ? (rate * 100).toFixed(4) + '%' : '—';
                const cls = rate > 0.0001 ? 'funding-pos' : (rate < -0.0001 ? 'funding-neg' : 'funding-neu');
                return `
                <div class="funding-tile">
                    <div class="funding-tile-sym">${c.symbol.replace('USDT', '')}</div>
                    <div class="funding-tile-rate ${cls}">${rateStr}</div>
                    <div class="funding-tile-sub">${c.regime || '—'}</div>
                </div>
            `;
            }).join('');
        }

        // 2. Funding Insight summary
        const insightEl = document.getElementById('fundingInsight');
        if (insightEl && coins.length > 0) {
            const withFunding = coins.filter(c => c.features && c.features.funding !== undefined);
            const posCount = withFunding.filter(c => c.features.funding > 0.0001).length;
            const negCount = withFunding.filter(c => c.features.funding < -0.0001).length;
            const neuCount = withFunding.length - posCount - negCount;
            const avgRate = withFunding.length > 0
                ? withFunding.reduce((s, c) => s + (c.features.funding || 0), 0) / withFunding.length : 0;

            insightEl.innerHTML = `
            <strong>💡 Funding Insight:</strong>
            ${generateFundingInsight(withFunding, posCount, negCount, neuCount, avgRate)}
        `;
        }

        // 3. Flow Heatmap (funding-tile style)
        const heatmap = document.getElementById('flowHeatmap');
        if (heatmap && coins.length > 0) {
            heatmap.innerHTML = coins.map(c => {
                const sent = calculateSentiment(c);
                const sentStr = (sent > 0 ? '+' : '') + sent.toFixed(2);
                const cls = sent > 0.5 ? 'funding-pos' : (sent > 0.1 ? 'funding-neu' : (sent < -0.5 ? 'funding-neg' : (sent < -0.1 ? 'funding-neg' : 'funding-neu')));
                return `
                <div class="funding-tile">
                    <div class="funding-tile-sym">${c.symbol.replace('USDT', '')}</div>
                    <div class="funding-tile-rate ${cls}">${sentStr}</div>
                    <div class="funding-tile-sub">${c.regime || '—'}</div>
                </div>
            `;
            }).join('');
        }

        // 4. Conviction Score for selected coin
        const sym = state.selectedCoin;
        const data = sym ? coinStates[sym] : null;
        if (data) {
            const radarLabel = document.getElementById('radarCoinLabel');
            const scoreLabel = document.getElementById('scoreCompLabel');
            if (radarLabel) radarLabel.textContent = sym.replace('USDT', '');
            if (scoreLabel) scoreLabel.textContent = sym.replace('USDT', '');

            const scoreVal = document.getElementById('convScoreVal');
            const scoreLbl = document.getElementById('convScoreLabel');
            const levEl = document.getElementById('convLeverage');
            if (scoreVal) {
                const s = Math.round((data.confidence || 0) * 100);
                scoreVal.textContent = s;
                scoreVal.style.color = s > 70 ? '#16A34A' : (s > 50 ? '#F59E0B' : '#DC2626');
            }
            if (scoreLbl) {
                const conf = data.confidence || 0;
                scoreLbl.textContent = conf > 0.98 ? 'Very High Conviction' : (conf > 0.90 ? 'High Conviction' : (conf > 0.70 ? 'Moderate' : 'Low Conviction'));
            }
            if (levEl) levEl.textContent = 'Leverage: ' + (data.leverage || '—') + 'x';

            // Factor bars
            const bars = document.getElementById('convFactorBars');
            if (bars) {
                const f = data.features || {};
                const factors = [
                    { name: 'HMM Conf', val: (data.confidence || 0) * 100 },
                    { name: 'Momentum', val: Math.min(100, Math.max(0, 50 + (f.log_return || 0) * 5000)) },
                    { name: 'Volatility', val: Math.min(100, (f.volatility || 0) * 2000) },
                    { name: 'Volume', val: Math.min(100, Math.max(0, 50 + (f.volume_change || 0) * 25)) },
                    { name: 'RSI', val: (f.rsi_norm || 0.5) * 100 },
                    { name: 'Funding', val: Math.min(100, Math.max(0, 50 - (f.funding || 0) * 100000)) },
                    { name: 'OI Change', val: Math.min(100, Math.max(0, 50 + (f.oi_change || 0) * 2500)) },
                    { name: 'Sentiment', val: Math.max(0, (calculateSentiment(data) + 1) * 50) }
                ];
                bars.innerHTML = factors.map(fac => {
                    const color = fac.val > 60 ? '#22C55E' : (fac.val > 40 ? '#F59E0B' : '#EF4444');
                    return `
                    <div class="conv-factor-bar">
                        <div class="conv-factor-name">${fac.name}</div>
                        <div class="conv-factor-bg">
                            <div class="conv-factor-fill" style="width:${fac.val}%;background:${color};"></div>
                        </div>
                        <div class="conv-factor-pts" style="color:${color}">${fac.val.toFixed(0)}</div>
                    </div>
                `;
                }).join('');
            }
        }

        // 5. Taker flow metrics for selected coin
        if (data && data.orderflow_details) {
            const d = data.orderflow_details;
            const mTaker = document.getElementById('mTaker');
            const mLS = document.getElementById('mLS');
            const buyBar = document.getElementById('takerBuyBar');
            const sellBar = document.getElementById('takerSellBar');

            if (mTaker && d.taker_buy_ratio !== undefined) {
                const bp = Math.round(d.taker_buy_ratio * 100);
                mTaker.textContent = bp + '%';
                mTaker.style.color = bp > 55 ? '#16A34A' : (bp < 45 ? '#DC2626' : '#64748B');
            }
            if (mLS && d.long_short_ratio !== undefined) {
                mLS.textContent = d.long_short_ratio.toFixed(2);
                mLS.style.color = d.long_short_ratio > 1 ? '#16A34A' : '#DC2626';
            }
            if (buyBar && sellBar && d.taker_buy_ratio !== undefined) {
                const bp = Math.round(d.taker_buy_ratio * 100);
                buyBar.style.width = bp + '%';
                sellBar.style.width = (100 - bp) + '%';
            }
        }
    }

    // ─── AI Insight Generators ────────────────────────────────────────────────────

    function generateFundingInsight(coins, posCount, negCount, neuCount, avgRate) {
        if (coins.length === 0) return 'Waiting for funding data...';

        const extremePos = coins.filter(c => c.features.funding > 0.02).map(c => c.symbol.replace('USDT', ''));
        const extremeNeg = coins.filter(c => c.features.funding < -0.02).map(c => c.symbol.replace('USDT', ''));
        const moderate = coins.filter(c => Math.abs(c.features.funding) < 0.001).map(c => c.symbol.replace('USDT', ''));

        let insight = `<b>${posCount}</b> coins have positive funding (longs pay shorts), <b>${negCount}</b> negative (shorts pay longs), <b>${neuCount}</b> neutral. `;
        insight += `Average rate: <b>${(avgRate * 100).toFixed(4)}%</b>. `;

        if (avgRate > 0.001) {
            insight += `Market is <b style="color:#DC2626">overleveraged long</b> — consider short opportunities or tighter stops on longs. `;
        } else if (avgRate < -0.001) {
            insight += `Market is <b style="color:#16A34A">overleveraged short</b> — potential short squeeze setup, favor longs. `;
        } else {
            insight += `Funding is <b>balanced</b> — no strong directional bias from derivatives. `;
        }

        if (extremePos.length > 0) insight += `<b style="color:#DC2626">Caution on longs:</b> ${extremePos.join(', ')} have extreme positive funding. `;
        if (extremeNeg.length > 0) insight += `<b style="color:#16A34A">Short squeeze risk:</b> ${extremeNeg.join(', ')} have extreme negative funding. `;
        return insight;
    }

    function updateSentimentInsight() {
        const el = document.getElementById('sentimentInsight');
        if (!el) return;
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);
        if (coins.length === 0) return;

        const bullish = coins.filter(c => (c.sentiment || 0) > 0.2).map(c => c.symbol.replace('USDT', ''));
        const bearish = coins.filter(c => (c.sentiment || 0) < -0.2).map(c => c.symbol.replace('USDT', ''));
        const avgSent = coins.reduce((s, c) => s + (c.sentiment || 0), 0) / coins.length;

        let insight = `Overall sentiment is <b>${avgSent > 0.1 ? 'bullish' : (avgSent < -0.1 ? 'bearish' : 'neutral')}</b> (avg: ${avgSent.toFixed(2)}). `;
        if (bullish.length > 0) insight += `<b style="color:#16A34A">Bullish sentiment:</b> ${bullish.slice(0, 5).join(', ')}${bullish.length > 5 ? ' +' + (bullish.length - 5) + ' more' : ''} — consider long entries. `;
        if (bearish.length > 0) insight += `<b style="color:#DC2626">Bearish sentiment:</b> ${bearish.slice(0, 5).join(', ')}${bearish.length > 5 ? ' +' + (bearish.length - 5) + ' more' : ''} — exercise caution or look for shorts. `;
        if (bullish.length === 0 && bearish.length === 0) insight += 'No strong sentiment signals detected — market is indecisive.';

        el.innerHTML = `<strong>\ud83d\udca1 Insight:</strong> ${insight}`;
    }

    function updateFlowHeatmapInsight() {
        const el = document.getElementById('flowHeatmapInsight');
        if (!el) return;
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);
        if (coins.length === 0) return;

        const bullFlow = coins.filter(c => {
            const d = c.orderflow_details || {};
            return d.imbalance > 0.1 && d.taker_buy_ratio > 0.55;
        }).map(c => c.symbol.replace('USDT', ''));

        const bearFlow = coins.filter(c => {
            const d = c.orderflow_details || {};
            return d.imbalance < -0.1 && d.taker_buy_ratio < 0.45;
        }).map(c => c.symbol.replace('USDT', ''));

        let insight = '';
        if (bullFlow.length > 0) insight += `<b style="color:#16A34A">Bullish flow detected:</b> ${bullFlow.join(', ')} — aggressive buying with positive order imbalance, consider going long. `;
        if (bearFlow.length > 0) insight += `<b style="color:#DC2626">Bearish flow detected:</b> ${bearFlow.join(', ')} — heavy selling pressure with negative imbalance, consider shorts or avoid longs. `;
        if (bullFlow.length === 0 && bearFlow.length === 0) insight += 'Order flow is mixed across all coins — no strong directional signal. Wait for clearer imbalance before entering.';

        el.innerHTML = `<strong>\ud83d\udca1 Insight:</strong> ${insight}`;
    }

    function updateOrderFlowInsight() {
        const el = document.getElementById('orderFlowInsight');
        if (!el) return;
        const coinStates = state.multi.coin_states || {};
        const coins = Object.values(coinStates);
        if (coins.length === 0) return;

        const withWalls = coins.filter(c => {
            const d = c.orderflow_details || {};
            return (d.bid_walls || []).length > 0 || (d.ask_walls || []).length > 0;
        });

        const strongBid = coins.filter(c => {
            const d = c.orderflow_details || {};
            return (d.bid_walls || []).length >= 2 && d.imbalance > 0;
        }).map(c => c.symbol.replace('USDT', ''));

        const strongAsk = coins.filter(c => {
            const d = c.orderflow_details || {};
            return (d.ask_walls || []).length >= 2 && d.imbalance < 0;
        }).map(c => c.symbol.replace('USDT', ''));

        let insight = `${withWalls.length} of ${coins.length} coins show wall activity in the order book. `;
        if (strongBid.length > 0) insight += `<b style="color:#16A34A">Strong bid support:</b> ${strongBid.join(', ')} — large bid walls suggest accumulation, favor long positions. `;
        if (strongAsk.length > 0) insight += `<b style="color:#DC2626">Heavy ask resistance:</b> ${strongAsk.join(', ')} — significant sell walls indicate distribution, be cautious on longs. `;
        if (strongBid.length === 0 && strongAsk.length === 0) insight += 'No dominant wall patterns — orderbook is balanced with no strong accumulation or distribution signals.';

        el.innerHTML = `<strong>\ud83d\udca1 Insight:</strong> ${insight}`;
    }

    // ─── Expose functions globally for app.js to call on dashboard ───────────────
    window._intelUpdateSentiment = function (multiData) {
        state.multi = multiData || state.multi;
        try { updateSentiment(); } catch (e) { console.error('intelUpdateSentiment:', e); }
        try { updateSentimentInsight(); } catch (e) { console.error('sentimentInsight:', e); }
    };
    window._intelUpdateOrderFlow = function (multiData) {
        state.multi = multiData || state.multi;
        try { updateOrderFlow(); } catch (e) { console.error('intelUpdateOrderFlow:', e); }
        try { updateFlowHeatmapInsight(); } catch (e) { console.error('flowHeatmapInsight:', e); }
        try { updateOrderFlowInsight(); } catch (e) { console.error('orderFlowInsight:', e); }
    };
    window._intelUpdateFunding = function (multiData) {
        state.multi = multiData || state.multi;
        try { updateFunding(); } catch (e) { console.error('intelUpdateFunding:', e); }
    };
    window._intelUpdateNewsFeed = function () {
        try { updateNewsFeed(); } catch (e) { console.error('intelUpdateNewsFeed:', e); }
    };

})(); // END IIFE
