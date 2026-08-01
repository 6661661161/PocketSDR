// Pocket SDR Web UI - Receiver page

const LED_COLORS = ['#CC0000', '#F8F8F8', '#EE9900', '#006600', '#00CC00'];

const ROWS_L = [
    ['time', 'Receiver Time (s)'],
    ['src', 'Input Source'],
    ['fmt', 'Fmt / # RF CH / # Array CH'],
    ['fo1', 'LO Frequencies 1-4 (MHz)'],
    ['fo2', 'LO Frequencies 5-8 (MHz)'],
    ['IQ', 'Sampling'],
    ['fs', 'Sampling Rate (Msps)'],
    ['nch', '# BB CH Locked/All'],
    ['rate', 'IF Data Rate (MB/s)'],
    ['buff', 'IF Data Buffer Usage (%)'],
    ['sum', 'IF Data Log (MB)']
];
const ROWS_R = [
    ['stime', 'Time (GPST)'],
    ['sstat', 'Solution Status'],
    ['lat', 'Latitude (°)'],
    ['lon', 'Longitude (°)'],
    ['hgt', 'Altitude (m)'],
    ['nsat', '# Sats Used/All'],
    ['latency', 'Solution Latency (s)'],
    ['count', '# PVT/OBS/NAV'],
    ['out', 'Output Streams']
];

export class RcvPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        const rows = (defs, side) => defs.map(([id, lbl]) =>
            `<div class="rcv-row"><span class="lbl">${lbl}</span>` +
            `<span class="val" id="rcv-${id}">---</span></div>`).join('');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<span class="space"></span>` +
            `<label>Output</label><span id="rcv-leds">` +
            '<span class="led"></span>'.repeat(8) + `</span>` +
            `</div>` +
            `<div class="rcv-body"><div class="rcv-grid">` +
            `<div class="rcv-col">${rows(ROWS_L)}</div>` +
            `<div class="rcv-col">${rows(ROWS_R)}</div>` +
            `</div></div>`;
        this.leds = this.el.querySelectorAll('#rcv-leds .led');
        app.ws.on('rcv_stat', (msg) => this.updateStat(msg));
        app.ws.on('pvt_sol', (msg) => this.updateSol(msg));
    }
    val(id) {
        return this.el.querySelector('#rcv-' + id);
    }
    set(id, txt, warn) {
        const e = this.val(id);
        e.textContent = txt;
        e.classList.toggle('warn', !!warn);
    }
    updateStat(msg) {
        if (!this.active) return;
        const f = msg.str.split(/\s+/);
        if (f.length < 13) return;
        this.set('time', f[0]);
        this.set('src', f[1]);
        this.set('fmt', f[2]);
        this.set('fo1', f[3]);
        this.set('fo2', f[4]);
        this.set('IQ', f[5]);
        this.set('fs', f[6]);
        this.set('nch', f[7]);
        this.set('rate', f[8]);
        this.set('buff', f[9], parseFloat(f[9]) > 90.0);
        this.set('latency', f[10]);
        this.set('count', f[11]);
        this.set('sum', f[12], parseFloat(f[12]) > 0.0);
        for (let i = 0; i < 8; i++) {
            this.leds[i].style.background = LED_COLORS[(msg.strs[i] + 1)] ||
                LED_COLORS[1];
        }
        let n = 0;
        for (const s of msg.strs) if (s > 0) n++;
        this.set('out', n > 0 ? n + ' stream(s)' : '---');
    }
    updateSol(msg) {
        if (!this.active) return;
        const f = msg.str.split(/\s+/);
        if (f.length < 7) return;
        this.set('stime', f[0] + ' ' + f[1]);
        this.set('sstat', f[6], f[6] != 'FIX');
        this.set('lat', f[2]);
        this.set('lon', f[3]);
        this.set('hgt', f[4]);
        this.set('nsat', f[5]);
    }
    show() {
        this.active = true;
        this.app.ws.sub('pvt_sol', {cyc: 200});
    }
    hide() {
        this.active = false;
        this.app.ws.unsub('pvt_sol');
    }
}
