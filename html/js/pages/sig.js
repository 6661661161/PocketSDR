// Pocket SDR Web UI - Signal Options page

const SYS_SIGS = { // selectable signals by satellite system
    GPS: ['L1CA', 'L1CD', 'L1CP', 'L2CM', 'L5I', 'L5Q'],
    GLONASS: ['G1CA', 'G1OCD', 'G1OCP', 'G2CA', 'G2OCP', 'G3OCD', 'G3OCP'],
    Galileo: ['E1B', 'E1C', 'E5AI', 'E5AQ', 'E5ABQ', 'E5BI', 'E5BQ', 'E6B',
        'E6C'],
    QZSS: ['L1CA', 'L1CB', 'L1CD', 'L1CP', 'L1S', 'L2CM', 'L5I', 'L5Q',
        'L5SI', 'L5SIV', 'L5SQ', 'L5SQV', 'L6D', 'L6E'],
    BeiDou: ['B1I', 'B1CD', 'B1CP', 'B2AD', 'B2AP', 'B2I', 'B2BI', 'B3I'],
    NavIC: ['I1SD', 'I1SP', 'I5S', 'ISS'],
    SBAS: ['L1CA', 'L5I', 'L5Q']
};
const DEF_SAT = { // default satellite number lists (GLONASS: FCNs/slots)
    GPS: '1-32', GLONASS: '-7-6/1-27', Galileo: '1-36', QZSS: '1-9',
    BeiDou: '1-63', NavIC: '1-14', SBAS: '120-158'
};

// parse number list with ranges (e.g. "1-32,40", "-7-6") ----------------------
function parseNums(str) {
    const nums = [];
    for (const tok of str.split(',')) {
        const m = tok.trim().match(/^(-?\d+)(?:-(-?\d+))?$/);
        if (!m) continue;
        const a = parseInt(m[1]);
        const b = m[2] !== undefined ? parseInt(m[2]) : a;
        for (let n = a; n <= b && n - a < 512; n++) nums.push(n);
    }
    return nums;
}

// compress number list to ranges ----------------------------------------------
function compNums(nums) {
    const s = [...new Set(nums)].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < s.length; ) {
        let j = i;
        while (j + 1 < s.length && s[j+1] == s[j] + 1) j++;
        out.push(j > i ? s[i] + '-' + s[j] : '' + s[i]);
        i = j + 1;
    }
    return out.join(',');
}

// QZSS satellite number to PRN (as python qzss_no2prn) ------------------------
function qzssNo2Prn(sig, no) {
    if (['L1CA', 'L1CD', 'L1CP', 'L2CM', 'L5I', 'L5Q', 'L6D'].includes(sig)) {
        return 192 + no;
    }
    if (sig == 'L1S' && no <= 7) return 182 + no;
    if (sig == 'L6E') return 202 + no;
    if (sig == 'L1CB' && [4, 5, 8, 9, 10].includes(no)) {
        return no <= 5 ? 199 + no : no <= 9 ? 197 + no : 202;
    }
    if (['L5SI', 'L5SQ'].includes(sig) && [2, 3, 4, 7].includes(no)) {
        return 182 + no;
    }
    if (['L5SIV', 'L5SQV'].includes(sig) && [4, 8, 9].includes(no)) {
        return no == 4 ? 186 : 197 + no;
    }
    return 0;
}

// satellite number list to PRN list for a signal (null: none) -----------------
function sat2prns(sys, sig, satno) {
    if (sys == 'QZSS') {
        const prns = parseNums(satno).map(n => qzssNo2Prn(sig, n))
            .filter(p => p > 0);
        return prns.length ? compNums(prns) : null;
    }
    if (sys == 'GLONASS') { // "fcns/slots"
        const s = satno.split('/');
        const part = sig == 'G1CA' || sig == 'G2CA' ? s[0] : s[1] || '';
        return part.trim() ? part.trim() : null;
    }
    return satno;
}

// PRN list back to satellite number list --------------------------------------
function prns2sat(sys, sig, prns) {
    if (sys == 'QZSS') {
        const nos = parseNums(prns).map(p => {
            for (let no = 1; no <= 11; no++) {
                if (qzssNo2Prn(sig, no) == p) return no;
            }
            return 0;
        }).filter(n => n > 0);
        return nos.length ? compNums(nos) : '';
    }
    return prns;
}

