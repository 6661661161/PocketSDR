// Pocket SDR Web UI - Log page

const FILTERS = ['', '$TIME', '$POS', '$ATT', '$OBS', '$NAV', '$SAT', '$CH',
    '$EPH', '$ALM', '$LOG'];
const MAX_LINES = 2000;

export class LogPage {
    constructor(app) {
        this.app = app;
        this.lines = [];
        this.paused = false;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label>Filter</label><select id="lg-sel">` +
            FILTERS.map(f => `<option>${f}</option>`).join('') + `</select>` +
            `<input type="text" id="lg-txt" size="20">` +
            `<span class="space"></span>` +
            `<button id="lg-pause">Pause</button>` +
            `<button id="lg-clear">Clear</button>` +
            `</div>` +
            `<div class="log-body" id="lg-body"><pre id="lg-pre"></pre></div>`;
        this.body = this.el.querySelector('#lg-body');
        this.pre = this.el.querySelector('#lg-pre');
        this.el.querySelector('#lg-sel').onchange = () => this.render();
        this.el.querySelector('#lg-txt').oninput = () => this.render();
        this.el.querySelector('#lg-pause').onclick = () => {
            this.paused = !this.paused;
            this.el.querySelector('#lg-pause').textContent =
                this.paused ? 'Resume' : 'Pause';
            if (!this.paused) this.render();
        };
        this.el.querySelector('#lg-clear').onclick = () => {
            this.lines = [];
            this.render();
        };
        app.ws.on('log', (msg) => {
            if (!this.active) return;
            this.lines.push(...msg.lines);
            if (this.lines.length > MAX_LINES) {
                this.lines.splice(0, this.lines.length - MAX_LINES);
            }
            if (!this.paused) this.render();
        });
    }
    filter() {
        const filt = (this.el.querySelector('#lg-sel').value + ' ' +
            this.el.querySelector('#lg-txt').value).trim();
        if (!filt) return this.lines;
        const terms = filt.split(/\s+/).map(t => t.split('|'));
        return this.lines.filter(
            line => terms.every(alts => alts.some(a => line.includes(a))));
    }
    render() {
        this.pre.textContent = this.filter().join('\n');
        this.body.scrollTop = this.body.scrollHeight;
    }
    show() {
        this.active = true;
        this.lines = [];
        this.render();
        this.app.ws.sub('log', {cyc: 200});
    }
    hide() {
        this.active = false;
        this.app.ws.unsub('log');
    }
}
