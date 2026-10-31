// ============================================================
// ACTIVITYPLUS - PRO JAVASCRIPT
// ============================================================

// --- LOADING: splash screen + busy overlay ---------------------------------
// Splash (#loadingScreen) is shown on first open until login/data are ready.
const hideSplash = () => {
    const screen = document.getElementById('loadingScreen');
    if (screen) screen.classList.add('hidden');
};
// Safety net: never leave the splash up forever
setTimeout(hideSplash, 12000);

// Busy overlay (#busyOverlay) is shown whenever data is loading, saving,
// editing, deleting, importing or a report is being prepared.
let busyCount = 0;
let busyShownAt = 0;
let busyHideTimer = null;
const MIN_BUSY_MS = 450;   // avoid a flicker on very fast operations

function setBusy(message = 'Loading...') {
    busyCount++;
    clearTimeout(busyHideTimer);
    const el = document.getElementById('busyOverlay');
    if (!el) return;
    const txt = document.getElementById('busyText');
    if (txt) txt.textContent = message;
    if (!el.classList.contains('show')) {
        busyShownAt = Date.now();
        el.classList.add('show');
        el.setAttribute('aria-hidden', 'false');
        document.body.setAttribute('aria-busy', 'true');
    }
}

function clearBusy() {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount > 0) return;
    const wait = Math.max(150, MIN_BUSY_MS - (Date.now() - busyShownAt));
    clearTimeout(busyHideTimer);
    busyHideTimer = setTimeout(() => {
        if (busyCount > 0) return;
        const el = document.getElementById('busyOverlay');
        if (el) { el.classList.remove('show'); el.setAttribute('aria-hidden', 'true'); }
        document.body.removeAttribute('aria-busy');
    }, wait);
}

async function withBusy(message, fn) {
    setBusy(message);
    try { return await fn(); }
    finally { clearBusy(); }
}

const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

// ============================================================
// PASSWORD EYE TOGGLE
// ============================================================
function setupEyeToggles() {
    // Login eye
    const loginEye = document.getElementById('loginEye');
    const loginPassword = document.getElementById('loginPassword');
    if (loginEye && loginPassword) {
        loginEye.addEventListener('click', () => {
            const isPassword = loginPassword.type === 'password';
            loginPassword.type = isPassword ? 'text' : 'password';
            const icon = loginEye.querySelector('i');
            if (icon) {
                icon.className = isPassword ? 'ph-bold ph-eye-slash' : 'ph-bold ph-eye';
            }
        });
    }

    // All other eye toggles (data-target)
    document.querySelectorAll('.eye-toggle[data-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            const isPassword = target.type === 'password';
            target.type = isPassword ? 'text' : 'password';
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = isPassword ? 'ph-bold ph-eye-slash' : 'ph-bold ph-eye';
            }
        });
    });
}

// ============================================================
// MAIN APP DATA
// ============================================================
const KEY = "activityplus_v2";
const CATS = ["Salary", "Food", "Transport", "Shopping", "Bills", "Entertainment", "Business", "Other"];

const defaultData = {
    transactions: [],
    goals: [],
    wallets: [
        { id: 1, name: "Cash", fullName: "", kind: "Personal", type: "Cash", currency: "USD" },
        { id: 2, name: "E-Wallet", fullName: "", kind: "Personal", type: "E-Wallet", currency: "SLSH" },
        { id: 3, name: "Bank", fullName: "", kind: "Personal", type: "Bank", currency: "ETB" }
    ],
    budgets: [],
    savingsTx: [],
    rates: { USD_SLSH: 0, USD_ETB: 0 }
};

let data = JSON.parse(JSON.stringify(defaultData));
data.transactions = data.transactions || [];
data.goals = data.goals || [];
data.wallets = data.wallets || defaultData.wallets;
data.budgets = data.budgets || [];

let currentCurrency = "ALL";

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const normalizeWallet = w => ({
    ...w,
    kind: w.kind === "Business" ? "Business" : "Personal",   // older wallets default to Personal
    fullName: w.fullName || "",
    account: w.account || ""
});

const normalizeData = (value) => {
    const x = value && typeof value === "object" ? value : {};
    const wallets = Array.isArray(x.wallets) && x.wallets.length ? x.wallets : JSON.parse(JSON.stringify(defaultData.wallets));
    return {
        transactions: Array.isArray(x.transactions) ? x.transactions : [],
        goals: Array.isArray(x.goals) ? x.goals : [],
        wallets: wallets.map(normalizeWallet),
        budgets: Array.isArray(x.budgets) ? x.budgets : [],
        savingsTx: Array.isArray(x.savingsTx) ? x.savingsTx : [],
        rates: {
            USD_SLSH: Number(x.rates?.USD_SLSH) > 0 ? Number(x.rates.USD_SLSH) : 0,
            USD_ETB: Number(x.rates?.USD_ETB) > 0 ? Number(x.rates.USD_ETB) : 0
        }
    };
};

let currentUser = null;
let saveTimer = null;

const save = async (showError = true, message = "Saving...") => {
    if (!sb || !currentUser) {
        if (showError) toast("Please login first.");
        return false;
    }
    setBusy(message);
    try {
        const payload = {
            user_id: currentUser.id,
            data: normalizeData(data),
            updated_at: new Date().toISOString()
        };
        const { error } = await sb.from("activityplus_data").upsert(payload, { onConflict: "user_id" });
        if (error) {
            console.error("ActivityPlus save error:", error);
            if (showError) toast("Could not save: " + error.message);
            return false;
        }
        renderAll();
        return true;
    } finally {
        clearBusy();
    }
};

const loadRemoteData = async () => {
    if (!sb || !currentUser) return;
    const { data: row, error } = await sb.from("activityplus_data").select("data").eq("user_id", currentUser.id).maybeSingle();
    if (error) {
        console.error("ActivityPlus load error:", error);
        toast("Could not load your data: " + error.message);
        return false;
    }
    if (row?.data) {
        data = normalizeData(row.data);
    } else {
        const legacy = localStorage.getItem(KEY);
        if (legacy) {
            try {
                data = normalizeData(JSON.parse(legacy));
                const ok = await save(false);
                if (ok) localStorage.removeItem(KEY);
            } catch (e) {
                console.warn("Legacy migration failed:", e);
            }
        } else {
            data = normalizeData(defaultData);
            await save(false);
        }
    }
    renderAll();
    return true;
};

// ============================================================
// UTILITIES
// ============================================================
const fmt = (n, c) => ({ USD: "$", SLSH: "SLSH ", ETB: "ETB " }[c] || "") + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

const CURS = ["USD", "SLSH", "ETB"];
const CUR_NAMES = { USD: "US DOLLAR", SLSH: "SL SHILLING", ETB: "ET BIRR" };
const curName = c => CUR_NAMES[c] || c;

// Balance of one wallet: income/expense/transfer plus both sides of an exchange
function walletBal(w) {
    return data.transactions.reduce((a, t) => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income' && t.wallet === w.name) return a + amt;
        if (t.type === 'expense' && t.wallet === w.name) return a - amt;
        if (t.type === 'transfer') {
            if (t.from === w.name) return a - amt;
            if (t.to === w.name) return a + amt;
        }
        if (t.type === 'exchange') {
            if (t.from === w.name) return a - amt;
            if (t.to === w.name) return a + (Number(t.toAmount) || 0);
        }
        return a;
    }, 0);
}

const currencyBalance = c => data.wallets.filter(w => w.currency === c).reduce((a, w) => a + walletBal(w), 0);
const kindTotals = kind => {
    const out = { USD: 0, SLSH: 0, ETB: 0 };
    data.wallets.filter(w => (w.kind || 'Personal') === kind).forEach(w => { out[w.currency] = (out[w.currency] || 0) + walletBal(w); });
    return out;
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

const toast = msg => {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2400);
};

const txAmount = (type, c, cat) => data.transactions
    .filter(t => t.type === type && t.currency === c && (!cat || t.category === cat))
    .reduce((a, t) => a + Number(t.amount), 0);

// ============================================================
// RENDER FUNCTIONS
// ============================================================
// ---- Exchange rates (saved in Settings) ----
// Units of each currency per 1 USD; every other pair is derived from these two.
const perUsd = c => c === 'USD' ? 1 : Number(data.rates?.['USD_' + c]) || 0;
const savedRate = (from, to) => {
    const a = perUsd(from), b = perUsd(to);
    return a > 0 && b > 0 ? b / a : 0;
};

function renderRates() {
    if (!$('#ratesTable')) return;
    const active = document.activeElement && document.activeElement.id;
    if (active !== 'rateUsdSlsh') $('#rateUsdSlsh').value = data.rates?.USD_SLSH || '';
    if (active !== 'rateUsdEtb') $('#rateUsdEtb').value = data.rates?.USD_ETB || '';
    const pairs = [['USD', 'SLSH'], ['SLSH', 'USD'], ['USD', 'ETB'], ['ETB', 'USD'], ['SLSH', 'ETB'], ['ETB', 'SLSH']];
    $('#ratesTable').innerHTML = pairs.map(([f, t]) => {
        const r = savedRate(f, t);
        return `<div class="rate-row"><span>1 ${f}</span><i class="ph-bold ph-arrow-right"></i><strong>${r ? Number(r.toFixed(6)).toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' ' + t : 'not set'}</strong></div>`;
    }).join('');
}

function renderAll() {
    renderRates();
    renderWalletManage();
    renderDashboard();
    renderTransactions();
    renderGoals();
    renderWallets();
    renderBudgets();
    renderAnalytics();
    populateWallets();
    populateCategories();
}

