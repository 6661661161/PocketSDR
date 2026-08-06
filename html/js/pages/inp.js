// Pocket SDR Web UI - Input Options page

const FMTS = ['INT8', 'INT8X2', 'RAW8', 'RAW16', 'RAW16I', 'RAW32', 'CS8',
    'CS16'];

export class InpPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label class="ttl">Input Options</label>` +
            `<span class="space"></span>` +
            `<span class="warn-txt" id="in-note"></span>` +
            `<button id="in-apply">Apply</button>` +
            `<button id="in-reload">Reload</button>` +
            `</div>` +
            `<div class="cfg-body">` +
            `<div class="cfg-row"><label>Input Source</label>` +
            `<select id="in-inp">` +
            `<option value="0">RF Frontend (Pocket SDR FE)</option>` +
            `<option value="1">IF Data File</option>` +
            `<option value="2">SoapySDR Device</option></select></div>` +
            `<div class="cfg-row"><label>IF Data File Path</label>` +
            `<input type="text" id="in-file" class="wide"></div>` +
            `<div class="cfg-row"><label>Time Offset / Scale</label>` +
            `<input type="number" id="in-toff" class="num" step="any">` +
            `<input type="number" id="in-tscale" class="num" step="any"></div>` +
            `<div class="cfg-row"><label>IF Data Format</label>` +
            `<select id="in-fmt">` + FMTS.map((f, i) =>
                `<option value="${i+1}">${f}</option>`).join('') +
            `</select></div>` +
            `<div class="cfg-row"><label>Sampling Rate (Msps)</label>` +
            `<input type="number" id="in-fs" class="num" step="any"></div>` +
            `<div class="cfg-row"><label>USB Bus / Port (-1: any)</label>` +
            `<input type="number" id="in-bus" class="num">` +
            `<input type="number" id="in-port" class="num"></div>` +
            `<div class="cfg-row"><label>FE Configuration File</label>` +
            `<input type="text" id="in-conf" class="wide"></div>` +
            `<div class="cfg-row"><label>SoapySDR Driver</label>` +
            `<input type="text" id="in-driver" class="num2"></div>` +
            `<table class="cfg-tbl"><thead><tr><th>RF CH</th>` +
            `<th>LO Freq (MHz)</th><th>Sampling</th><th>Bits</th></tr>` +
            `</thead><tbody>` +
            [...Array(8)].map((_, i) =>
                `<tr><td>CH${i+1}</td>` +
                `<td><input type="number" class="in-fo" step="any"></td>` +
                `<td><select class="in-IQ"><option value="1">I</option>` +
                `<option value="2">IQ</option></select></td>` +
                `<td><select class="in-bits"><option>2</option>` +
                `<option>3</option></select></td></tr>`).join('') +
            `</tbody></table>` +
            `</div>`;
        this.el.querySelector('#in-apply').onclick = () => this.apply();
        this.el.querySelector('#in-reload').onclick = () =>
            this.app.ws.get('cfg');
        app.ws.on('cfg', (msg) => {
            if (this.active) this.populate(msg);
        });
        app.ws.on('hello', () => {
            if (this.active) this.app.ws.get('cfg');
        });
    }
    // update Apply enable state by configuration state -------------------------
    setEditable(ena, run) {
        this.el.querySelector('#in-apply').disabled = !ena || run;
        this.el.querySelector('#in-note').textContent = !ena ?
            'configuration not supported by the server' :
            run ? 'Stop the receiver to edit' : '';
    }
    populate(cfg) {
        this.setEditable(cfg.ena, cfg.run);
        this.el.querySelector('#in-inp').value = cfg.inp;
        this.el.querySelector('#in-file').value = cfg.file;
        this.el.querySelector('#in-toff').value = cfg.toff;
        this.el.querySelector('#in-tscale').value = cfg.tscale;
        this.el.querySelector('#in-fmt').value = cfg.fmt || 2;
        this.el.querySelector('#in-fs').value = cfg.fs;
        this.el.querySelector('#in-bus').value = cfg.bus;
        this.el.querySelector('#in-port').value = cfg.port;
        this.el.querySelector('#in-conf').value = cfg.conf;
        this.el.querySelector('#in-driver').value = cfg.driver;
        const fo = cfg.fo.split(',');
        const IQ = cfg.IQ.split(',');
        const bits = cfg.bits.split(',');
        this.el.querySelectorAll('.in-fo').forEach(
            (e, i) => e.value = parseFloat(fo[i]) || 0);
        this.el.querySelectorAll('.in-IQ').forEach(
            (e, i) => e.value = IQ[i] || '2');
        this.el.querySelectorAll('.in-bits').forEach(
            (e, i) => e.value = bits[i] || '2');
    }
    apply() {
        const val = (id) => this.el.querySelector(id).value;
        const csv = (cls) => [...this.el.querySelectorAll(cls)].map(
            e => e.value || '0').join(',');
        this.app.ws.send({cmd: 'set_inp',
            inp: parseInt(val('#in-inp')),
            file: val('#in-file'),
            toff: parseFloat(val('#in-toff')) || 0,
            tscale: parseFloat(val('#in-tscale')) || 1,
            fmt: parseInt(val('#in-fmt')),
            fs: parseFloat(val('#in-fs')) || 12,
            bus: parseInt(val('#in-bus')),
            port: parseInt(val('#in-port')),
            conf: val('#in-conf'),
            driver: val('#in-driver'),
            fo: csv('.in-fo'), IQ: csv('.in-IQ'), bits: csv('.in-bits')});
        this.app.msg('Input options applied.');
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
