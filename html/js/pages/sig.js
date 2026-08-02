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
const DEF_PRN = { // default PRN number lists
    GPS: '1-32', GLONASS: '-7-6', Galileo: '1-36', QZSS: '193-202',
    BeiDou: '1-63', NavIC: '1-14', SBAS: '120-158'
};

export class SigPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label>Signal Options</label>` +
            `<span class="space"></span>` +
            `<span class="warn-txt" id="sg-note"></span>` +
            `<button id="sg-all">Set All</button>` +
            `<button id="sg-none">Unset All</button>` +
            `<button id="sg-apply">Apply</button>` +
            `<button id="sg-reload">Reload</button>` +
            `</div>` +
            `<div class="cfg-body">` +
            Object.keys(SYS_SIGS).map(sys =>
                `<div class="sig-sec" data-sys="${sys}">` +
                `<span class="sig-head">${sys}</span>` +
                `<label>PRN</label>` +
                `<input type="text" class="sg-prn" size="12">` +
                SYS_SIGS[sys].map(sig =>
                    `<label class="sig-chk"><input type="checkbox" ` +
                    `class="sg-sig" data-sig="${sig}"> ${sig}</label>`
                ).join('') + `</div>`).join('') +
            `<div class="cfg-row"><label>Receiver Options</label>` +
            `<input type="text" id="sg-opt" class="wide"></div>` +
            `<div class="cfg-note">Receiver Options: -RFCH sig:ch[,ch...] ` +
            `-ARCH=n -GAIN=dB -BW=MHz -LPF=ch:MHz -FAST_SRCH</div>` +
            `</div>`;
        this.el.querySelector('#sg-apply').onclick = () => this.apply();
        this.el.querySelector('#sg-reload').onclick = () =>
            this.app.ws.get('cfg');
        this.el.querySelector('#sg-all').onclick = () => this.setAll(true);
        this.el.querySelector('#sg-none').onclick = () => this.setAll(false);
        app.ws.on('cfg', (msg) => {
            if (this.active) this.populate(msg);
        });
        app.ws.on('hello', () => {
            if (this.active) this.app.ws.get('cfg');
        });
    }
    setEditable(ena, run) {
        for (const id of ['#sg-apply', '#sg-all', '#sg-none']) {
            this.el.querySelector(id).disabled = !ena || run;
        }
        this.el.querySelector('#sg-note').textContent = !ena ?
            'configuration not supported by the server' :
            run ? 'stop the receiver to edit' : '';
    }
    setAll(ena) {
        for (const e of this.el.querySelectorAll('.sg-sig')) e.checked = ena;
    }
    populate(cfg) {
        this.setEditable(cfg.ena, cfg.run);
        this.el.querySelector('#sg-opt').value = cfg.opt;
        for (const sec of this.el.querySelectorAll('.sig-sec')) {
            sec.querySelector('.sg-prn').value = DEF_PRN[sec.dataset.sys];
            for (const e of sec.querySelectorAll('.sg-sig')) e.checked = false;
        }
        // assign "SIG:prns" entries to systems (first unclaimed match wins)
        for (const ent of cfg.sigs.split(/\s+/)) {
            const [sig, prn] = ent.split(':');
            if (!sig || !prn) continue;
            for (const sec of this.el.querySelectorAll('.sig-sec')) {
                if (!SYS_SIGS[sec.dataset.sys].includes(sig)) continue;
                const box = [...sec.querySelectorAll('.sg-sig')].find(
                    e => e.dataset.sig == sig);
                if (box.checked) continue; // claimed: try next system
                box.checked = true;
                sec.querySelector('.sg-prn').value = prn;
                break;
            }
        }
    }
    apply() {
        const sigs = [];
        for (const sec of this.el.querySelectorAll('.sig-sec')) {
            const prn = sec.querySelector('.sg-prn').value.trim() ||
                DEF_PRN[sec.dataset.sys];
            for (const e of sec.querySelectorAll('.sg-sig')) {
                if (e.checked) sigs.push(e.dataset.sig + ':' + prn);
            }
        }
        this.app.ws.send({cmd: 'set_sig', sigs: sigs.join(' '),
            opt: this.el.querySelector('#sg-opt').value});
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
