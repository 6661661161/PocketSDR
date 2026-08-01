//
//  Pocket SDR C Library - Web UI Server Functions.
//
//  Author:
//  T.TAKASU
//
//  History:
//  2026-08-01  0.1  new
//
//  Design: doc/design_web_ui.md. The server hosts static Web UI files over
//  HTTP and exchanges commands and monitor data with browsers over WebSocket
//  (RFC 6455 subset). Binary frames are little-endian (LE hosts assumed).
//
#include <ctype.h>
#include <stdarg.h>
#include "pocket_sdr.h"
#ifdef WIN32
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#endif
#ifdef MACOS
#include <mach-o/dyld.h>
#endif

// constants and macros --------------------------------------------------------
#define MAX_WEB_CLI    8        // max number of HTTP/WebSocket clients
#define WEB_CYC        10       // server loop cycle (ms)
#define MIN_CYC        50       // min topic update cycle (ms)
#define DEF_CYC_TEXT   200      // default cycle of text topics (ms)
#define DEF_CYC_BIN    100      // default cycle of binary topics (ms)
#define LOG_POLL_CYC   200      // receiver log polling cycle (ms)
#define PING_CYC       10000    // WebSocket ping cycle (ms)
#define DROP_TIMEOUT   30000    // client drop timeout (ms)
#define MAX_REQ        4096     // max HTTP request and WS command size (bytes)
#define IN_BUFF_SIZE   8192     // client input buffer size (bytes)
#define OUT_BUFF_SIZE  (1<<18)  // client output buffer size (bytes)
#define OUT_BUFF_SKIP  (1<<15)  // skip topic push if pending exceeds (bytes)
#define STAT_BUFF_SIZE (128*SDR_MAX_NCH) // channel status buffer size (bytes)
#define JSON_BUFF_SIZE (STAT_BUFF_SIZE*2+1024) // JSON buffer size (bytes)
#define BIN_BUFF_SIZE  (1<<16)  // binary frame buffer size (bytes)
#define LOG_BUFF_SIZE  (2<<18)  // receiver log read buffer size (bytes)
#define MAX_NFFT       4096     // max PSD FFT points
#define MAX_LOG_LINES  2000     // receiver log ring size (lines)
#define MAX_LOG_SEND   200      // max log lines per push
#define WEB_PROTO      1        // wire protocol version
#define DEF_SEL_WIDTH  3e-6     // default correlator width (s)
#define WS_GUID        "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

#define FRM_PSD        1        // binary frame type: PSD
#define FRM_CORR       2        // binary frame type: correlator snapshot
#define FRM_CORR_HIST  3        // binary frame type: correlator history

#define TOPIC_RCV_STAT  1       // topic: receiver status
#define TOPIC_CH_STAT   2       // topic: BB channel status
#define TOPIC_SAT_STAT  3       // topic: satellite status
#define TOPIC_PVT_SOL   4       // topic: PVT solution
#define TOPIC_RFCH_STAT 5       // topic: RF channel status
#define TOPIC_HIST      6       // topic: IF data histogram
#define TOPIC_LOG       7       // topic: receiver log
#define TOPIC_PSD       8       // topic: PSD (binary)
#define TOPIC_CORR      9       // topic: correlator snapshot (binary)
#define TOPIC_CORR_HIST 10      // topic: correlator history (binary)
#define N_TOPIC         10      // number of topics

#define MIN(x, y)      ((x) < (y) ? (x) : (y))
#define CLIP(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))

#ifdef WIN32
typedef SOCKET sock_t;          // socket type
#define sock_err()     WSAGetLastError()
#define SOCK_BLOCK(e)  ((e) == WSAEWOULDBLOCK)
#define SEND_FLAGS     0
#else
typedef int sock_t;
#define INVALID_SOCKET (-1)
#define closesocket(s) close(s)
#define sock_err()     errno
#define SOCK_BLOCK(e)  ((e) == EWOULDBLOCK || (e) == EAGAIN || (e) == EINTR)
#ifdef MACOS
#define SEND_FLAGS     0
#else
#define SEND_FLAGS     MSG_NOSIGNAL
#endif
#endif // WIN32

// type definitions ------------------------------------------------------------
typedef struct {                // topic subscription type
    int ena;                    // enable flag
    int cyc;                    // update cycle (ms)
    uint32_t next;              // next update tick (ms)
    int ch, rfch;               // BB and RF channel numbers (1-origin)
    int chno, opt, nfft;        // ch_stat channel/option and PSD FFT points
    double tave, tspan, width, min_lock; // topic parameters
    int log_pos;                // log lines sent (absolute count)
    char sys[16];               // ch_stat system selection
    char sats[256];             // sat_stat satellite list
} web_sub_t;

typedef struct {                // Web UI client type
    sock_t sock;                // client socket
    int state;                  // state (0:free, 1:HTTP, 2:WebSocket)
    int close_req;              // close after flush flag
    int nin, nout, nmsg;        // buffer data sizes (bytes)
    int msg_op;                 // WS message initial opcode
    uint32_t alive, ping;       // last receive and ping ticks (ms)
    uint8_t inb[IN_BUFF_SIZE+1]; // input buffer
    uint8_t msg[MAX_REQ+1];     // WS message assembly buffer
    uint8_t *outb;              // output buffer
    web_sub_t subs[N_TOPIC+1];  // topic subscriptions
} web_cli_t;

struct sdr_web_tag {            // Web UI server type
    int state;                  // state (0:stop, 1:run)
    sdr_rcv_t *rcv;             // SDR receiver
    sock_t ssock;               // listen socket
    char html_dir[1024];        // Web UI document root
    web_cli_t cli[MAX_WEB_CLI]; // clients
    int sel_ch;                 // correlator selected channel (0:none)
    double sel_width;           // correlator width (s)
    char *log_lines[MAX_LOG_LINES]; // receiver log ring
    int log_cnt;                // total log lines added
    uint32_t log_tick;          // last log polling tick (ms)
    char *log_buff;             // receiver log read buffer
    char *stat_buff;            // channel status buffer
    char *json_buff;            // JSON encode buffer
    uint8_t *bin_buff;          // binary frame buffer
    float *psd;                 // PSD buffer
    sdr_cpx_t *hist_P;          // correlator history buffer
    sdr_thread_t thread;        // server thread
};

// compare strings ignoring case -----------------------------------------------
static int str_ncmp_i(const char *a, const char *b, int n)
{
    for (int i = 0; i < n; i++) {
        int c1 = tolower((unsigned char)a[i]), c2 = tolower((unsigned char)b[i]);
        if (c1 != c2) return c1 - c2;
        if (!c1) break;
    }
    return 0;
}

