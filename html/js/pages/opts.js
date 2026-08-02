// Pocket SDR Web UI - Options page (runtime system options)

const OPTS = [ // [key, label, note]
    ['epoch', 'Epoch Interval for PVT (s)', ''],
    ['lag_epoch', 'Max Epoch Lag for PVT (s)', ''],
    ['el_mask', 'Elevation Mask for PVT (°)', ''],
    ['sp_corr', 'Correlator Spacing (chip)', 'restart required'],
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
    ['bump_jump', 'Bump Jump for BOC Modulation (0/1)', 'restart required'],
    ['max_acq', 'Max Code Length for Direct Acq (ms)', '']
];

export class OptsPage {
    constructor(app) {
        this.app = app;
        this.el = document.createElement('div');
        this.el.innerHTML =
            `<div class="toolbar">` +
            `<label class="ttl">System Options</label>` +
            `<label>(applied to the running receiver; changes are not ` +
            `persistent)</label>` +
            `<span class="space"></span>` +
            `<button id="op-refresh">Refresh</button>` +
            `</div>` +
            `<div class="op-body"><table class="optbl"><tbody>` +
            OPTS.map(([key, label, note]) =>
                `<tr data-key="${key}"><td class="lbl">${label}</td>` +
                `<td><input type="number" step="any" id="op-${key}"></td>` +
                `<td><button>Set</button></td>` +
                `<td class="note">${note ? '(' + note + ')' : ''}</td>` +
                `</tr>`).join('') +
            `</tbody></table></div>`;
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
        app.ws.on('opts', (msg) => this.update(msg));
        app.ws.on('open', () => {
            if (this.active) this.app.ws.get('opts');
        });
    }
    update(msg) {
        if (!this.active) return;
        for (const [key] of OPTS) {
            const inp = this.el.querySelector('#op-' + key);
            if (msg[key] !== undefined && document.activeElement != inp) {
                inp.value = msg[key];
            }
        }
    }
    show() {
        this.active = true;
        this.app.ws.get('opts');
    }
    hide() {
        this.active = false;
    }
}
