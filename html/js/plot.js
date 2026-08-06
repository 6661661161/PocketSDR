// Pocket SDR Web UI - Canvas 2D plot library (port of python/sdr_plot.py)

export const BG = '#FFFFFF';        // plot background
export const FG = '#555555';        // frame, ticks and labels
export const GR = '#CCCCCC';        // grid lines
export const P1 = '#003020';        // primary plot color
export const P2 = '#888844';        // secondary plot color
export const P3 = '#BBBBBB';        // reference line color
export const WARN = '#FF4000';      // warning color

// read a CSS custom property with fallback ------------------------------------
export function cssVar(name, def) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name).trim();
    return v || def;
}

// plot label and title fonts (set by --plot-font / --plot-title-font) ---------
export function plotFont() {
    return cssVar('--plot-font', '11px Tahoma, "DejaVu Sans", sans-serif');
}
export function plotTitleFont() {
    return cssVar('--plot-title-font',
        'bold 12px Tahoma, "DejaVu Sans", sans-serif');
}

export const SYS_COLOR = {          // satellite system colors
    G: '#006600', R: '#EE9900', E: '#CC00CC', J: '#0000AA', C: '#CC0000',
    I: '#007777', S: '#777777'
};

export const SYS_COLOR2 = {         // pale variants (not used in PVT)
    G: '#88AA88', R: '#F8CC88', E: '#EE88EE', J: '#8888CC', C: '#E08888',
    I: '#88BBBB', S: '#BBBBBB'
};

// tick step in 1-2-2.5-5 series -----------------------------------------------
function tickStep(span, maxTicks) {
    const raw = span / Math.max(2, maxTicks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) {
        if (raw <= m * mag * 1.5) return m * mag;
    }
    return 10 * mag;
}

// tick step for time axis (s) -------------------------------------------------
function timeStep(span, maxTicks) {
    for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
        7200, 10800, 21600, 43200]) {
        if (span / s <= Math.max(2, maxTicks) * 2.0) return s;
    }
    return 86400;
}

// time label hh:mm:ss ---------------------------------------------------------
function timeLabel(t) {
    t = ((Math.round(t) % 86400) + 86400) % 86400;
    const z = (v) => (v < 10 ? '0' : '') + v;
    return z(Math.floor(t / 3600)) + ':' + z(Math.floor(t % 3600 / 60)) +
        ':' + z(Math.floor(t % 60));
}

// tick positions within limits ------------------------------------------------
function tickList(lim, step) {
    const ticks = [];
    for (let x = Math.ceil(lim[0] / step - 1e-9) * step;
        x <= lim[1] + step * 1e-9; x += step) {
        ticks.push(Math.abs(x) < step * 1e-9 ? 0 : x);
    }
    return ticks;
}