// SHA-1 hash (RFC 3174) -------------------------------------------------------
static void sha1(const uint8_t *data, int len, uint8_t *hash)
{
    uint32_t h[5] = {
        0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0
    };
    int total = ((len + 8) / 64 + 1) * 64;
    uint8_t *buff = (uint8_t *)sdr_malloc(total);

    memcpy(buff, data, len);
    buff[len] = 0x80;
    for (int i = 0; i < 8; i++) {
        buff[total-1-i] = (uint8_t)((uint64_t)len * 8 >> (i * 8));
    }
    for (int i = 0; i < total; i += 64) {
        uint32_t w[80], a, b, c, d, e;
        for (int j = 0; j < 16; j++) {
            w[j] = ((uint32_t)buff[i+j*4] << 24) | ((uint32_t)buff[i+j*4+1] << 16) |
                ((uint32_t)buff[i+j*4+2] << 8) | buff[i+j*4+3];
        }
        for (int j = 16; j < 80; j++) {
            uint32_t x = w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16];
            w[j] = (x << 1) | (x >> 31);
        }
        a = h[0]; b = h[1]; c = h[2]; d = h[3]; e = h[4];
        for (int j = 0; j < 80; j++) {
            uint32_t f, k;
            if      (j < 20) { f = (b & c) | (~b & d);          k = 0x5A827999; }
            else if (j < 40) { f = b ^ c ^ d;                   k = 0x6ED9EBA1; }
            else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
            else             { f = b ^ c ^ d;                   k = 0xCA62C1D6; }
            uint32_t t = ((a << 5) | (a >> 27)) + f + e + k + w[j];
            e = d; d = c; c = (b << 30) | (b >> 2); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    for (int i = 0; i < 5; i++) {
        hash[i*4  ] = (uint8_t)(h[i] >> 24);
        hash[i*4+1] = (uint8_t)(h[i] >> 16);
        hash[i*4+2] = (uint8_t)(h[i] >>  8);
        hash[i*4+3] = (uint8_t)(h[i]);
    }
    sdr_free(buff);
}

// Base64 encoding -------------------------------------------------------------
static void base64(const uint8_t *data, int len, char *str)
{
    static const char *tbl =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int i, j;

    for (i = j = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)data[i] << 16;
        if (i + 1 < len) v |= (uint32_t)data[i+1] << 8;
        if (i + 2 < len) v |= data[i+2];
        str[j++] = tbl[(v >> 18) & 0x3F];
        str[j++] = tbl[(v >> 12) & 0x3F];
        str[j++] = i + 1 < len ? tbl[(v >> 6) & 0x3F] : '=';
        str[j++] = i + 2 < len ? tbl[v & 0x3F] : '=';
    }
    str[j] = '\0';
}

// get JSON value position in flat object --------------------------------------
static const char *jsn_val(const char *msg, const char *key)
{
    char pat[64];

    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(msg, pat);
    if (!p) return NULL;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t') p++;
    if (*p++ != ':') return NULL;
    while (*p == ' ' || *p == '\t') p++;
    return p;
}

// get JSON string value -------------------------------------------------------
static int jsn_str(const char *msg, const char *key, char *val, int size)
{
    const char *p = jsn_val(msg, key);
    int i = 0;

    if (!p || *p++ != '"') return 0;
    while (*p && *p != '"' && i < size - 1) {
        if (*p == '\\' && p[1]) p++;
        val[i++] = *p++;
    }
    val[i] = '\0';
    return 1;
}

// get JSON number value -------------------------------------------------------
static int jsn_num(const char *msg, const char *key, double *val)
{
    const char *p = jsn_val(msg, key);
    char *end;

    if (!p) return 0;
    double v = strtod(p, &end);
    if (end == p) return 0;
    *val = v;
    return 1;
}

// escape string for JSON ------------------------------------------------------
static int jsn_esc(char *buff, int size, const char *str)
{
    int n = 0;

    for (const char *p = str; *p && n < size - 8; p++) {
        if (*p == '"' || *p == '\\') {
            buff[n++] = '\\';
            buff[n++] = *p;
        } else if (*p == '\n') {
            buff[n++] = '\\';
            buff[n++] = 'n';
        } else if (*p == '\r') {
            buff[n++] = '\\';
            buff[n++] = 'r';
        } else if ((uint8_t)*p < 0x20) {
            n += snprintf(buff + n, size - n, "\\u%04x", *p);
        } else {
            buff[n++] = *p;
        }
    }
    buff[n] = '\0';
    return n;
}

// write little-endian values to binary buffer ---------------------------------
static uint8_t *bin_u16(uint8_t *p, uint16_t v)
{
    memcpy(p, &v, 2);
    return p + 2;
}

static uint8_t *bin_u32(uint8_t *p, uint32_t v)
{
    memcpy(p, &v, 4);
    return p + 4;
}

static uint8_t *bin_f32(uint8_t *p, float v)
{
    memcpy(p, &v, 4);
    return p + 4;
}

static uint8_t *bin_f64(uint8_t *p, double v)
{
    memcpy(p, &v, 8);
    return p + 8;
}

// set socket non-blocking mode ------------------------------------------------
static void sock_nonblock(sock_t sock)
{
#ifdef WIN32
    u_long mode = 1;
    ioctlsocket(sock, FIONBIO, &mode);
#else
    fcntl(sock, F_SETFL, fcntl(sock, F_GETFL, 0) | O_NONBLOCK);
#endif
}

// append data to client output buffer -----------------------------------------
static int cli_out(web_cli_t *cli, const void *data, int n)
{
    if (n <= 0) return 1;
    if (cli->nout + n > OUT_BUFF_SIZE) return 0;
    memcpy(cli->outb + cli->nout, data, n);
    cli->nout += n;
    return 1;
}

// flush client output buffer --------------------------------------------------
static void cli_flush(web_cli_t *cli)
{
    while (cli->nout > 0) {
        int n = send(cli->sock, (char *)cli->outb, cli->nout, SEND_FLAGS);
        if (n <= 0) {
            if (n < 0 && SOCK_BLOCK(sock_err())) return;
            cli->nout = 0;
            cli->close_req = 1;
            return;
        }
        memmove(cli->outb, cli->outb + n, cli->nout - n);
        cli->nout -= n;
    }
}

