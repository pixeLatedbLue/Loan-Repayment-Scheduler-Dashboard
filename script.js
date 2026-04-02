/**
 * NexLoan v2.0 — Debt Intelligence Platform
 * Features: Max-Heap Priority Queue, Analytics, Charts, Scenarios, Export, Undo, localStorage
 */

// ============================================================
//  DATA MODELS
// ============================================================

class Loan {
    constructor(principal, interestRate, daysUntilDue, lateFee, creditFactor, notes = '', id = null) {
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.principal = parseFloat(principal);
        this.interestRate = parseFloat(interestRate);
        this.daysUntilDue = parseInt(daysUntilDue);
        this.lateFee = parseFloat(lateFee);
        this.creditFactor = parseInt(creditFactor);
        this.notes = notes || '';
        this.totalPaid = 0;
        this.paymentHistory = [];
        this.urgency = 0;
        this.interestBurden = '0';
        this.updateUrgency();
    }

    updateUrgency() {
        if (this.daysUntilDue <= 0) {
            this.urgency = 100;
        } else {
            const dailyInterest = (this.principal * (this.interestRate / 100)) / 365;
            const timeFactor = 50 / Math.max(1, this.daysUntilDue);
            const riskFactor = (11 - this.creditFactor) * 2;
            const burdenFactor = Math.min(30, dailyInterest * 10);
            this.urgency = Math.min(99, timeFactor + riskFactor + burdenFactor);
        }
        this.interestBurden = ((this.principal * (this.interestRate / 100)) / 365 * Math.max(1, this.daysUntilDue)).toFixed(2);
    }

    monthlyInterest() {
        return (this.principal * (this.interestRate / 100)) / 12;
    }

    totalInterestOverLife(monthlyPayment) {
        let balance = this.principal;
        let totalInterest = 0;
        const monthlyRate = this.interestRate / 100 / 12;
        if (monthlyRate === 0) return 0;
        let months = 0;
        while (balance > 0.01 && months < 600) {
            const interest = balance * monthlyRate;
            totalInterest += interest;
            const principal = Math.min(monthlyPayment - interest, balance);
            if (principal <= 0) break; // can't pay off
            balance -= principal;
            months++;
        }
        return totalInterest;
    }

    payoffMonths(monthlyPayment) {
        const monthlyRate = this.interestRate / 100 / 12;
        if (monthlyRate === 0) {
            return Math.ceil(this.principal / monthlyPayment);
        }
        const interest = this.principal * monthlyRate;
        if (monthlyPayment <= interest) return Infinity;
        return Math.ceil(Math.log(monthlyPayment / (monthlyPayment - interest)) / Math.log(1 + monthlyRate));
    }

    toJSON() {
        return {
            id: this.id,
            principal: this.principal,
            interestRate: this.interestRate,
            daysUntilDue: this.daysUntilDue,
            lateFee: this.lateFee,
            creditFactor: this.creditFactor,
            notes: this.notes,
            totalPaid: this.totalPaid,
            paymentHistory: this.paymentHistory
        };
    }

    static fromJSON(data) {
        const l = new Loan(data.principal, data.interestRate, data.daysUntilDue, data.lateFee, data.creditFactor, data.notes, data.id);
        l.totalPaid = data.totalPaid || 0;
        l.paymentHistory = data.paymentHistory || [];
        return l;
    }
}

// ============================================================
//  MAX-HEAP
// ============================================================

class MaxHeap {
    constructor() { this.heap = []; }

    getParentIndex(i) { return Math.floor((i - 1) / 2); }
    getLeftChildIndex(i) { return 2 * i + 1; }
    getRightChildIndex(i) { return 2 * i + 2; }

    swap(i1, i2) { [this.heap[i1], this.heap[i2]] = [this.heap[i2], this.heap[i1]]; }

    insert(loan) { this.heap.push(loan); this.heapifyUp(); }

    heapifyUp() {
        let index = this.heap.length - 1;
        while (index > 0) {
            let p = this.getParentIndex(index);
            if (this.heap[p].urgency < this.heap[index].urgency) { this.swap(p, index); index = p; }
            else break;
        }
    }

    rebuild() {
        const n = this.heap.length;
        for (let i = Math.floor(n / 2) - 1; i >= 0; i--) this.heapifyDown(i);
    }

    heapifyDown(index) {
        let max = index;
        const l = this.getLeftChildIndex(index), r = this.getRightChildIndex(index);
        if (l < this.heap.length && this.heap[l].urgency > this.heap[max].urgency) max = l;
        if (r < this.heap.length && this.heap[r].urgency > this.heap[max].urgency) max = r;
        if (index !== max) { this.swap(index, max); this.heapifyDown(max); }
    }

    removeById(id) {
        const idx = this.heap.findIndex(l => l.id === id);
        if (idx === -1) return;
        this.heap.splice(idx, 1);
        this.rebuild();
    }

    getSortedLoans() {
        return [...this.heap].sort((a, b) => b.urgency - a.urgency);
    }
}

// ============================================================
//  UTILITY HELPERS
// ============================================================

let currencySymbol = '$';

function fmt(n) {
    const abs = Math.abs(n);
    const formatted = abs >= 1e6 ? (abs / 1e6).toFixed(2) + 'M' :
                      abs >= 1e3 ? abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) :
                      abs.toFixed(2);
    return currencySymbol + formatted;
}