const BAL_KEY = 'activityplus_hide_balance';
const balHidden = () => localStorage.getItem(BAL_KEY) === '1';
const mask = t => balHidden() ? '••••••' : t;

function renderDashboard() {
    const c = currentCurrency;
    const all = !c || c === 'ALL';
    const inc = data.transactions.filter(t => t.type === 'income' && (all || t.currency === c)).reduce((a, t) => a + Number(t.amount), 0);
    const exp = data.transactions.filter(t => t.type === 'expense' && (all || t.currency === c)).reduce((a, t) => a + Number(t.amount), 0);

    const name = (currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || '').trim();
    $("#heroGreeting").textContent = name ? "Welcome back, " + name.split(' ')[0] : "Welcome back";
    $("#dashHero").classList.toggle('is-all', all);

    const eye = $("#toggleBalance i");
    if (eye) eye.className = balHidden() ? 'ph-bold ph-eye-slash' : 'ph-bold ph-eye';

    $("#balanceValue").textContent = all ? "Multi-currency" : mask(fmt(currencyBalance(c), c));
    $("#balanceLabel").textContent = all ? "Balance per currency is shown below" : curName(c);
    $("#incomeValue").textContent = all ? "—" : mask(fmt(inc, c));
    $("#expenseValue").textContent = all ? "—" : mask(fmt(exp, c));
    $("#savingValue").textContent = all ? "—" : mask(fmt(data.goals.filter(g => g.currency === c).reduce((a, g) => a + Number(g.saved), 0), c));

    const icons = { USD: 'ph-currency-dollar', SLSH: 'ph-coins', ETB: 'ph-money' };
    $("#currencyCards").innerHTML = CURS.map(cur => {
        const ci = txAmount('income', cur), ce = txAmount('expense', cur);
        return `<button type="button" class="cur-card ${cur === c ? 'selected' : ''}" data-pick="${cur}">
            <div class="cur-top"><span class="cur-ico ${cur.toLowerCase()}"><i class="ph-fill ${icons[cur]}"></i></span><small>${cur}</small></div>
            <p>${curName(cur)}</p>
            <strong>${mask(fmt(currencyBalance(cur), cur))}</strong>
            <div class="cur-foot"><span class="income-text">+${mask(fmt(ci, cur))}</span><span class="expense-text">−${mask(fmt(ce, cur))}</span></div>
        </button>`;
    }).join('');
    $$('#currencyCards [data-pick]').forEach(b => b.onclick = () => selectDashCurrency(b.dataset.pick));

    $("#walletSplit").innerHTML = ['Personal', 'Business'].map(kind => {
        const list = data.wallets.filter(w => (w.kind || 'Personal') === kind);
        const tot = kindTotals(kind);
        return `<div class="split-card ${kind.toLowerCase()}">
            <div class="split-head"><span class="split-ico"><i class="ph-fill ${kind === 'Business' ? 'ph-briefcase' : 'ph-user'}"></i></span>
            <div><strong>${kind}</strong><small>${list.length} wallet${list.length === 1 ? '' : 's'}</small></div></div>
            <div class="split-amts">${CURS.filter(cur => list.some(w => w.currency === cur)).map(cur => `<span>${mask(fmt(tot[cur], cur))}</span>`).join('') || '<span class="muted">No wallets yet</span>'}</div>
        </div>`;
    }).join('');

    const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6);
    $("#recentTransactions").innerHTML = recent.length
        ? recent.map(txRow).join("")
        : `<div class="empty">No transactions yet.</div>`;

    $("#goalPreview").innerHTML = data.goals.length
        ? data.goals.slice(0, 4).map(g => {
            const p = Math.min(100, 100 * g.saved / g.target || 0);
            return `<div class="mini-goal"><strong>${esc(g.name)}</strong><div class="mini-progress"><span style="width:${p}%"></span></div><small class="muted">${p.toFixed(0)}% · ${fmt(g.saved, g.currency)} / ${fmt(g.target, g.currency)}</small></div>`;
        }).join("")
        : `<div class="empty">No savings goals yet.</div>`;

    $("#budgetPreview").innerHTML = data.budgets.length
        ? data.budgets.slice(0, 4).map(b => budgetHTML(b, true)).join("")
        : `<div class="empty">No budgets yet.</div>`;
}

$('#toggleBalance').onclick = () => {
    localStorage.setItem(BAL_KEY, balHidden() ? '0' : '1');
    renderDashboard();
};

function selectDashCurrency(cur) {
    currentCurrency = cur;
    $$('.currency-tabs .currency').forEach(x => x.classList.toggle('active', x.dataset.currency === cur));
    renderDashboard();
}

// --- transaction display helpers (income / expense / transfer / exchange) ---
const TX_LABEL = { income: 'Income', expense: 'Expense', transfer: 'Transfer', exchange: 'Exchange' };
const TX_SIGN = { income: '+', expense: '−', transfer: '↔', exchange: '⇄' };
const TX_CLASS = { income: 'income-text', expense: 'expense-text', transfer: 'transfer-text', exchange: 'exchange-text' };
const txAmountText = tx => tx.type === 'exchange'
    ? `${fmt(tx.amount, tx.currency)} → ${fmt(tx.toAmount, tx.toCurrency)}`
    : `${TX_SIGN[tx.type] || ''}${fmt(tx.amount, tx.currency)}`;

function txRow(tx) {
    const ico = { income: 'ph-arrow-down', expense: 'ph-shopping-cart', transfer: 'ph-arrow-right', exchange: 'ph-arrows-clockwise' }[tx.type] || 'ph-arrow-right';
    const where = tx.wallet || (tx.from + " → " + tx.to);
    return `<div class="tx-item">
        <div class="tx-icon ${esc(tx.type)}"><i class="ph-fill ${ico}"></i></div>
        <div class="tx-info">
            <strong>${esc(tx.description)}</strong>
            <small>${esc(tx.category || TX_LABEL[tx.type])} · ${esc(where)}</small>
        </div>
        <div class="amount ${TX_CLASS[tx.type] || ''}">
            ${txAmountText(tx)}
            <small class="tx-date">${esc(tx.date)}</small>
        </div>
        <span class="pill ${esc(tx.type)}">${TX_LABEL[tx.type] || esc(tx.type)}</span>
    </div>`;
}

function renderTransactions() {
    const q = $("#searchTransactions").value.toLowerCase();
    const type = $("#typeFilter").value;
    const cat = $("#categoryFilter").value;

    const rows = data.transactions.filter(t =>
        (type === 'all' || t.type === type) &&
        (cat === 'all' || t.category === cat) &&
        (`${t.description} ${t.category || ''} ${t.wallet || ''} ${t.from || ''} ${t.to || ''}`.toLowerCase().includes(q))
    ).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    $("#transactionTable").innerHTML = rows.length
        ? rows.map(t => `<tr>
            <td><strong>${esc(t.description)}</strong></td>
            <td>${esc(t.type)}</td>
            <td>${esc(t.category || 'Transfer')}</td>
            <td>${esc(t.wallet || `${t.from} → ${t.to}`)}</td>
            <td>${t.date}</td>
            <td class="${TX_CLASS[t.type] || ''}"><strong>${txAmountText(t)}</strong></td>
            <td><div class="row-actions">
                <button class="small-btn" onclick="editTx(${t.id})"><i class="ph-bold ph-pencil-simple"></i></button>
                <button class="small-btn delete" onclick="deleteTx(${t.id})"><i class="ph-bold ph-trash"></i></button>
            </div></td>
        </tr>`).join("")
        : `<tr><td colspan="7" class="empty">No transactions found.</td></tr>`;
}

function renderGoals() {
    $("#goalsGrid").innerHTML = data.goals.length
        ? data.goals.map(g => goalHTML(g)).join("")
        : `<div class="panel empty" style="grid-column:1/-1">Create your first savings goal.</div>`;
    renderSavingsTx();
}

function goalHTML(g) {
    const p = Math.min(100, 100 * g.saved / g.target || 0);
    return `<div class="goal-card">
        <div class="goal-top">
            <div class="goal-icon"><i class="ph-fill ph-piggy-bank"></i></div>
            <button class="small-btn delete" onclick="deleteGoal(${g.id})"><i class="ph-bold ph-trash"></i></button>
        </div>
        <h3>${esc(g.name)}</h3>
        <div class="muted">${fmt(g.saved, g.currency)} saved of ${fmt(g.target, g.currency)}</div>
        ${g.deadline ? `<div class="muted">Deadline: ${esc(g.deadline)}</div>` : ''}
        <div class="progress"><div class="progress-bar" style="width:${p}%"></div></div>
        <div class="goal-foot"><span>${p.toFixed(0)}% complete</span><span>${fmt(Math.max(0, g.target - g.saved), g.currency)} left</span></div>
        <button class="secondary-btn full" onclick="addToGoal(${g.id})"><i class="ph-bold ph-plus"></i> Add money</button>
    </div>`;
}

