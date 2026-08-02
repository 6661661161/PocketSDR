// Pocket SDR Web UI - Output Options page

const TYPES = ['None', 'NMEA', 'RTCM3', 'LOG', 'IF Data'];

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
        this.el.querySelector('#ot-apply').disabled = !ena || run;
        this.el.querySelector('#ot-note').textContent = !ena ?
            'configuration not supported by the server' :
            run ? 'stop the receiver to edit' : '';
    }
    populate(cfg) {
        this.setEditable(cfg.ena, cfg.run);
        const types = cfg.types.split(',');
        const paths = cfg.paths.split('|');
        this.el.querySelectorAll('.ot-type').forEach(
            (e, i) => e.value = types[i] || '0');
        this.el.querySelectorAll('.ot-path').forEach(
            (e, i) => e.value = paths[i] || '');
    }
    apply() {
        const types = [...this.el.querySelectorAll('.ot-type')].map(
            e => e.value).join(',');
        const paths = [...this.el.querySelectorAll('.ot-path')].map(
            e => e.value).join('|');
        this.app.ws.send({cmd: 'set_out', types: types, paths: paths});
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