function monthsToDate(months) {
    if (!isFinite(months) || months > 600) return 'Never (payment too low)';
    const now = new Date();
    now.setMonth(now.getMonth() + months);
    return now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => { t.style.animation = 'none'; t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ============================================================
//  CANVAS CHART UTILITIES
// ============================================================

function drawLineChart(canvasId, datasets, labels, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 600;
    canvas.width = W;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { top: 20, right: 20, bottom: 40, left: 65 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const allVals = datasets.flatMap(d => d.data);
    const maxVal = Math.max(...allVals) * 1.05;
    const minVal = 0;

    // Grid
    ctx.strokeStyle = 'rgba(90, 65, 40, 0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + chartH - (i / 4) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = 'rgba(140, 125, 110, 0.65)';
        ctx.font = '10px DM Mono, monospace';
        ctx.textAlign = 'right';
        const val = minVal + (i / 4) * (maxVal - minVal);
        ctx.fillText(fmt(val), pad.left - 8, y + 4);
    }

    // X axis labels
    ctx.fillStyle = 'rgba(160,158,150,0.6)';
    ctx.font = '10px DM Mono, monospace';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(labels.length / 8));
    labels.forEach((lbl, i) => {
        if (i % step === 0) {
            const x = pad.left + (i / (labels.length - 1)) * chartW;
            ctx.fillText(lbl, x, H - 8);
        }
    });

    // Lines
    datasets.forEach(({ data, color, fill }) => {
        if (data.length < 2) return;
        ctx.beginPath();
        data.forEach((val, i) => {
            const x = pad.left + (i / (data.length - 1)) * chartW;
            const y = pad.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        if (fill) {
            ctx.lineTo(pad.left + chartW, pad.top + chartH);
            ctx.lineTo(pad.left, pad.top + chartH);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
            grad.addColorStop(0, color.replace(')', ',0.2)').replace('rgb', 'rgba'));
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fill();
        }
    });
}

function drawDonut(canvasId, data, colors, labels) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 260;
    canvas.width = W;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2 - 20;
    const r = Math.min(cx, cy) - 10;
    const inner = r * 0.55;
    const total = data.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    let startAngle = -Math.PI / 2;
    data.forEach((val, i) => {
        const slice = (val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + slice);
        ctx.closePath();
        ctx.fillStyle = colors[i];
        ctx.fill();
        startAngle += slice;
    });

    // Inner circle
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = '#16161f';
    ctx.fill();

    // Center text
    ctx.fillStyle = 'rgba(240,238,232,0.8)';
    ctx.font = `bold 14px DM Mono, monospace`;
    ctx.textAlign = 'center';
    const pct = Math.round((data[1] / total) * 100);
    ctx.fillText(`${pct}% principal`, cx, cy - 4);
    ctx.fillStyle = 'rgba(160,158,150,0.6)';
    ctx.font = '11px DM Sans, sans-serif';
    ctx.fillText(`${100 - pct}% interest`, cx, cy + 16);

    // Legend
    const legY = H - 24;
    const legX = (W - (labels.length * 120)) / 2;
    labels.forEach((lbl, i) => {
        const x = legX + i * 140;
        ctx.beginPath();
        ctx.arc(x + 8, legY, 5, 0, Math.PI * 2);
        ctx.fillStyle = colors[i];
        ctx.fill();
        ctx.fillStyle = 'rgba(160,158,150,0.8)';
        ctx.font = '11px DM Sans, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lbl, x + 18, legY + 4);
    });
}

function drawWaterfall(canvasId, items) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 500;
    canvas.width = W;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { top: 20, right: 20, bottom: 50, left: 70 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...items.map(i => i.value)) * 1.1;
    const barW = chartW / items.length * 0.6;
    const gap = chartW / items.length;

    // Grid
    ctx.strokeStyle = 'rgba(90, 65, 40, 0.07)';
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + chartH - (i / 4) * chartH;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = 'rgba(140, 125, 110, 0.65)';
        ctx.font = '10px DM Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(fmt((i / 4) * maxVal), pad.left - 6, y + 4);
    }

    items.forEach((item, i) => {
        const barH = (item.value / maxVal) * chartH;
        const x = pad.left + i * gap + gap / 2 - barW / 2;
        const y = pad.top + chartH - barH;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, item.color);
        grad.addColorStop(1, item.color.replace('1)', '0.3)').replace(')', ',0.3)'));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        ctx.fill();

        // Label
        ctx.fillStyle = 'rgba(160,158,150,0.8)';
        ctx.font = '9.5px DM Sans, sans-serif';
        ctx.textAlign = 'center';
        const words = item.label.split(' ');
        words.forEach((w, wi) => ctx.fillText(w, x + barW / 2, H - 8 - (words.length - 1 - wi) * 14));
    });
}

// ============================================================
//  SIMULATION: REPAYMENT STRATEGIES
// ============================================================

function simulateRepayment(loans, monthlyBudget, strategy = 'avalanche') {
    if (!loans.length || monthlyBudget <= 0) return { months: 0, totalInterest: 0, order: [] };

    // Deep clone
    let balances = loans.map(l => ({
        id: l.id,
        principal: l.principal,
        balance: l.principal,
        rate: l.interestRate / 100 / 12,
        notes: l.notes || l.id
    }));

    let totalInterest = 0;
    let months = 0;
    const order = [];

    while (balances.some(b => b.balance > 0.01) && months < 600) {
        months++;
        let budget = monthlyBudget;

        // Pay minimum (interest) on all
        balances.forEach(b => {
            if (b.balance <= 0) return;
            const interest = b.balance * b.rate;
            totalInterest += interest;
            b.balance += interest;
        });

        // Sort by strategy
        const active = balances.filter(b => b.balance > 0.01);
        if (strategy === 'snowball') active.sort((a, b) => a.balance - b.balance);
        else active.sort((a, b) => b.rate - a.rate); // avalanche

        // Allocate budget
        active.forEach(b => {
            if (budget <= 0 || b.balance <= 0.01) return;
            const pay = Math.min(budget, b.balance);
            b.balance -= pay;
            budget -= pay;
            if (b.balance <= 0.01) { b.balance = 0; order.push({ id: b.id, month: months }); }
        });
    }

    return { months, totalInterest, order };
}

// ============================================================
//  AMORTIZATION
// ============================================================

function generateAmortization(loan, monthlyPayment) {
    const rows = [];
    let balance = loan.principal;
    const monthlyRate = loan.interestRate / 100 / 12;
    let month = 0;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;

    while (balance > 0.01 && month < 600) {
        month++;
        const interest = balance * monthlyRate;
        const principal = Math.min(monthlyPayment - interest, balance);
        if (principal <= 0) break;
        balance = Math.max(0, balance - principal);
        totalInterestPaid += interest;
        totalPrincipalPaid += principal;

        rows.push({
            month,
            payment: Math.min(monthlyPayment, interest + principal),
            interest,
            principal,
            balance,
            totalInterestPaid,
            totalPrincipalPaid
        });
    }

    return rows;
}

// ============================================================
//  MAIN UI CONTROLLER
// ============================================================