// ---- Wallet providers (what gets created together, and its optional bank) ----
const PROVIDERS = [
    { id: 'CASH', name: 'CASH', country: 'On hand', sub: 'Physical cash', badge: 'Cash', cls: 'cash', pick: true,
      groups: [{ key: 'CASH', currencies: ['USD', 'SLSH', 'ETB'], bank: null }] },
    { id: 'ZAAD', name: 'ZAAD SERVICE', country: 'Somaliland', badge: 'ZAAD', cls: 'zaad',
      groups: [{ key: 'ZAAD', currencies: ['USD', 'SLSH'], bank: 'Darasalaam Bank' }] },
    { id: 'KAASHPLUS', name: 'KAASHPLUS', country: 'Somaliland', badge: 'K+', cls: 'kaashplus',
      groups: [{ key: 'KAASHPLUS', currencies: ['USD', 'SLSH'], bank: 'Darasalaam Bank' }] },
    { id: 'EDAHAB', name: 'EDAHAB', country: 'Somaliland', badge: 'eD', cls: 'edahab',
      groups: [{ key: 'EDAHAB', currencies: ['USD', 'SLSH'], bank: 'Dahabshiil Bank' }] },
    { id: 'EBIRR', name: 'EBIRR', country: 'Ethiopia', badge: 'e', cls: 'ebirr',
      groups: [
        { key: 'EBIRR KAAFI', currencies: ['ETB'], bank: 'Kaafi MF Bank' },
        { key: 'EBIRR COOPAY', currencies: ['ETB'], bank: 'CBO Bank' }
      ] },
    { id: 'TELEBIRR', name: 'TELEBIRR', country: 'Ethiopia', badge: 'tB', cls: 'telebirr',
      groups: [{ key: 'TELEBIRR', currencies: ['ETB'], bank: 'Tele Account' }] },
    { id: 'MPESA', name: 'M-PESA', country: 'Ethiopia', badge: 'M', cls: 'mpesa',
      groups: [{ key: 'MPESA', currencies: ['ETB'], bank: 'MPESA Bank' }] }
];
const kindOf = w => w.kind || 'Personal';
const groupWallets = (pid, gkey, kind) => data.wallets.filter(w => w.provider === pid && w.group === gkey && kindOf(w) === kind);

function groupHTML(p, g, kind) {
    const all = groupWallets(p.id, g.key, kind);
    const wal = all.filter(w => !w.isBank), banks = all.filter(w => w.isBank);
    const free = g.currencies.filter(c => !banks.some(b => b.currency === c));
    const multi = p.groups.length > 1;
    const hasBank = !!g.bank;
    const tiles = wal.map(w => `<div class="pw-tile">
        <div class="pw-tile-top"><i class="ph-fill ph-wallet"></i><small>${esc(w.currency)} Wallet</small></div>
        <strong>${fmt(walletBal(w), w.currency)}</strong></div>`).join('');
    const bankRows = banks.map(b => `<div class="pw-bank">
        <div class="pw-bank-head"><span class="pw-bank-ico"><i class="ph-fill ph-bank"></i></span>
            <div class="pw-bank-info"><strong>${esc(g.bank)}</strong><small>Bank Account · ${esc(b.currency)}${b.account ? ' · ····' + esc(String(b.account).slice(-4)) : ''}</small></div>
            <strong class="pw-bank-bal">${fmt(walletBal(b), b.currency)}</strong></div></div>`).join('');
    const note = (!hasBank || banks.length) ? '' : `<div class="pw-bank">
        <div class="pw-bank-head"><span class="pw-bank-ico"><i class="ph-fill ph-bank"></i></span>
            <div class="pw-bank-info"><strong>${esc(g.bank)}</strong><small>Bank Account</small></div>
            <span class="pw-opt">Ikhtiyaari</span></div>
        <div class="pw-note"><i class="ph ph-info"></i><span>Account number-ka waxaa lagu daraa marka la diyaariyo.</span></div></div>`;
    const add = (hasBank && free.length) ? `<button class="pw-add" onclick="openBankModal('${p.id}','${kind}','${g.key}')"><i class="ph-bold ph-plus"></i> Add Bank Account</button>` : '';
    return `<div class="pw-group">${multi ? `<div class="pw-gtitle">${esc(g.key)}</div>` : ''}
        <div class="pw-tiles">${tiles}</div>${bankRows}${note}${add}</div>`;
}

function providerCardHTML(p, kind) {
    return `<div class="panel pw-card">
        <div class="pw-head"><span class="pw-logo ${p.cls}">${esc(p.badge)}</span>
            <div class="pw-title"><strong>${esc(p.name)}</strong><small>${esc(p.sub || (p.country + ' · Mobile Money'))}</small></div>
            <button class="pw-menu" onclick="showSection('walletSettings')" title="Wallet settings"><i class="ph-bold ph-dots-three-vertical"></i></button></div>
        ${p.groups.map(g => groupHTML(p, g, kind)).join('')}
    </div>`;
}

function legacyCardHTML(list) {
    return `<div class="panel pw-card">
        <div class="pw-head"><span class="pw-logo other"><i class="ph-fill ph-wallet"></i></span>
            <div class="pw-title"><strong>OTHER WALLETS</strong><small>Created before providers</small></div></div>
        <div class="pw-group"><div class="pw-tiles">${list.map(w => `<div class="pw-tile">
            <div class="pw-tile-top"><i class="ph-fill ph-wallet"></i><small>${esc(w.name)}</small></div>
            <strong>${fmt(walletBal(w), w.currency)}</strong></div>`).join('')}</div></div>
    </div>`;
}

let walletQuery = '';
const walletMatches = w => !walletQuery || [w.name, w.type, w.kind, w.provider || '', w.group || '', w.currency, curName(w.currency), w.account || '']
    .join(' ').toLowerCase().includes(walletQuery);

function renderWallets() {
    $("#walletGrid").innerHTML = ['Personal', 'Business'].map(kind => {
        const all = data.wallets.filter(w => kindOf(w) === kind);
        const tot = kindTotals(kind);
        const chips = CURS.filter(c => all.some(w => w.currency === c)).map(c => `<span class="group-chip">${fmt(tot[c], c)}</span>`).join('');
        const cards = PROVIDERS.filter(p => data.wallets.some(w => w.provider === p.id && kindOf(w) === kind) && (!walletQuery ||
            p.name.toLowerCase().includes(walletQuery) || data.wallets.some(w => w.provider === p.id && kindOf(w) === kind && walletMatches(w))))
            .map(p => providerCardHTML(p, kind));
        const legacy = all.filter(w => !w.provider && walletMatches(w));
        if (legacy.length) cards.push(legacyCardHTML(legacy));
        return `<div class="wallet-group">
            <div class="group-head ${kind.toLowerCase()}">
                <span class="group-ico"><i class="ph-fill ${kind === 'Business' ? 'ph-briefcase' : 'ph-user'}"></i></span>
                <div><h3>${kind} Wallets</h3><small>${all.length} wallet${all.length === 1 ? '' : 's'}</small></div>
                <div class="group-chips">${chips}</div>
            </div>
            ${cards.length ? `<div class="pw-grid">${cards.join('')}</div>` : `<div class="panel empty">${walletQuery ? `No ${kind} wallets match your search.` : `No ${kind} wallets yet. Tap Settings, then New Wallet.`}</div>`}
        </div>`;
    }).join('');
}

function renderBudgets() {
    $("#budgetGrid").innerHTML = data.budgets.length
        ? data.budgets.map(b => budgetHTML(b)).join("")
        : `<div class="panel empty" style="grid-column:1/-1">Create a monthly budget to control spending.</div>`;
}

function budgetHTML(b, compact = false) {
    const spent = txAmount('expense', b.currency, b.category);
    const p = Math.min(100, 100 * spent / b.limit || 0);
    return `<div class="goal-card">
        <div class="goal-top">
            <div class="goal-icon"><i class="ph-fill ph-target"></i></div>
            <button class="small-btn delete" onclick="deleteBudget(${b.id})"><i class="ph-bold ph-trash"></i></button>
        </div>
        <h3>${esc(b.category)}</h3>
        <div class="muted">${fmt(spent, b.currency)} spent of ${fmt(b.limit, b.currency)}</div>
        <div class="progress"><div class="progress-bar" style="width:${p}%"></div></div>
        <div class="goal-foot"><span>${p.toFixed(0)}% used</span><span>${fmt(Math.max(0, b.limit - spent), b.currency)} left</span></div>
    </div>`;
}

function renderAnalytics() {
    const c = $("#analyticsCurrency").value || 'USD';
    const inc = txAmount('income', c);
    const exp = txAmount('expense', c);

    $("#aIncome").textContent = fmt(inc, c);
    $("#aExpense").textContent = fmt(exp, c);
    $("#aNet").textContent = fmt(inc - exp, c);

    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString(undefined, { month: 'short' }) });
    }

    const vals = months.map(m => {
        const its = data.transactions.filter(t => t.date.startsWith(m.key) && t.currency === c);
        return {
            ...m,
            inc: its.filter(t => t.type === 'income').reduce((a, t) => a + Number(t.amount), 0),
            exp: its.filter(t => t.type === 'expense').reduce((a, t) => a + Number(t.amount), 0)
        };
    });

    const max = Math.max(1, ...vals.flatMap(x => [x.inc, x.exp]));

    $("#monthlyChart").innerHTML = vals.map(m => `
        <div class="month-group">
            <div class="bar" style="height:${Math.max(3, m.inc / max * 90)}%" title="Income ${fmt(m.inc, c)}"></div>
            <div class="bar exp" style="height:${Math.max(3, m.exp / max * 90)}%" title="Expenses ${fmt(m.exp, c)}"></div>
            <span class="month-label">${m.label}</span>
        </div>
    `).join('') + `<div class="chart-legend"><span><i class="legend-dot"></i>Income</span><span><i class="legend-dot exp"></i>Expenses</span></div>`;

    const cats = CATS.map(cat => ({ cat, val: txAmount('expense', c, cat) }))
        .filter(x => x.val > 0)
        .sort((a, b) => b.val - a.val)
        .slice(0, 7);

    const mx = Math.max(1, ...cats.map(x => x.val));

    $("#categoryChart").innerHTML = cats.length
        ? cats.map(x => `<div class="category-row"><span>${esc(x.cat)}</span><div class="cat-track"><div class="cat-fill" style="width:${x.val / mx * 100}%"></div></div><strong>${fmt(x.val, c)}</strong></div>`).join('')
        : `<div class="empty">No expense data for ${c}.</div>`;
}