export class SigPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label class="ttl">Signal Options</label>` +
            `<span class="space"></span>` +
            `<button id="sg-all">Set All</button>` +
            `<button id="sg-none">Unset All</button>` +
            `<button id="sg-apply">Apply</button>` +
            `<button id="sg-reload">Reload</button>` +
            `</div>` +
            `<div class="cfg-body">` +
            `<div class="warn-txt cfg-warn" id="sg-note"></div>` +
            `<div class="sig-sec sig-hdr">` +
            `<span class="sig-head">System</span>` +
            `<span class="sig-sat">Satellite No</span>` +
            `<span class="sig-sigs">GNSS Signals</span></div>` +
            Object.keys(SYS_SIGS).map(sys =>
                `<div class="sig-sec" data-sys="${sys}">` +
                `<label class="sig-head"><input type="checkbox" ` +
                `class="sg-sys" checked> ${sys}</label>` +
                `<input type="text" class="sg-prn sig-sat">` +
                `<span class="sig-grid">` +
                SYS_SIGS[sys].map(sig =>
                    `<label class="sig-chk"><input type="checkbox" ` +
                    `class="sg-sig" data-sig="${sig}"> ${sig}</label>`
                ).join('') + `</span></div>`).join('') +
            `<div class="cfg-frm">` +
            `<div class="cfg-row"><label>RF CH Assignments</label>` +
            `<input type="text" id="sg-rfch" class="wide"></div>` +
            `<div class="cfg-note">RF CH Assignments: ` +
            `&lt;sig&gt;:&lt;ch&gt;[{,|-}&lt;ch&gt;...] ... (empty: auto) / ` +
            `GLONASS SAT: fcns/slots</div></div>` +
            `</div>`;
        this.el.querySelector('#sg-apply').onclick = () => this.apply();
        this.el.querySelector('#sg-reload').onclick = () =>
            this.app.ws.get('cfg');
        this.el.querySelector('#sg-all').onclick = () => this.setAll(true);
        this.el.querySelector('#sg-none').onclick = () => this.setAll(false);
        for (const e of this.el.querySelectorAll('.sg-sys')) {
            e.onchange = () => this.updateEna();
        }
        app.ws.on('cfg', (msg) => {
            if (this.active) this.populate(msg);
        });
        app.ws.on('hello', () => {
            if (this.active) this.app.ws.get('cfg');
        });
    }
    // satellite numbers and signals follow the system enable check ------------
    updateEna() {
        const dis = this.el.querySelector('#sg-apply').disabled;
        for (const sec of this.el.querySelectorAll('.sig-sec[data-sys]')) {
            const ena = sec.querySelector('.sg-sys').checked;
            for (const e of sec.querySelectorAll('.sg-prn, .sg-sig')) {
                e.disabled = dis || !ena;
            }
        }
    }
    setEditable(ena, run) {
        const dis = !ena || run;
        for (const id of ['#sg-apply', '#sg-all', '#sg-none']) {
            this.el.querySelector(id).disabled = dis;
        }
        for (const e of this.el.querySelectorAll('.cfg-body input')) {
            e.disabled = dis;
        }
        this.el.querySelector('#sg-note').textContent = !ena ?
            'Configuration not supported by the server' :
            run ? 'Stop the receiver to edit' : '';
        this.updateEna();
    }
    setAll(ena) {
        for (const e of this.el.querySelectorAll('.sg-sig')) e.checked = ena;
        for (const e of this.el.querySelectorAll('.sg-sys')) e.checked = ena;
        this.updateEna();
    }
    populate(cfg) {
        this.el.querySelector('#sg-rfch').value = cfg.rfch;
        for (const sec of this.el.querySelectorAll('.sig-sec[data-sys]')) {
            sec.querySelector('.sg-prn').value = DEF_SAT[sec.dataset.sys];
            sec.querySelector('.sg-sys').checked = false;
            for (const e of sec.querySelectorAll('.sg-sig')) e.checked = false;
        }
        // assign "SIG:prns" entries to systems (first unclaimed match wins)
        let gloFcn = '', gloSlot = '';
        for (const ent of cfg.sigs.split(/\s+/)) {
            const [sig, prn] = ent.split(':');
            if (!sig || !prn) continue;
            for (const sec of this.el.querySelectorAll('.sig-sec[data-sys]')) {
                const sys = sec.dataset.sys;
                if (!SYS_SIGS[sys].includes(sig)) continue;
                const box = [...sec.querySelectorAll('.sg-sig')].find(
                    e => e.dataset.sig == sig);
                if (box.checked) continue; // claimed: try next system
                box.checked = true;
                sec.querySelector('.sg-sys').checked = true;
                if (sys == 'GLONASS') {
                    if (sig == 'G1CA' || sig == 'G2CA') gloFcn = gloFcn || prn;
                    else gloSlot = gloSlot || prn;
                }
                else {
                    const t = prns2sat(sys, sig, prn);
                    if (t) sec.querySelector('.sg-prn').value = t;
                }
                break;
            }
        }
        if (gloFcn || gloSlot) {
            this.el.querySelector('.sig-sec[data-sys=GLONASS] .sg-prn').value =
                (gloFcn || '-7-6') + '/' + (gloSlot || '1-27');
        }
        this.setEditable(cfg.ena, cfg.run);
    }
    apply() {
        const sigs = [];
        const secs = [...this.el.querySelectorAll('.sig-sec[data-sys]')];
        const nsig = Math.max(...secs.map(
            s => s.querySelectorAll('.sg-sig').length));
        // signal index first, then system, as the Tk GUI assigns receiver CHs
        for (let i = 0; i < nsig; i++) {
            for (const sec of secs) {
                if (!sec.querySelector('.sg-sys').checked) continue;
                const e = sec.querySelectorAll('.sg-sig')[i];
                if (!e || !e.checked) continue;
                const sys = sec.dataset.sys;
                const satno = sec.querySelector('.sg-prn').value.trim() ||
                    DEF_SAT[sys];
                const prns = sat2prns(sys, e.dataset.sig, satno);
                if (prns) sigs.push(e.dataset.sig + ':' + prns);
            }
        }
        this.app.ws.send({cmd: 'set_sig', sigs: sigs.join(' '),
            rfch: this.el.querySelector('#sg-rfch').value});
        this.app.msg('Signal options applied.');
        this.app.ws.get('cfg');
    }
    show() {
        this.active = true;
        this.app.ws.get('cfg');
    }
    hide() {
        this.active = false;
    }
}