// send WebSocket frame --------------------------------------------------------
static int ws_send(web_cli_t *cli, int opcode, const void *payload, int n)
{
    uint8_t head[10];
    int m = 0;

    head[m++] = (uint8_t)(0x80 | opcode);
    if (n < 126) {
        head[m++] = (uint8_t)n;
    } else if (n < 65536) {
        head[m++] = 126;
        head[m++] = (uint8_t)(n >> 8);
        head[m++] = (uint8_t)n;
    } else {
        head[m++] = 127;
        for (int i = 7; i >= 0; i--) {
            head[m++] = (uint8_t)((int64_t)n >> (i * 8));
        }
    }
    if (cli->nout + m + n > OUT_BUFF_SIZE) return 0;
    cli_out(cli, head, m);
    cli_out(cli, payload, n);
    return 1;
}

// send WebSocket text frame ---------------------------------------------------
static int ws_send_text(web_cli_t *cli, const char *str)
{
    return ws_send(cli, 0x1, str, (int)strlen(str));
}

// send HTTP error response ----------------------------------------------------
static void http_err(web_cli_t *cli, int code, const char *msg)
{
    char buff[256];

    int n = snprintf(buff, sizeof(buff), "HTTP/1.1 %d %s\r\n"
        "Content-Length: 0\r\nConnection: close\r\n\r\n", code, msg);
    cli_out(cli, buff, n);
    cli->close_req = 1;
}

// content type by file extension ----------------------------------------------
static const char *mime_type(const char *path)
{
    static const char *exts[] = {
        ".html", ".css", ".js", ".mjs", ".json", ".png", ".svg", ".ico",
        ".woff2", NULL
    };
    static const char *types[] = {
        "text/html", "text/css", "text/javascript", "text/javascript",
        "application/json", "image/png", "image/svg+xml", "image/x-icon",
        "font/woff2"
    };
    const char *ext = strrchr(path, '.');

    for (int i = 0; ext && exts[i]; i++) {
        if (!strcmp(ext, exts[i])) return types[i];
    }
    return "application/octet-stream";
}

// serve static file -----------------------------------------------------------
static void serve_file(sdr_web_t *web, web_cli_t *cli, const char *path)
{
    char full[1280], head[256];

    if (strstr(path, "..")) {
        http_err(cli, 403, "Forbidden");
        return;
    }
    snprintf(full, sizeof(full), "%s%s%s", web->html_dir, path,
        !strcmp(path, "/") ? "index.html" : "");
    FILE *fp = fopen(full, "rb");
    if (!fp) {
        http_err(cli, 404, "Not Found");
        return;
    }
    fseek(fp, 0, SEEK_END);
    long size = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (size < 0 || cli->nout + size + 256 > OUT_BUFF_SIZE) {
        fclose(fp);
        http_err(cli, 500, "Internal Server Error");
        return;
    }
    int mark = cli->nout;
    int n = snprintf(head, sizeof(head), "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\nContent-Length: %ld\r\nConnection: close\r\n\r\n",
        mime_type(full), size);
    cli_out(cli, head, n);
    if (fread(cli->outb + cli->nout, 1, size, fp) == (size_t)size) {
        cli->nout += (int)size;
        cli->close_req = 1;
    } else {
        cli->nout = mark;
        http_err(cli, 500, "Internal Server Error");
    }
    fclose(fp);
}

// send hello message ----------------------------------------------------------
static void send_hello(sdr_web_t *web, web_cli_t *cli)
{
    char buff[256];
    sdr_rcv_t *rcv = web->rcv;

    snprintf(buff, sizeof(buff), "{\"type\":\"hello\",\"name\":\"%s\","
        "\"ver\":\"%s\",\"proto\":%d,\"nrfch\":%d,\"narch\":%d,\"nch\":%d,"
        "\"fs\":%.0f,\"sel_ch\":%d}", sdr_get_name(), sdr_get_ver(), WEB_PROTO,
        rcv->nrfch, rcv->narch, rcv->nch, rcv->fs, web->sel_ch);
    ws_send_text(cli, buff);
}

// handle WebSocket upgrade ----------------------------------------------------
static void ws_upgrade(sdr_web_t *web, web_cli_t *cli, const char *key)
{
    uint8_t hash[20];
    char cat[128], accept[64], head[256];

    snprintf(cat, sizeof(cat), "%s%s", key, WS_GUID);
    sha1((const uint8_t *)cat, (int)strlen(cat), hash);
    base64(hash, 20, accept);
    int n = snprintf(head, sizeof(head), "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n\r\n", accept);
    cli_out(cli, head, n);
    cli->state = 2;
    send_hello(web, cli);
}

// process HTTP request --------------------------------------------------------
static void http_req(sdr_web_t *web, web_cli_t *cli)
{
    char method[16] = "", path[1024] = "", key[64] = "";
    int upgrade = 0;

    cli->inb[cli->nin] = '\0';
    char *req = (char *)cli->inb;
    char *end = strstr(req, "\r\n\r\n");
    if (!end) {
        if (cli->nin >= MAX_REQ) http_err(cli, 413, "Payload Too Large");
        return;
    }
    *end = '\0';
    int req_len = (int)(end - req) + 4;

    if (sscanf(req, "%15s %1023s", method, path) < 2) {
        http_err(cli, 400, "Bad Request");
        return;
    }
    char *q = strchr(path, '?');
    if (q) *q = '\0';
    char *p = strstr(req, "\r\n");
    if (p) p += 2;
    while (p) {
        char *e = strstr(p, "\r\n");
        if (e) *e = '\0';
        if (!str_ncmp_i(p, "Upgrade:", 8)) {
            char *v = p + 8;
            while (*v == ' ') v++;
            if (!str_ncmp_i(v, "websocket", 9)) upgrade = 1;
        } else if (!str_ncmp_i(p, "Sec-WebSocket-Key:", 18)) {
            char *v = p + 18;
            while (*v == ' ') v++;
            snprintf(key, sizeof(key), "%s", v);
        }
        p = e ? e + 2 : NULL;
    }
    memmove(cli->inb, cli->inb + req_len, cli->nin - req_len);
    cli->nin -= req_len;

    if (strcmp(method, "GET")) {
        http_err(cli, 405, "Method Not Allowed");
    } else if (!strcmp(path, "/ws")) {
        if (upgrade && *key) ws_upgrade(web, cli, key);
        else http_err(cli, 400, "Bad Request");
    } else {
        serve_file(web, cli, path);
    }
}