function populateWallets() {
    const opts = data.wallets.map(w => `<option value="${esc(w.name)}">${esc(w.name)} (${w.currency})</option>`).join('');
    ["txWallet", "fromWallet", "toWallet"].forEach(id => {
        const s = $("#" + id);
        if (s) s.innerHTML = opts;
    });
}

function populateCategories() {
    const cats = [...new Set([...CATS, ...data.transactions.map(t => t.category).filter(Boolean)])];
    $("#categoryFilter").innerHTML = '<option value="all">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $("#budgetCategory").innerHTML = cats.filter(c => !['Salary', 'Transfer', 'Exchange'].includes(c)).map(c => `<option>${esc(c)}</option>`).join('');
}

// ============================================================
// NAVIGATION
// ============================================================
function showSection(id) {
    $$('.section').forEach(s => s.classList.remove('active-section'));
    $('#' + id).classList.add('active-section');
    $$('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.section === (id === 'walletSettings' ? 'wallets' : id)));
    $('#pageTitle').textContent = {
        dashboard: 'Dashboard',
        transactions: 'Transactions',
        analytics: 'Analytics',
        budgets: 'Budgets',
        savings: 'Savings Goals',
        wallets: 'Wallets',
        walletSettings: 'Wallet Settings',
        settings: 'Settings & Backup'
    }[id];
}

$$('.nav-link').forEach(b => b.onclick = () => showSection(b.dataset.section));
$$('[data-go]').forEach(b => b.onclick = () => showSection(b.dataset.go));

$$('.currency').forEach(b => b.onclick = () => {
    if (!b.dataset.currency) return;
    $$('.currency').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentCurrency = b.dataset.currency;
    renderDashboard();
});

// ============================================================
// TRANSACTION MODAL
// ============================================================
function openTx(type, id = null) {
    const tx = id ? data.transactions.find(x => x.id === id) : null;
    $('#txId').value = tx ? tx.id : '';
    $('#txType').value = type;
    $('#modalTitle').textContent = tx ? 'Edit Transaction' : type === 'income' ? 'Add Income' : 'Add Expense';
    $('#txDescription').value = tx?.description || '';
    $('#txAmount').value = tx?.amount || '';
    $('#txCurrency').value = tx?.currency || 'USD';
    $('#txCategory').value = tx?.category || (type === 'income' ? 'Salary' : 'Food');
    $('#txWallet').value = tx?.wallet || data.wallets[0]?.name || '';
    $('#txDate').value = tx?.date || new Date().toISOString().slice(0, 10);
    $('#modal').classList.add('show');
}

function closeModal(id) {
    $('#' + id).classList.remove('show');
}

$('#addIncome').onclick = () => openTx('income');
$('#addExpense').onclick = () => openTx('expense');
$('#quickExpense').onclick = () => openTx('expense');
$('#closeModal').onclick = () => closeModal('modal');
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal('modal'); };
$$('[data-close]').forEach(b => b.onclick = () => closeModal(b.dataset.close));

window.editTx = id => {
    const t = data.transactions.find(x => x.id === id);
    if (t?.type === 'transfer') return toast('Transfers cannot be edited here. Delete and create a new transfer.');
    if (t?.type === 'exchange') return toast('Exchanges cannot be edited here. Delete and create a new exchange.');
    openTx(t.type, id);
};

$('#transactionForm').onsubmit = async e => {
    e.preventDefault();
    const id = Number($('#txId').value);
    const obj = {
        id: id || Date.now(),
        type: $('#txType').value,
        description: $('#txDescription').value.trim(),
        amount: Number($('#txAmount').value),
        currency: $('#txCurrency').value,
        category: $('#txCategory').value,
        wallet: $('#txWallet').value,
        date: $('#txDate').value
    };
    if (!obj.wallet) return toast('Create a wallet first.');
    if (id) {
        const i = data.transactions.findIndex(x => x.id === id);
        data.transactions[i] = obj;
    } else data.transactions.push(obj);
    closeModal('modal');
    if (await save(true, id ? 'Updating transaction...' : 'Saving transaction...')) toast(id ? 'Transaction updated.' : 'Transaction saved.');
};

// ============================================================
// TRANSFER
// ============================================================
$('#addTransfer').onclick = () => {
    $('#transferDate').value = new Date().toISOString().slice(0, 10);
    $('#transferModal').classList.add('show');
};

$('#transferForm').onsubmit = async e => {
    e.preventDefault();
    const from = $('#fromWallet').value;
    const to = $('#toWallet').value;
    if (from === to) return toast('Choose two different wallets.');
    const currency = $('#transferCurrency').value;
    const fw = data.wallets.find(w => w.name === from);
    const tw = data.wallets.find(w => w.name === to);
    if (!fw || !tw || fw.currency !== currency || tw.currency !== currency) return toast('From, To and transfer currency must match.');
    const amount = Number($('#transferAmount').value);
    if (!amount) return;
    data.transactions.push({
        id: Date.now(),
        type: 'transfer',
        description: 'Wallet transfer',
        amount,
        currency,
        category: 'Transfer',
        from,
        to,
        date: $('#transferDate').value
    });
    closeModal('transferModal');
    if (await save(true, 'Recording transfer...')) toast('Transfer recorded.');
};

// ============================================================
// WALLET SEARCH, MANAGEMENT (Settings) AND PROFILE BUTTON
// ============================================================
$('#walletSearch').addEventListener('input', e => {
    walletQuery = e.target.value.trim().toLowerCase();
    renderWallets();
});

function renderWalletManage() {
    const list = $('#walletManageList');
    if (!list) return;
    list.innerHTML = data.wallets.map(w => {
        const kind = w.kind || 'Personal';
        return `<div class="wm-item">
            <span class="wm-ico ${kind.toLowerCase()}"><i class="ph-fill ${kind === 'Business' ? 'ph-briefcase' : 'ph-user'}"></i></span>
            <div class="wm-info">
                <strong>${esc(w.fullName || 'No full name')}</strong>
                <small>${esc(w.name)} · ${kind} · ${curName(w.currency)}${w.account ? ' · Acc ' + esc(w.account) : ''}</small>
            </div>
            <div class="wm-bal">${mask(fmt(walletBal(w), w.currency))}</div>
            <div class="row-actions">
                <button class="small-btn" onclick="editWallet(${w.id})" title="Edit"><i class="ph-bold ph-pencil-simple"></i></button>
                <button class="small-btn delete" onclick="deleteWallet(${w.id})" title="Delete"><i class="ph-bold ph-trash"></i></button>
            </div>
        </div>`;
    }).join('');
    renderProviderList();
    const nm = (currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || currentUser?.email || 'A').trim();
    $('#profileInitial').textContent = nm.charAt(0).toUpperCase();
}

window.editWallet = id => {
    const w = data.wallets.find(x => x.id === id);
    if (!w) return;
    $('#weId').value = w.id;
    $('#weFullName').value = w.fullName || '';
    $('#weName').value = w.name;
    $('#weKind').value = w.kind || 'Personal';
    $('#weAccount').value = w.account || '';
    $('#walletEditModal').classList.add('show');
};

$('#walletEditForm').onsubmit = async e => {
    e.preventDefault();
    const w = data.wallets.find(x => String(x.id) === $('#weId').value);
    if (!w) return;
    const newName = $('#weName').value.trim().toUpperCase();
    if (!newName) return toast('Enter the wallet name.');
    if (newName.toLowerCase() !== w.name.toLowerCase() && data.wallets.some(x => x.name.toLowerCase() === newName.toLowerCase())) return toast('Another wallet already uses this name.');
    const old = w.name;
    if (newName !== old) {   // transactions refer to wallets by name
        data.transactions.forEach(t => {
            if (t.wallet === old) t.wallet = newName;
            if (t.from === old) t.from = newName;
            if (t.to === old) t.to = newName;
        });
        w.name = newName;
    }
    w.fullName = $('#weFullName').value.trim();
    w.kind = $('#weKind').value === 'Business' ? 'Business' : 'Personal';
    w.account = $('#weAccount').value.trim();
    closeModal('walletEditModal');
    if (await save(true, 'Saving wallet...')) toast('Wallet updated.');
};

$('#profileBtn').onclick = () => showSection('walletSettings');
$('#walletSettingsBtn').onclick = () => showSection('walletSettings');

// ============================================================
// EXCHANGE RATES (Settings)
// ============================================================
$('#ratesForm').onsubmit = async e => {
    e.preventDefault();
    data.rates = {
        USD_SLSH: Math.max(0, Number($('#rateUsdSlsh').value) || 0),
        USD_ETB: Math.max(0, Number($('#rateUsdEtb').value) || 0)
    };
    if (await save(true, 'Saving exchange rates...')) toast('Exchange rates saved.');
};

// ============================================================
// DASHBOARD QUICK ACTIONS
// ============================================================
$('#qaIncome').onclick = () => openTx('income');
$('#qaExpense').onclick = () => openTx('expense');
$('#qaTransfer').onclick = () => $('#addTransfer').click();
$('#qaExchange').onclick = () => openExchange();

// ============================================================
// EXCHANGE (move money between two wallets of different currencies)
// ============================================================
const exWallet = id => data.wallets.find(w => w.name === $(id).value);
const roundTo = (n, d) => Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0;

