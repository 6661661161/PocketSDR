// Pocket SDR Web UI - Correlator page

import {Plot, FG, GR, P1, P2, BG} from '../plot.js';

const TITLES = {
    I: 'I * sign(IP)', Q: 'Q', IQ: 'sqrt(I²+Q²)',
    AveI: 'Σ I * sign(IP) / N', AveIQ: 'sqrt(Σ(I²+Q²)/N)'
};

export class CorrPage {
    constructor(app) {
        this.app = app;
        this.ch = parseInt(new URLSearchParams(location.search).get('ch')) || 1;
        this.corr = null;
        this.hist = null;
        this.stat = null;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label>BB CH</label>` +
            `<button id="co-prev">&lt;</button>` +
            `<input type="number" id="co-ch" value="1" min="1">` +
            `<button id="co-next">&gt;</button>` +
            `<span class="mono" id="co-info"></span>` +
            `<span class="space"></span>` +
            `<label>IQ</label><select id="co-iq">` +
            ['I', 'Q', 'IQ', 'AveI', 'AveIQ'].map(
                v => `<option>${v}</option>`).join('') + `</select>` +
            `<label>W (µs)</label><select id="co-w">` +
            ['0.2', '0.3', '0.5', '1', '1.5', '2', '3', '5', '10', '20'].map(
                v => `<option>${v}</option>`).join('') + `</select>` +
            `<label>T (s)</label><select id="co-t">` +
            ['0.1', '0.2', '0.5', '1', '2', '5', '10'].map(
                v => `<option>${v}</option>`).join('') + `</select>` +
            `<label>Range</label><select id="co-rng">` +
            ['0.1', '0.15', '0.2', '0.3', '0.4', '0.6', '0.8', '1.0', '1.5',
                '2'].map(v => `<option>${v}</option>`).join('') + `</select>` +
            `</div>` +
            `<div class="corr-main">` +
            `<div class="plotbox"><canvas id="co-plt1"></canvas></div>` +
            `<div class="plotbox"><canvas id="co-plt2"></canvas></div>` +
            `<div class="plotbox corr-plt3"><canvas id="co-plt3"></canvas>` +
            `</div></div>`;
        this.el.querySelector('#co-ch').value = this.ch;
        this.el.querySelector('#co-iq').value = 'AveI';
        this.el.querySelector('#co-w').value = '5';
        this.el.querySelector('#co-t').value = '1';
        this.el.querySelector('#co-rng').value = '0.4';
        this.plt1 = new Plot(this.el.querySelector('#co-plt1'), {
            margin: [45, 20, 25, 32], xlabel: 'COFF (ms)'});
        this.plt2 = new Plot(this.el.querySelector('#co-plt2'), {
            margin: [45, 15, 25, 32], title: 'IP-QP', aspect: 1});
        this.plt3 = new Plot(this.el.querySelector('#co-plt3'), {
            margin: [45, 20, 25, 32], title: 'Time (s) - IP/QP'});
        this.el.querySelector('#co-prev').onclick = () =>
            this.setCh(this.ch - 1);
        this.el.querySelector('#co-next').onclick = () =>
            this.setCh(this.ch + 1);
        this.el.querySelector('#co-ch').onchange = () =>
            this.setCh(parseInt(this.el.querySelector('#co-ch').value) || 1);
        this.el.querySelector('#co-iq').onchange = () => this.draw();
        this.el.querySelector('#co-w').onchange = () => this.resub();
        this.el.querySelector('#co-t').onchange = () => this.resub();
        this.el.querySelector('#co-rng').onchange = () => this.draw();
        app.ws.on('corr', (msg) => {
            if (this.active && msg.ch == this.ch) {
                this.corr = msg;
                this.draw();
            }
        });
        app.ws.on('corr_hist', (msg) => {
            if (this.active && msg.ch == this.ch) this.hist = msg;
        });
        app.ws.on('ch_stat', (msg) => {
            if (!this.active) return;
            const lines = msg.str.split('\n');
            const f = lines.length > 2 ? lines[2].trim().split(/\s+/) : [];
            this.stat = f.length >= 26 && parseInt(f[0]) == this.ch ? f : null;
            this.updateInfo();
        });
        app.ws.on('sel_ch', (msg) => { // follow selection by other clients
            if (this.active && msg.ch > 0 && msg.ch != this.ch) {
                this.ch = msg.ch;
                this.el.querySelector('#co-ch').value = this.ch;
                this.corr = this.hist = this.stat = null;
                this.resub();
            }
        });
    }
    setCh(ch) {
        this.ch = Math.min(Math.max(ch, 1), this.app.info.nch || 9999);
        this.el.querySelector('#co-ch').value = this.ch;
        this.corr = this.hist = this.stat = null;
        this.resub();
    }
    resub() {
        if (!this.active) return;
        const W = parseFloat(this.el.querySelector('#co-w').value);
        const T = parseFloat(this.el.querySelector('#co-t').value);
        this.app.ws.sub('corr', {ch: this.ch, cyc: 100, width: W * 1e-6});
        this.app.ws.sub('corr_hist', {ch: this.ch, cyc: 100, tspan: T});
        this.app.ws.sub('ch_stat', {chno: this.ch, opt: 1, cyc: 200,
            min_lock: 0.0});
    }
    updateInfo() {
        const f = this.stat;
        this.el.querySelector('#co-info').textContent = f ?
            `RF CH: ${f[1]}  SAT: ${f[2]}  SIG: ${f[3]}  PRN: ${f[4]}` +
            `  LOCK: ${f[5]} s` : `CH ${this.ch}: not locked`;
    }
    draw() {
        this.drawPlt1();
        this.drawPlt2();
        this.drawPlt3();
    }
    drawPlt1() {
        const p = this.plt1, m = this.corr;
        const R = parseFloat(this.el.querySelector('#co-rng').value);
        const W = parseFloat(this.el.querySelector('#co-w').value);
        const mode = this.el.querySelector('#co-iq').value;
        p.opt.title = TITLES[mode];
        const x0 = m ? m.coff : 0.0, half = W * 5e-4; // W (us) / 2 in ms
        p.xlim = [x0 - half, x0 + half];
        p.ylim = mode == 'Q' ? [-R, R] :
            (mode == 'IQ' || mode == 'AveIQ') ? [0, R] : [-R * 0.3, R];
        p.begin();
        p.hline(0, GR);
        if (m) {
            p.vline(m.coff, GR);
            const sign = m.C[0] >= 0.0 ? 1.0 : -1.0;
            const x = [], y = [];
            for (let i = 0; i < m.n; i++) {
                x.push(m.coff + m.pos[i] / m.fs * 1e3);
                y.push(mode == 'I' ? m.C[i*2] * sign :
                    mode == 'Q' ? m.C[i*2+1] * sign :
                    mode == 'IQ' ? Math.hypot(m.C[i*2], m.C[i*2+1]) :
                    mode == 'AveI' ? m.aveI[i] : Math.sqrt(m.aveP[i]));
            }
            if (m.n > m.npos) { // additional correlators
                p.line(x.slice(m.npos), y.slice(m.npos), P2);
                p.dots(x.slice(m.npos), y.slice(m.npos), 3, P1);
            }
            p.dots(x.slice(0, m.npos), y.slice(0, m.npos), 9, P1);
        }
        p.end();
        // scale bar (W/10 us)
        const bar = W * 1e-4 * p.xs; // in px
        const bx = p.ax[2] - 15 - bar, by = p.ax[1] + 12;
        p.ctx.strokeStyle = FG;
        p.ctx.beginPath();
        p.ctx.moveTo(bx, by);
        p.ctx.lineTo(bx + bar, by);
        p.ctx.stroke();
        p.textPx(bx + bar / 2, by + 10, (W / 10).toFixed(2) + ' us', FG);
    }
    drawPlt2() {
        const p = this.plt2, m = this.corr, h = this.hist;
        const R = parseFloat(this.el.querySelector('#co-rng').value);
        p.xlim = [-R, R];
        p.ylim = [-R, R];
        p.begin();
        p.vline(0, GR);
        p.hline(0, GR);
        if (h) {
            p.ctx.fillStyle = P2;
            for (let i = 0; i < h.n; i++) {
                p.ctx.fillRect(p.xp(h.P[i*2]) - 1, p.yp(h.P[i*2+1]) - 1, 2, 2);
            }
        }
        if (m) {
            p.point(m.C[0], m.C[1], 11, BG);
            p.point(m.C[0], m.C[1], 9, P1);
        }
        p.end();
    }
    drawPlt3() {
        const p = this.plt3, h = this.hist;
        const R = parseFloat(this.el.querySelector('#co-rng').value);
        const T = parseFloat(this.el.querySelector('#co-t').value);
        const tend = h ? h.time : 0.0;
        p.xlim = [tend - T, tend];
        p.ylim = [-R, R];
        p.begin();
        p.hline(0, GR);
        if (h && h.n > 0) {
            const t = [], ip = [], qp = [];
            for (let i = 0; i < h.n; i++) {
                t.push(h.time + (i - h.n + 1) * h.T);
                ip.push(h.P[i*2]);
                qp.push(h.P[i*2+1]);
            }
            p.line(t, qp, P2);
            p.line(t, ip, P1);
            p.point(t[h.n-1], ip[h.n-1], 11, BG);
            p.point(t[h.n-1], ip[h.n-1], 9, P1);
        }
        p.end();
        p.textPx(p.ax[2] - 70, p.ax[1] + 12, '— IP', P1, 'left');
        p.textPx(p.ax[2] - 70, p.ax[1] + 24, '— QP', P2, 'left');
        const f = this.stat;
        if (f) {
            p.textPx(p.ax[0] + 8, p.ax[1] + 12,
                `C/N0: ${f[6]} dB-Hz  COFF: ${f[8]} ms  DOP: ${f[9]} Hz  ` +
                `ADR: ${f[10]} cyc  SYNC: ${f[11]}  #NAV: ${f[12]}`, FG,
                'left');
            p.textPx(p.ax[0] + 8, p.ax[3] - 12,
                `ERR_P: ${f[16]} cyc  ERR_C: ${f[17]} m  PLI: ${f[18]}  ` +
                `NAV: ${f[20]}-${f[21]}-${f[22]}  WEEK: ${f[23]}  ` +
                `TOW: ${f[24]} s`, FG, 'left');
        }
    }
    show() {
        this.active = true;
        this.resub();
    }
    hide() {
        this.active = false;
        this.app.ws.unsub('corr');
        this.app.ws.unsub('corr_hist');
        this.app.ws.unsub('ch_stat');
    }
}