const UI = {
    heap: new MaxHeap(),
    undoStack: [],
    activeTab: 'queue',
    editingLoanId: null,

    init() {
        this.loadFromStorage();
        this.registerEventListeners();
        this.registerKeyboardShortcuts();
        if (this.heap.heap.length === 0) this.addSampleData();
        this.populateLoanSelects();
        this.render();
        this.renderCreditTracker();
    },

    // ── STORAGE ────────────────────────────────────────────

    saveToStorage() {
        const data = this.heap.heap.map(l => l.toJSON());
        localStorage.setItem('nexloan_loans', JSON.stringify(data));
        localStorage.setItem('nexloan_currency', currencySymbol);
    },

    loadFromStorage() {
        const raw = localStorage.getItem('nexloan_loans');
        const cur = localStorage.getItem('nexloan_currency');
        if (cur) {
            currencySymbol = cur;
            document.querySelectorAll('.currency-prefix').forEach(el => el.textContent = cur);
            document.querySelectorAll('.cur-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.symbol === cur);
            });
        }
        if (raw) {
            try {
                const loans = JSON.parse(raw);
                loans.forEach(d => this.heap.insert(Loan.fromJSON(d)));
            } catch (e) { console.error('Failed to load from storage', e); }
        }
    },

    pushUndo() {
        const snapshot = JSON.stringify(this.heap.heap.map(l => l.toJSON()));
        this.undoStack.push(snapshot);
        if (this.undoStack.length > 20) this.undoStack.shift();
        document.getElementById('undo-btn').disabled = false;
    },

    undo() {
        if (!this.undoStack.length) return;
        const snapshot = JSON.parse(this.undoStack.pop());
        this.heap = new MaxHeap();
        snapshot.forEach(d => this.heap.insert(Loan.fromJSON(d)));
        if (!this.undoStack.length) document.getElementById('undo-btn').disabled = true;
        this.saveToStorage();
        this.populateLoanSelects();
        this.render();
        toast('Action undone', 'info');
    },

    // ── EVENT LISTENERS ────────────────────────────────────

    registerEventListeners() {
        // Splash
        document.getElementById('init-btn').addEventListener('click', () => {
            document.getElementById('splash-screen').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const tab = item.dataset.tab;
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
                const pane = document.getElementById(`tab-${tab}`);
                if (pane) { pane.classList.remove('hidden'); }
                this.activeTab = tab;
                if (tab === 'charts') this.renderCharts();
                if (tab === 'analytics') this.renderAnalytics();
                if (tab === 'scenarios') this.renderScenarios();
            });
        });

        // Modal open/close
        document.getElementById('open-modal-btn').addEventListener('click', () => this.openAddModal());
        document.getElementById('close-modal').addEventListener('click', () => this.closeModal());
        document.getElementById('close-modal-2').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === document.getElementById('modal-overlay')) this.closeModal(); });

        // Form submit
        document.getElementById('loan-form').addEventListener('submit', e => { e.preventDefault(); this.handleSaveLoan(); });

        // Time skip & undo
        document.getElementById('time-skip-btn').addEventListener('click', () => this.simulateTimePassage());
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());

        // Payment input
        document.getElementById('payment-input').addEventListener('input', () => this.render());

        // Currency buttons
        document.querySelectorAll('.cur-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currencySymbol = btn.dataset.symbol;
                document.querySelectorAll('.cur-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.currency-prefix').forEach(el => el.textContent = currencySymbol);
                this.saveToStorage();
                this.render();
                if (this.activeTab === 'analytics') this.renderAnalytics();
                if (this.activeTab === 'charts') this.renderCharts();
            });
        });

        // Import CSV buttons
        document.getElementById('import-btn').addEventListener('click', () => {
            document.getElementById('import-modal').classList.remove('hidden');
        });
        document.getElementById('close-import-modal').addEventListener('click', () => document.getElementById('import-modal').classList.add('hidden'));
        document.getElementById('close-import-modal-2').addEventListener('click', () => document.getElementById('import-modal').classList.add('hidden'));
        document.getElementById('do-import-btn').addEventListener('click', () => {
            const text = document.getElementById('csv-import-modal-area').value;
            const count = this.importCSV(text);
            if (count > 0) { document.getElementById('import-modal').classList.add('hidden'); document.getElementById('csv-import-modal-area').value = ''; }
        });

        // Export buttons
        document.getElementById('export-csv-btn').addEventListener('click', () => this.exportCSV());
        document.getElementById('export-summary-btn').addEventListener('click', () => this.exportSummaryReport());
        document.getElementById('export-schedule-btn').addEventListener('click', () => {
            const budget = parseFloat(document.getElementById('report-budget').value);
            if (!budget) { toast('Enter a budget first', 'error'); return; }
            this.exportRepaymentSchedule(budget);
        });
        document.getElementById('import-csv-btn').addEventListener('click', () => {
            const text = document.getElementById('csv-import-area').value;
            this.importCSV(text);
        });

        // Analytics
        document.getElementById('analytics-budget').addEventListener('input', () => { if (this.activeTab === 'analytics') this.renderAnalytics(); });
        document.getElementById('gen-amort-btn').addEventListener('click', () => this.renderAmortizationTable());
        document.getElementById('chart-budget').addEventListener('input', () => { if (this.activeTab === 'charts') this.renderCharts(); });
        document.getElementById('donut-loan-select').addEventListener('change', () => this.renderDonut());

        // Scenario buttons
        document.getElementById('calc-overdue-btn').addEventListener('click', () => this.calcOverduePenalty());
        document.getElementById('calc-rate-btn').addEventListener('click', () => this.calcRateChange());
        document.getElementById('run-compare-btn').addEventListener('click', () => this.runPaymentComparison());

        // Shortcuts modal
        document.getElementById('close-shortcuts').addEventListener('click', () => document.getElementById('shortcuts-overlay').classList.add('hidden'));
        document.getElementById('shortcuts-overlay').addEventListener('click', e => { if (e.target === document.getElementById('shortcuts-overlay')) document.getElementById('shortcuts-overlay').classList.add('hidden'); });
    },

    registerKeyboardShortcuts() {
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            switch (e.key) {
                case 'a': case 'A': this.openAddModal(); break;
                case 'd': case 'D': this.simulateTimePassage(); break;
                case 'z': case 'Z': this.undo(); break;
                case '1': this.switchTab('queue'); break;
                case '2': this.switchTab('analytics'); break;
                case '3': this.switchTab('charts'); break;
                case '4': this.switchTab('scenarios'); break;
                case '5': this.switchTab('reports'); break;
                case '?': document.getElementById('shortcuts-overlay').classList.toggle('hidden'); break;
                case 'Escape':
                    document.getElementById('modal-overlay').classList.add('hidden');
                    document.getElementById('shortcuts-overlay').classList.add('hidden');
                    document.getElementById('import-modal').classList.add('hidden');
                    break;
            }
        });
    },

    switchTab(tab) {
        const item = document.querySelector(`.nav-item[data-tab="${tab}"]`);
        if (item) item.click();
    },

    // ── LOAN CRUD ───────────────────────────────────────────

    openAddModal() {
        this.editingLoanId = null;
        document.getElementById('modal-title').textContent = 'Register New Instrument';
        document.getElementById('submit-loan-btn').textContent = 'Inject to Heap';
        document.getElementById('edit-loan-id').value = '';
        document.getElementById('loan-form').reset();
        document.getElementById('modal-overlay').classList.remove('hidden');
    },

    openEditModal(loanId) {
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;
        this.editingLoanId = loanId;
        document.getElementById('modal-title').textContent = 'Edit Instrument';
        document.getElementById('submit-loan-btn').textContent = 'Save Changes';
        document.getElementById('edit-loan-id').value = loanId;
        document.getElementById('principal').value = loan.principal;
        document.getElementById('interest').value = loan.interestRate;
        document.getElementById('days').value = loan.daysUntilDue;
        document.getElementById('late-fee').value = loan.lateFee;
        document.getElementById('credit-factor').value = loan.creditFactor;
        document.getElementById('loan-notes').value = loan.notes || '';
        document.getElementById('modal-overlay').classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        document.getElementById('loan-form').reset();
        this.editingLoanId = null;
    },

    handleSaveLoan() {
        this.pushUndo();
        const id = document.getElementById('edit-loan-id').value;
        const loan = new Loan(
            document.getElementById('principal').value,
            document.getElementById('interest').value,
            document.getElementById('days').value,
            document.getElementById('late-fee').value,
            document.getElementById('credit-factor').value,
            document.getElementById('loan-notes').value,
            id || null
        );

        if (id) {
            // Copy over history
            const old = this.heap.heap.find(l => l.id === id);
            if (old) { loan.totalPaid = old.totalPaid; loan.paymentHistory = old.paymentHistory; }
            this.heap.removeById(id);
        }

        this.heap.insert(loan);
        this.closeModal();
        this.saveToStorage();
        this.populateLoanSelects();
        this.render();
        toast(id ? 'Loan updated ✓' : 'Loan added to heap ✓', 'success');
    },

    deleteLoan(loanId) {
        this.pushUndo();
        this.heap.removeById(loanId);
        this.saveToStorage();
        this.populateLoanSelects();
        this.render();
        toast('Loan removed', 'info');
    },

    recordPayment(loanId, amount) {
        this.pushUndo();
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;
        amount = parseFloat(amount);
        if (isNaN(amount) || amount <= 0) return;
        loan.principal = Math.max(0, loan.principal - amount);
        loan.totalPaid += amount;
        loan.paymentHistory.push({ date: new Date().toLocaleDateString(), amount });
        loan.updateUrgency();
        this.heap.rebuild();
        this.saveToStorage();
        this.render();
        toast(`Payment of ${fmt(amount)} recorded`, 'success');
        if (loan.principal <= 0) {
            toast('🎉 Loan fully paid off! Consider archiving.', 'success');
        }
    },

    // ── SIMULATION ─────────────────────────────────────────

    simulateTimePassage() {
        this.pushUndo();
        this.heap.heap.forEach(loan => { loan.daysUntilDue -= 1; loan.updateUrgency(); });
        this.heap.rebuild();
        this.saveToStorage();
        this.render();
        toast('Simulated +1 day', 'info');
    },

    addSampleData() {
        [
            new Loan(15000, 12, 5, 250, 4, 'HDFC Personal Loan'),
            new Loan(2500, 5, 20, 50, 8, 'Credit Union'),
            new Loan(50000, 18, 1, 1000, 2, 'Bank of India Business'),
            new Loan(1200, 24, -2, 100, 5, 'Axis Bank CC'),
            new Loan(8000, 9, 45, 150, 6, 'SBI Education Loan')
        ].forEach(s => this.heap.insert(s));
        this.saveToStorage();
    },

    // ── SELECTS & ALERTS ───────────────────────────────────

    populateLoanSelects() {
        const loans = this.heap.getSortedLoans();
        const ids = ['amort-loan-select', 'donut-loan-select', 'overdue-loan-select', 'rate-loan-select'];
        ids.forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '<option value="">Select a loan...</option>';
            loans.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.id;
                opt.textContent = `${l.notes || l.id} — ${fmt(l.principal)} @ ${l.interestRate}%`;
                sel.appendChild(opt);
            });
        });
    },

    // ── MAIN RENDER ────────────────────────────────────────

    render() {
        const container = document.getElementById('loan-list');
        const countEl = document.getElementById('loan-count');
        const loans = this.heap.getSortedLoans();
        const budget = parseFloat(document.getElementById('payment-input').value) || 0;

        countEl.textContent = `Total Active Instruments: ${loans.length}`;

        // Update summary pills
        const totalDebt = loans.reduce((s, l) => s + l.principal, 0);
        const overdue = loans.filter(l => l.daysUntilDue <= 0).length;
        const monthlyInterest = loans.reduce((s, l) => s + l.monthlyInterest(), 0);
        document.getElementById('total-debt-display').textContent = fmt(totalDebt);
        document.getElementById('overdue-count').textContent = overdue;
        document.getElementById('monthly-interest').textContent = fmt(monthlyInterest);

        // Alert banner
        const alertBanner = document.getElementById('alert-banner');
        if (overdue > 0) {
            alertBanner.classList.remove('hidden');
            document.getElementById('alert-text').textContent = `${overdue} loan${overdue > 1 ? 's are' : ' is'} overdue! Late fees accumulating daily.`;
        } else {
            alertBanner.classList.add('hidden');
        }

        // Currency prefix sync
        document.querySelectorAll('.currency-prefix').forEach(el => el.textContent = currencySymbol);

        container.innerHTML = '';

        if (loans.length === 0) {
            container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><h3>No Loans Registered</h3><p>Press <kbd>A</kbd> or click "Add New Loan" to begin.</p></div>`;
            return;
        }

        loans.forEach(loan => {
            const card = document.createElement('div');
            let statusClass = loan.urgency > 80 ? 'critical' : loan.urgency > 50 ? 'warning' : 'safe';
            card.className = `loan-card ${statusClass}`;

            const paidPct = loan.totalPaid > 0 ? Math.min(100, (loan.totalPaid / (loan.principal + loan.totalPaid)) * 100) : 0;

            card.innerHTML = `
                <div class="urgency-header">
                    <div class="urgency-score-wrap">
                        <span class="urgency-score">${Math.round(loan.urgency)}%</span>
                        <span class="urgency-label">Urgency</span>
                    </div>
                    <div class="card-actions">
                        <button class="card-action-btn edit-btn" title="Edit" data-id="${loan.id}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="card-action-btn pay-btn" title="Record Payment" data-id="${loan.id}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        </button>
                        <button class="card-action-btn danger delete-btn" title="Delete" data-id="${loan.id}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                </div>
                <div class="progress-container">
                    <div class="progress-bar" style="width:${loan.urgency}%"></div>
                </div>
                <div class="loan-details">
                    <div class="detail-item">
                        <span class="detail-label">Principal</span>
                        <span class="detail-value">${fmt(loan.principal)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Due In</span>
                        <span class="detail-value" style="color:${loan.daysUntilDue <= 0 ? 'var(--critical)' : loan.daysUntilDue <= 5 ? 'var(--warning)' : 'inherit'}">${loan.daysUntilDue <= 0 ? `${Math.abs(loan.daysUntilDue)}d Overdue` : `${loan.daysUntilDue} Days`}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Interest Accrued</span>
                        <span class="detail-value">${fmt(parseFloat(loan.interestBurden))}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Late Penalty</span>
                        <span class="detail-value">${fmt(loan.lateFee)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Monthly Interest</span>
                        <span class="detail-value">${fmt(loan.monthlyInterest())}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Credit Factor</span>
                        <span class="detail-value">${loan.creditFactor}/10</span>
                    </div>
                </div>
                ${loan.notes ? `<div class="loan-notes-display"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>${loan.notes}</div>` : ''}
                ${loan.totalPaid > 0 ? `<div class="payment-track"><div class="payment-track-label">Total Paid: ${fmt(loan.totalPaid)}</div><div class="payment-track-bar"><div class="payment-track-fill" style="width:${paidPct}%"></div></div></div>` : ''}
            `;

            card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); this.openEditModal(loan.id); });
            card.querySelector('.delete-btn').addEventListener('click', e => {
                e.stopPropagation();
                if (confirm(`Delete this loan (${fmt(loan.principal)})?`)) this.deleteLoan(loan.id);
            });
            card.querySelector('.pay-btn').addEventListener('click', e => {
                e.stopPropagation();
                const amount = prompt(`Record payment for ${loan.notes || loan.id}\nCurrent balance: ${fmt(loan.principal)}\n\nEnter payment amount:`);
                if (amount !== null && parseFloat(amount) > 0) this.recordPayment(loan.id, amount);
            });

            container.appendChild(card);
        });
    },

    // ── ANALYTICS ──────────────────────────────────────────

    renderAnalytics() {
        const budget = parseFloat(document.getElementById('analytics-budget').value) || 5000;
        const loans = this.heap.getSortedLoans();

        if (!loans.length) {
            document.getElementById('payoff-projections').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No loans to analyze.</p>';
            document.getElementById('strategy-comparison').innerHTML = '';
            return;
        }

        // Payoff projections table
        const perLoanBudget = budget / loans.length;
        let projHTML = `<table class="projection-table"><thead><tr>
            <th>Loan</th><th>Balance</th><th>Rate</th><th>Monthly Payment</th>
            <th>Payoff Months</th><th>Payoff Date</th><th>Total Interest</th><th>Total Cost</th>
        </tr></thead><tbody>`;

        loans.forEach(loan => {
            const share = Math.max(loan.monthlyInterest() * 1.2, perLoanBudget);
            const months = loan.payoffMonths(share);
            const totalInt = loan.totalInterestOverLife(share);
            const date = monthsToDate(months);
            const isFinite_ = isFinite(months);
            projHTML += `<tr>
                <td class="highlight">${loan.notes || loan.id.substr(0, 6)}</td>
                <td>${fmt(loan.principal)}</td>
                <td>${loan.interestRate}%</td>
                <td class="ok">${fmt(share)}</td>
                <td class="${months > 60 ? 'bad' : months > 24 ? 'warn' : 'ok'}">${isFinite_ ? months : '∞'}</td>
                <td>${date}</td>
                <td class="bad">${isFinite_ ? fmt(totalInt) : 'N/A'}</td>
                <td>${isFinite_ ? fmt(loan.principal + totalInt) : 'N/A'}</td>
            </tr>`;
        });

        projHTML += `</tbody></table>`;
        document.getElementById('payoff-projections').innerHTML = projHTML;

        // Strategy comparison
        const snowball = simulateRepayment(loans, budget, 'snowball');
        const avalanche = simulateRepayment(loans, budget, 'avalanche');
        const winner = avalanche.totalInterest <= snowball.totalInterest ? 'avalanche' : 'snowball';
        const saved = Math.abs(snowball.totalInterest - avalanche.totalInterest);

        document.getElementById('strategy-comparison').innerHTML = `
            <div class="strategy-grid">
                <div class="strategy-box snowball">
                    <h4><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>❄ Snowball (Smallest Balance First)</h4>
                    <div class="strategy-item"><span class="s-label">Total Months</span><span class="s-value">${snowball.months}</span></div>
                    <div class="strategy-item"><span class="s-label">Debt-Free Date</span><span class="s-value">${monthsToDate(snowball.months)}</span></div>
                    <div class="strategy-item"><span class="s-label">Total Interest Paid</span><span class="s-value">${fmt(snowball.totalInterest)}</span></div>
                    <div class="strategy-item"><span class="s-label">Total Cost</span><span class="s-value">${fmt(loans.reduce((s,l)=>s+l.principal,0) + snowball.totalInterest)}</span></div>
                </div>
                <div class="strategy-box avalanche">
                    <h4><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>🏔 Avalanche (Highest Rate First)</h4>
                    <div class="strategy-item"><span class="s-label">Total Months</span><span class="s-value">${avalanche.months}</span></div>
                    <div class="strategy-item"><span class="s-label">Debt-Free Date</span><span class="s-value">${monthsToDate(avalanche.months)}</span></div>
                    <div class="strategy-item"><span class="s-label">Total Interest Paid</span><span class="s-value">${fmt(avalanche.totalInterest)}</span></div>
                    <div class="strategy-item"><span class="s-label">Total Cost</span><span class="s-value">${fmt(loans.reduce((s,l)=>s+l.principal,0) + avalanche.totalInterest)}</span></div>
                </div>
            </div>
            <div class="strategy-winner better">
                🏆 ${winner.toUpperCase()} wins — saves ${fmt(saved)} in interest
                (${Math.abs(snowball.months - avalanche.months)} months faster)
            </div>
        `;
    },

    renderAmortizationTable() {
        const loanId = document.getElementById('amort-loan-select').value;
        const budget = parseFloat(document.getElementById('analytics-budget').value) || 5000;
        if (!loanId) { toast('Select a loan first', 'error'); return; }
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;

        const perLoan = Math.max(loan.monthlyInterest() * 1.5, budget / Math.max(1, this.heap.heap.length));
        const rows = generateAmortization(loan, perLoan);

        if (!rows.length) {
            document.getElementById('amort-table-container').innerHTML = '<p style="color:var(--critical);font-size:0.85rem">Payment too low to cover interest.</p>';
            return;
        }

        let html = `<table class="amort-table"><thead><tr>
            <th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th><th>Cumul. Interest</th>
        </tr></thead><tbody>`;

        rows.forEach(r => {
            html += `<tr>
                <td>Month ${r.month}</td>
                <td>${fmt(r.payment)}</td>
                <td class="principal-col">${fmt(r.principal)}</td>
                <td class="interest-col">${fmt(r.interest)}</td>
                <td>${fmt(r.balance)}</td>
                <td>${fmt(r.totalInterestPaid)}</td>
            </tr>`;
        });

        const totalInt = rows[rows.length - 1]?.totalInterestPaid || 0;
        const totalPay = rows.reduce((s, r) => s + r.payment, 0);
        html += `<tr class="total-row">
            <td>TOTAL</td><td>${fmt(totalPay)}</td>
            <td class="principal-col">${fmt(loan.principal)}</td>
            <td class="interest-col">${fmt(totalInt)}</td>
            <td>$0.00</td><td>${fmt(totalInt)}</td>
        </tr></tbody></table>`;

        document.getElementById('amort-table-container').innerHTML = html;
    },

    // ── CHARTS ─────────────────────────────────────────────

    renderCharts() {
        const budget = parseFloat(document.getElementById('chart-budget').value) || 5000;
        const loans = this.heap.getSortedLoans();
        if (!loans.length) return;

        this.renderGantt(loans, budget);
        this.renderDebtCurve(loans, budget);
        this.renderWaterfall(loans, budget);
        this.renderDonut();
    },

    renderGantt(loans, budget) {
        const container = document.getElementById('gantt-chart');
        const colors = ['#c9a84c','#7b68ee','#00c9a7','#ff4d6d','#ffa94d','#40c057','#748ffc','#f06595'];
        const maxMonths = Math.max(...loans.map(l => {
            const perLoan = Math.max(l.monthlyInterest() * 1.5, budget / loans.length);
            const m = l.payoffMonths(perLoan);
            return isFinite(m) ? m : 120;
        }));

        let html = `<div class="gantt-container">`;
        loans.forEach((loan, i) => {
            const perLoan = Math.max(loan.monthlyInterest() * 1.5, budget / loans.length);
            const months = loan.payoffMonths(perLoan);
            const displayMonths = isFinite(months) ? months : 120;
            const pct = (displayMonths / maxMonths) * 100;
            const color = colors[i % colors.length];
            html += `
                <div class="gantt-item">
                    <div class="gantt-label">${loan.notes || loan.id.substr(0, 8)}</div>
                    <div class="gantt-track">
                        <div class="gantt-bar" style="width:${pct}%;background:${color}">${displayMonths}mo</div>
                    </div>
                    <div class="gantt-months">${monthsToDate(displayMonths)}</div>
                </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    renderDebtCurve(loans, budget) {
        const months = 60;
        const labels = Array.from({ length: months + 1 }, (_, i) => i === 0 ? 'Now' : `M${i}`);

        // Simulate total debt each month
        let balances = loans.map(l => ({ balance: l.principal, rate: l.interestRate / 100 / 12 }));
        const data = [balances.reduce((s, b) => s + b.balance, 0)];

        for (let m = 0; m < months; m++) {
            let remaining = budget;
            balances.sort((a, b) => b.rate - a.rate);
            balances.forEach(b => {
                if (b.balance <= 0 || remaining <= 0) return;
                const interest = b.balance * b.rate;
                b.balance += interest;
                const pay = Math.min(remaining, b.balance);
                b.balance -= pay;
                if (b.balance < 0) b.balance = 0;
                remaining -= pay;
            });
            data.push(Math.max(0, balances.reduce((s, b) => s + b.balance, 0)));
        }

        const canvas = document.getElementById('debt-curve-canvas');
        if (canvas) {
            canvas.style.width = '100%';
            setTimeout(() => drawLineChart('debt-curve-canvas', [{ data, color: 'rgb(201,168,76)', fill: true }], labels), 50);
        }
    },

    renderWaterfall(loans, budget) {
        const items = loans.map((loan, i) => {
            const interest = loan.monthlyInterest();
            const colors = ['rgba(255,77,109,1)', 'rgba(255,169,77,1)', 'rgba(123,104,238,1)', 'rgba(0,201,167,1)', 'rgba(201,168,76,1)'];
            return {
                label: (loan.notes || loan.id.substr(0, 8)).split(' ').slice(0, 2).join(' '),
                value: interest,
                color: colors[i % colors.length]
            };
        });

        const canvas = document.getElementById('waterfall-canvas');
        if (canvas) {
            canvas.style.width = '100%';
            setTimeout(() => drawWaterfall('waterfall-canvas', items), 50);
        }
    },

    renderDonut() {
        const loanId = document.getElementById('donut-loan-select').value;
        if (!loanId) return;
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;

        const budget = parseFloat(document.getElementById('chart-budget').value) || 5000;
        const perLoan = Math.max(loan.monthlyInterest() * 1.5, budget / Math.max(1, this.heap.heap.length));
        const totalInt = loan.totalInterestOverLife(perLoan);
        const canvas = document.getElementById('donut-canvas');
        if (canvas) {
            canvas.style.width = '100%';
            setTimeout(() => drawDonut('donut-canvas', [totalInt, loan.principal], ['rgba(255,77,109,0.85)', 'rgba(64,192,87,0.85)'], ['Interest', 'Principal']), 50);
        }
    },

    // ── SCENARIOS ──────────────────────────────────────────

    renderScenarios() {
        this.renderCreditTracker();
    },

    calcOverduePenalty() {
        const loanId = document.getElementById('overdue-loan-select').value;
        const days = parseInt(document.getElementById('overdue-days').value) || 30;
        const result = document.getElementById('overdue-result');
        if (!loanId) { result.innerHTML = ''; toast('Select a loan first', 'error'); return; }
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;

        const dailyInterest = (loan.principal * loan.interestRate / 100) / 365;
        const extraInterest = dailyInterest * days;
        const total = loan.lateFee + extraInterest;

        result.innerHTML = `<div class="result-box">
            <div class="result-row"><span class="result-label">Late Fee</span><span class="result-value bad">${fmt(loan.lateFee)}</span></div>
            <div class="result-row"><span class="result-label">Extra Interest (${days} days)</span><span class="result-value bad">${fmt(extraInterest)}</span></div>
            <div class="result-row"><span class="result-label">Daily Cost</span><span class="result-value mid">${fmt(dailyInterest)}</span></div>
            <div class="result-row"><span class="result-label">Total Penalty</span><span class="result-value bad">${fmt(total)}</span></div>
            <div class="result-row"><span class="result-label">New Total Owed</span><span class="result-value bad">${fmt(loan.principal + total)}</span></div>
        </div>`;
    },

    calcRateChange() {
        const loanId = document.getElementById('rate-loan-select').value;
        const increase = parseFloat(document.getElementById('rate-change').value) || 2;
        const result = document.getElementById('rate-result');
        if (!loanId) { result.innerHTML = ''; toast('Select a loan first', 'error'); return; }
        const loan = this.heap.heap.find(l => l.id === loanId);
        if (!loan) return;

        const oldRate = loan.interestRate;
        const newRate = oldRate + increase;
        const oldMonthly = (loan.principal * oldRate / 100) / 12;
        const newMonthly = (loan.principal * newRate / 100) / 12;
        const extraPerYear = (newMonthly - oldMonthly) * 12;

        result.innerHTML = `<div class="result-box">
            <div class="result-row"><span class="result-label">Current Rate</span><span class="result-value">${oldRate}%</span></div>
            <div class="result-row"><span class="result-label">New Rate (+${increase}%)</span><span class="result-value bad">${newRate}%</span></div>
            <div class="result-row"><span class="result-label">Old Monthly Interest</span><span class="result-value">${fmt(oldMonthly)}</span></div>
            <div class="result-row"><span class="result-label">New Monthly Interest</span><span class="result-value bad">${fmt(newMonthly)}</span></div>
            <div class="result-row"><span class="result-label">Extra Per Month</span><span class="result-value mid">+${fmt(newMonthly - oldMonthly)}</span></div>
            <div class="result-row"><span class="result-label">Extra Per Year</span><span class="result-value bad">+${fmt(extraPerYear)}</span></div>
        </div>`;
    },

    runPaymentComparison() {
        const amounts = [
            parseFloat(document.getElementById('cmp-a').value) || 3000,
            parseFloat(document.getElementById('cmp-b').value) || 6000,
            parseFloat(document.getElementById('cmp-c').value) || 10000
        ];
        const loans = this.heap.getSortedLoans();
        if (!loans.length) { toast('No loans to compare', 'error'); return; }

        let html = '<div class="compare-grid">';
        amounts.forEach(budget => {
            const result = simulateRepayment(loans, budget, 'avalanche');
            const totalDebt = loans.reduce((s, l) => s + l.principal, 0);
            html += `<div class="compare-col">
                <h5>${fmt(budget)}/mo</h5>
                <div class="result-row"><span class="result-label">Payoff Time</span><span class="result-value ${result.months < 24 ? 'good' : result.months < 48 ? 'mid' : 'bad'}">${result.months} months</span></div>
                <div class="result-row"><span class="result-label">Debt-Free</span><span class="result-value">${monthsToDate(result.months)}</span></div>
                <div class="result-row"><span class="result-label">Total Interest</span><span class="result-value bad">${fmt(result.totalInterest)}</span></div>
                <div class="result-row"><span class="result-label">Total Cost</span><span class="result-value">${fmt(totalDebt + result.totalInterest)}</span></div>
            </div>`;
        });
        html += '</div>';

        // Show savings
        const savings = simulateRepayment(loans, amounts[0], 'avalanche').totalInterest - simulateRepayment(loans, amounts[2], 'avalanche').totalInterest;
        if (savings > 0) {
            html += `<div class="strategy-winner better" style="margin-top:1rem">💡 Doubling your budget saves ${fmt(savings)} in total interest</div>`;
        }
        document.getElementById('payment-compare-result').innerHTML = html;
    },

    renderCreditTracker() {
        const loans = this.heap.getSortedLoans();
        const container = document.getElementById('credit-tracker');
        if (!container) return;

        const avgCredit = loans.length ? loans.reduce((s, l) => s + l.creditFactor, 0) / loans.length : 5;
        const overdueCount = loans.filter(l => l.daysUntilDue < 0).length;
        const debtRatio = loans.reduce((s, l) => s + l.principal, 0);

        let score = Math.round(avgCredit * 50 + 300);
        score = Math.max(300, Math.min(850, score - overdueCount * 40));
        const pct = ((score - 300) / 550) * 100;

        const band = score >= 750 ? { label: 'Excellent', color: 'var(--safe)' } :
                     score >= 650 ? { label: 'Good', color: 'var(--warning)' } :
                     score >= 550 ? { label: 'Fair', color: 'var(--warning)' } :
                                    { label: 'Poor', color: 'var(--critical)' };

        container.innerHTML = `
            <div class="credit-score-display" style="color:${band.color}">${score}</div>
            <div class="credit-label">${band.label} Credit Estimate</div>
            <div class="credit-bar-wrap">
                <div class="credit-bar-bg">
                    <div class="credit-needle" style="left:${pct}%"></div>
                </div>
            </div>
            <div class="result-box" style="margin-top:1rem">
                <div class="result-row"><span class="result-label">Avg Credit Factor</span><span class="result-value">${avgCredit.toFixed(1)}/10</span></div>
                <div class="result-row"><span class="result-label">Overdue Loans</span><span class="result-value ${overdueCount > 0 ? 'bad' : 'good'}">${overdueCount}</span></div>
                <div class="result-row"><span class="result-label">Total Debt Load</span><span class="result-value">${fmt(debtRatio)}</span></div>
                <div class="result-row"><span class="result-label">Recommendation</span><span class="result-value mid">${overdueCount > 0 ? 'Pay overdue loans ASAP' : 'Keep repaying on time'}</span></div>
            </div>
        `;
    },

    // ── EXPORT ─────────────────────────────────────────────

    exportCSV() {
        const loans = this.heap.getSortedLoans();
        if (!loans.length) { toast('No loans to export', 'error'); return; }
        const header = 'ID,Principal,Rate(%),DaysUntilDue,LateFee,CreditFactor,Notes,TotalPaid,Urgency';
        const rows = loans.map(l =>
            `${l.id},${l.principal},${l.interestRate},${l.daysUntilDue},${l.lateFee},${l.creditFactor},"${l.notes}",${l.totalPaid},${l.urgency.toFixed(1)}`
        );
        this.downloadFile([header, ...rows].join('\n'), 'nexloan_loans.csv', 'text/csv');
        toast('CSV downloaded ✓', 'success');
    },

    exportSummaryReport() {
        const loans = this.heap.getSortedLoans();
        const totalDebt = loans.reduce((s, l) => s + l.principal, 0);
        const totalInterest = loans.reduce((s, l) => s + l.monthlyInterest(), 0);
        const overdue = loans.filter(l => l.daysUntilDue <= 0);

        const lines = [
            `NexLoan Monthly Summary — ${new Date().toLocaleDateString()}`,
            `${'='.repeat(55)}`,
            `Total Active Loans: ${loans.length}`,
            `Total Outstanding Debt: ${fmt(totalDebt)}`,
            `Monthly Interest Burden: ${fmt(totalInterest)}`,
            `Overdue Loans: ${overdue.length}`,
            ``,
            `${'─'.repeat(55)}`,
            `LOAN DETAILS`,
            `${'─'.repeat(55)}`,
            ...loans.map(l =>
                `${(l.notes || l.id).padEnd(25)} ${fmt(l.principal).padStart(12)} @ ${l.interestRate}% | ${l.daysUntilDue}d | Urgency: ${l.urgency.toFixed(0)}%`
            ),
            ``,
            `Generated by NexLoan v2.0`
        ];

        this.downloadFile(lines.join('\n'), 'nexloan_summary.txt', 'text/plain');
        toast('Summary report downloaded ✓', 'success');
    },

    exportRepaymentSchedule(budget) {
        const loans = this.heap.getSortedLoans();
        const lines = [
            `NexLoan Repayment Schedule — Monthly Budget: ${fmt(budget)}`,
            `Generated: ${new Date().toLocaleDateString()}`,
            `${'='.repeat(70)}`,
        ];

        const perLoan = budget / loans.length;
        loans.forEach(loan => {
            const payment = Math.max(loan.monthlyInterest() * 1.2, perLoan);
            const rows = generateAmortization(loan, payment);
            lines.push(``, `Loan: ${loan.notes || loan.id} — Balance: ${fmt(loan.principal)} @ ${loan.interestRate}%`);
            lines.push(`Monthly Payment: ${fmt(payment)} | Payoff: ${monthsToDate(rows.length)}`);
            lines.push(`Month,Payment,Principal,Interest,Balance`);
            rows.slice(0, 36).forEach(r =>
                lines.push(`${r.month},${r.payment.toFixed(2)},${r.principal.toFixed(2)},${r.interest.toFixed(2)},${r.balance.toFixed(2)}`)
            );
        });

        this.downloadFile(lines.join('\n'), 'nexloan_schedule.csv', 'text/csv');
        toast('Repayment schedule downloaded ✓', 'success');
    },

    downloadFile(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    },

    importCSV(text) {
        const lines = text.trim().split('\n').filter(l => l.trim());
        let count = 0;
        this.pushUndo();
        lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
            if (parts.length < 5) return;
            const [principal, rate, days, lateFee, creditFactor, ...noteParts] = parts;
            if (isNaN(parseFloat(principal))) return;
            const loan = new Loan(principal, rate, days, lateFee, creditFactor || 5, noteParts.join(',') || '');
            this.heap.insert(loan);
            count++;
        });
        if (count > 0) {
            this.saveToStorage();
            this.populateLoanSelects();
            this.render();
            toast(`Imported ${count} loan${count > 1 ? 's' : ''} ✓`, 'success');
            document.getElementById('import-result').textContent = `✓ ${count} loans imported successfully`;
        } else {
            toast('No valid loans found in CSV', 'error');
        }
        return count;
    }
};

// ============================================================
//  SPLASH PARTICLE ANIMATION
// ============================================================

function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: 60 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        opacity: Math.random() * 0.5 + 0.1
    }));

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(181, 84, 30, ${p.opacity})`;
            ctx.fill();
            p.x += p.dx; p.y += p.dy;
            if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
        });

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
                if (dist < 100) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(181, 84, 30, ${0.06 * (1 - dist / 100)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    }
    draw();
}

// ============================================================
//  BOOT
// ============================================================

window.onload = () => {
    initParticles();
    UI.init();
};