function exWalletOptions(selected) {
    return data.wallets.map(w => `<option value="${esc(w.name)}" ${w.name === selected ? 'selected' : ''}>${esc(w.name)} · ${curName(w.currency)}${w.kind === 'Business' ? ' (Business)' : ''}</option>`).join('');
}

function applySavedRate() {
    const f = exWallet('#exFromWallet'), t = exWallet('#exToWallet');
    if (!f || !t) return;
    const r = savedRate(f.currency, t.currency);
    $('#exRate').value = r ? roundTo(r, 6) : '';
    exFromRate();
}

function refreshExchangeLabels() {
    const f = exWallet('#exFromWallet'), t = exWallet('#exToWallet');
    if (!f || !t) return;
    $('#exFromCur').textContent = '(' + f.currency + ')';
    $('#exToCur').textContent = '(' + t.currency + ')';
    $('#exRateHint').textContent = `(1 ${f.currency} = ? ${t.currency})`;
    $('#exSummary').innerHTML = f.currency === t.currency
        ? `<span class="ex-warn">Choose wallets with two different currencies.</span>`
        : `<span>${curName(f.currency)}</span><i class="ph-bold ph-arrows-clockwise"></i><span>${curName(t.currency)}</span>`;
}

function openExchange() {
    const curs = new Set(data.wallets.map(w => w.currency));
    if (data.wallets.length < 2 || curs.size < 2) return toast('Create wallets in two different currencies first.');
    const first = data.wallets[0];
    const other = data.wallets.find(w => w.currency !== first.currency);
    $('#exFromWallet').innerHTML = exWalletOptions(first.name);
    $('#exToWallet').innerHTML = exWalletOptions(other.name);
    ['#exAmount', '#exRate', '#exReceive'].forEach(i => $(i).value = '');
    $('#exDate').value = new Date().toISOString().slice(0, 10);
    refreshExchangeLabels();
    applySavedRate();
    $('#exchangeModal').classList.add('show');
}

$('#addExchange').onclick = openExchange;

$('#exFromWallet').onchange = () => {
    const f = exWallet('#exFromWallet'), t = exWallet('#exToWallet');
    if (f && t && f.currency === t.currency) {
        const alt = data.wallets.find(w => w.currency !== f.currency);
        if (alt) $('#exToWallet').value = alt.name;
    }
    refreshExchangeLabels();
    applySavedRate();
};
$('#exToWallet').onchange = () => { refreshExchangeLabels(); applySavedRate(); };

const exFromRate = () => {                       // amount x rate -> receive
    const a = Number($('#exAmount').value), r = Number($('#exRate').value);
    if (a > 0 && r > 0) $('#exReceive').value = roundTo(a * r, 2);
};
$('#exAmount').addEventListener('input', exFromRate);
$('#exRate').addEventListener('input', exFromRate);
$('#exReceive').addEventListener('input', () => {   // receive / amount -> rate
    const a = Number($('#exAmount').value), got = Number($('#exReceive').value);
    if (a > 0 && got > 0) $('#exRate').value = roundTo(got / a, 6);
});

$('#exchangeForm').onsubmit = async e => {
    e.preventDefault();
    const f = exWallet('#exFromWallet'), t = exWallet('#exToWallet');
    if (!f || !t) return toast('Choose both wallets.');
    if (f.currency === t.currency) return toast('Exchange needs two different currencies.');
    const amount = Number($('#exAmount').value);
    const toAmount = Number($('#exReceive').value);
    if (!(amount > 0) || !(toAmount > 0)) return toast('Enter the amount and the exchange rate.');
    if (amount > walletBal(f) && !confirm(`${f.name} only has ${fmt(walletBal(f), f.currency)}. Exchange anyway?`)) return;
    data.transactions.push({
        id: Date.now(),
        type: 'exchange',
        description: `Exchange ${f.currency} → ${t.currency}`,
        amount,
        currency: f.currency,
        toAmount,
        toCurrency: t.currency,
        rate: roundTo(toAmount / amount, 6),
        category: 'Exchange',
        from: f.name,
        to: t.name,
        date: $('#exDate').value
    });
    closeModal('exchangeModal');
    if (await save(true, 'Recording exchange...')) toast('Exchange recorded.');
};

// ============================================================
// GOALS
// ============================================================
$('#addGoal').onclick = () => $('#goalModal').classList.add('show');

$('#goalForm').onsubmit = async e => {
    e.preventDefault();
    data.goals.push({
        id: Date.now(),
        name: $('#goalName').value.trim(),
        target: Number($('#goalTarget').value),
        saved: 0,
        currency: $('#goalCurrency').value,
        deadline: $('#goalDeadline').value
    });
    e.target.reset();
    closeModal('goalModal');
    if (await save(true, 'Creating savings goal...')) toast('Savings goal created.');
};

