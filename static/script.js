const cardsContainer = document.getElementById('cardsContainer');
const targetDomainInput = document.getElementById('targetDomainInput');
const filterCardInput = document.getElementById('filterCardInput');
const runOsintBtn = document.getElementById('runOsintBtn');
const toast = document.getElementById('toast');
const activeTargetLabel = document.getElementById('activeTargetLabel');

const reconHud = document.getElementById('reconHud');
const hudStatusText = document.getElementById('hudStatusText');
const hudModuleCounter = document.getElementById('hudModuleCounter');
const progressBar = document.getElementById('progressBar');
const liveTerminalLog = document.getElementById('liveTerminalLog');

const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIcon = document.getElementById('soundIcon');
const clearAllBtn = document.getElementById('clearAllBtn');

const viewGridBtn = document.getElementById('viewGridBtn');
const viewGraphBtn = document.getElementById('viewGraphBtn');
const graphContainer = document.getElementById('graphContainer');
const graphCanvas = document.getElementById('graphCanvas');
const graphPopup = document.getElementById('graphPopup');
const graphNodeCount = document.getElementById('graphNodeCount');
const resetGraphBtn = document.getElementById('resetGraphBtn');

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

let soundEnabled = true;
let audioCtx = null;
let activeEventSource = null;
let liveCardsList = [];
let currentTargetDomain = '';
let currentModuleIndex = 0;
const TOTAL_MODULES = 16;
let activeViewMode = 'grid';

// --- INTERACTIVE CYBER GRAPH ENGINE ---
let graphCtx = null;
let graphNodes = [];
let graphLinks = [];
let graphParticles = [];
let graphAnimFrame = null;
let graphTransform = { x: 0, y: 0, scale: 1 };
let isPanning = false;
let startPan = { x: 0, y: 0 };
let draggedNode = null;
let hoveredNode = null;
let graphCanvasRect = { left: 0, top: 0, width: 800, height: 600 };

// --- AUDIO SYNTHESIZER ---
function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioCtx = new AudioContext();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playTone(freq, type, duration, gainLevel = 0.1) {
    if (!soundEnabled) return;
    try {
        initAudio();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(gainLevel, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
}

function soundCardArrive() {
    if (!soundEnabled) return;
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
    } catch (e) {}
}

function soundRadarBeep() {
    playTone(1400, 'sine', 0.08, 0.07);
}

function soundSuccess() {
    if (!soundEnabled) return;
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0.09, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.25);
        });
    } catch (e) {}
}

function soundWipePurge() {
    if (!soundEnabled) return;
    try {
        initAudio();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.28);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    } catch (e) {}
}

function showToast(msg) {
    if (!toast) return;
    toast.innerText = msg;
    toast.className = 'show';
    setTimeout(() => { toast.className = ''; }, 3000);
}

function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'matrix');
    if (graphCtx) renderGraphFrame();
}

function getThemeColors() {
    const style = getComputedStyle(document.body);
    return {
        accent: style.getPropertyValue('--accent').trim() || '#00ff66',
        cardBg: style.getPropertyValue('--card-bg').trim() || '#071509',
        secondary: style.getPropertyValue('--secondary').trim() || '#0d2810',
        cardBorder: style.getPropertyValue('--card-border').trim() || '#133a18',
        textColor: style.getPropertyValue('--text-color').trim() || '#79f78d',
        radarGlow: style.getPropertyValue('--radar-glow').trim() || 'rgba(0, 255, 102, 0.25)',
        success: style.getPropertyValue('--success').trim() || '#00ff66',
        warning: style.getPropertyValue('--warning').trim() || '#ccff00',
        danger: style.getPropertyValue('--danger').trim() || '#ff3344'
    };
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- CARD GENERATOR ROUTINES ---
function createCardElement(cardDef) {
    const div = document.createElement('div');
    div.className = 'osint-card';
    div.dataset.searchable = (cardDef.searchable || '').toLowerCase();
    div.dataset.title = (cardDef.title || '').toLowerCase();
    div.dataset.cardType = cardDef.cardType || '';
    div.dataset.target = cardDef.target || '';

    div.innerHTML = `
        <div class="osint-card-header">
            <h3><i class="fa-solid ${cardDef.icon}"></i> ${escapeHtml(cardDef.title)}</h3>
            <div class="card-header-actions">
                <span class="target-pill">${escapeHtml(cardDef.target)}</span>
                <button class="btn-card-recheck" title="Re-check this module for ${escapeHtml(cardDef.target)}">
                    <i class="fa-solid fa-magnifying-glass card-recheck-icon"></i>
                </button>
            </div>
        </div>
        <div class="osint-card-body">
            ${cardDef.html}
        </div>
    `;

    const recheckBtn = div.querySelector('.btn-card-recheck');
    if (recheckBtn) {
        recheckBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            recheckSingleCard(div, cardDef);
        });
    }

    return div;
}

async function recheckSingleCard(cardElement, cardDef) {
    const recheckBtn = cardElement.querySelector('.btn-card-recheck');
    const icon = cardElement.querySelector('.card-recheck-icon');
    if (recheckBtn && recheckBtn.disabled) return;

    if (recheckBtn) recheckBtn.disabled = true;
    if (icon) {
        icon.className = 'fa-solid fa-arrows-rotate card-recheck-icon fa-spin';
    }
    cardElement.classList.add('card-rechecking');
    soundRadarBeep();
    showToast(`Re-probing ${cardDef.title} for ${cardDef.target}...`);

    try {
        const res = await fetch('/api/osint/recheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: cardDef.target,
                card_type: cardDef.cardType
            })
        });

        const result = await res.json();
        if (result.success && result.data) {
            const updatedCardDef = convertCardEventToDef(result.cardType, result.username, result.data);
            if (updatedCardDef) {
                cardElement.dataset.searchable = (updatedCardDef.searchable || '').toLowerCase();
                const bodyEl = cardElement.querySelector('.osint-card-body');
                if (bodyEl) {
                    bodyEl.innerHTML = updatedCardDef.html;
                }
                const idx = liveCardsList.findIndex(c => c.title === cardDef.title && c.target === cardDef.target);
                if (idx !== -1) {
                    liveCardsList[idx] = updatedCardDef;
                }
                const node = graphNodes.find(n => n.id === cardDef.title);
                if (node) {
                    node.cardDef = updatedCardDef;
                }
                soundSuccess();
                showToast(`Updated ${updatedCardDef.title}!`);
            }
        } else {
            showToast(result.message || 'Re-check failed');
        }
    } catch (err) {
        console.error(err);
        showToast('Error re-probing card');
    } finally {
        if (recheckBtn) recheckBtn.disabled = false;
        if (icon) {
            icon.className = 'fa-solid fa-magnifying-glass card-recheck-icon';
        }
        cardElement.classList.remove('card-rechecking');
    }
}