// send receiver status topic --------------------------------------------------
static void send_rcv_stat(sdr_web_t *web, web_cli_t *cli)
{
    char stat[2048] = "", esc[4096], buff[4608];
    int strs[SDR_MAX_STR];

    sdr_rcv_rcv_stat(web->rcv, stat, sizeof(stat));
    sdr_rcv_str_stat(web->rcv, strs);
    jsn_esc(esc, sizeof(esc), stat);
    snprintf(buff, sizeof(buff), "{\"type\":\"rcv_stat\",\"str\":\"%s\","
        "\"strs\":[%d,%d,%d,%d,%d,%d,%d,%d]}", esc, strs[0], strs[1], strs[2],
        strs[3], strs[4], strs[5], strs[6], strs[7]);
    ws_send_text(cli, buff);
}

// send BB channel status topic ------------------------------------------------
static void send_ch_stat(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    sdr_rcv_ch_stat(web->rcv, sub->sys, sub->chno, sub->min_lock, sub->rfch,
        sub->opt, web->stat_buff, STAT_BUFF_SIZE);
    int n = snprintf(web->json_buff, JSON_BUFF_SIZE,
        "{\"type\":\"ch_stat\",\"str\":\"");
    n += jsn_esc(web->json_buff + n, JSON_BUFF_SIZE - n - 4, web->stat_buff);
    snprintf(web->json_buff + n, JSON_BUFF_SIZE - n, "\"}");
    ws_send_text(cli, web->json_buff);
}

// send satellite status topic -------------------------------------------------
static void send_sat_stat(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    char *buff = web->json_buff;
    const char *p = sub->sats;
    int n, cnt = 0;

    n = snprintf(buff, JSON_BUFF_SIZE, "{\"type\":\"sat_stat\",\"sats\":[");
    while (*p && n < JSON_BUFF_SIZE - 256) {
        char sat[16], stat[1024], id[16];
        double az, el;
        int len = 0, pvt, obs, eph, svh, fcn;
        while (*p && *p != ',') {
            if (len < 15) sat[len++] = *p;
            p++;
        }
        sat[len] = '\0';
        if (*p == ',') p++;
        if (!len || !sdr_rcv_sat_stat(web->rcv, sat, stat, sizeof(stat))) {
            continue;
        }
        if (sscanf(stat, "%15s %lf %lf %d %d %d %d %d", id, &az, &el, &pvt,
            &obs, &eph, &svh, &fcn) < 8) continue;
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s{\"sat\":\"%s\","
            "\"az\":%.1f,\"el\":%.1f,\"pvt\":%d,\"obs\":%d,\"eph\":%d,"
            "\"svh\":%d,\"fcn\":%d}", cnt++ ? "," : "", id, az, el, pvt, obs,
            eph, svh, fcn);
    }
    snprintf(buff + n, JSON_BUFF_SIZE - n, "]}");
    ws_send_text(cli, buff);
}

// send PVT solution topic -----------------------------------------------------
static void send_pvt_sol(sdr_web_t *web, web_cli_t *cli)
{
    char stat[128] = "", esc[256], buff[320];

    sdr_rcv_pvt_sol(web->rcv, stat, sizeof(stat));
    jsn_esc(esc, sizeof(esc), stat);
    snprintf(buff, sizeof(buff), "{\"type\":\"pvt_sol\",\"str\":\"%s\"}", esc);
    ws_send_text(cli, buff);
}

// send RF channel status topic ------------------------------------------------
static void send_rfch_stat(sdr_web_t *web, web_cli_t *cli)
{
    char *buff = web->json_buff;
    double stat[8];
    int n, cnt = 0;

    n = snprintf(buff, JSON_BUFF_SIZE, "{\"type\":\"rfch_stat\",\"chs\":[");
    for (int ch = 1; ch <= SDR_MAX_BUFF && n < JSON_BUFF_SIZE - 256; ch++) {
        if (!sdr_rcv_rfch_stat(web->rcv, ch, stat)) break;
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s{\"ch\":%d,\"dev\":%d,"
            "\"fmt\":%d,\"fs\":%.0f,\"fo\":%.0f,\"IQ\":%d,\"bits\":%d,"
            "\"std\":%.2f,\"rtoc\":%d}", cnt++ ? "," : "", ch, (int)stat[0],
            (int)stat[1], stat[2], stat[3], (int)stat[4], (int)stat[5],
            stat[6], (int)stat[7]);
    }
    snprintf(buff + n, JSON_BUFF_SIZE - n, "]}");
    ws_send_text(cli, buff);
}

// send IF data histogram topic (rfch = 0: all RF CHs) -------------------------
static void send_hist(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    char *buff = web->json_buff;
    int ch1 = sub->rfch ? sub->rfch : 1;
    int ch2 = sub->rfch ? sub->rfch : SDR_MAX_BUFF;

    for (int ch = ch1; ch <= ch2; ch++) {
        double stat[8], hist1[256], hist2[256] = {0};
        int val[256], n;
        if (!sdr_rcv_rfch_stat(web->rcv, ch, stat)) break;
        int IQ = (int)stat[4];
        int nval = sdr_rcv_rfch_hist(web->rcv, ch, sub->tave, val, hist1,
            hist2);
        if (nval <= 0) continue;
        n = snprintf(buff, JSON_BUFF_SIZE, "{\"type\":\"hist\",\"rfch\":%d,"
            "\"IQ\":%d,\"val\":[", ch, IQ);
        for (int i = 0; i < nval; i++) {
            n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s%d", i ? "," : "",
                val[i]);
        }
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "],\"hist1\":[");
        for (int i = 0; i < nval; i++) {
            n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s%.5g", i ? "," : "",
                hist1[i]);
        }
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "],\"hist2\":[");
        for (int i = 0; IQ == 2 && i < nval; i++) {
            n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s%.5g", i ? "," : "",
                hist2[i]);
        }
        snprintf(buff + n, JSON_BUFF_SIZE - n, "]}");
        ws_send_text(cli, buff);
    }
}

// send receiver log topic -----------------------------------------------------
static void send_log(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    char *buff = web->json_buff;
    int start = sub->log_pos, end = web->log_cnt, cnt = 0;

    if (start < end - MAX_LOG_LINES) start = end - MAX_LOG_LINES;
    if (end > start + MAX_LOG_SEND) end = start + MAX_LOG_SEND;
    if (start >= end) return;
    int n = snprintf(buff, JSON_BUFF_SIZE, "{\"type\":\"log\",\"lines\":[");
    for (int i = start; i < end; i++) {
        const char *line = web->log_lines[i % MAX_LOG_LINES];
        if (!line) continue;
        if (n > JSON_BUFF_SIZE - 4096) {
            end = i;
            break;
        }
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "%s\"", cnt++ ? "," : "");
        n += jsn_esc(buff + n, JSON_BUFF_SIZE - n - 8, line);
        n += snprintf(buff + n, JSON_BUFF_SIZE - n, "\"");
    }
    snprintf(buff + n, JSON_BUFF_SIZE - n, "]}");
    if (ws_send_text(cli, buff)) sub->log_pos = end;
}