// ---- Savings transactions (separate from the main Transactions) ----
function openSavingsTx(goalId) {
    if (!data.goals.length) return toast('Create a savings goal first.');
    $('#stGoal').innerHTML = data.goals.map(g => `<option value="${g.id}" ${g.id === goalId ? 'selected' : ''}>${esc(g.name)} (${g.currency})</option>`).join('');
    setSavingsType('deposit');
    $('#stAmount').value = '';
    $('#stNote').value = '';
    $('#stDate').value = new Date().toISOString().slice(0, 10);
    refreshSavingsCur();
    $('#savingsTxModal').classList.add('show');
}
function refreshSavingsCur() {
    const g = data.goals.find(x => String(x.id) === $('#stGoal').value);
    $('#stCur').textContent = g ? '(' + g.currency + ')' : '';
}
function setSavingsType(t) {
    $('#stType').value = t;
    $$('#stTypeSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.st === t));
}
window.addToGoal = id => openSavingsTx(id);
$('#addSavingsTx').onclick = () => openSavingsTx();
$('#stGoal').onchange = refreshSavingsCur;
$$('#stTypeSeg .seg-btn').forEach(b => b.addEventListener('click', () => setSavingsType(b.dataset.st)));

$('#savingsTxForm').onsubmit = async e => {
    e.preventDefault();
    const g = data.goals.find(x => String(x.id) === $('#stGoal').value);
    const amount = Number($('#stAmount').value);
    const type = $('#stType').value === 'withdraw' ? 'withdraw' : 'deposit';
    if (!g) return toast('Choose a goal.');
    if (!(amount > 0)) return toast('Enter a valid amount.');
    if (type === 'withdraw' && amount > Number(g.saved)) return toast(`You only have ${fmt(g.saved, g.currency)} saved in this goal.`);
    g.saved = Number(g.saved) + (type === 'deposit' ? amount : -amount);
    data.savingsTx.push({
        id: Date.now(), goalId: g.id, goalName: g.name, type, amount,
        currency: g.currency, date: $('#stDate').value, note: $('#stNote').value.trim()
    });
    closeModal('savingsTxModal');
    if (await save(true, 'Saving transaction...')) toast(type === 'deposit' ? 'Deposit saved.' : 'Withdrawal saved.');
};

function renderSavingsTx() {
    const body = $('#savingsTxTable');
    if (!body) return;
    const q = ($('#searchSavings')?.value || '').trim().toLowerCase();
    const tf = $('#savingsTypeFilter')?.value || 'all';
    const rows = [...data.savingsTx]
        .filter(t => (tf === 'all' || t.type === tf) && (!q || [t.goalName, t.note, t.type, t.currency].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    body.innerHTML = rows.length ? rows.map(t => `<tr>
        <td>${esc(t.date)}</td>
        <td><strong>${esc(t.goalName)}</strong></td>
        <td><span class="pill ${t.type === 'deposit' ? 'income' : 'expense'}">${t.type === 'deposit' ? 'Deposit' : 'Withdraw'}</span></td>
        <td>${esc(t.note || '—')}</td>
        <td class="${t.type === 'deposit' ? 'income-text' : 'expense-text'}"><strong>${t.type === 'deposit' ? '+' : '−'}${fmt(t.amount, t.currency)}</strong></td>
        <td><div class="row-actions"><button class="small-btn delete" onclick="deleteSavingsTx(${t.id})"><i class="ph-bold ph-trash"></i></button></div></td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">No savings transactions yet.</td></tr>`;
}
$('#searchSavings').addEventListener('input', renderSavingsTx);
$('#savingsTypeFilter').addEventListener('change', renderSavingsTx);

window.deleteSavingsTx = id => requestSecureAction(async () => {
    const t = data.savingsTx.find(x => x.id === id);
    if (!t) return;
    const g = data.goals.find(x => x.id === t.goalId);
    if (g) g.saved = Math.max(0, Number(g.saved) + (t.type === 'deposit' ? -t.amount : t.amount));
    data.savingsTx = data.savingsTx.filter(x => x.id !== id);
    if (await save(true, 'Deleting savings transaction...')) toast('Savings transaction deleted.');
});

window.deleteGoal = id => {
    if (confirm('Delete this savings goal?')) {
        data.goals = data.goals.filter(x => x.id !== id);
        save();
    }
};

window.deleteTx = id => {
    if (confirm('Delete this transaction?')) {
        data.transactions = data.transactions.filter(x => x.id !== id);
        save();
        toast('Transaction deleted.');
    }
};

// ============================================================
// WALLETS
// ============================================================
function renderProviderList() {
    const list = $('#providerList');
    if (!list) return;
    list.innerHTML = PROVIDERS.map(p => {
        const curs = [...new Set(p.groups.flatMap(g => g.currencies))].join(' · ');
        const n = data.wallets.filter(w => w.provider === p.id).length;
        return `<div class="prov-row">
            <span class="pw-logo ${p.cls}">${esc(p.badge)}</span>
            <div class="prov-info"><strong>${esc(p.name)}</strong><small>${esc(p.country)} · ${esc(curs)}${n ? ' · ' + n + ' created' : ''}</small></div>
            <button class="pw-add inline" onclick="openProviderModal('${p.id}')"><i class="ph-bold ph-plus"></i> Create</button>
        </div>`;
    }).join('');
}

function updateProviderHint() {
    const p = PROVIDERS.find(x => x.id === $('#walletProvider').value);
    if (!p) return;
    const names = p.groups.flatMap(g => g.currencies.map(c => `${g.key} ${c}`));
    const row = $('#walletCurRow');
    row.hidden = !p.pick;
    if (p.pick) {
        $('#walletCurChips').innerHTML = p.groups[0].currencies.map((c, i) => `<button type="button" class="chip${i === 0 ? ' active' : ''}" data-cur="${c}">${esc(curName(c))}</button>`).join('');
        $$('#walletCurChips .chip').forEach(b => b.onclick = () => b.classList.toggle('active'));
        $('#walletProviderHint').innerHTML = 'Cash wallets are created on their own. Pick the currencies you hold cash in; you can add another currency later.';
        return;
    }
    $('#walletProviderHint').innerHTML = `Creates: <b>${esc(names.join(', '))}</b>.<br>Bank: ${esc(p.groups.map(g => g.bank).join(', '))} (optional, added later from the Wallets page).`;
}

window.openProviderModal = id => {
    $('#walletProvider').innerHTML = PROVIDERS.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.country)})</option>`).join('');
    if (id) $('#walletProvider').value = id;
    updateProviderHint();
    $('#walletModal').classList.add('show');
};
$('#addWallet').onclick = () => openProviderModal();
$('#walletProvider').addEventListener('change', updateProviderHint);

function uniqueWalletName(base, kind) {
    const taken = n => data.wallets.some(w => w.name.toLowerCase() === n.toLowerCase());
    if (!taken(base)) return base;
    if (kind === 'Business' && !taken(base + ' BUSINESS')) return base + ' BUSINESS';
    let i = 2;
    while (taken(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}

$('#walletForm').onsubmit = async e => {
    e.preventDefault();
    const p = PROVIDERS.find(x => x.id === $('#walletProvider').value);
    if (!p) return;
    const kind = $('#walletKind').value === 'Business' ? 'Business' : 'Personal';
    let picked = null;
    if (p.pick) {
        picked = [...$$('#walletCurChips .chip.active')].map(b => b.dataset.cur);
        if (!picked.length) return toast('Choose at least one currency.');
    } else if (data.wallets.some(w => w.provider === p.id && kindOf(w) === kind)) {
        return toast(`${p.name} (${kind}) already exists.`);
    }
    const fullName = $('#walletFullName').value.trim();
    const made = [];
    let i = 0;
    p.groups.forEach(g => g.currencies.filter(c => !picked || picked.includes(c)).forEach(currency => {
        if (p.pick && data.wallets.some(w => w.provider === p.id && w.group === g.key && kindOf(w) === kind && w.currency === currency)) return;
        const name = uniqueWalletName(`${g.key} ${currency}`, kind);
        made.push(name);
        data.wallets.push({ id: Date.now() + (i++), name, fullName, kind, account: '', type: p.pick ? 'Cash' : 'E-Wallet', currency, provider: p.id, group: g.key, isBank: false });
    }));
    if (!made.length) return toast(`${p.name} (${kind}) already has those currencies.`);
    e.target.reset();
    setWalletKind('Personal');
    closeModal('walletModal');
    if (await save(true, 'Creating wallet...')) toast('Wallet created: ' + made.join(', '));
    showSection('wallets');
};

// Bank account: only after the provider wallet exists, and linked to it
window.openBankModal = (pid, kind, gkey) => {
    const p = PROVIDERS.find(x => x.id === pid);
    const g = p?.groups.find(x => x.key === gkey);
    if (!g) return;
    const free = g.currencies.filter(c => !groupWallets(pid, gkey, kind).some(w => w.isBank && w.currency === c));
    if (!free.length) return toast('Bank account already added.');
    $('#bkProvider').value = pid; $('#bkKind').value = kind; $('#bkGroup').value = gkey;
    $('#bkInfo').innerHTML = `<b>${esc(g.bank)}</b> will be linked to <b>${esc(g.key)}</b>.`;
    $('#bkCurrency').innerHTML = free.map(c => `<option value="${c}">${esc(curName(c))}</option>`).join('');
    $('#bkAccount').value = '';
    $('#bankModal').classList.add('show');
};

$('#bankForm').onsubmit = async e => {
    e.preventDefault();
    const pid = $('#bkProvider').value, kind = $('#bkKind').value, gkey = $('#bkGroup').value;
    const p = PROVIDERS.find(x => x.id === pid);
    const g = p?.groups.find(x => x.key === gkey);
    const account = $('#bkAccount').value.trim();
    if (!g) return;
    if (!account) return toast('Enter the account number.');
    const currency = $('#bkCurrency').value;
    const parent = groupWallets(pid, gkey, kind).find(w => !w.isBank);
    if (!parent) return toast('Create the wallet first.');
    const name = uniqueWalletName(`${g.bank.toUpperCase()} ${currency}`, kind);
    data.wallets.push({ id: Date.now(), name, fullName: parent.fullName || '', kind, account, type: 'Bank', currency, provider: pid, group: gkey, isBank: true });
    closeModal('bankModal');
    if (await save(true, 'Adding bank account...')) toast('Bank account added: ' + name);
};

window.deleteWallet = id => {
    if (data.wallets.length <= 1) return toast('Keep at least one wallet.');
    const w = data.wallets.find(x => x.id === id);
    const linked = (!w.isBank && w.provider)
        ? data.wallets.filter(x => x.isBank && x.provider === w.provider && x.group === w.group && kindOf(x) === kindOf(w))
        : [];
    const lastOfGroup = linked.length && !data.wallets.some(x => x.id !== w.id && !x.isBank && x.provider === w.provider && x.group === w.group && kindOf(x) === kindOf(w));
    const gone = lastOfGroup ? [w.id, ...linked.map(x => x.id)] : [w.id];
    if (data.wallets.length - gone.length < 1) return toast('Keep at least one wallet.');
    if (confirm(`Delete ${w.name}${lastOfGroup ? ' and its linked bank account' : ''}? Existing transactions will remain.`)) {
        data.wallets = data.wallets.filter(x => !gone.includes(x.id));
        save();
    }
};

// ============================================================
// BUDGETS
// ============================================================
$('#addBudget').onclick = () => $('#budgetModal').classList.add('show');

$('#budgetForm').onsubmit = async e => {
    e.preventDefault();
    const category = $('#budgetCategory').value;
    const currency = $('#budgetCurrency').value;
    const limit = Number($('#budgetLimit').value);
    if (data.budgets.some(b => b.category === category && b.currency === currency)) return toast('A budget for this category already exists.');
    data.budgets.push({ id: Date.now(), category, currency, limit });
    e.target.reset();
    closeModal('budgetModal');
    if (await save(true, 'Creating budget...')) toast('Budget created.');
};

window.deleteBudget = id => {
    if (confirm('Delete this budget?')) {
        data.budgets = data.budgets.filter(b => b.id !== id);
        save();
    }
};

// ============================================================
// FILTERS
// ============================================================
['searchTransactions', 'typeFilter', 'categoryFilter'].forEach(id => $('#' + id).addEventListener('input', renderTransactions));
$('#analyticsCurrency').onchange = renderAnalytics;

// ============================================================
// SMART SPENDING CHECK
// ============================================================
$('#checkSpending').onclick = () => {
    const item = prompt('What do you want to buy?');
    if (!item) return;
    const amount = Number(prompt('How much does it cost?'));
    if (!amount) return;
    const type = prompt('Is it a NEED or WANT?', 'WANT');
    if (type?.toUpperCase() === 'NEED') toast('Check your budget, then buy.');
    else toast('WAIT 24 HOURS before buying this.');
};

// ============================================================
// THEME
// ============================================================
$('#themeBtn').onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('activityplus_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

if (localStorage.getItem('activityplus_theme') === 'dark') document.body.classList.add('dark');

// ============================================================
// EXPORT / IMPORT
// ============================================================
function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

$('#exportJson').onclick = () => download('ActivityPlus-backup.json', JSON.stringify(data, null, 2), 'application/json');

$('#exportCsv').onclick = () => {
    const rows = [
        ['Date', 'Type', 'Description', 'Category', 'Wallet/From', 'To', 'Currency', 'Amount', 'To Currency', 'To Amount'],
        ...data.transactions.map(t => [t.date, t.type, t.description, t.category || '', t.wallet || t.from || '', t.to || '', t.currency, t.amount, t.toCurrency || '', t.toAmount || ''])
    ];
    download('ActivityPlus-transactions.csv', rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n'), 'text/csv');
};

$('#importJson').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
        let x;
        try {
            x = JSON.parse(r.result);
            if (!x.transactions || !x.wallets) throw Error();
        } catch {
            e.target.value = '';
            return toast('Invalid ActivityPlus backup.');
        }
        data = normalizeData({ ...defaultData, ...x });
        if (await save(true, 'Importing backup...')) toast('Backup restored.');
        e.target.value = '';
    };
    r.readAsText(f);
};

// ============================================================
// PIN
// ============================================================
$('#setPin').onclick = () => {
    const pin = prompt('Set a 4-6 digit PIN:');
    if (!/^\d{4,6}$/.test(pin || '')) return toast('PIN must be 4-6 digits.');
    localStorage.setItem('activityplus_pin', pin);
    toast('PIN saved on this browser.');
};

$('#removePin').onclick = () => {
    localStorage.removeItem('activityplus_pin');
    toast('PIN removed.');
};

$('#resetData').onclick = () => {
    if (confirm('Reset all ActivityPlus data? This cannot be undone.')) {
        data = JSON.parse(JSON.stringify(defaultData));
        save();
        toast('All data reset.');
    }
};

// ============================================================
// LOGIN + SUPABASE
// ============================================================
const SUPABASE_URL = "https://supvvuzyuaptstedwqsu.supabase.co";
const SUPABASE_KEY = "sb_publishable_jeX4deGHUQgW9iHWD__dsg_dh-mxrml";
const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);


const loginScreen = $("#loginScreen");
const appShell = $$(".sidebar, .main");

const setLoggedInUI = logged => {
    loginScreen.classList.toggle("hidden", logged);
    appShell.forEach(el => el.classList.toggle("app-hidden", !logged));
};

const showLoginError = msg => {
    $("#loginError").textContent = msg || "";
};

function loadProfile(user) {
    const name = user.user_metadata?.full_name || user.user_metadata?.name || "";
    if ($("#profileName")) $("#profileName").value = name;
    if ($("#profileEmail")) $("#profileEmail").value = user.email || "";
    updatePinStatus();
}

async function bootAuth() {
    if (!sb) {
        showLoginError("Login service could not load. Check your internet connection.");
        return;
    }
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) {
        showLoginError(error.message || "Could not restore login session.");
        setLoggedInUI(false);
        return;
    }
    if (session) {
        currentUser = session.user;
        setLoggedInUI(true);
        loadProfile(session.user);
        await loadRemoteData();
    } else {
        currentUser = null;
        setLoggedInUI(false);
    }
    sb.auth.onAuthStateChange(async (_event, newSession) => {
        const prevId = currentUser?.id || null;
        currentUser = newSession?.user || null;
        setLoggedInUI(!!newSession);
        if (newSession) {
            loadProfile(newSession.user);
            // Show the loading overlay only for a fresh login, not for silent token refreshes
            if (prevId !== newSession.user.id) await withBusy('Loading your data...', loadRemoteData);
            else await loadRemoteData();
        }
    });
}

$("#loginForm").onsubmit = async e => {
    e.preventDefault();
    showLoginError("");
    if (!sb) return showLoginError("Login service unavailable.");
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    setBusy("Signing in...");
    let error;
    try {
        ({ error } = await sb.auth.signInWithPassword({ email, password }));
    } finally {
        clearBusy();
    }
    if (error) return showLoginError(error.message || "Login failed. Check email and password.");
    $("#loginPassword").value = "";
    toast("Login successful.");
};

function updatePinStatus() {
    const has = /^\d{4,6}$/.test(localStorage.getItem("activityplus_pin") || "");
    if ($("#pinStatus")) $("#pinStatus").textContent = has ? "PIN is active on this browser." : "No PIN created yet.";
}

$("#logoutBtn").onclick = async () => {
    await withBusy("Signing out...", async () => {
        if (sb) await sb.auth.signOut();
        currentUser = null;
        data = normalizeData(defaultData);
    });
};

$("#profileForm").onsubmit = async e => {
    e.preventDefault();
    if (!sb) return;
    const name = $("#profileName").value.trim();
    const { error } = await withBusy("Saving profile...", () => sb.auth.updateUser({ data: { full_name: name } }));
    toast(error ? error.message : "Profile updated.");
    if (!error && currentUser) { currentUser.user_metadata = { ...(currentUser.user_metadata || {}), full_name: name }; renderDashboard(); }
};

$("#passwordForm").onsubmit = async e => {
    e.preventDefault();
    if (!sb) return;
    const a = $("#newPassword").value;
    const b = $("#confirmPassword").value;
    if (a.length < 6) return toast("Password must be at least 6 characters.");
    if (a !== b) return toast("Passwords do not match.");
    const { error } = await withBusy("Updating password...", () => sb.auth.updateUser({ password: a }));
    if (error) toast(error.message);
    else {
        e.target.reset();
        toast("Password updated successfully.");
    }
};

$("#settingsThemeBtn").onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('activityplus_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

// ============================================================
// WALLET PRESETS
// ============================================================
function setWalletKind(kind) {
    $("#walletKind").value = kind;
    $$("#walletKindSeg .seg-btn").forEach(b => b.classList.toggle("active", b.dataset.kind === kind));
}
$$("#walletKindSeg .seg-btn").forEach(b => b.addEventListener("click", () => setWalletKind(b.dataset.kind)));


// ============================================================
// CURRENCY WALLET SELECTS
// ============================================================
function walletOptionsForCurrency(currency, selected = "") {
    return data.wallets.filter(w => w.currency === currency).map(w => `<option value="${esc(w.name)}" ${w.name === selected ? 'selected' : ''}>${esc(w.name)}</option>`).join("");
}

function refreshCurrencyWalletSelects() {
    const c = $("#txCurrency")?.value || "USD";
    const tw = $("#txWallet");
    if (tw) tw.innerHTML = walletOptionsForCurrency(c, tw.value) || `<option value="">No ${c} wallet yet</option>`;
    const tc = $("#transferCurrency")?.value || "USD";
    [$("#fromWallet"), $("#toWallet")].forEach(s => {
        if (s) {
            const old = s.value;
            s.innerHTML = walletOptionsForCurrency(tc, old);
        }
    });
}

$("#txCurrency").addEventListener("change", refreshCurrencyWalletSelects);
$("#transferCurrency").addEventListener("change", refreshCurrencyWalletSelects);

const originalPopulateWallets = populateWallets;
populateWallets = () => {
    originalPopulateWallets();
    refreshCurrencyWalletSelects();
};

// ============================================================
// SECURE ACTIONS (PIN + PASSWORD)
// ============================================================
let pendingSecureAction = null;

async function requestSecureAction(action) {
    if (!localStorage.getItem("activityplus_pin")) return toast("Create a PIN first in Settings.");
    pendingSecureAction = action;
    $("#confirmActionPassword").value = "";
    $("#confirmActionPin").value = "";
    $("#pinConfirmModal").classList.add("show");
}

$("#pinConfirmForm").onsubmit = async e => {
    e.preventDefault();
    if (!sb) return;
    const pin = $("#confirmActionPin").value;
    const password = $("#confirmActionPassword").value;
    if (pin !== localStorage.getItem("activityplus_pin")) return toast("Incorrect PIN.");
    setBusy("Verifying...");
    let user, error;
    try {
        ({ data: { user } } = await sb.auth.getUser());
        if (user?.email) ({ error } = await sb.auth.signInWithPassword({ email: user.email, password }));
    } finally {
        clearBusy();
    }
    if (!user?.email) return toast("Please login again.");
    if (error) return toast("Incorrect password.");
    const fn = pendingSecureAction;
    pendingSecureAction = null;
    $("#pinConfirmModal").classList.remove("show");
    if (fn) fn();
};

window.deleteTx = id => requestSecureAction(async () => {
    data.transactions = data.transactions.filter(x => x.id !== id);
    if (await save(true, "Deleting transaction...")) toast("Transaction deleted.");
});

window.deleteGoal = id => requestSecureAction(async () => {
    data.goals = data.goals.filter(x => x.id !== id);
    if (await save(true, "Deleting savings goal...")) toast("Savings goal deleted.");
});

window.deleteWallet = id => requestSecureAction(async () => {
    if (data.wallets.length <= 1) return toast("Keep at least one wallet.");
    data.wallets = data.wallets.filter(x => x.id !== id);
    if (await save(true, "Deleting wallet...")) toast("Wallet deleted.");
});

window.deleteBudget = id => requestSecureAction(async () => {
    data.budgets = data.budgets.filter(x => x.id !== id);
    if (await save(true, "Deleting budget...")) toast("Budget deleted.");
});

$("#resetData").onclick = () => requestSecureAction(async () => {
    data = JSON.parse(JSON.stringify(defaultData));
    if (await save(true, "Resetting data...")) toast("All data reset.");
});


// ============================================================
// PDF REPORT (Settings -> Report)
// ============================================================
function reportRange(period) {
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const today = ymd(now);
    if (period === 'month') {
        const from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
        return { from, to: today, label: 'This month (' + now.toLocaleString('en-US', { month: 'long', year: 'numeric' }) + ')' };
    }
    if (period === '30') {
        const d = new Date(now); d.setDate(d.getDate() - 29);
        return { from: ymd(d), to: today, label: 'Last 30 days' };
    }
    if (period === 'year') {
        return { from: now.getFullYear() + '-01-01', to: today, label: 'This year (' + now.getFullYear() + ')' };
    }
    return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
}

function walletBalanceOf(w) { return walletBal(w); }

const REPORT_LOGO = "data:image/png;base64,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";

function downloadReportPdf() {
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) return toast('PDF tool could not load. Check your internet and try again.');
    try {
        const range = reportRange($('#reportPeriod').value);
        const txs = data.transactions
            .filter(t => t.date >= range.from && t.date <= range.to)
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        const sum = (type, c, cat) => txs.filter(t => t.type === type && t.currency === c && (!cat || t.category === cat)).reduce((a, t) => a + Number(t.amount), 0);

        const doc = new JsPDF({ unit: 'pt', format: 'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const M = 40;
        const GREEN = [10, 155, 64];
        const INK = [13, 27, 42];
        const MUTED = [107, 122, 144];
        const now = new Date();

        // Header band
        doc.setFillColor(...GREEN);
        doc.rect(0, 0, W, 92, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(M, 23, 46, 46, 11, 11, 'F');
        try { doc.addImage(REPORT_LOGO, 'PNG', M + 6, 29, 34, 34); } catch (e) { /* logo is optional */ }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.text('ActivityPlus', M + 60, 44);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.text('Personal Finance Report', M + 60, 64);
        doc.setFontSize(10);
        doc.text(range.label, W - M, 44, { align: 'right' });
        doc.text('Generated ' + now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), W - M, 62, { align: 'right' });

        let y = 118;
        const who = ($('#profileName') && $('#profileName').value) || (currentUser && currentUser.email) || '';
        if (who) {
            doc.setTextColor(...MUTED);
            doc.setFontSize(10);
            doc.text('Prepared for ' + who, M, y);
            y += 22;
        }

        const heading = (text) => {
            if (y > H - 140) { doc.addPage(); y = 50; }
            doc.setTextColor(...INK);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.text(text, M, y);
            y += 10;
        };
        const emptyNote = (text) => {
            doc.setTextColor(...MUTED);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.text(text, M, y + 12);
            y += 36;
        };
        const table = (head, body, opts = {}) => {
            if (!body.length) return emptyNote(opts.empty || 'No data.');
            doc.autoTable({
                startY: y,
                head: [head],
                body,
                margin: { left: M, right: M },
                theme: 'striped',
                styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: INK, overflow: 'linebreak' },
                headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [244, 250, 246] },
                columnStyles: opts.columnStyles || {}
            });
            y = doc.lastAutoTable.finalY + 26;
        };

        // 1. Summary by currency
        heading('Summary by currency');
        table(
            ['Currency', 'Balance now', 'Income', 'Expenses', 'Net', 'Savings saved'],
            CURS.map(c => [
                curName(c),
                fmt(currencyBalance(c), c),
                fmt(sum('income', c), c),
                fmt(sum('expense', c), c),
                fmt(sum('income', c) - sum('expense', c), c),
                fmt(data.goals.filter(g => g.currency === c).reduce((a, g) => a + Number(g.saved), 0), c)
            ]),
            { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } }
        );

        // 2. Wallets
        heading('Wallet balances (today)');
        table(
            ['Wallet', 'Category', 'Type', 'Currency', 'Balance'],
            data.wallets.map(w => [w.name, w.kind || 'Personal', w.type || 'Wallet', w.currency, fmt(walletBalanceOf(w), w.currency)]),
            { columnStyles: { 4: { halign: 'right' } }, empty: 'No wallets yet.' }
        );

        // 3. Spending by category (period)
        const catRows = [];
        CURS.forEach(c => {
            [...new Set(txs.filter(t => t.type === 'expense' && t.currency === c).map(t => t.category || 'Other'))]
                .map(cat => ({ cat, val: sum('expense', c, cat) }))
                .sort((a, b) => b.val - a.val)
                .forEach(x => catRows.push([c, x.cat, fmt(x.val, c)]));
        });
        heading('Spending by category');
        table(['Currency', 'Category', 'Spent'], catRows, { columnStyles: { 2: { halign: 'right' } }, empty: 'No expenses in this period.' });

        // 4. Budgets
        heading('Budgets');
        table(
            ['Category', 'Currency', 'Limit', 'Spent', 'Used'],
            data.budgets.map(b => {
                const spent = txAmount('expense', b.currency, b.category);
                return [b.category, b.currency, fmt(b.limit, b.currency), fmt(spent, b.currency), Math.min(999, 100 * spent / b.limit || 0).toFixed(0) + '%'];
            }),
            { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }, empty: 'No budgets yet.' }
        );

        // 5. Savings goals
        heading('Savings goals');
        table(
            ['Goal', 'Currency', 'Saved', 'Target', 'Progress', 'Deadline'],
            data.goals.map(g => [g.name, g.currency, fmt(g.saved, g.currency), fmt(g.target, g.currency), Math.min(100, 100 * g.saved / g.target || 0).toFixed(0) + '%', g.deadline || '-']),
            { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }, empty: 'No savings goals yet.' }
        );

        // 6. Transactions
        heading('Transactions (' + txs.length + ')');
        table(
            ['Date', 'Type', 'Description', 'Category', 'Wallet', 'Amount'],
            txs.map(t => [
                t.date,
                t.type.charAt(0).toUpperCase() + t.type.slice(1),
                t.description,
                t.category || 'Transfer',
                t.wallet || `${t.from} -> ${t.to}`,
                t.type === 'exchange'
                    ? fmt(t.amount, t.currency) + ' -> ' + fmt(t.toAmount, t.toCurrency)
                    : (t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '') + fmt(t.amount, t.currency)
            ]),
            { columnStyles: { 5: { halign: 'right' } }, empty: 'No transactions in this period.' }
        );

        // Footer on every page
        const pages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            doc.setPage(i);
            doc.setDrawColor(230, 237, 233);
            doc.line(M, H - 34, W - M, H - 34);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(...MUTED);
            doc.text('ActivityPlus - Personal Finance', M, H - 20);
            doc.text('Page ' + i + ' of ' + pages, W - M, H - 20, { align: 'right' });
        }

        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        doc.save(`ActivityPlus-report-${stamp}.pdf`);
        toast('PDF report downloaded.');
    } catch (err) {
        console.error('ActivityPlus PDF error:', err);
        toast('Could not create the PDF: ' + (err.message || 'unknown error'));
    }
}

$('#downloadPdf').onclick = async () => {
    setBusy('Preparing your report...');
    try {
        await nextPaint();   // let the loading overlay paint before the heavy PDF work
        downloadReportPdf();
    } finally {
        clearBusy();
    }
};

// ============================================================
// INIT
// ============================================================
if (localStorage.getItem("activityplus_theme") === "dark") document.body.classList.add("dark");

setupEyeToggles();
renderAll();
updatePinStatus();
refreshCurrencyWalletSelects();
const bootStarted = Date.now();
bootAuth().finally(() => setTimeout(hideSplash, Math.max(0, 1000 - (Date.now() - bootStarted))));

// ============================================================
// MODERN SELECT (custom dropdown on top of every <select>)
// ============================================================
(function modernSelects() {
    const valDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(HTMLSelectElement.prototype, 'value', {
        get() { return valDesc.get.call(this); },
        set(v) { valDesc.set.call(this, v); this._cs && this._cs.sync(); }
    });
    let panel = null, owner = null;
    const closePanel = () => { if (panel) panel.remove(); if (owner) owner.wrap.classList.remove('open'); panel = owner = null; };

    function build(sel) {
        if (sel._cs || sel.closest('.cs')) return;
        const wrap = document.createElement('div');
        wrap.className = 'cs' + (sel.classList.contains('currency') ? ' cs-pill' : '');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'cs-btn';
        btn.innerHTML = '<span class="cs-label"></span><i class="ph-bold ph-caret-down"></i>';
        sel.parentNode.insertBefore(wrap, sel);
        wrap.appendChild(btn); wrap.appendChild(sel);
        sel.classList.add('cs-native');
        const label = btn.querySelector('.cs-label');
        const api = {
            wrap, sel,
            sync() {
                const o = sel.options[sel.selectedIndex];
                label.textContent = o ? o.textContent : '';
                label.classList.toggle('placeholder', !o || o.value === '');
                btn.disabled = sel.disabled;
            }
        };
        sel._cs = api;
        api.sync();
        new MutationObserver(api.sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        sel.addEventListener('change', api.sync);
        btn.addEventListener('click', ev => {
            ev.preventDefault();
            if (owner === api) return closePanel();
            closePanel();
            owner = api; wrap.classList.add('open');
            panel = document.createElement('div');
            panel.className = 'cs-panel';
            [...sel.options].forEach(o => {
                const it = document.createElement('button');
                it.type = 'button';
                it.className = 'cs-opt' + (o.selected ? ' selected' : '');
                it.disabled = o.disabled;
                it.innerHTML = `<span>${esc(o.textContent)}</span>${o.selected ? '<i class="ph-bold ph-check"></i>' : ''}`;
                it.onclick = () => { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); closePanel(); btn.focus(); };
                panel.appendChild(it);
            });
            document.body.appendChild(panel);
            const r = btn.getBoundingClientRect();
            const below = innerHeight - r.bottom - 12, above = r.top - 12;
            const up = below < 180 && above > below;
            panel.style.minWidth = Math.max(r.width, 160) + 'px';
            panel.style.left = Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8) + 'px';
            panel.style.maxHeight = Math.min(300, up ? above : below) + 'px';
            if (up) panel.style.bottom = (innerHeight - r.top + 6) + 'px'; else panel.style.top = (r.bottom + 6) + 'px';
            panel.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
        });
    }

    const all = root => (root.matches?.('select') ? [root] : []).concat([...(root.querySelectorAll?.('select') || [])]);
    all(document).forEach(build);
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && all(n).forEach(build))))
        .observe(document.body, { childList: true, subtree: true });
    document.addEventListener('mousedown', e => { if (panel && !panel.contains(e.target) && !owner.wrap.contains(e.target)) closePanel(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
    addEventListener('resize', closePanel);
    document.addEventListener('scroll', e => { if (panel && !panel.contains(e.target)) closePanel(); }, true);
    document.addEventListener('reset', () => setTimeout(() => $$('select').forEach(s => s._cs && s._cs.sync()), 0), true);
})();
