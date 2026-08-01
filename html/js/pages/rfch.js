// Pocket SDR Web UI - RF CH page (PSD and histograms)

import {Plot, FG, GR, P1, P2, SYS_COLOR} from '../plot.js';

const SIG_FREQ = { // signal carrier frequencies (MHz)
    L1CA: 1575.42, L1CB: 1575.42, L1CD: 1575.42, L1CP: 1575.42, L1S: 1575.42,
    L2CM: 1227.6, L5I: 1176.45, L5Q: 1176.45, L5SI: 1176.45, L5SQ: 1176.45,
    L5SIV: 1176.45, L5SQV: 1176.45, L6D: 1278.75, L6E: 1278.75,
    G1CA: 1602.0, G2CA: 1246.0, G1OCD: 1600.995, G1OCP: 1600.995,
    G2OCP: 1248.06, G3OCD: 1202.025, G3OCP: 1202.025,
    E1B: 1575.42, E1C: 1575.42, E5AI: 1176.45, E5AQ: 1176.45,
    E5ABI: 1191.795, E5ABQ: 1191.795, E5BI: 1207.14, E5BQ: 1207.14,
    E6B: 1278.75, E6C: 1278.75,
    B1I: 1561.098, B1CD: 1575.42, B1CP: 1575.42, B2AD: 1176.45,
    B2AP: 1176.45, B2I: 1207.14, B2BI: 1207.14, B3I: 1268.52,
    I1SD: 1575.42, I1SP: 1575.42, I5S: 1176.45, ISS: 2492.028
};
const HIST_XL = [5, 3, 5, 9, 9];    // histogram x range by bits
const HIST_YL = [0.4, 0.4, 0.4, 0.3, 0.25]; // histogram y range by bits