// poll receiver log into ring buffer ------------------------------------------
static void poll_log(sdr_web_t *web)
{
    if (sdr_get_log(web->log_buff, LOG_BUFF_SIZE) <= 0) return;
    char *p = web->log_buff, *q;
    while ((q = strchr(p, '\n'))) {
        *q = '\0';
        int i = web->log_cnt % MAX_LOG_LINES;
        int len = (int)strlen(p);
        sdr_free(web->log_lines[i]);
        web->log_lines[i] = (char *)sdr_malloc(len + 1);
        memcpy(web->log_lines[i], p, len + 1);
        web->log_cnt++;
        p = q + 1;
    }
}

// send PSD binary frames (rfch = 0: all RF CHs) -------------------------------
static void send_psd(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    double stat[8];
    int ch1 = sub->rfch ? sub->rfch : 1;
    int ch2 = sub->rfch ? sub->rfch : SDR_MAX_BUFF;

    for (int ch = ch1; ch <= ch2; ch++) {
        if (!sdr_rcv_rfch_stat(web->rcv, ch, stat)) break;
        int n = sdr_rcv_rfch_psd(web->rcv, ch, sub->tave, sub->nfft,
            web->psd);
        if (n <= 0) continue;
        uint8_t *p = web->bin_buff;
        *p++ = FRM_PSD;
        *p++ = (uint8_t)ch;
        *p++ = (uint8_t)stat[4];
        *p++ = (uint8_t)stat[5];
        p = bin_f32(p, (float)stat[2]);
        p = bin_f32(p, (float)sub->tave);
        p = bin_u32(p, (uint32_t)n);
        p = bin_f64(p, stat[3]);
        memcpy(p, web->psd, sizeof(float) * n);
        ws_send(cli, 0x2, web->bin_buff, 24 + n * 4);
    }
}

// send correlator snapshot binary frame ---------------------------------------
static void send_corr(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    double stat[8], stat2[2] = {0}, pos[SDR_MAX_CORR], P[SDR_MAX_CORR];
    double I[SDR_MAX_CORR];
    sdr_cpx_t C[SDR_MAX_CORR];

    int n = sdr_rcv_corr_stat(web->rcv, sub->ch, stat, pos, C, P, I);
    if (n <= 0) return;
    sdr_rcv_corr_hist(web->rcv, sub->ch, 0.0, stat2, web->hist_P); // ch time
    uint8_t *p = web->bin_buff;
    *p++ = FRM_CORR;
    *p++ = (uint8_t)stat[0];
    p = bin_u16(p, (uint16_t)sub->ch);
    p = bin_u32(p, (uint32_t)n);
    p = bin_u32(p, (uint32_t)stat[6]);
    p = bin_f32(p, (float)stat[1]);
    p = bin_f32(p, (float)stat[2]);
    p = bin_f32(p, (float)stat[3]);
    p = bin_f32(p, (float)stat[5]);
    p = bin_f32(p, (float)stat2[0]);
    p = bin_f64(p, stat[4]);
    for (int i = 0; i < n; i++) {
        p = bin_f32(p, (float)pos[i]);
    }
    for (int i = 0; i < n; i++) {
        p = bin_f32(p, C[i][0]);
        p = bin_f32(p, C[i][1]);
    }
    for (int i = 0; i < n; i++) {
        p = bin_f32(p, (float)P[i]);
    }
    for (int i = 0; i < n; i++) {
        p = bin_f32(p, (float)I[i]);
    }
    ws_send(cli, 0x2, web->bin_buff, 40 + n * 20);
}

// send correlator history binary frame ----------------------------------------
static void send_corr_hist(sdr_web_t *web, web_cli_t *cli, web_sub_t *sub)
{
    double stat[2] = {0};

    int n = sdr_rcv_corr_hist(web->rcv, sub->ch, sub->tspan, stat,
        web->hist_P);
    if (n <= 0) return;
    uint8_t *p = web->bin_buff;
    *p++ = FRM_CORR_HIST;
    *p++ = 0;
    p = bin_u16(p, (uint16_t)sub->ch);
    p = bin_u32(p, (uint32_t)n);
    p = bin_f64(p, stat[0]);
    p = bin_f32(p, (float)stat[1]);
    p = bin_u32(p, 0);
    memcpy(p, web->hist_P, sizeof(sdr_cpx_t) * n);
    ws_send(cli, 0x2, web->bin_buff, 24 + n * 8);
}

// send topic data -------------------------------------------------------------
static void send_topic(sdr_web_t *web, web_cli_t *cli, int topic,
    web_sub_t *sub)
{
    switch (topic) {
        case TOPIC_RCV_STAT : send_rcv_stat (web, cli); break;
        case TOPIC_CH_STAT  : send_ch_stat  (web, cli, sub); break;
        case TOPIC_SAT_STAT : send_sat_stat (web, cli, sub); break;
        case TOPIC_PVT_SOL  : send_pvt_sol  (web, cli); break;
        case TOPIC_RFCH_STAT: send_rfch_stat(web, cli); break;
        case TOPIC_HIST     : send_hist     (web, cli, sub); break;
        case TOPIC_LOG      : send_log      (web, cli, sub); break;
        case TOPIC_PSD      : send_psd      (web, cli, sub); break;
        case TOPIC_CORR     : send_corr     (web, cli, sub); break;
        case TOPIC_CORR_HIST: send_corr_hist(web, cli, sub); break;
    }
}

// topic name to ID ------------------------------------------------------------
static int topic_id(const char *name)
{
    static const char *names[] = {
        "", "rcv_stat", "ch_stat", "sat_stat", "pvt_sol", "rfch_stat", "hist",
        "log", "psd", "corr", "corr_hist"
    };
    for (int i = 1; i <= N_TOPIC; i++) {
        if (!strcmp(name, names[i])) return i;
    }
    return 0;
}

