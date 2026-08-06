// Pocket SDR Web UI - Output Options page

const TYPES = ['None', 'NMEA', 'RTCM3', 'LOG', 'IF Data'];
const LOGS = ['TIME', 'POS', 'ATT', 'OBS', 'NAV', 'SAT', 'CH', 'EPH', 'ALM',
    'LOG'];

export class OutPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label class="ttl">Output Options</label>` +
            `<span class="space"></span>` +
            `<span class="warn-txt" id="ot-note"></span>` +
            `<button id="ot-apply">Apply</button>` +
            `<button id="ot-reload">Reload</button>` +
            `</div>` +
            `<div class="cfg-body">` +
            `<table class="cfg-tbl"><thead><tr><th>Stream</th><th>Type</th>` +
            `<th>Path (file, :port = TCP server, addr:port = TCP client)` +
            `</th></tr></thead><tbody>` +
            [...Array(8)].map((_, i) =>
                `<tr><td>${i+1}</td>` +
                `<td><select class="ot-type">` + TYPES.map((t, j) =>
                    `<option value="${j}">${t}</option>`).join('') +
                `</select></td>` +
                `<td><input type="text" class="ot-path wide"></td>` +
                `</tr>`).join('') +
            `</tbody></table>` +
            `<div class="cfg-note">Keyword replacement in path: %Y = year, ` +
            `%y = year (2 digits), %m = month, %d = day of month, ` +
            `%h = hour, %M = minute, %S = second (UTC)</div>` +
            `<div class="cfg-row"><label>RF CH Separation</label>` +
            `<label class="sig-chk"><input type="checkbox" id="ot-array"> ` +
            `Separate RF CHs as receivers (RTCM3)</label></div>` +
            `<div class="cfg-row"><label>Receiver Log Types</label>` +
            `<span class="sig-grid">` + LOGS.map(t =>
                `<label class="sig-chk"><input type="checkbox" class="ot-log" ` +
                `data-log="${t}"> $${t}</label>`).join('') + `</span></div>` +
            `</div>`;
        this.el.querySelector('#ot-apply').onclick = () => this.apply();
        this.el.querySelector('#ot-reload').onclick = () =>
            this.app.ws.get('cfg');
        app.ws.on('cfg', (msg) => {
            if (this.active) this.populate(msg);
        });
        app.ws.on('hello', () => {
            if (this.active) this.app.ws.get('cfg');
        });
    }
    setEditable(ena, run) {
        const dis = !ena || run;
        this.el.querySelector('#ot-apply').disabled = dis;
        for (const e of this.el.querySelectorAll('.cfg-body input, ' +
            '.cfg-body select')) {
            e.disabled = dis;
        }
        this.el.querySelector('#ot-note').textContent = !ena ?
            'Configuration not supported by the server' :
            run ? 'Stop the receiver to edit' : '';
    }
    populate(cfg) {
        const types = cfg.types.split(',');
        const paths = cfg.paths.split('|');
        const logs = (cfg.log_mask || '').split(',');
        this.el.querySelectorAll('.ot-type').forEach(
            (e, i) => e.value = types[i] || '0');
        this.el.querySelectorAll('.ot-path').forEach(
            (e, i) => e.value = paths[i] || '');
        this.el.querySelectorAll('.ot-log').forEach(
            (e, i) => e.checked = logs[i] != '0');
        // RF CH separation is the -ARRAY token of the receiver options
        this.opt = cfg.opt;
        this.el.querySelector('#ot-array').checked =
            /(^|\s)-ARRAY(\s|$)/.test(cfg.opt);
        this.setEditable(cfg.ena, cfg.run);
    }
    apply() {
        const types = [...this.el.querySelectorAll('.ot-type')].map(
            e => e.value).join(',');
        const paths = [...this.el.querySelectorAll('.ot-path')].map(
            e => e.value).join('|');
        const logs = [...this.el.querySelectorAll('.ot-log')].map(
            e => e.checked ? 1 : 0).join(',');
        this.app.ws.send({cmd: 'set_out', types: types, paths: paths,
            log_mask: logs});
        let opt = (this.opt || '').replace(/(^|\s)-ARRAY(?=\s|$)/g, '').trim();
        if (this.el.querySelector('#ot-array').checked) {
            opt = (opt + ' -ARRAY').trim();
        }
        this.app.ws.send({cmd: 'set_sys', opt: opt});
        this.app.msg('Output options applied.');
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