// Canvas 2D plot --------------------------------------------------------------
export class Plot {
    constructor(canvas, opts) {
        this.cv = canvas;
        this.ctx = canvas.getContext('2d');
        this.opt = Object.assign({
            margin: [40, 15, 22, 30], // left, right, top, bottom (px)
            aspect: 0, title: '', xlabel: '', ylabel: ''
        }, opts || {});
        this.xlim = this.opt.xlim || [0, 1];
        this.ylim = this.opt.ylim || [0, 1];
    }
    resize() {
        const r = this.cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(50, Math.round(r.width * dpr));
        const h = Math.max(50, Math.round(r.height * dpr));
        if (this.cv.width != w || this.cv.height != h) {
            this.cv.width = w;
            this.cv.height = h;
        }
        this.w = w / dpr;
        this.h = h / dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // data to pixel transforms
    xp(x) {
        return this.xc + (x - (this.xlim[0] + this.xlim[1]) / 2) * this.xs;
    }
    yp(y) {
        return this.yc - (y - (this.ylim[0] + this.ylim[1]) / 2) * this.ys;
    }
    // start frame: clear, draw grid, clip to plot area
    begin() {
        this.resize();
        this.font = plotFont();
        this.fontB = plotTitleFont();
        const ctx = this.ctx, [ml, mr, mt, mb] = this.opt.margin;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, this.w, this.h);
        this.ax = [ml, mt, this.w - mr, this.h - mb];
        if (this.opt.aspect) { // keep plot area square
            const side = Math.min(this.ax[2] - this.ax[0],
                this.ax[3] - this.ax[1]);
            const cx = (this.ax[0] + this.ax[2]) / 2;
            const cy = (this.ax[1] + this.ax[3]) / 2;
            this.ax = [cx - side / 2, cy - side / 2, cx + side / 2,
                cy + side / 2];
        }
        let xs = (this.ax[2] - this.ax[0]) / (this.xlim[1] - this.xlim[0]);
        let ys = (this.ax[3] - this.ax[1]) / (this.ylim[1] - this.ylim[0]);
        if (this.opt.aspect) xs = ys = Math.min(xs, ys);
        this.xs = xs;
        this.ys = ys;
        this.xc = (this.ax[0] + this.ax[2]) / 2;
        this.yc = (this.ax[1] + this.ax[3]) / 2;
        this.xt = (this.opt.taxis ? timeStep : tickStep)(
            this.xlim[1] - this.xlim[0],
            (this.ax[2] - this.ax[0]) / (this.opt.taxis ? 75 : 55));
        this.yt = this.opt.ystep || tickStep(this.ylim[1] - this.ylim[0],
            (this.ax[3] - this.ax[1]) / 35);
        ctx.strokeStyle = GR;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        if (this.opt.xticks !== false) {
            for (const x of tickList(this.xlim, this.xt)) {
                const px = Math.round(this.xp(x)) + 0.5;
                ctx.moveTo(px, this.ax[1]);
                ctx.lineTo(px, this.ax[3]);
            }
        }
        if (this.opt.yticks !== false) {
            for (const y of tickList(this.ylim, this.yt)) {
                const py = Math.round(this.yp(y)) + 0.5;
                ctx.moveTo(this.ax[0], py);
                ctx.lineTo(this.ax[2], py);
            }
        }
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.ax[0], this.ax[1], this.ax[2] - this.ax[0],
            this.ax[3] - this.ax[1]);
        ctx.clip();
    }
    // end frame: remove clip, draw frame, ticks, labels and title
    end() {
        const ctx = this.ctx;
        ctx.restore();
        ctx.strokeStyle = FG;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(this.ax[0] + 0.5, this.ax[1] + 0.5,
            this.ax[2] - this.ax[0] - 1, this.ax[3] - this.ax[1] - 1);
        ctx.font = this.font;
        ctx.fillStyle = FG;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const dec = (t) => Math.max(0, -Math.floor(Math.log10(t) + 1e-9));
        if (this.opt.xticks !== false) {
            for (const x of tickList(this.xlim, this.xt)) {
                const px = Math.round(this.xp(x)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(px, this.ax[3]);
                ctx.lineTo(px, this.ax[3] - 5);
                ctx.stroke();
                if (this.opt.xlabels !== false) {
                    ctx.fillText(this.opt.taxis ? timeLabel(x) :
                        x.toFixed(dec(this.xt)), px, this.ax[3] + 3);
                }
            }
        }
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (this.opt.yticks !== false) {
            for (const y of tickList(this.ylim, this.yt)) {
                const py = Math.round(this.yp(y)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(this.ax[0], py);
                ctx.lineTo(this.ax[0] + 5, py);
                ctx.stroke();
                ctx.fillText(y.toFixed(dec(this.yt)), this.ax[0] - 3, py);
            }
        }
        if (this.opt.title) {
            ctx.font = this.fontB;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(this.opt.title, (this.ax[0] + this.ax[2]) / 2,
                this.ax[1] - 4);
        }
        if (this.opt.xlabel) {
            ctx.font = this.font;
            ctx.textBaseline = 'bottom';
            if (this.opt.xlabel_in) { // inside the plot at the bottom left
                ctx.textAlign = 'left';
                ctx.fillText(this.opt.xlabel, this.ax[0] + 6, this.ax[3] - 5);
            }
            else { // just under the tick labels
                const fs = parseFloat(this.font) || 10;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(this.opt.xlabel, (this.ax[0] + this.ax[2]) / 2,
                    this.ax[3] + 5 + (this.opt.xlabels === false ? 0 : fs * 1.3));
            }
        }
    }
    // polyline in data coordinates
    line(xs, ys, color, width) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 0.6;
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
            const px = this.xp(xs[i]), py = this.yp(ys[i]);
            if (i == 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }
    // dots in data coordinates
    dots(xs, ys, size, color) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        const r = size / 2;
        for (let i = 0; i < xs.length; i++) {
            ctx.beginPath();
            ctx.arc(this.xp(xs[i]), this.yp(ys[i]), r, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
    point(x, y, size, color) {
        this.dots([x], [y], size, color);
    }
    vline(x, color) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        const px = Math.round(this.xp(x)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, this.ax[1]);
        ctx.lineTo(px, this.ax[3]);
        ctx.stroke();
    }
    hline(y, color) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        const py = Math.round(this.yp(y)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(this.ax[0], py);
        ctx.lineTo(this.ax[2], py);
        ctx.stroke();
    }
    // bar from y = 0 in data coordinates with pixel width
    bar(x, y, wpix, color) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        const px = this.xp(x), py0 = this.yp(0), py1 = this.yp(y);
        ctx.fillRect(px - wpix / 2, Math.min(py0, py1), wpix,
            Math.abs(py0 - py1));
    }
    // text in data coordinates
    text(x, y, str, color, ax, ay, font) {
        this.textPx(this.xp(x), this.yp(y), str, color, ax, ay, font);
    }
    // text in pixel coordinates
    textPx(px, py, str, color, ax, ay, font) {
        const ctx = this.ctx;
        ctx.font = font || this.font || plotFont();
        ctx.fillStyle = color || FG;
        ctx.textAlign = ax || 'center';
        ctx.textBaseline = ay || 'middle';
        ctx.fillText(str, px, py);
    }
    // circle in data coordinates with pixel radius
    circle(x, y, rpx, stroke, fill) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(this.xp(x), this.yp(y), rpx, 0, 2 * Math.PI);
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 0.6;
            ctx.stroke();
        }
    }
    // bar between y0 and y1 in data coordinates with pixel width
    barY(x, y0, y1, wpix, color) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        const px = this.xp(x), py0 = this.yp(y0), py1 = this.yp(y1);
        ctx.fillRect(px - wpix / 2, Math.min(py0, py1), wpix,
            Math.abs(py0 - py1));
    }
    // downward triangle mark in pixel coordinates (hollow: outlined)
    markPx(px, py, size, color, hollow) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(px, py + size / 2);
        ctx.lineTo(px - size / 2, py - size / 2);
        ctx.lineTo(px + size / 2, py - size / 2);
        ctx.closePath();
        if (hollow) {
            ctx.fillStyle = BG;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        else {
            ctx.fillStyle = color;
            ctx.fill();
        }
    }
    // downward triangle mark in data coordinates
    mark(x, y, size, color) {
        const ctx = this.ctx;
        const px = this.xp(x), py = this.yp(y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(px, py + size / 2);
        ctx.lineTo(px - size / 2, py - size / 2);
        ctx.lineTo(px + size / 2, py - size / 2);
        ctx.closePath();
        ctx.fill();
    }
}