// send command acknowledge ----------------------------------------------------
static void send_ack(web_cli_t *cli, const char *cmd, int ok, const char *extra)
{
    char buff[256];

    snprintf(buff, sizeof(buff), "{\"type\":\"ack\",\"cmd\":\"%s\",\"ok\":%s"
        "%s%s}", cmd, ok ? "true" : "false", extra && *extra ? "," : "",
        extra ? extra : "");
    ws_send_text(cli, buff);
}

// update correlator channel selection and broadcast ---------------------------
static void update_sel_ch(sdr_web_t *web, int ch, double width)
{
    char buff[128];

    if (ch == web->sel_ch && width == web->sel_width) return;
    web->sel_ch = ch;
    web->sel_width = width;
    sdr_rcv_sel_ch(web->rcv, ch, width);
    snprintf(buff, sizeof(buff), "{\"type\":\"sel_ch\",\"ch\":%d,"
        "\"width\":%.3g}", ch, width);
    for (int i = 0; i < MAX_WEB_CLI; i++) {
        if (web->cli[i].state == 2) ws_send_text(web->cli + i, buff);
    }
}

// release correlator channel selection if no subscriber -----------------------
static void check_sel_ch(sdr_web_t *web)
{
    for (int i = 0; i < MAX_WEB_CLI; i++) {
        if (web->cli[i].state != 2) continue;
        if (web->cli[i].subs[TOPIC_CORR].ena ||
            web->cli[i].subs[TOPIC_CORR_HIST].ena) return;
    }
    if (web->sel_ch) update_sel_ch(web, 0, DEF_SEL_WIDTH);
}

// process Web UI client command -----------------------------------------------
static void proc_cmd(sdr_web_t *web, web_cli_t *cli, const char *msg)
{
    char cmd[32] = "", topic[32] = "", extra[128];
    double val;

    if (!jsn_str(msg, "cmd", cmd, sizeof(cmd))) {
        ws_send_text(cli, "{\"type\":\"error\",\"msg\":\"no cmd\"}");
        return;
    }
    if (!strcmp(cmd, "sub") || !strcmp(cmd, "get")) {
        int id = jsn_str(msg, "topic", topic, sizeof(topic)) ?
            topic_id(topic) : 0;
        if (!id) {
            send_ack(cli, cmd, 0, "\"msg\":\"bad topic\"");
            return;
        }
        web_sub_t sub;
        memset(&sub, 0, sizeof(sub));
        sub.cyc = id >= TOPIC_PSD ? DEF_CYC_BIN : DEF_CYC_TEXT;
        sub.ch = 1;
        sub.rfch = id == TOPIC_PSD || id == TOPIC_HIST ? 1 : 0;
        sub.nfft = 2048;
        sub.tave = 0.01;
        sub.tspan = 1.0;
        sub.width = web->sel_width > 0.0 ? web->sel_width : DEF_SEL_WIDTH;
        sub.min_lock = 2.0;
        snprintf(sub.sys, sizeof(sub.sys), "ALL");
        if (jsn_num(msg, "cyc", &val)) sub.cyc = (int)CLIP(val, MIN_CYC, 60000);
        if (jsn_num(msg, "ch", &val)) sub.ch = (int)CLIP(val, 1, SDR_MAX_NCH);
        if (jsn_num(msg, "rfch", &val)) { // 0 = all RF CHs
            sub.rfch = (int)CLIP(val, 0, SDR_MAX_BUFF);
        }
        if (jsn_num(msg, "chno", &val)) sub.chno = (int)val;
        if (jsn_num(msg, "opt", &val)) sub.opt = (int)val;
        if (jsn_num(msg, "nfft", &val)) sub.nfft = (int)CLIP(val, 64, MAX_NFFT);
        if (jsn_num(msg, "tave", &val)) sub.tave = CLIP(val, 1e-4, 0.1);
        if (jsn_num(msg, "tspan", &val)) sub.tspan = CLIP(val, 0.01, 10.0);
        if (jsn_num(msg, "width", &val)) sub.width = CLIP(val, 1e-7, 1e-4);
        if (jsn_num(msg, "min_lock", &val)) sub.min_lock = val;
        jsn_str(msg, "sys", sub.sys, sizeof(sub.sys));
        jsn_str(msg, "sats", sub.sats, sizeof(sub.sats));
        if (!strcmp(cmd, "get")) {
            send_topic(web, cli, id, &sub);
            return;
        }
        sub.ena = 1;
        sub.next = sdr_get_tick();
        sub.log_pos = cli->subs[id].ena ? cli->subs[id].log_pos : 0;
        cli->subs[id] = sub;
        if (id == TOPIC_CORR || id == TOPIC_CORR_HIST) {
            update_sel_ch(web, sub.ch, sub.width);
        }
        send_ack(cli, "sub", 1, NULL);
    } else if (!strcmp(cmd, "unsub")) {
        int id = jsn_str(msg, "topic", topic, sizeof(topic)) ?
            topic_id(topic) : 0;
        if (id) cli->subs[id].ena = 0;
        if (id == TOPIC_CORR || id == TOPIC_CORR_HIST) check_sel_ch(web);
        send_ack(cli, "unsub", id != 0, NULL);
    } else if (!strcmp(cmd, "sel_ch")) {
        double ch = 0.0, width = web->sel_width;
        jsn_num(msg, "ch", &ch);
        jsn_num(msg, "width", &width);
        update_sel_ch(web, (int)CLIP(ch, 0, SDR_MAX_NCH),
            CLIP(width, 1e-7, 1e-4));
        send_ack(cli, "sel_ch", 1, NULL);
    } else if (!strcmp(cmd, "set_gain")) {
        double rfch = 1.0, gain = 0.0;
        jsn_num(msg, "rfch", &rfch);
        jsn_num(msg, "gain", &gain);
        int ok = sdr_rcv_set_gain(web->rcv, (int)rfch - 1, (int)gain);
        send_ack(cli, "set_gain", ok, NULL);
    } else if (!strcmp(cmd, "get_gain")) {
        double rfch = 1.0;
        jsn_num(msg, "rfch", &rfch);
        int gain = sdr_rcv_get_gain(web->rcv, (int)rfch - 1);
        snprintf(extra, sizeof(extra), "\"gain\":%d", gain);
        send_ack(cli, "get_gain", gain >= 0, extra);
    } else if (!strcmp(cmd, "set_filt")) {
        double rfch = 1.0, bw = 0.0, freq = 0.0, order = 0.0;
        jsn_num(msg, "rfch", &rfch);
        jsn_num(msg, "bw", &bw);
        jsn_num(msg, "freq", &freq);
        jsn_num(msg, "order", &order);
        int ok = sdr_rcv_set_filt(web->rcv, (int)rfch - 1, bw, freq,
            (int)order);
        send_ack(cli, "set_filt", ok, NULL);
    } else if (!strcmp(cmd, "get_filt")) {
        double rfch = 1.0, bw = 0.0, freq = 0.0;
        int order = 0;
        jsn_num(msg, "rfch", &rfch);
        int ok = sdr_rcv_get_filt(web->rcv, (int)rfch - 1, &bw, &freq, &order);
        snprintf(extra, sizeof(extra), "\"bw\":%.3f,\"freq\":%.3f,"
            "\"order\":%d", bw, freq, order);
        send_ack(cli, "get_filt", ok, extra);
    } else if (!strcmp(cmd, "setopt")) {
        char name[32] = "";
        double value = 0.0;
        int ok = jsn_str(msg, "name", name, sizeof(name)) &&
            jsn_num(msg, "value", &value);
        if (ok) sdr_rcv_setopt(name, value);
        send_ack(cli, "setopt", ok, NULL);
    } else if (!strcmp(cmd, "log_level")) {
        if (jsn_num(msg, "value", &val)) sdr_log_level((int)val);
        send_ack(cli, "log_level", 1, NULL);
    } else {
        ws_send_text(cli, "{\"type\":\"error\",\"msg\":\"unknown cmd\"}");
    }
}

