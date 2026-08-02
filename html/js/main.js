// Pocket SDR Web UI - application shell

import {WsClient} from './ws.js';
import {RcvPage} from './pages/rcv.js';
import {RfchPage} from './pages/rfch.js';
import {BbchPage} from './pages/bbch.js';
import {CorrPage} from './pages/corr.js';
import {SatsPage} from './pages/sats.js';
import {SolPage} from './pages/sol.js';
import {ArrayPage} from './pages/array.js';
import {OptsPage} from './pages/opts.js';
import {LogPage} from './pages/log.js';

const ws = new WsClient();

// shared application state ----------------------------------------------------
const app = {
    ws: ws,
    info: {nrfch: 1, narch: 0, nch: 0, fs: 0, name: 'Pocket SDR', ver: ''},
    msg: (s) => { document.getElementById('msg1').textContent = s; },
    selectCorrCh: (ch) => {} // set after pages are built
};

// pages -----------------------------------------------------------------------
const pages = [
    {name: 'Receiver', page: new RcvPage(app)},
    {name: 'RF CH', page: new RfchPage(app)},
    {name: 'BB CH', page: new BbchPage(app)},
    {name: 'Correlator', page: new CorrPage(app)},
    {name: 'Satellites', page: new SatsPage(app)},
    {name: 'Solution', page: new SolPage(app)},
    {name: 'Array', page: new ArrayPage(app)},
    {name: 'Options', page: new OptsPage(app)},
    {name: 'Log', page: new LogPage(app)}
];
let cur = -1;

app.selectCorrCh = (ch) => {
    pages[3].page.setCh(ch);
};

// switch page -----------------------------------------------------------------
function selPage(i) {
    if (i == cur) return;
    const tabs = document.querySelectorAll('#tabbar .tab');
    if (cur >= 0) {
        pages[cur].page.hide();
        pages[cur].page.el.classList.remove('active');
        tabs[cur].classList.remove('active');
    }
    cur = i;
    pages[cur].page.el.classList.add('active');
    tabs[cur].classList.add('active');
    pages[cur].page.show();
}

// build tab bar and pages -----------------------------------------------------
const tabbar = document.getElementById('tabbar');
const pagesEl = document.getElementById('pages');
pages.forEach((p, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.textContent = p.name;
    tab.onclick = () => selPage(i);
    tabbar.appendChild(tab);
    p.page.el.classList.add('page');
    pagesEl.appendChild(p.page.el);
});

// WebSocket handlers ----------------------------------------------------------
ws.on('open', () => {
    const conn = document.getElementById('conn');
    conn.textContent = 'CONNECTED';
    conn.className = 'conn-on';
    app.msg('Connected to receiver.');
});
ws.on('close', () => {
    const conn = document.getElementById('conn');
    conn.textContent = 'OFFLINE';
    conn.className = 'conn-off';
    app.msg('Connection lost. Reconnecting...');
});
ws.on('hello', (msg) => {
    Object.assign(app.info, msg);
    document.getElementById('title').textContent =
        msg.name + ' ver.' + msg.ver + ' - pocket_trk Web UI';
});
ws.on('rcv_stat', (msg) => {
    const f = msg.str.split(/\s+/);
    document.getElementById('msg2').textContent = 'Time: ' + f[0] + ' s';
});
ws.on('ack', (msg) => {
    if (!msg.ok) app.msg('Command error: ' + msg.cmd +
        (msg.msg ? ' (' + msg.msg + ')' : ''));
});
ws.on('error', (msg) => {
    app.msg('Error: ' + msg.msg);
});

// global subscriptions and start ----------------------------------------------
ws.on('open', () => {
    ws.sub('rcv_stat', {cyc: 200});
});
ws.connect();
const hash = ['receiver', 'rfch', 'bbch', 'corr', 'sats', 'sol', 'array',
    'opts', 'log'].indexOf(location.hash.slice(1));
selPage(hash < 0 ? 0 : hash);