export class RfchPage {
    constructor(app) {
        this.app = app;
        this.bits = 2;
        this.sigs = {}; // RF CH -> [{sig, sys}]
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label>RF CH</label><select id="rf-ch"></select>` +
            `<span class="mono" id="rf-fs"></span>` +
            `<span class="space"></span>` +
            `<label>Filter BW (MHz)</label><select id="rf-bw">` +
            ['-', '2.5', '4.2', '8.7', '16.4', '23.4', '36.0'].map(
                v => `<option>${v}</option>`).join('') + `</select>` +
            `<select id="rf-order"><option>3rd</option><option>5th</option>` +
            `</select>` +
            `<label>LNA Gain</label><select id="rf-gain"><option>-</option>` +
            `<option>Auto</option>` + [...Array(64)].map(
                (_, i) => `<option>${i}</option>`).join('') + `</select>` +
            `<label>Ave (s)</label><select id="rf-tave">` +
            ['0.1', '0.03', '0.01', '0.003', '0.001'].map(
                v => `<option>${v}</option>`).join('') + `</select>` +
            `</div>` +
            `<div class="rfch-main">` +
            `<div class="plotbox rfch-psd"><canvas id="rf-psd"></canvas></div>` +
            `<div class="plotbox"><canvas id="rf-hist1"></canvas></div>` +
            `<div class="plotbox"><canvas id="rf-hist2"></canvas></div>` +
            `</div>`;
        this.el.querySelector('#rf-tave').value = '0.01';
        this.psdPlot = new Plot(this.el.querySelector('#rf-psd'), {
            margin: [45, 20, 25, 32], title: 'Power Spectral Density (dB/Hz)',
            xlabel: 'Frequency (MHz)', xlim: [1560, 1590], ylim: [-85, -45]
        });
        this.histPlot = [1, 2].map(i => new Plot(
            this.el.querySelector('#rf-hist' + i), {
            margin: [40, 15, 25, 32], title: 'Histogram ' + 'IQ'[i-1],
            xlabel: 'Quantized Value', xlim: [-5, 5], ylim: [0, 0.4]
        }));
        this.el.querySelector('#rf-ch').onchange = () => this.resub();
        this.el.querySelector('#rf-tave').onchange = () => this.resub();
        this.el.querySelector('#rf-gain').onchange = () => this.setGain();
        this.el.querySelector('#rf-bw').onchange = () => this.setFilt();
        this.el.querySelector('#rf-order').onchange = () => this.setFilt();
        app.ws.on('psd', (msg) => this.updatePsd(msg));
        app.ws.on('hist', (msg) => this.updateHist(msg));
        app.ws.on('ch_stat', (msg) => this.updateSigs(msg));
        app.ws.on('hello', () => {
            this.fillChs();
            if (this.active) {
                this.resub();
                this.app.ws.get('ch_stat', {chno: -1});
            }
        });
    }
    fillChs() {
        const sel = this.el.querySelector('#rf-ch');
        const n = this.app.info.nrfch + this.app.info.narch;
        if (sel.options.length == n) return;
        sel.innerHTML = [...Array(n)].map(
            (_, i) => `<option>${i+1}</option>`).join('');
    }
    rfch() {
        return parseInt(this.el.querySelector('#rf-ch').value) || 1;
    }
    resub() {
        if (!this.active) return;
        const tave = parseFloat(this.el.querySelector('#rf-tave').value);
        this.app.ws.sub('psd', {rfch: this.rfch(), cyc: 100, tave: tave,
            nfft: 2048});
        this.app.ws.sub('hist', {rfch: this.rfch(), cyc: 200, tave: tave});
    }
    setGain() {
        const val = this.el.querySelector('#rf-gain').value;
        if (val == '-') return;
        this.app.ws.send({cmd: 'set_gain', rfch: this.rfch(),
            gain: val == 'Auto' ? 0 : parseInt(val) + 1});
    }
    setFilt() {
        const bw = this.el.querySelector('#rf-bw').value;
        const order = this.el.querySelector('#rf-order').value;
        if (bw == '-') return;
        this.app.ws.send({cmd: 'set_filt', rfch: this.rfch(),
            bw: parseFloat(bw), freq: 0.0, order: order == '3rd' ? 1 : 0});
    }
    updateSigs(msg) { // derive signal list per RF CH (one-shot get)
        if (!this.active) return;
        this.sigs = {};
        for (const line of msg.str.split('\n').slice(2)) {
            const f = line.trim().split(/\s+/);
            if (f.length < 16) continue;
            const rf = parseInt(f[1]), sig = f[3], sys = f[2][0];
            this.sigs[rf] = this.sigs[rf] || [];
            if (!this.sigs[rf].find(s => s.sig == sig)) {
                this.sigs[rf].push({sig: sig, sys: sys});
            }
        }
    }
    updatePsd(msg) {
        if (!this.active || msg.rfch != this.rfch()) return;
        this.bits = msg.bits;
        const fo = msg.fo * 1e-6, fs = msg.fs * 1e-6;
        const p = this.psdPlot;
        p.xlim = msg.IQ == 1 ? [fo, fo + fs / 2] : [fo - fs / 2, fo + fs / 2];
        p.ylim = [-85, -45];
        p.begin();
        const x = new Array(msg.n), y = new Array(msg.n);
        for (let i = 0; i < msg.n; i++) {
            x[i] = p.xlim[0] + (p.xlim[1] - p.xlim[0]) * i / (msg.n - 1);
            y[i] = msg.psd[i];
        }
        p.vline(fo, GR);
        p.line(x, y, P1);
        // signal frequency marks
        let dy = 12;
        for (const s of this.sigs[msg.rfch] || []) {
            const f = SIG_FREQ[s.sig];
            if (!f || f < p.xlim[0] || f > p.xlim[1]) continue;
            const color = SYS_COLOR[s.sys] || FG;
            p.textPx(p.xp(f), p.ax[1] + dy, '▾ ' + s.sig, color, 'left',
                'middle');
            dy += 11;
        }
        p.end();
        p.textPx(p.ax[0] + 4, p.ax[3] - 8, fo.toFixed(3) + ' MHz', FG,
            'left', 'middle');
        p.textPx(p.ax[2] - 4, p.ax[3] - 8,
            (msg.IQ == 1 ? 'I' : 'IQ') + ' (' + msg.bits + ' bits)', FG,
            'right', 'middle');
        p.textPx(p.ax[0] + 4, p.ax[1] + 8, 'CH' + msg.rfch, P1, 'left',
            'middle', 'bold 12px Tahoma, sans-serif');
        this.el.querySelector('#rf-fs').textContent =
            'F_S: ' + fs.toFixed(6) + ' MHz';
    }
    updateHist(msg) {
        if (!this.active || msg.rfch != this.rfch()) return;
        const b = Math.min(this.bits, 4);
        for (const i of [0, 1]) {
            const p = this.histPlot[i];
            const hist = i == 0 ? msg.hist1 : msg.hist2;
            p.xlim = [-HIST_XL[b], HIST_XL[b]];
            p.ylim = [0, HIST_YL[b]];
            p.begin();
            let ave = 0.0, vari = 0.0;
            if (msg.IQ == 2 || i == 0) {
                for (let j = 0; j < msg.val.length; j++) {
                    ave += msg.val[j] * hist[j];
                }
                for (let j = 0; j < msg.val.length; j++) {
                    vari += (msg.val[j] - ave) ** 2 * hist[j];
                    p.bar(msg.val[j], hist[j], p.xs * 0.6, P1);
                }
            }
            p.end();
            p.textPx(p.ax[2] - 6, p.ax[1] + 12, 'Ave: ' + ave.toFixed(2), FG,
                'right', 'middle');
            p.textPx(p.ax[2] - 6, p.ax[1] + 24,
                'Std: ' + Math.sqrt(vari).toFixed(2), FG, 'right', 'middle');
        }
    }
    show() {
        this.active = true;
        this.fillChs();
        this.resub();
        this.app.ws.get('ch_stat', {chno: -1}); // for signal marks
    }
    hide() {
        this.active = false;
        this.app.ws.unsub('psd');
        this.app.ws.unsub('hist');
    }
}