// process WebSocket input -----------------------------------------------------
static void ws_input(sdr_web_t *web, web_cli_t *cli)
{
    while (cli->nin >= 2) {
        uint8_t *p = cli->inb;
        int fin = p[0] & 0x80, opcode = p[0] & 0x0F, masked = p[1] & 0x80;
        int64_t len = p[1] & 0x7F;
        int pos = 2;

        if (len == 126) {
            if (cli->nin < 4) return;
            len = ((int64_t)p[2] << 8) | p[3];
            pos = 4;
        } else if (len == 127) {
            if (cli->nin < 10) return;
            len = 0;
            for (int i = 0; i < 8; i++) {
                len = (len << 8) | p[2+i];
            }
            pos = 10;
        }
        if (!masked || len > MAX_REQ) { // protocol violation or oversized
            cli->close_req = 1;
            return;
        }
        if (cli->nin < pos + 4 + (int)len) return;
        uint8_t *mask = p + pos, *payload = p + pos + 4;
        for (int i = 0; i < (int)len; i++) {
            payload[i] ^= mask[i % 4];
        }
        if (opcode == 0x9) {        // ping -> pong
            ws_send(cli, 0xA, payload, (int)len);
        } else if (opcode == 0xA) { // pong
            ;
        } else if (opcode == 0x8) { // close
            ws_send(cli, 0x8, payload, len >= 2 ? 2 : 0);
            cli->close_req = 1;
        } else if (opcode <= 0x2) { // text/binary/continuation
            if (opcode) cli->msg_op = opcode;
            if (cli->nmsg + (int)len > MAX_REQ) {
                cli->close_req = 1;
                return;
            }
            memcpy(cli->msg + cli->nmsg, payload, (int)len);
            cli->nmsg += (int)len;
            if (fin) {
                cli->msg[cli->nmsg] = '\0';
                if (cli->msg_op == 0x1) proc_cmd(web, cli, (char *)cli->msg);
                cli->nmsg = 0;
            }
        }
        int total = pos + 4 + (int)len;
        memmove(cli->inb, cli->inb + total, cli->nin - total);
        cli->nin -= total;
    }
}

// receive client data ---------------------------------------------------------
static void recv_cli(sdr_web_t *web, web_cli_t *cli)
{
    int n = recv(cli->sock, (char *)cli->inb + cli->nin,
        IN_BUFF_SIZE - cli->nin, 0);
    if (n == 0 || (n < 0 && !SOCK_BLOCK(sock_err()))) {
        cli->nout = 0;
        cli->close_req = 1;
        return;
    }
    if (n < 0) return;
    cli->nin += n;
    cli->alive = sdr_get_tick();
    if (cli->state == 1) http_req(web, cli);
    if (cli->state == 2 && cli->nin > 0) ws_input(web, cli);
}

// close client ----------------------------------------------------------------
static void close_cli(sdr_web_t *web, web_cli_t *cli)
{
    uint8_t *outb = cli->outb;
    int ws = cli->state == 2;

    closesocket(cli->sock);
    memset(cli, 0, sizeof(*cli));
    cli->outb = outb;
    cli->sock = INVALID_SOCKET;
    if (ws) check_sel_ch(web);
}

// accept new client -----------------------------------------------------------
static void accept_cli(sdr_web_t *web)
{
    struct sockaddr_in addr;
    socklen_t len = sizeof(addr);

    sock_t sock = accept(web->ssock, (struct sockaddr *)&addr, &len);
    if (sock == INVALID_SOCKET) return;
    for (int i = 0; i < MAX_WEB_CLI; i++) {
        web_cli_t *cli = web->cli + i;
        if (cli->state) continue;
        int opt = 1;
        sock_nonblock(sock);
        setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, (char *)&opt, sizeof(opt));
#ifdef MACOS
        setsockopt(sock, SOL_SOCKET, SO_NOSIGPIPE, &opt, sizeof(opt));
#endif
        cli->sock = sock;
        cli->state = 1;
        cli->alive = cli->ping = sdr_get_tick();
        return;
    }
    closesocket(sock); // no free client slot
}

