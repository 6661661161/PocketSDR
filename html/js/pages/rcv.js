// Pocket SDR Web UI - Receiver page

import {Plot, BG, FG, GR, SYS_COLOR, SYS_COLOR2} from '../plot.js';

const D2R = Math.PI / 180;
const LED_COLORS = ['#CC0000', '#F8F8F8', '#EE9900', '#006600', '#00CC00'];
const SYSTEMS = ['ALL', 'GPS', 'GLONASS', 'Galileo', 'QZSS', 'BeiDou',
    'NavIC', 'SBAS'];
const SYS_ORDER = 'GREJCIS';

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
    ['count', '# PVT/OBS/NAV']
];

// satellite system of satellite ID --------------------------------------------
export function satSys(sat) {
    return sat[0] >= '0' && sat[0] <= '9' ? 'S' : sat[0];
}

// satellite sort order --------------------------------------------------------
export function satNo(sat) {
    const sys = satSys(sat);
    const prn = parseInt(sat.replace(/^[A-Z]/, '')) || 0;
    return SYS_ORDER.indexOf(sys) * 1000 + prn;
}

export class RcvPage {
    constructor(app) {
        this.app = app;
        this.sigStat = {};  // sat -> [{sig, cn0}]
        this.satInfo = {};  // sat -> {az, el, pvt, ...}
        this.sats = [];
        this.satsKey = '';
        this.el = document.createElement('div');
        const rows = (defs) => defs.map(([id, lbl]) =>
            `<div class="rcv-row"><span class="lbl">${lbl}</span>` +
            `<span class="val" id="rcv-${id}">---</span></div>`).join('');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label>RF CH</label><select id="rcv-rf"><option>ALL</option>` +
            [...Array(16)].map((_, i) => `<option>${i+1}</option>`).join('') +
            `</select>` +
            `<label>System</label><select id="rcv-sys">` +
            SYSTEMS.map(s => `<option>${s}</option>`).join('') + `</select>` +
            `<span class="space"></span>` +
            `<label>Output</label><span id="rcv-leds">` +
            '<span class="led"></span>'.repeat(8) + `</span>` +
            `</div>` +
            `<div class="rcv-main">` +
            `<div class="rcv-top">` +
            `<div class="rcv-body2"><div class="rcv-grid">` +
            `<div class="rcv-col">${rows(ROWS_L)}</div>` +
            `<div class="rcv-col">${rows(ROWS_R)}</div>` +
            `</div></div>` +
            `<div class="plotbox rcv-sky"><canvas id="rcv-sky"></canvas>` +
            `</div></div>` +
            `<div class="plotbox rcv-cn0"><canvas id="rcv-cn0"></canvas>` +
            `</div></div>`;
        this.leds = this.el.querySelectorAll('#rcv-leds .led');
        this.sky = this.el.querySelector('#rcv-sky');
        this.cn0Plot = new Plot(this.el.querySelector('#rcv-cn0'), {
            margin: [35, 15, 22, 24], title: 'Signal C/N0 (dB-Hz)',
            ylim: [20, 55], xticks: false});
        for (const id of ['rcv-rf', 'rcv-sys']) {
            this.el.querySelector('#' + id).onchange = () => this.resub();
        }
        app.ws.on('rcv_stat', (msg) => this.updateStat(msg));
        app.ws.on('pvt_sol', (msg) => this.updateSol(msg));
        app.ws.on('ch_stat', (msg) => this.updateChStat(msg));
        app.ws.on('sat_stat', (msg) => this.updateSatStat(msg));
    }
    set(id, txt, warn) {
        const e = this.el.querySelector('#rcv-' + id);
        e.textContent = txt;
        e.classList.toggle('warn', !!warn);
    }
    resub() {
        if (!this.active) return;
        const rf = this.el.querySelector('#rcv-rf').value;
        this.app.ws.sub('ch_stat', {
            cyc: 200, sys: this.el.querySelector('#rcv-sys').value, chno: 0,
            min_lock: 2.0, rfch: rf == 'ALL' ? 0 : parseInt(rf), opt: 0});
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
    }
    updateSol(msg) {
        if (!this.active) return;
        const f = msg.str.split(/\s+/);
        if (f.length < 7) return;
        this.set('stime', f[0] + ' ' + f[1]);
        this.set('sstat', f[6], false);
        this.set('lat', f[2]);
        this.set('lon', f[3]);
        this.set('hgt', f[4]);
        this.set('nsat', f[5]);
    }
    updateChStat(msg) {
        if (!this.active) return;
        this.sigStat = {};
        for (const line of msg.str.split('\n').slice(2)) {
            const f = line.trim().split(/\s+/);
            if (f.length < 16) continue;
            (this.sigStat[f[2]] = this.sigStat[f[2]] || []).push(
                {sig: f[3], cn0: parseFloat(f[6])});
        }
        this.sats = Object.keys(this.sigStat).sort(
            (a, b) => satNo(a) - satNo(b));
        const key = this.sats.join(',');
        if (key != this.satsKey) {
            this.satsKey = key;
            if (key) this.app.ws.sub('sat_stat', {sats: key, cyc: 200});
            else this.app.ws.unsub('sat_stat');
        }
        this.draw();
    }
    updateSatStat(msg) {
        if (!this.active) return;
        this.satInfo = {};
        for (const s of msg.sats) this.satInfo[s.sat] = s;
        this.draw();
    }
    draw() {
        this.drawSky();
        this.drawCn0();
    }
    drawSky() {
        const cv = this.sky, dpr = window.devicePixelRatio || 1;
        const r0 = cv.getBoundingClientRect();
        if (r0.width < 60 || r0.height < 60) return;
        cv.width = Math.round(r0.width * dpr);
        cv.height = Math.round(r0.height * dpr);
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = r0.width, h = r0.height;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 16;
        ctx.strokeStyle = GR;
        ctx.lineWidth = 1;
        for (const el of [0, 30, 60]) {
            ctx.beginPath();
            ctx.arc(cx, cy, R * (90 - el) / 90, 0, 2 * Math.PI);
            ctx.stroke();
        }
        for (let az = 0; az < 360; az += 30) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + R * Math.sin(az * D2R),
                cy - R * Math.cos(az * D2R));
            ctx.stroke();
        }
        ctx.font = '11px Tahoma, sans-serif';
        ctx.fillStyle = FG;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, cy - R - 8);
        ctx.fillText('E', cx + R + 8, cy);
        ctx.fillText('S', cx, cy + R + 8);
        ctx.fillText('W', cx - R - 8, cy);
        ctx.font = '9px Tahoma, sans-serif';
        for (const sat of this.sats) {
            const si = this.satInfo[sat] || {az: 0, el: 0, pvt: 0};
            const rr = R * (90 - si.el) / 90;
            const x = cx + rr * Math.sin(si.az * D2R);
            const y = cy - rr * Math.cos(si.az * D2R);
            const color = SYS_COLOR[satSys(sat)] || FG;
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, 2 * Math.PI);
            ctx.fillStyle = si.pvt ? color : BG;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.stroke();
            ctx.fillStyle = si.pvt ? BG : FG;
            ctx.fillText(sat, x, y);
        }
    }
    drawCn0() {
        const p = this.cn0Plot;
        const sys = this.el.querySelector('#rcv-sys').value;
        const sats = this.sats;
        p.xlim = [-0.7, Math.max(sats.length, 1) - 0.3];
        p.begin();
        const ctx = p.ctx;
        let nuse = 0;
        sats.forEach((sat, i) => {
            const si = this.satInfo[sat] || {pvt: 0};
            const color = (si.pvt ? SYS_COLOR : SYS_COLOR2)[satSys(sat)] ||
                FG;
            if (si.pvt) nuse++;
            const sigs = this.sigStat[sat];
            if (sys == 'ALL') {
                const cn0 = Math.max(...sigs.map(s => s.cn0));
                p.barY(i, 20, cn0, 6, color);
            }
            else {
                sigs.forEach((s, j) => {
                    const px = p.xp(i) + (j - (sigs.length - 1) / 2) * 8;
                    const py0 = p.yp(20), py1 = p.yp(s.cn0);
                    ctx.fillStyle = color;
                    ctx.fillRect(px - 3, Math.min(py0, py1), 6,
                        Math.abs(py0 - py1));
                });
            }
        });
        p.end();
        sats.forEach((sat, i) => {
            p.textPx(p.xp(i), p.ax[3] + 4,
                sys == 'ALL' ? sat.replace(/^[A-Z]/, '') : sat, FG,
                'center', 'top');
        });
        p.textPx(p.ax[0] + 6, p.ax[1] + 10,
            '#Sats: ' + nuse + '/' + sats.length, FG, 'left');
        if (sys == 'ALL') {
            const present = [...new Set(sats.map(satSys))];
            let px = p.ax[2] - 6;
            for (const s of present.reverse()) {
                p.textPx(px, p.ax[1] + 10, s, SYS_COLOR[s], 'right');
                px -= 14;
            }
        }
        else {
            const sigs = [...new Set([].concat(
                ...sats.map(s => this.sigStat[s].map(x => x.sig))))];
            p.textPx(p.ax[2] - 6, p.ax[1] + 10, 'Signals: ' + sigs.join(' '),
                FG, 'right');
        }
    }
    show() {
        this.active = true;
        this.satsKey = '';
        this.resub();
        this.app.ws.sub('pvt_sol', {cyc: 200});
    }
    hide() {
        this.active = false;
        this.app.ws.unsub('ch_stat');
        this.app.ws.unsub('sat_stat');
        this.app.ws.unsub('pvt_sol');
    }
}
