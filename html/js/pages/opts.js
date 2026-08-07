// Pocket SDR Web UI - Options page (runtime system options)

const OPTS = [ // [key, label, note]
    ['epoch', 'Epoch Interval for PVT (s)', ''],
    ['lag_epoch', 'Max Epoch Lag for PVT (s)', ''],
    ['el_mask', 'Elevation Mask for PVT (°)', ''],
    ['sp_corr', 'Correlator Spacing (chip)', ''],
    ['t_acq', 'Integration Time for Acquisition (s)', ''],
    ['t_acq_ext', 'Integration Time for Assisted Acq (s)', ''],
    ['t_dll', 'Integration Time for DLL (s)', ''],
    ['t_coh', 'Coherent Integration for Pilot (s)', ''],
    ['b_dll', 'DLL Loop Filter Bandwidth (Hz)', ''],
    ['b_pll', 'PLL Loop Filter Bandwidth (Hz)', ''],
    ['b_fll_w', 'FLL Loop Filter Bandwidth Wide (Hz)', ''],
    ['b_fll_n', 'FLL Loop Filter Bandwidth Narrow (Hz)', ''],
    ['max_dop', 'Max Doppler Freq to Search (Hz)', ''],
    ['thres_cn0_l', 'C/N0 Threshold for Lock (dB-Hz)', ''],
    ['thres_cn0_u', 'C/N0 Threshold for Lost (dB-Hz)', ''],
    ['thres_cn0_ext', 'C/N0 Threshold for Assisted Acq (dB-Hz)', ''],
    ['thres_pli', 'Carrier Lock Threshold (PLI)', ''],
    ['lost_th', 'Lost Decision Count (windows)', ''],
    ['bump_jump', 'Bump Jump for BOC Modulation (0/1)', ''],
    ['max_acq', 'Max Code Length for Direct Acq (ms)', '']
];

const N_PVT = 3; // number of the PVT options at the head of OPTS

// option value table (bare: also wrapped in an option group frame) ------------
function optbl(opts, bare) {
    const tbl = `<table class="optbl"><tbody>` +
        opts.map(([key, label, note]) =>
            `<tr data-key="${key}"><td class="lbl">${label}</td>` +
            `<td><input type="number" step="any" id="op-${key}"></td>` +
            `<td><button>Set</button></td>` +
            `<td class="note">${note ? '(' + note + ')' : ''}</td>` +
            `</tr>`).join('') + `</tbody></table>`;
    return bare ? tbl : `<div class="cfg-frm">${tbl}</div>`;
}

export class OptsPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label class="ttl">System Options</label>` +
            `<span class="space"></span>` +
            `<button id="op-def">Set Default</button>` +
            `<button id="op-apply">Apply</button>` +
            `<button id="op-refresh">Refresh</button>` +
            `</div>` +
            `<div class="op-body">` +
            `<div class="warn-txt cfg-warn" id="op-note"></div>` +
            optbl(OPTS.slice(0, N_PVT)) + // PVT options, as the Tk panels
            `<div class="cfg-frm">` + optbl(OPTS.slice(N_PVT), 1) +
            `<div class="cfg-row"><label>Signal Acquisition Mode</label>` +
            `<select id="op-acq"><option>Full</option><option>Fast</option>` +
            `</select></div></div>` +
            `<div class="cfg-row"><label>FFTW Wisdom Path</label>` +
            `<input type="text" id="op-fftw" class="wide"></div>` +
            `<div class="cfg-row"><label>Receiver Options</label>` +
            `<input type="text" id="op-opt" class="wide"></div>` +
            `<div class="cfg-note">Receiver Options: -ARCH=n -GAIN=dB ` +
            `-BW=MHz (applied at receiver start)</div></div>`;
        for (const row of this.el.querySelectorAll('tr[data-key]')) {
            row.querySelector('button').onclick = () => {
                const val = parseFloat(
                    row.querySelector('input').value);
                if (isNaN(val)) return;
                this.app.ws.send({cmd: 'setopt', name: row.dataset.key,
                    value: val});
                this.app.msg('Option ' + row.dataset.key + ' set to ' + val);
                this.app.ws.get('opts');
            };
        }
        this.el.querySelector('#op-refresh').onclick = () => {
            this.app.ws.get('opts');
        };
        this.el.querySelector('#op-def').onclick = () => {
            this.app.ws.send({cmd: 'opts_default'});
            this.app.msg('System options set to default.');
            this.app.ws.get('opts');
        };
        this.el.querySelector('#op-apply').onclick = () => {
            this.app.ws.send({cmd: 'set_sys',
                fftw: this.el.querySelector('#op-fftw').value,
                opt: this.el.querySelector('#op-opt').value,
                fast_acq: this.el.querySelector('#op-acq').value == 'Fast' ?
                    1 : 0});
            this.app.msg('System options applied.');
            this.app.ws.get('opts');
        };
        app.ws.on('opts', (msg) => this.update(msg));
        for (const ev of ['open', 'hello']) { // follow the run state
            app.ws.on(ev, () => {
                if (this.active) this.app.ws.get('opts');
            });
        }
    }
    update(msg) {
        if (!this.active) return;
        for (const [key] of OPTS) {
            const inp = this.el.querySelector('#op-' + key);
            if (msg[key] !== undefined && document.activeElement != inp) {
                inp.value = msg[key];
            }
        }
        for (const [id, val] of [['#op-fftw', msg.fftw], ['#op-opt', msg.opt]]) {
            const inp = this.el.querySelector(id);
            if (val !== undefined && document.activeElement != inp) {
                inp.value = val;
            }
        }
        if (msg.fast_acq !== undefined) {
            this.el.querySelector('#op-acq').value =
                msg.fast_acq ? 'Fast' : 'Full';
        }
        const dis = !msg.ena || msg.run; // options apply at channel creation
        for (const e of this.el.querySelectorAll('.op-body input, ' +
            '.op-body select, .op-body button, #op-apply, #op-def')) {
            e.disabled = dis;
        }
        this.el.querySelector('#op-note').textContent = !msg.ena ? '' :
            msg.run ? 'Stop the receiver to edit' : '';
    }
    show() {
        this.active = true;
        this.app.ws.get('opts');
    }
    hide() {
        this.active = false;
    }
}