// Web UI server thread --------------------------------------------------------
static void *web_thread(void *arg)
{
    sdr_web_t *web = (sdr_web_t *)arg;

    while (web->state) {
        fd_set rfds, wfds;
        struct timeval tv = {0, WEB_CYC * 1000};
        sock_t maxfd = web->ssock;

        FD_ZERO(&rfds);
        FD_ZERO(&wfds);
        FD_SET(web->ssock, &rfds);
        for (int i = 0; i < MAX_WEB_CLI; i++) {
            web_cli_t *cli = web->cli + i;
            if (!cli->state) continue;
            FD_SET(cli->sock, &rfds);
            if (cli->nout > 0) FD_SET(cli->sock, &wfds);
            if (cli->sock > maxfd) maxfd = cli->sock;
        }
        if (select((int)maxfd + 1, &rfds, &wfds, NULL, &tv) < 0) {
            sdr_sleep_msec(WEB_CYC);
            continue;
        }
        if (FD_ISSET(web->ssock, &rfds)) accept_cli(web);
        for (int i = 0; i < MAX_WEB_CLI; i++) {
            web_cli_t *cli = web->cli + i;
            if (cli->state && FD_ISSET(cli->sock, &rfds)) recv_cli(web, cli);
        }
        uint32_t tick = sdr_get_tick();
        if ((int32_t)(tick - web->log_tick) >= LOG_POLL_CYC) {
            poll_log(web);
            web->log_tick = tick;
        }
        for (int i = 0; i < MAX_WEB_CLI; i++) {
            web_cli_t *cli = web->cli + i;
            if (cli->state != 2 || cli->close_req) continue;
            for (int j = 1; j <= N_TOPIC; j++) {
                web_sub_t *sub = cli->subs + j;
                if (!sub->ena || (int32_t)(tick - sub->next) < 0) continue;
                // latest-data-wins: drop the push if the client lags
                if (cli->nout <= OUT_BUFF_SKIP) send_topic(web, cli, j, sub);
                sub->next += sub->cyc;
                if ((int32_t)(tick - sub->next) > 0) sub->next = tick + sub->cyc;
            }
            if ((int32_t)(tick - cli->ping) >= PING_CYC) {
                ws_send(cli, 0x9, NULL, 0);
                cli->ping = tick;
            }
            if ((int32_t)(tick - cli->alive) >= DROP_TIMEOUT) cli->close_req = 1;
        }
        for (int i = 0; i < MAX_WEB_CLI; i++) {
            web_cli_t *cli = web->cli + i;
            if (!cli->state) continue;
            cli_flush(cli);
            if (cli->close_req && cli->nout == 0) close_cli(web, cli);
        }
    }
    return NULL;
}

// get executable directory ----------------------------------------------------
static void exe_dir(char *dir, int size)
{
    char path[1024] = "";

#ifdef WIN32
    GetModuleFileNameA(NULL, path, sizeof(path));
#elif defined(MACOS)
    uint32_t len = sizeof(path);
    _NSGetExecutablePath(path, &len);
#else
    int n = (int)readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (n > 0) path[n] = '\0';
#endif
    char *p = strrchr(path, '/');
#ifdef WIN32
    char *q = strrchr(path, '\\');
    if (q > p) p = q;
#endif
    if (p) *p = '\0';
    snprintf(dir, size, "%s", *path ? path : ".");
}

//------------------------------------------------------------------------------
//  Start the Web UI server. The server serves static Web UI files in html_dir
//  over HTTP and exchanges commands and monitor data over WebSocket (/ws).
//
//  args:
//      rcv       (I)  SDR receiver
//      addr      (I)  bind address ("" or NULL: 127.0.0.1)
//      port      (I)  TCP port number
//      html_dir  (I)  Web UI document root ("" or NULL: <exe_dir>/../html)
//
//  returns:
//      Web UI server (NULL: error)
//
sdr_web_t *sdr_web_start(sdr_rcv_t *rcv, const char *addr, int port,
    const char *html_dir)
{
    struct sockaddr_in sa;
    int opt = 1;

    if (!rcv || port <= 0 || port > 65535) return NULL;

    sock_t sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock == INVALID_SOCKET) {
        fprintf(stderr, "web server socket error (%d)\n", sock_err());
        return NULL;
    }
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (char *)&opt, sizeof(opt));
    memset(&sa, 0, sizeof(sa));
    sa.sin_family = AF_INET;
    sa.sin_port = htons((uint16_t)port);
    sa.sin_addr.s_addr = addr && *addr ? inet_addr(addr) :
        htonl(INADDR_LOOPBACK);
    if (sa.sin_addr.s_addr == INADDR_NONE) {
        fprintf(stderr, "web server bind address error %s\n", addr);
        closesocket(sock);
        return NULL;
    }
    if (bind(sock, (struct sockaddr *)&sa, sizeof(sa)) < 0 ||
        listen(sock, 8) < 0) {
        fprintf(stderr, "web server bind error port=%d (%d)\n", port,
            sock_err());
        closesocket(sock);
        return NULL;
    }
    sock_nonblock(sock);

    sdr_web_t *web = (sdr_web_t *)sdr_malloc(sizeof(sdr_web_t));
    web->rcv = rcv;
    web->ssock = sock;
    web->sel_width = DEF_SEL_WIDTH;
    if (html_dir && *html_dir) {
        snprintf(web->html_dir, sizeof(web->html_dir), "%s", html_dir);
    } else {
        char dir[1000];
        exe_dir(dir, sizeof(dir));
        snprintf(web->html_dir, sizeof(web->html_dir), "%s/../html", dir);
    }
    web->log_buff = (char *)sdr_malloc(LOG_BUFF_SIZE + 1);
    web->stat_buff = (char *)sdr_malloc(STAT_BUFF_SIZE);
    web->json_buff = (char *)sdr_malloc(JSON_BUFF_SIZE);
    web->bin_buff = (uint8_t *)sdr_malloc(BIN_BUFF_SIZE);
    web->psd = (float *)sdr_malloc(sizeof(float) * MAX_NFFT);
    web->hist_P = (sdr_cpx_t *)sdr_malloc(sizeof(sdr_cpx_t) * SDR_N_HIST);
    for (int i = 0; i < MAX_WEB_CLI; i++) {
        web->cli[i].outb = (uint8_t *)sdr_malloc(OUT_BUFF_SIZE);
        web->cli[i].sock = INVALID_SOCKET;
    }
    web->log_tick = sdr_get_tick();
    web->state = 1;
    if (!sdr_thread_create(&web->thread, web_thread, web)) {
        web->state = 0;
        sdr_web_stop(web);
        return NULL;
    }
    return web;
}

//------------------------------------------------------------------------------
//  Stop the Web UI server and free all resources.
//
//  args:
//      web       (I)  Web UI server (NULL: no operation)
//
//  returns:
//      none
//
void sdr_web_stop(sdr_web_t *web)
{
    if (!web) return;
    if (web->state) {
        web->state = 0;
        sdr_thread_join(web->thread);
    }
    closesocket(web->ssock);
    for (int i = 0; i < MAX_WEB_CLI; i++) {
        if (web->cli[i].state) closesocket(web->cli[i].sock);
        sdr_free(web->cli[i].outb);
    }
    for (int i = 0; i < MAX_LOG_LINES; i++) {
        sdr_free(web->log_lines[i]);
    }
    sdr_free(web->log_buff);
    sdr_free(web->stat_buff);
    sdr_free(web->json_buff);
    sdr_free(web->bin_buff);
    sdr_free(web->psd);
    sdr_free(web->hist_P);
    sdr_free(web);
}