function convertCardEventToDef(cardType, target, data) {
    let result = null;
    switch (cardType) {
        case 'tg_profile': {
            result = {
                title: 'Telegram Live Web Profile',
                icon: 'fa-paper-plane',
                target: target,
                searchable: `${target} ${data.title || ''} ${data.extra || ''} ${data.entity_type || ''} telegram profile`,
                html: `
                    <div class="profile-avatar-row">
                        <img src="${escapeHtml(data.photo_url)}" class="profile-avatar" alt="TG Photo" onerror="this.src='https://ui-avatars.com/api/?name=TG&background=0088cc&color=fff'">
                        <div class="profile-avatar-details">
                            <div class="intel-row"><span class="intel-label">Title / Name:</span><span class="intel-value highlight">${escapeHtml(data.title || target)}</span></div>
                            <div class="intel-row"><span class="intel-label">Entity Type:</span><span class="intel-value status-ok">${escapeHtml(data.entity_type || 'User')}</span></div>
                            <div class="intel-row"><span class="intel-label">Badge / Extra:</span><span class="intel-value">${escapeHtml(data.extra || 'None')}</span></div>
                            <div class="intel-row"><span class="intel-label">Verified Status:</span><span class="intel-value ${data.is_verified ? 'status-ok' : 'status-warn'}">${data.is_verified ? 'Official Verified <i class="fa-solid fa-circle-check"></i>' : 'Standard Account'}</span></div>
                        </div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;"><span class="intel-label">Bio / Channel Description:</span><div class="code-line">${escapeHtml(data.description || 'No public bio published')}</div></div>
                    <div class="intel-row" style="margin-top: 8px;"><span class="intel-label">Direct Web Gateway:</span><a href="${escapeHtml(data.url)}" target="_blank" class="btn-visit"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open t.me/${escapeHtml(target)}</a></div>
                `
            };
            break;
        }
        case 'phone_intel': {
            result = {
                title: 'Telegram Phone Routing Intel',
                icon: 'fa-phone-volume',
                target: target,
                searchable: `${target} ${data.e164 || ''} ${data.country_hint || ''} phone telegram`,
                html: `
                    <div class="intel-row"><span class="intel-label">E.164 Format:</span><span class="intel-value highlight">${escapeHtml(data.e164 || target)}</span></div>
                    <div class="intel-row"><span class="intel-label">Country Hint:</span><span class="intel-value status-ok">${escapeHtml(data.country_hint || 'International')}</span></div>
                    <div class="intel-row"><span class="intel-label">Raw Digits:</span><span class="intel-value">${escapeHtml(data.digits || '')}</span></div>
                    <div class="intel-row"><span class="intel-label">Deep Protocol:</span><a href="${escapeHtml(data.tg_deeplink)}" class="btn-visit"><i class="fa-solid fa-bolt"></i> Launch tg://resolve?phone</a></div>
                    <div class="intel-row"><span class="intel-label">Web Gateway:</span><a href="${escapeHtml(data.tg_web_link)}" target="_blank" class="btn-visit"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open t.me Web</a></div>
                `
            };
            break;
        }
        case 'phone_sync_intel': {
            const vectors = data.vectors || [];
            const rows = vectors.map(v => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="fa-solid fa-address-book"></i>
                        <div style="display:flex; flex-direction:column;">
                            <span class="platform-name">${escapeHtml(v.name)}</span>
                            <span style="font-size:0.72rem; opacity:0.75;">${escapeHtml(v.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(v.action_url)}" target="_blank" class="btn-visit-small" title="Trigger Pivot"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Phone-to-Username Discovery & Contact Sync',
                icon: 'fa-id-badge',
                target: target,
                searchable: `${target} phone sync mtproto contact username reverse truecaller`,
                html: `
                    <div class="intel-row"><span class="intel-label">Phone Vector:</span><span class="intel-value highlight">${escapeHtml(data.phone || target)}</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">De-anonymization & Sync Channels:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">OSINT Operational Method:</span>
                        <div class="code-line" style="color: var(--text-color); font-size:0.76rem;">${escapeHtml(data.tip || '')}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_history': {
            const snapshots = data.wayback_snapshots || [];
            const bots = data.history_bots || [];
            
            const snapRows = snapshots.length > 0 ? snapshots.map(s => `
                <div class="history-item">
                    <span class="history-date"><i class="fa-solid fa-clock-rotate-left"></i> ${escapeHtml(s.timestamp)}</span>
                    <span class="history-status">HTTP ${escapeHtml(s.status)}</span>
                    <a href="${escapeHtml(s.archive_url)}" target="_blank" class="btn-visit-small"><i class="fa-solid fa-file-lines"></i> Snapshot</a>
                </div>
            `).join('') : '<div style="font-size:0.78rem; opacity:0.6; padding:4px 0;">No archived t.me snapshot on Wayback yet. Querying live history bots below:</div>';

            const botRows = bots.map(b => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="fa-solid fa-robot"></i>
                        <div style="display:flex; flex-direction:column;">
                            <span class="platform-name" style="color:var(--accent);">${escapeHtml(b.bot_name)}</span>
                            <span style="font-size:0.72rem; opacity:0.85;">${escapeHtml(b.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action" style="min-width:70px; text-align:right;">
                        <a href="${escapeHtml(b.url)}" target="_blank" class="btn-visit-small"><i class="fa-brands fa-telegram"></i> Open Bot</a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Historical Usernames & Identity Archive (2013-Present)',
                icon: 'fa-timeline',
                target: target,
                searchable: `${target} historical usernames changes archive wayback sangmata userinfobot 10 years`,
                html: `
                    <div class="intel-row"><span class="intel-label">Platform History:</span><span class="intel-value highlight">Telegram Founded Aug 2013 (${data.historical_span_years}+ Years Span)</span></div>
                    <div class="intel-row"><span class="intel-label">Wayback Machine Index:</span><a href="${escapeHtml(data.wayback_hub)}" target="_blank" class="btn-visit-small"><i class="fa-solid fa-box-archive"></i> Full Archive Calendar</a></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Captured Web Milestones:</span>
                        <div class="history-list">${snapRows}</div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">Specialized Historical Rename & ID Trackers:</span>
                        <div class="social-presence-list">${botRows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_uid_estimator': {
            const epoch = data.matched_epoch;
            const guideRows = (data.epoch_guide || []).map(g => `
                <div class="uid-epoch-row">
                    <span class="epoch-range">&le; ${g.max_id >= 2147483647 ? '64-bit' : g.max_id.toLocaleString()}</span>
                    <span class="epoch-year">${escapeHtml(g.year)}</span>
                    <span class="epoch-tier">${escapeHtml(g.tier)}</span>
                </div>
            `).join('');

            result = {
                title: 'Telegram Sequential User ID & Age Estimator',
                icon: 'fa-stopwatch-20',
                target: target,
                searchable: `${target} telegram user id age creation registration date estimator`,
                html: `
                    <div class="intel-row"><span class="intel-label">Numeric ID Input:</span><span class="intel-value highlight">${data.is_resolved_id ? escapeHtml(data.numeric_id.toLocaleString()) : 'Not directly integer, use @UserInfobot'}</span></div>
                    ${epoch ? `
                        <div class="intel-row"><span class="intel-label">Estimated Vintage:</span><span class="intel-value status-ok">${escapeHtml(epoch.year)}</span></div>
                        <div class="intel-row"><span class="intel-label">Account Era:</span><span class="intel-value">${escapeHtml(epoch.era)}</span></div>
                        <div class="intel-row"><span class="intel-label">Seniority Tier:</span><span class="intel-value highlight">${escapeHtml(epoch.tier)}</span></div>
                    ` : `
                        <div class="intel-row"><span class="intel-label">Resolve User ID:</span><span class="intel-value status-warn">Forward target message to @UserInfobot to get raw numeric ID</span></div>
                    `}
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">Monotonic Registration Chronology (2013-2025):</span>
                        <div class="code-box" style="max-height:140px;">${guideRows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_fragment': {
            result = {
                title: 'Fragment.com TON Asset & Handle Auctions',
                icon: 'fa-gem',
                target: target,
                searchable: `${target} fragment ton blockchain anonymous number auction handle`,
                html: `
                    <div class="intel-row"><span class="intel-label">Target Handle:</span><span class="intel-value highlight">@${escapeHtml(data.target)}</span></div>
                    <div class="intel-row"><span class="intel-label">Fragment Marketplace:</span><a href="${escapeHtml(data.fragment_username_url)}" target="_blank" class="btn-visit"><i class="fa-solid fa-arrow-up-right-from-square"></i> Check Handle Ownership</a></div>
                    <div class="intel-row"><span class="intel-label">TON DNS Endpoint:</span><a href="${escapeHtml(data.ton_dns_url)}" target="_blank" class="btn-visit"><i class="fa-solid fa-globe"></i> Resolve ${escapeHtml(data.target)}.t.me</a></div>
                    ${data.fragment_number_url ? `
                        <div class="intel-row"><span class="intel-label">TON Anonymous Phone:</span><a href="${escapeHtml(data.fragment_number_url)}" target="_blank" class="btn-visit highlight"><i class="fa-solid fa-coins"></i> View +888 NFT Token</a></div>
                    ` : ''}
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Web3 Intelligence Context:</span>
                        <div class="code-line">${escapeHtml(data.description)}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_breaches': {
            const list = Array.isArray(data) ? data : [];
            const rows = list.map(b => `
                <div class="dork-row dork-threat">
                    <div class="dork-meta">
                        <span class="dork-engine threat-label"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(b.name)}</span>
                        <span class="dork-query">${escapeHtml(b.description)}</span>
                    </div>
                    <a href="${escapeHtml(b.url)}" target="_blank" class="btn-visit-small" title="Open Breach Search"><i class="fa-solid fa-crosshairs"></i> Search</a>
                </div>
            `).join('');

            result = {
                title: 'Breach Correlation & Leaked DB Vectors',
                icon: 'fa-shield-virus',
                target: target,
                searchable: `${target} breach leak db intelx snusbase dehashed credentials`,
                html: `
                    <div class="intel-row"><span class="intel-label">Target Vector:</span><span class="intel-value highlight">${escapeHtml(target)}</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">External De-anonymization Databases:</span>
                        <div class="dork-container">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_threat_intel': {
            const list = Array.isArray(data) ? data : [];
            const rows = list.map(t => `
                <div class="social-presence-row platform-active dork-threat">
                    <div class="platform-meta">
                        <i class="${escapeHtml(t.icon)}" style="color:var(--danger);"></i>
                        <div style="display:flex; flex-direction:column;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="platform-name">${escapeHtml(t.platform)}</span>
                                <span class="pill-tag threat-pill">${escapeHtml(t.badge)}</span>
                            </div>
                            <span style="font-size:0.72rem; opacity:0.85;">${escapeHtml(t.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(t.url)}" target="_blank" class="btn-visit-small" title="Inspect Threat Sandbox"><i class="fa-solid fa-crosshairs"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Malware C2 & Threat Intel Pivots',
                icon: 'fa-skull-crossbones',
                target: target,
                searchable: `${target} malware c2 infostealer virustotal hybrid analysis anyrun threatfox github tokens`,
                html: `
                    <div class="intel-row"><span class="intel-label">Target Vector:</span><span class="intel-value highlight">${escapeHtml(target)}</span></div>
                    <div class="intel-row"><span class="intel-label">IoC Detection Mode:</span><span class="intel-value status-bad"><i class="fa-solid fa-bug"></i> C2 & Infostealer Hunter</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Dynamic Detonation & Malware Registries:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_crypto_intel': {
            const channels = data.financial_channels || [];
            const rows = channels.map(c => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="${escapeHtml(c.icon)}" style="color:var(--warning);"></i>
                        <div style="display:flex; flex-direction:column;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="platform-name">${escapeHtml(c.currency)}</span>
                                <span class="pill-tag crypto-pill">${escapeHtml(c.badge)}</span>
                            </div>
                            <span style="font-size:0.72rem; opacity:0.85;">${escapeHtml(c.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(c.search_url)}" target="_blank" class="btn-visit-small" title="Trace Blockchain Endpoint"><i class="fa-solid fa-magnifying-glass-dollar"></i></a>
                    </div>
                </div>
            `).join('');

            const patterns = (data.wallet_regex_patterns || []).map(p => `
                <div class="uid-epoch-row">
                    <span class="epoch-range">${escapeHtml(p.type)}</span>
                    <span class="epoch-tier code-line" style="font-size:0.7rem;">${escapeHtml(p.regex)}</span>
                </div>
            `).join('');

            result = {
                title: 'Cryptocurrency & Financial Trail Tracing',
                icon: 'fa-money-bill-transfer',
                target: target,
                searchable: `${target} crypto bitcoin usdt tron btc eth ton blockchain financial tracking mixer ransom`,
                html: `
                    <div class="intel-row"><span class="intel-label">Settlement Asset Rails:</span><span class="intel-value highlight">USDT TRC-20 / BTC / TON</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Explorers & Illicit Escrow Tracers:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">Target Address Regex Validators:</span>
                        <div class="code-box" style="max-height:110px;">${patterns}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_darkweb_forums': {
            const forums = Array.isArray(data) ? data : [];
            const rows = forums.map(f => `
                <div class="social-presence-row platform-active dork-threat">
                    <div class="platform-meta">
                        <i class="${escapeHtml(f.icon)}" style="color:var(--accent);"></i>
                        <div style="display:flex; flex-direction:column;">
                            <span class="platform-name">${escapeHtml(f.name)}</span>
                            <span style="font-size:0.72rem; opacity:0.8;">${escapeHtml(f.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(f.url)}" target="_blank" class="btn-visit-small" title="Open Forum Pivot"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Cybercrime Underground & Dark Web Index',
                icon: 'fa-user-ninja',
                target: target,
                searchable: `${target} darkweb breachforums xss exploit pastebin rentry ahmia tor cybercrime`,
                html: `
                    <div class="intel-row"><span class="intel-label">Forum Cross-Indices:</span><span class="intel-value highlight">${forums.length} Underground Clearnet/Tor Vectors</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Underground Communities & Paste Feeds:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_forensics': {
            const vectors = data.vectors || [];
            const rows = vectors.map(v => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="fa-solid fa-fingerprint" style="color:var(--accent);"></i>
                        <div style="display:flex; flex-direction:column;">
                            <span class="platform-name">${escapeHtml(v.title)}</span>
                            <span style="font-size:0.72rem; color:var(--warning);">${escapeHtml(v.evidence)}</span>
                            <span style="font-size:0.72rem; opacity:0.8;">${escapeHtml(v.relevance)}</span>
                        </div>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Telegram Metadata & Forwarding Forensics',
                icon: 'fa-microscope',
                target: target,
                searchable: `${target} forensics forward_from_chat sticker pack media sha256 message id gaps telethon`,
                html: `
                    <div class="intel-row"><span class="intel-label">Forensics Scope:</span><span class="intel-value status-ok">Immutable MTProto Artifacts</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Artifact Extraction & Evidence Vectors:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">Telethon / Pyrogram Raw Extraction Command:</span>
                        <div class="code-line" style="font-size:0.72rem;">${escapeHtml(data.forensic_command || '')}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_geo_intel': {
            const modules = data.modules || [];
            const rows = modules.map(m => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="fa-solid fa-location-crosshairs" style="color:var(--accent);"></i>
                        <div style="display:flex; flex-direction:column;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span class="platform-name">${escapeHtml(m.name)}</span>
                                <span class="pill-tag variant-pill">${escapeHtml(m.status)}</span>
                            </div>
                            <span style="font-size:0.72rem; opacity:0.85;">${escapeHtml(m.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(m.action_link)}" target="_blank" class="btn-visit-small" title="Open Geolocation Vector"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Geospatial & Trilateration Intelligence',
                icon: 'fa-earth-americas',
                target: target,
                searchable: `${target} geolocation trilateration geogramint nearby gps timezone voip p2p stun ip leak`,
                html: `
                    <div class="intel-row"><span class="intel-label">Positioning Vectors:</span><span class="intel-value highlight">GPS Trilateration & UTC Dispersion</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Physical Space De-anonymization:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                    <div class="intel-block" style="margin-top: 8px;">
                        <span class="intel-label">Operational Security Directive:</span>
                        <div class="code-line" style="color:var(--warning); font-size:0.73rem;">${escapeHtml(data.operational_warning || '')}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_directories': {
            const list = Array.isArray(data) ? data : [];
            const rows = list.map(item => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="${escapeHtml(item.icon)}"></i>
                        <div style="display:flex; flex-direction:column;">
                            <span class="platform-name">${escapeHtml(item.name)}</span>
                            <span style="font-size:0.72rem; opacity:0.7;">${escapeHtml(item.description)}</span>
                        </div>
                    </div>
                    <div class="platform-action">
                        <a href="${escapeHtml(item.url)}" target="_blank" class="btn-visit-small" title="Open Directory Query"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Telegram Search Directories & Analytics',
                icon: 'fa-chart-pie',
                target: target,
                searchable: `${target} tgstat telemetr lyzem telegago intelx analytics`,
                html: `
                    <div class="intel-row"><span class="intel-label">Intelligence Engines:</span><span class="intel-value status-ok">${list.length} Services Configured</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Channel & Search Portals:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_dorks': {
            const dorkList = Array.isArray(data) ? data : [];
            const rows = dorkList.map(d => `
                <div class="dork-row dork-threat">
                    <div class="dork-meta">
                        <span class="dork-engine threat-label"><i class="fa-brands fa-telegram"></i> ${escapeHtml(d.engine)}</span>
                        <span class="dork-query">${escapeHtml(d.query)}</span>
                    </div>
                    <a href="${escapeHtml(d.url)}" target="_blank" class="btn-visit-small" title="Launch Dork in New Tab"><i class="fa-solid fa-crosshairs"></i> Query</a>
                </div>
            `).join('');

            result = {
                title: 'Telegram Search Dorks & File Leaks',
                icon: 'fa-magnifying-glass-chart',
                target: target,
                searchable: `${target} telegram dorks chat files pastebin google yandex`,
                html: `
                    <div class="intel-row"><span class="intel-label">Target Vectors:</span><span class="intel-value status-ok">${dorkList.length} OSINT Dorks Synthesized</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Telegram Targeted Recon Queries:</span>
                        <div class="dork-container">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_deeplinks': {
            const links = data.links || [];
            const rows = links.map(l => `
                <div class="social-presence-row platform-active">
                    <div class="platform-meta">
                        <i class="fa-solid fa-link"></i>
                        <span class="platform-name">${escapeHtml(l.title)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="pill-tag variant-pill">${escapeHtml(l.badge)}</span>
                        <a href="${escapeHtml(l.url)}" target="_blank" class="btn-visit-small"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                    </div>
                </div>
            `).join('');

            result = {
                title: 'Telegram Client Deep Links',
                icon: 'fa-bolt-lightning',
                target: target,
                searchable: `${target} tg:// resolve deeplink web telegram`,
                html: `
                    <div class="intel-row"><span class="intel-label">Dispatch Protocol:</span><span class="intel-value highlight">${escapeHtml(data.type || 'Direct Action')}</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Client & Web Gateway URLs:</span>
                        <div class="social-presence-list">${rows}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_variants': {
            const vList = data.variations || [];
            const variantTags = vList.map(v => `<a href="https://t.me/${escapeHtml(v)}" target="_blank" class="pill-tag variant-pill"><i class="fa-brands fa-telegram"></i> @${escapeHtml(v)}</a>`).join(' ');
            result = {
                title: 'Telegram Alias & Bot Permutations',
                icon: 'fa-wand-magic-sparkles',
                target: target,
                searchable: `${target} ${vList.join(' ')} bot variations channel`,
                html: `
                    <div class="intel-row"><span class="intel-label">Base Alias:</span><span class="intel-value highlight">@${escapeHtml(data.base || target)}</span></div>
                    <div class="intel-row"><span class="intel-label">Heuristics:</span><span class="intel-value">Bot, Channel, Group, Support & Backup</span></div>
                    <div class="intel-block" style="margin-top: 6px;">
                        <span class="intel-label">Correlated Telegram Handles:</span>
                        <div class="tag-container">${variantTags}</div>
                    </div>
                `
            };
            break;
        }
        case 'tg_summary': {
            result = {
                title: 'Telegram Exposure & Footprint',
                icon: 'fa-shield-halved',
                target: target,
                searchable: `${target} ${data.status_badge || ''} ${data.entity_type || ''} summary`,
                html: `
                    <div class="intel-row"><span class="intel-label">Telegram Target:</span><span class="intel-value highlight">${escapeHtml(data.target || target)}</span></div>
                    <div class="intel-row"><span class="intel-label">Target Taxonomy:</span><span class="intel-value">${escapeHtml((data.target_type || 'handle').toUpperCase())}</span></div>
                    <div class="intel-row"><span class="intel-label">Entity Classification:</span><span class="intel-value status-ok">${escapeHtml(data.entity_type || 'Unspecified')}</span></div>
                    <div class="intel-row"><span class="intel-label">Audit Verdict:</span><span class="intel-value ${data.exists ? 'status-ok' : 'status-warn'}">${escapeHtml(data.status_badge || 'COMPLETE')}</span></div>
                    <div class="intel-row"><span class="intel-label">Threat Vectors:</span><span class="intel-value status-bad">${escapeHtml(String(data.threat_vectors_count || 'Active'))} Indicators</span></div>
                    <div class="intel-row"><span class="intel-label">Timestamp:</span><span class="intel-value">${escapeHtml(data.timestamp || '')}</span></div>
                `
            };
            break;
        }
        default:
            return null;
    }
    if (result) {
        result.cardType = cardType;
    }
    return result;
}

function updateFilter() {
    const query = (filterCardInput.value || '').toLowerCase().trim();
    const cards = cardsContainer.querySelectorAll('.osint-card');
    cards.forEach(card => {
        const searchable = card.dataset.searchable || '';
        const title = card.dataset.title || '';
        if (!query || searchable.includes(query) || title.includes(query)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });

    if (graphNodes.length > 0) {
        graphNodes.forEach(node => {
            if (node.isCenter) {
                node.isDimmed = false;
            } else if (!query) {
                node.isDimmed = false;
            } else {
                const searchable = (node.cardDef?.searchable || '') + ' ' + (node.title || '');
                node.isDimmed = !searchable.toLowerCase().includes(query);
            }
        });
    }
}

// --- REAL-TIME SSE ENGINE ---
function runRealtimeOSINT() {
    const target = (targetDomainInput.value || '').trim();
    if (!target) {
        showToast('Enter a Telegram username (e.g. durov), phone (+1...), or numeric ID');
        return;
    }

    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }

    initAudio();
    soundRadarBeep();

    currentTargetDomain = target.replace('@', '');

    currentModuleIndex = 0;
    reconHud.classList.remove('hidden');
    hudStatusText.innerText = 'PROBING TELEGRAM NETWORK INFRASTRUCTURE...';
    hudModuleCounter.innerText = `[0 / ${TOTAL_MODULES} Modules Active]`;
    progressBar.style.width = '0%';
    liveTerminalLog.innerText = `Launching Telegram OSINT reconnaissance pipeline for ${currentTargetDomain}...`;
    runOsintBtn.disabled = true;
    activeTargetLabel.innerText = `Target: ${currentTargetDomain}`;

    cardsContainer.innerHTML = '';
    liveCardsList = [];
    initGraphTopology(currentTargetDomain);

    const sseUrl = `/api/osint/stream?target=${encodeURIComponent(currentTargetDomain)}`;
    activeEventSource = new EventSource(sseUrl);

    activeEventSource.addEventListener('start', (e) => {
        const payload = JSON.parse(e.data);
        liveTerminalLog.innerText = `Target verified: ${payload.username} [${payload.target_type}] at ${payload.timestamp}`;
        soundRadarBeep();
    });

    activeEventSource.addEventListener('log', (e) => {
        const payload = JSON.parse(e.data);
        liveTerminalLog.innerText = payload.message;
        soundRadarBeep();
    });

    activeEventSource.addEventListener('card', (e) => {
        const payload = JSON.parse(e.data);
        const cardDef = convertCardEventToDef(payload.cardType, payload.username, payload.data);
        if (cardDef) {
            currentModuleIndex++;
            const pct = Math.min(100, Math.round((currentModuleIndex / TOTAL_MODULES) * 100));
            progressBar.style.width = `${pct}%`;
            hudModuleCounter.innerText = `[${currentModuleIndex} / ${TOTAL_MODULES} Modules Active]`;
            hudStatusText.innerText = `STREAMING: ${cardDef.title.toUpperCase()}`;

            const cardEl = createCardElement(cardDef);
            cardsContainer.appendChild(cardEl);
            liveCardsList.push(cardDef);

            addGraphNodeForCard(cardDef);

            soundCardArrive();
            updateFilter();
        }
    });

    activeEventSource.addEventListener('complete', (e) => {
        const payload = JSON.parse(e.data);
        progressBar.style.width = '100%';
        hudStatusText.innerText = 'TELEGRAM OSINT COMPLETE';
        hudModuleCounter.innerText = `[All Modules Synced]`;
        liveTerminalLog.innerText = `Telegram reconnaissance finished and archived for ${payload.username}`;
        activeTargetLabel.innerText = `${payload.username} (Active)`;
        runOsintBtn.disabled = false;
        soundSuccess();
        showToast(`Telegram recon complete for ${payload.username}!`);
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
    });

    activeEventSource.addEventListener('error', (e) => {
        let errMsg = 'Connection closed or probe error';
        try {
            if (e.data) {
                const p = JSON.parse(e.data);
                errMsg = p.message || errMsg;
            }
        } catch (_) {}
        hudStatusText.innerText = 'PROBE COMPLETE OR CLOSED';
        liveTerminalLog.innerText = errMsg;
        runOsintBtn.disabled = false;
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
    });
}

// --- CLEAN / PURGE ALL INTEL ---
async function clearAllIntel() {
    soundWipePurge();
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }
    runOsintBtn.disabled = false;
    reconHud.classList.add('hidden');
    cardsContainer.innerHTML = '';
    liveCardsList = [];
    targetDomainInput.value = '';
    filterCardInput.value = '';
    activeTargetLabel.innerText = 'Target: Standby';
    currentTargetDomain = '';
    resetGraphState();

    try {
        const res = await fetch('/api/osint/clear', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Telegram profiles wiped clean!');
    } catch (e) {
        showToast('All cards wiped from view.');
    }
}

// --- SOUND TOGGLE ---
function toggleSound() {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
        soundIcon.className = 'fa-solid fa-volume-high';
        initAudio();
        soundCardArrive();
        showToast('Tactical Audio FX: ON');
    } else {
        soundIcon.className = 'fa-solid fa-volume-xmark';
        showToast('Tactical Audio FX: MUTED');
    }
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sound_enabled: soundEnabled })
    }).catch(() => {});
}

// --- LOAD EXISTING RECORDS ON STARTUP ---
async function loadExistingRecords() {
    try {
        const res = await fetch('/api/osint/records');
        const records = await res.json();
        if (records.length > 0) {
            cardsContainer.innerHTML = '';
            liveCardsList = [];
            const latest = records[0];
            const target = latest.target || latest.username;
            currentTargetDomain = target;
            activeTargetLabel.innerText = `Cached Target: ${target}`;
            initGraphTopology(target);

            const possibleCards = [
                ['phone_intel', latest.phone_intel],
                ['phone_sync_intel', latest.phone_sync_intel],
                ['tg_profile', latest.tg_profile],
                ['tg_history', latest.tg_history],
                ['tg_uid_estimator', latest.tg_uid_estimator],
                ['tg_fragment', latest.tg_fragment],
                ['tg_breaches', latest.tg_breaches],
                ['tg_threat_intel', latest.tg_threat_intel],
                ['tg_crypto_intel', latest.tg_crypto_intel],
                ['tg_darkweb_forums', latest.tg_darkweb_forums],
                ['tg_forensics', latest.tg_forensics],
                ['tg_geo_intel', latest.tg_geo_intel],
                ['tg_directories', latest.tg_directories],
                ['tg_dorks', latest.tg_dorks],
                ['tg_deeplinks', latest.tg_deeplinks],
                ['tg_variants', latest.tg_variants],
                ['tg_summary', latest.tg_summary]
            ];

            possibleCards.forEach(([cardType, data]) => {
                if (data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0)) {
                    const cardDef = convertCardEventToDef(cardType, target, data);
                    if (cardDef) {
                        cardsContainer.appendChild(createCardElement(cardDef));
                        liveCardsList.push(cardDef);
                        addGraphNodeForCard(cardDef);
                    }
                }
            });
        }
    } catch (e) {
        console.error('Failed to load records', e);
    }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const cfg = await res.json();
        document.getElementById('cfg-theme').value = cfg.theme || 'matrix';
        document.getElementById('cfg-data-path').value = cfg.data_path || '';
        document.getElementById('cfg-sound').value = cfg.sound_enabled !== false ? 'true' : 'false';
        soundEnabled = cfg.sound_enabled !== false;
        soundIcon.className = soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
        applyTheme(cfg.theme);
    } catch (e) {}
}

// --- EVENT LISTENERS ---
runOsintBtn.onclick = runRealtimeOSINT;
targetDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runRealtimeOSINT();
});
filterCardInput.addEventListener('input', updateFilter);
soundToggleBtn.onclick = toggleSound;
clearAllBtn.onclick = clearAllIntel;

if (settingsBtn) settingsBtn.onclick = () => settingsModal.classList.add('active');
if (closeSettings) closeSettings.onclick = () => settingsModal.classList.remove('active');
if (saveSettingsBtn) {
    saveSettingsBtn.onclick = async () => {
        const newTheme = document.getElementById('cfg-theme').value;
        const newPath = document.getElementById('cfg-data-path').value;
        const soundVal = document.getElementById('cfg-sound').value === 'true';
        soundEnabled = soundVal;
        soundIcon.className = soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
        applyTheme(newTheme);
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ theme: newTheme, data_path: newPath, sound_enabled: soundEnabled })
        });
        settingsModal.classList.remove('active');
        showToast('Settings Saved');
    };
}

// --- INTERACTIVE GRAPH CANVAS SYSTEM ---
function setupGraphCanvas() {
    if (!graphCanvas) return;
    graphCtx = graphCanvas.getContext('2d');
    resizeGraphCanvas();
    window.addEventListener('resize', resizeGraphCanvas);

    graphCanvas.addEventListener('mousedown', handleGraphMouseDown);
    window.addEventListener('mousemove', handleGraphMouseMove);
    window.addEventListener('mouseup', handleGraphMouseUp);
    graphCanvas.addEventListener('wheel', handleGraphWheel, { passive: false });
    graphCanvas.addEventListener('mouseleave', handleGraphMouseLeave);

    if (viewGridBtn) {
        viewGridBtn.addEventListener('click', () => switchViewMode('grid'));
    }
    if (viewGraphBtn) {
        viewGraphBtn.addEventListener('click', () => switchViewMode('graph'));
    }
    if (resetGraphBtn) {
        resetGraphBtn.addEventListener('click', recenterGraphView);
    }

    startGraphLoop();
}

function resizeGraphCanvas() {
    if (!graphCanvas || !graphContainer) return;
    const rect = graphContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    graphCanvasRect = rect;
    graphCanvas.width = rect.width * dpr;
    graphCanvas.height = rect.height * dpr;
    if (graphCtx) {
        graphCtx.scale(dpr, dpr);
    }
    if (graphNodes.length === 0 && currentTargetDomain) {
        recenterGraphView();
    }
}

function switchViewMode(mode) {
    activeViewMode = mode;
    if (mode === 'grid') {
        viewGridBtn.classList.add('active');
        viewGraphBtn.classList.remove('active');
        cardsContainer.classList.remove('hidden');
        graphContainer.classList.add('hidden');
        hideGraphPopup();
    } else {
        viewGraphBtn.classList.add('active');
        viewGridBtn.classList.remove('active');
        cardsContainer.classList.add('hidden');
        graphContainer.classList.remove('hidden');
        resizeGraphCanvas();
        recenterGraphView();
    }
}

function resetGraphState() {
    graphNodes = [];
    graphLinks = [];
    graphParticles = [];
    hoveredNode = null;
    draggedNode = null;
    hideGraphPopup();
    updateGraphNodeCounter();
}

function initGraphTopology(username) {
    resetGraphState();
    if (!username) return;

    const width = graphCanvasRect.width || 800;
    const height = graphCanvasRect.height || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    const centerNode = {
        id: 'center-user',
        isCenter: true,
        title: `${username}`,
        label: `${username}`,
        target: username,
        x: centerX,
        y: centerY,
        vx: 0,
        vy: 0,
        radius: 46,
        color: '#0088cc',
        pulse: 0,
        pulseSpeed: 0.04,
        icon: 'fa-paper-plane'
    };
    graphNodes.push(centerNode);
    recenterGraphView();
    updateGraphNodeCounter();
}

function addGraphNodeForCard(cardDef) {
    if (!cardDef) return;
    const existing = graphNodes.find(n => n.id === cardDef.title);
    if (existing) {
        existing.cardDef = cardDef;
        return;
    }

    const centerNode = graphNodes.find(n => n.isCenter);
    const width = graphCanvasRect.width || 800;
    const height = graphCanvasRect.height || 600;
    const cX = centerNode ? centerNode.x : width / 2;
    const cY = centerNode ? centerNode.y : height / 2;

    const angle = ((graphNodes.length - 1) / TOTAL_MODULES) * Math.PI * 2 + (Math.PI / 14);
    const orbitRadius = Math.min(width, height) * 0.38 + (graphNodes.length % 2 === 0 ? 25 : -25);

    const nodeX = cX + Math.cos(angle) * orbitRadius;
    const nodeY = cY + Math.sin(angle) * orbitRadius;

    const nodeObj = {
        id: cardDef.title,
        isCenter: false,
        title: cardDef.title,
        label: cardDef.title.replace('Telegram ', '').replace('OSINT ', '').trim(),
        icon: cardDef.icon,
        target: cardDef.target,
        cardDef: cardDef,
        x: nodeX,
        y: nodeY,
        targetX: nodeX,
        targetY: nodeY,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius: 30,
        color: '#00adb5',
        pulse: Math.random() * Math.PI,
        pulseSpeed: 0.03,
        spawnProgress: 0
    };

    graphNodes.push(nodeObj);

    if (centerNode) {
        graphLinks.push({ 
            source: centerNode, 
            target: nodeObj, 
            length: orbitRadius, 
            strength: 0.05 
        });
    }

    updateGraphNodeCounter();
}

function updateGraphNodeCounter() {
    if (!graphNodeCount) return;
    const count = graphNodes.length;
    graphNodeCount.innerText = `${count} Node${count === 1 ? '' : 's'} Linked`;
}

function recenterGraphView() {
    const width = graphCanvasRect.width || 800;
    const height = graphCanvasRect.height || 600;
    graphTransform.scale = 1;
    graphTransform.x = 0;
    graphTransform.y = 0;
    const centerNode = graphNodes.find(n => n.isCenter);
    if (centerNode) {
        centerNode.x = width / 2;
        centerNode.y = height / 2;
    }
}

function startGraphLoop() {
    function loop() {
        updateGraphPhysics();
        renderGraphFrame();
        graphAnimFrame = requestAnimationFrame(loop);
    }
    if (!graphAnimFrame) {
        graphAnimFrame = requestAnimationFrame(loop);
    }
}

function updateGraphPhysics() {
    if (graphNodes.length === 0) return;

    graphNodes.forEach(node => {
        if (node.spawnProgress < 1) {
            node.spawnProgress = Math.min(1, (node.spawnProgress || 0) + 0.08);
        }
        node.pulse = (node.pulse || 0) + (node.pulseSpeed || 0.03);
    });

    for (let i = 0; i < graphNodes.length; i++) {
        const n1 = graphNodes[i];
        if (n1 === draggedNode) continue;

        for (let j = i + 1; j < graphNodes.length; j++) {
            const n2 = graphNodes[j];
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.hypot(dx, dy) || 1;
            const minDist = (n1.radius + n2.radius) * 1.8;

            if (dist < minDist) {
                const force = (minDist - dist) / dist * 0.25;
                const fx = dx * force;
                const fy = dy * force;
                if (!n1.isCenter && n1 !== draggedNode) { n1.x -= fx * 0.5; n1.y -= fy * 0.5; }
                if (!n2.isCenter && n2 !== draggedNode) { n2.x += fx * 0.5; n2.y += fy * 0.5; }
            }
        }
    }

    graphLinks.forEach(link => {
        if (link.target === draggedNode) return;
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.hypot(dx, dy) || 1;
        const diff = dist - link.length;
        const spring = diff * 0.015;
        const sx = (dx / dist) * spring;
        const sy = (dy / dist) * spring;

        if (!link.target.isCenter) {
            link.target.x -= sx;
            link.target.y -= sy;
        }
    });

    if (Math.random() < 0.08 && graphLinks.length > 0) {
        const randomLink = graphLinks[Math.floor(Math.random() * graphLinks.length)];
        graphParticles.push({
            source: randomLink.source,
            target: randomLink.target,
            progress: 0,
            speed: 0.015 + Math.random() * 0.02
        });
    }

    for (let i = graphParticles.length - 1; i >= 0; i--) {
        const p = graphParticles[i];
        p.progress += p.speed;
        if (p.progress >= 1) {
            graphParticles.splice(i, 1);
        }
    } 
}

function renderGraphFrame() {
    if (!graphCtx || !graphCanvas) return;
    const colors = getThemeColors();
    const width = graphCanvasRect.width || 800;
    const height = graphCanvasRect.height || 600;

    graphCtx.save();
    graphCtx.clearRect(0, 0, width, height);

    graphCtx.translate(graphTransform.x, graphTransform.y);
    graphCtx.scale(graphTransform.scale, graphTransform.scale);

    drawGraphGridPattern(width, height, colors);

    graphLinks.forEach(link => {
        const isHighlighted = (hoveredNode && (hoveredNode === link.source || hoveredNode === link.target));
        graphCtx.beginPath();
        graphCtx.moveTo(link.source.x, link.source.y);
        graphCtx.lineTo(link.target.x, link.target.y);
        graphCtx.strokeStyle = isHighlighted ? colors.accent : (link.target.isDimmed ? 'rgba(255,255,255,0.05)' : colors.cardBorder);
        graphCtx.lineWidth = isHighlighted ? 2.5 : 1.2;
        if (isHighlighted) {
            graphCtx.shadowColor = colors.accent;
            graphCtx.shadowBlur = 10;
        } else {
            graphCtx.shadowBlur = 0;
        }
        graphCtx.stroke();
        graphCtx.shadowBlur = 0;
    });

    graphParticles.forEach(p => {
        if (!p.source || !p.target) return;
        const curX = p.source.x + (p.target.x - p.source.x) * p.progress;
        const curY = p.source.y + (p.target.y - p.source.y) * p.progress;
        graphCtx.beginPath();
        graphCtx.arc(curX, curY, 3, 0, Math.PI * 2);
        graphCtx.fillStyle = colors.accent;
        graphCtx.shadowColor = colors.accent;
        graphCtx.shadowBlur = 8;
        graphCtx.fill();
        graphCtx.shadowBlur = 0;
    });

    graphNodes.forEach(node => {
        drawGraphNode(node, colors);
    });

    graphCtx.restore();
}

function drawGraphGridPattern(w, h, colors) {
    graphCtx.save();
    graphCtx.strokeStyle = colors.secondary;
    graphCtx.lineWidth = 0.5;
    graphCtx.globalAlpha = 0.35;

    const gridSize = 40;
    const startX = -w;
    const endX = w * 2;
    const startY = -h;
    const endY = h * 2;

    graphCtx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
        graphCtx.moveTo(x, startY);
        graphCtx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
        graphCtx.moveTo(startX, y);
        graphCtx.lineTo(endX, y);
    }
    graphCtx.stroke();
    graphCtx.restore();
}

function drawGraphNode(node, colors) {
    const scaleAnim = node.spawnProgress !== undefined ? node.spawnProgress : 1;
    const r = node.radius * scaleAnim;
    const isHover = (node === hoveredNode);

    graphCtx.save();
    if (node.isDimmed) {
        graphCtx.globalAlpha = 0.25;
    }

    if (node.isCenter || isHover) {
        const ringRadius = r + 8 + Math.sin(node.pulse || 0) * 4;
        graphCtx.beginPath();
        graphCtx.arc(node.x, node.y, ringRadius, 0, Math.PI * 2);
        graphCtx.strokeStyle = colors.accent;
        graphCtx.lineWidth = isHover ? 2 : 1.2;
        graphCtx.setLineDash([4, 4]);
        graphCtx.stroke();
        graphCtx.setLineDash([]);
    }

    graphCtx.beginPath();
    graphCtx.arc(node.x, node.y, r, 0, Math.PI * 2);
    graphCtx.fillStyle = node.isCenter ? colors.secondary : colors.cardBg;
    graphCtx.fill();

    graphCtx.strokeStyle = isHover ? colors.accent : (node.isCenter ? colors.accent : colors.cardBorder);
    graphCtx.lineWidth = isHover ? 3 : (node.isCenter ? 2.5 : 1.5);
    if (isHover || node.isCenter) {
        graphCtx.shadowColor = colors.accent;
        graphCtx.shadowBlur = isHover ? 16 : 10;
    }
    graphCtx.stroke();
    graphCtx.shadowBlur = 0;

    graphCtx.fillStyle = colors.accent;
    graphCtx.textAlign = 'center';
    graphCtx.textBaseline = 'middle';

    if (node.isCenter) {
        graphCtx.font = `bold 12px 'Consolas', monospace`;
        graphCtx.fillStyle = colors.textColor;
        const displayTarget = node.target && node.target.length > 16 ? node.target.slice(0, 15) + '…' : `${node.target || 'TARGET'}`;
        graphCtx.fillText(displayTarget, node.x, node.y - 4);

        graphCtx.font = `10px 'Consolas', monospace`;
        graphCtx.fillStyle = colors.accent;
        graphCtx.fillText('[TELEGRAM]', node.x, node.y + 11);
    } else {
        graphCtx.font = `bold 10px 'Consolas', monospace`;
        graphCtx.fillStyle = isHover ? colors.accent : colors.textColor;
        const lines = (node.label || node.title).split('\n');
        if (lines.length > 1) {
            graphCtx.fillText(lines[0], node.x, node.y - 6);
            graphCtx.fillText(lines[1], node.x, node.y + 7);
        } else {
            const txt = lines[0].length > 12 ? lines[0].slice(0, 11) + '…' : lines[0];
            graphCtx.fillText(txt, node.x, node.y);
        }
    }

    graphCtx.restore();
}

function showGraphPopup(node, screenX, screenY) {
    if (!graphPopup) return;

    if (node.isCenter) {
        const completedCount = liveCardsList.length;
        graphPopup.innerHTML = `
            <div class="osint-card-header">
                <h3><i class="fa-brands fa-telegram"></i> Telegram Target Hub</h3>
                <span class="target-pill">${escapeHtml(node.target)}</span>
            </div>
            <div class="osint-card-body">
                <div class="intel-row"><span class="intel-label">Active Target:</span><span class="intel-value highlight">${escapeHtml(node.target)}</span></div>
                <div class="intel-row"><span class="intel-label">Recon Modules:</span><span class="intel-value status-ok">${completedCount} Clusters Synced</span></div>
                <div class="intel-row"><span class="intel-label">Network:</span><span class="intel-value">Telegram Real-Time Surface</span></div>
                <div class="intel-row"><span class="intel-label">Cybercrime Hunting:</span><span class="intel-value status-bad">C2, Crypto & Dark Web Active</span></div>
            </div>
        `;
    } else if (node.cardDef) {
        graphPopup.innerHTML = `
            <div class="osint-card-header">
                <h3><i class="fa-solid ${node.cardDef.icon}"></i> ${escapeHtml(node.cardDef.title)}</h3>
                <span class="target-pill">${escapeHtml(node.cardDef.target)}</span>
            </div>
            <div class="osint-card-body">
                ${node.cardDef.html}
            </div>
        `;
    } else {
        return;
    }

    graphPopup.classList.remove('hidden');

    const popupRect = graphPopup.getBoundingClientRect();
    const contRect = graphContainer.getBoundingClientRect();

    let posX = screenX - contRect.left + 15;
    let posY = screenY - contRect.top + 15;

    if (posX + popupRect.width > contRect.width) {
        posX = screenX - contRect.left - popupRect.width - 15;
    }
    if (posY + popupRect.height > contRect.height) {
        posY = screenY - contRect.top - popupRect.height - 15;
    }
    if (posX < 10) posX = 10;
    if (posY < 10) posY = 10;

    graphPopup.style.left = `${posX}px`;
    graphPopup.style.top = `${posY}px`;
}

function hideGraphPopup() {
    if (graphPopup) {
        graphPopup.classList.add('hidden');
    }
}

function getCanvasPointer(e) {
    const rect = graphCanvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const worldX = (rawX - graphTransform.x) / graphTransform.scale;
    const worldY = (rawY - graphTransform.y) / graphTransform.scale;
    return { rawX, rawY, worldX, worldY, clientX: e.clientX, clientY: e.clientY };
}

function findNodeAt(worldX, worldY) {
    for (let i = graphNodes.length - 1; i >= 0; i--) {
        const node = graphNodes[i];
        const dist = Math.hypot(node.x - worldX, node.y - worldY);
        if (dist <= node.radius) {
            return node;
        }
    } 
    return null;
}

function handleGraphMouseDown(e) {
    const ptr = getCanvasPointer(e);
    const hitNode = findNodeAt(ptr.worldX, ptr.worldY);

    if (hitNode) {
        draggedNode = hitNode;
        hideGraphPopup();
    } else {
        isPanning = true;
        startPan = { x: ptr.rawX - graphTransform.x, y: ptr.rawY - graphTransform.y };
    }
}

function handleGraphMouseMove(e) {
    if (!graphCanvas) return;
    const ptr = getCanvasPointer(e);

    if (draggedNode) {
        draggedNode.x = ptr.worldX;
        draggedNode.y = ptr.worldY;
        hideGraphPopup();
        return;
    }

    if (isPanning) {
        graphTransform.x = ptr.rawX - startPan.x;
        graphTransform.y = ptr.rawY - startPan.y;
        hideGraphPopup();
        return;
    }

    const hitNode = findNodeAt(ptr.worldX, ptr.worldY);
    if (hitNode !== hoveredNode) {
        hoveredNode = hitNode;
        if (hoveredNode) {
            soundRadarBeep();
            showGraphPopup(hoveredNode, ptr.clientX, ptr.clientY);
        } else {
            hideGraphPopup();
        }
    } else if (hoveredNode) {
        showGraphPopup(hoveredNode, ptr.clientX, ptr.clientY);
    }
}

function handleGraphMouseUp() {
    draggedNode = null;
    isPanning = false;
}

function handleGraphMouseLeave() {
    draggedNode = null;
    isPanning = false;
    hoveredNode = null;
    hideGraphPopup();
}

function handleGraphWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(2.5, Math.max(0.4, graphTransform.scale * zoomFactor));

    const rect = graphCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    graphTransform.x = mouseX - (mouseX - graphTransform.x) * (newScale / graphTransform.scale);
    graphTransform.y = mouseY - (mouseY - graphTransform.y) * (newScale / graphTransform.scale);
    graphTransform.scale = newScale;
    hideGraphPopup();
}

document.addEventListener('DOMContentLoaded', async () => {
    setupGraphCanvas();
    await loadSettings();
    await loadExistingRecords();
});
