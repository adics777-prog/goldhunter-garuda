"""
GHG Builder - membuat file EA (.ex5 / .ex4) berlisensi untuk member GoldHunter Garuda.

Cara kerja:
  1. Tanya ke web (goldhuntergaruda.com/api/builder/claim) apakah ada tugas generate.
  2. Salin source EA ke folder kerja, sisipkan kunci lisensi (nomor akun + tanggal habis)
     dan ikon Garuda. File EA asli TIDAK diubah.
  3. Compile dengan MetaEditor, lalu upload hasilnya ke web.

Jalankan:  python ghg_builder.py          (terus berjalan, cek tiap beberapa detik)
           python ghg_builder.py --once   (cek sekali lalu keluar)
           python ghg_builder.py --test 12345678 [YYYY-MM-DD]   (tes compile lokal tanpa web)
           python ghg_builder.py --config config.local.json    (pakai web lokal localhost:8788)
Hanya pakai library bawaan Python 3.
"""
import base64, datetime, glob, hashlib, json, os, re, shutil, socket, subprocess, sys, time, traceback, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
ICON = os.path.join(HERE, 'GoldHunter_Garuda.ico')


def load_config():
    name = sys.argv[sys.argv.index('--config') + 1] if '--config' in sys.argv else 'config.json'
    path = name if os.path.isabs(name) else os.path.join(HERE, name)
    if not os.path.exists(path):
        sys.exit('config.json belum ada. Salin config.example.json menjadi config.json lalu isi.')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def log(msg):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    with open(os.path.join(HERE, 'builder.log'), 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def api(cfg, path, payload):
    req = urllib.request.Request(
        cfg['api_base'].rstrip('/') + path,
        data=json.dumps(payload).encode(),
        headers={'content-type': 'application/json', 'x-builder-token': cfg['token'], 'user-agent': 'GHG-Builder/1.0'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:300]}')


# ---------------------------------------------------------------- license injection
LICENSE_BLOCK = r'''
//+------------------------------------------------------------------+
//| LISENSI - disisipkan otomatis oleh GHG Builder (build #{build_id})
//| Akun: {account}   Berlaku: {expiry_text}
//+------------------------------------------------------------------+
#define GHG_LIC_ACCOUNT  {account}
#define GHG_LIC_EXPIRY   {expiry}
bool   g_ghgLicWarned = false;

bool GHG_LicenseCheck(const bool atInit)
  {{
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
      return(true);
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   if(login == 0)
      return(true);              // terminal belum login; dicek lagi saat tick pertama
   string why = "";
   if(login != (long)GHG_LIC_ACCOUNT)
      why = StringFormat("EA ini terkunci untuk akun %I64d, bukan akun %I64d.", (long)GHG_LIC_ACCOUNT, login);
   else if(GHG_LIC_EXPIRY > 0 && TimeCurrent() > (datetime)GHG_LIC_EXPIRY)
      why = "Masa sewa EA sudah berakhir pada " + TimeToString((datetime)GHG_LIC_EXPIRY, TIME_DATE) +
            ". Perpanjang di goldhuntergaruda.com";
   if(why == "")
     {{
      if(atInit && GHG_LIC_EXPIRY > 0)
        {{
         long left = ((long)GHG_LIC_EXPIRY - (long)TimeCurrent()) / 86400;
         Print("GoldHunter Garuda: lisensi akun ", login, " berlaku sampai ", TimeToString((datetime)GHG_LIC_EXPIRY, TIME_DATE), " (", left, " hari lagi)");
         if(left <= 7)
            Alert("GoldHunter Garuda: masa sewa tinggal ", left, " hari. Perpanjang di goldhuntergaruda.com");
        }}
      return(true);
     }}
   if(!g_ghgLicWarned)
     {{
      g_ghgLicWarned = true;
      Alert("GoldHunter Garuda: ", why);
      Print("GoldHunter Garuda: ", why);
     }}
   if(!atInit)
      ExpertRemove();
   return(false);
  }}
'''


def inject_license(src, build_id, account, expiry):
    expiry_text = 'selamanya' if not expiry else datetime.datetime.utcfromtimestamp(expiry).strftime('%Y-%m-%d %H:%M UTC')
    block = LICENSE_BLOCK.format(build_id=build_id, account=int(account), expiry=int(expiry or 0), expiry_text=expiry_text)

    m = re.search(r'^\s*int\s+OnInit\s*\(\s*(void)?\s*\)\s*\{', src, re.M)
    if not m:
        raise RuntimeError('Tidak menemukan "int OnInit()" di source EA')
    head = src[:m.start()]
    body = src[m.start():]
    body = re.sub(r'(int\s+OnInit\s*\(\s*(void)?\s*\)\s*\{)',
                  r'\1\n   if(!GHG_LicenseCheck(true)) return(INIT_FAILED);', body, count=1)
    body, n = re.subn(r'(void\s+OnTick\s*\(\s*(void)?\s*\)\s*\{)',
                      r'\1\n   if(!GHG_LicenseCheck(false)) return;', body, count=1)
    if n != 1:
        raise RuntimeError('Tidak menemukan "void OnTick()" di source EA')
    out = head + block + '\n' + body

    # Garuda icon in the MetaTrader navigator / EA properties
    if os.path.exists(ICON) and not re.search(r'^#property\s+icon', out, re.M):
        out, n = re.subn(r'^(#property\s+version[^\n]*\n)', r'\1#property icon "GoldHunter_Garuda.ico"\n', out, count=1, flags=re.M)
        if n == 0:
            out = '#property icon "GoldHunter_Garuda.ico"\n' + out
    return out


REPORT_BLOCK = r"""
//+------------------------------------------------------------------+
//| LAPORAN PROFIT ke goldhuntergaruda.com - disisipkan GHG Builder
//| Mengirim balance, equity & profit tertutup hari/minggu/bulan secara berkala.
//| Interval awal dari admin saat compile; sesudahnya mengikuti balasan server ("next").
//| Butuh: Tools > Options > Expert Advisors > Allow WebRequest > https://goldhuntergaruda.com
//+------------------------------------------------------------------+
#define GHG_REPORT_URL   "__URL__"
#define GHG_LIC_ID       __LIC__
#define GHG_REPORT_TOKEN "__TOKEN__"
#define GHG_REPORT_EVERY __EVERY__
#define GHG_EA_VERSION   "__VERSION__"
datetime g_ghgNextReport = 0;
int      g_ghgEvery      = GHG_REPORT_EVERY;   // seconds; updated from the server reply
bool     g_ghgWebWarned  = false;
long     g_ghgSince      = 0;                  // start of the member's track record (UTC seconds, from the server reply)

void GHG_Report()
  {
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
      return;
   if(TimeLocal() < g_ghgNextReport)
      return;
   g_ghgNextReport = TimeLocal() + g_ghgEvery;
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   if(login == 0)
      return;
//--- period starts in broker server time: today 00:00, Monday 00:00, 1st of month 00:00
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   datetime dayStart   = StringToTime(StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day));
   datetime weekStart  = dayStart - ((dt.day_of_week + 6) % 7) * 86400;
   datetime monthStart = StringToTime(StringFormat("%04d.%02d.01", dt.year, dt.mon));
   datetime from = (weekStart < monthStart ? weekStart : monthStart);
   double pd = 0.0, pw = 0.0, pm = 0.0;
   if(HistorySelect(from, TimeCurrent() + 86400))
     {
      int n = HistoryDealsTotal();
      for(int i = 0; i < n; i++)
        {
         ulong t = HistoryDealGetTicket(i);
         if(t == 0)
            continue;
         long type = HistoryDealGetInteger(t, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
            continue;
         datetime when = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
         double p = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
                    + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
         if(when >= monthStart) pm += p;
         if(when >= weekStart)  pw += p;
         if(when >= dayStart)   pd += p;
        }
     }
//--- closed profit since the start of the track record (modal = balance - total, so deposits count as capital)
   double total = 0.0;
   if(g_ghgSince > 0)
     {
      long off = (long)(TimeTradeServer() - TimeGMT());
      off = (long)MathRound(off / 900.0) * 900;
      if(HistorySelect((datetime)(g_ghgSince + off), TimeCurrent() + 86400))
        {
         int n2 = HistoryDealsTotal();
         for(int i = 0; i < n2; i++)
           {
            ulong t = HistoryDealGetTicket(i);
            if(t == 0)
               continue;
            long type = HistoryDealGetInteger(t, DEAL_TYPE);
            if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
               continue;
            total += HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP)
                     + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_FEE);
           }
        }
     }
   string json = StringFormat("{\"lic\":%d,\"token\":\"%s\",\"login\":%I64d,\"server\":\"%s\",\"currency\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"day\":%.2f,\"week\":%.2f,\"month\":%.2f,\"positions\":%d,\"version\":\"%s\",\"since_used\":%I64d,\"total\":%.2f}",
                              GHG_LIC_ID, GHG_REPORT_TOKEN, login, AccountInfoString(ACCOUNT_SERVER), AccountInfoString(ACCOUNT_CURRENCY),
                              AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY), pd, pw, pm, PositionsTotal(), GHG_EA_VERSION, g_ghgSince, total);
   char data[], res[];
   string resHeaders;
   int len = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, len > 0 ? len - 1 : 0);
   ResetLastError();
   int code = WebRequest("POST", GHG_REPORT_URL, "Content-Type: application/json\r\n", 5000, data, res, resHeaders);
   if(code == 200)
     {
      // server reply e.g. {"ok":true,"next":1800} -> report interval set by the admin
      string reply = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
      int ks = StringFind(reply, "\"since\":");
      if(ks >= 0)
        {
         long sn = StringToInteger(StringSubstr(reply, ks + 8, 12));
         if(sn > 0 && sn != g_ghgSince)
           {
            g_ghgSince = sn;
            g_ghgNextReport = TimeLocal() + 5;    // resend soon with the correct total
            return;
           }
        }
      int k = StringFind(reply, "\"next\":");
      if(k >= 0)
        {
         long next = StringToInteger(StringSubstr(reply, k + 7, 8));
         if(next >= 60 && next <= 86400)
           {
            g_ghgEvery = (int)next;
            g_ghgNextReport = TimeLocal() + g_ghgEvery;
           }
        }
     }
   if(code == -1)
     {
      int err = GetLastError();
      if(!g_ghgWebWarned)
        {
         g_ghgWebWarned = true;
         PrintFormat("GoldHunter Garuda: laporan profit belum terkirim (error %d). Izinkan WebRequest: Tools > Options > Expert Advisors > centang Allow WebRequest, tambahkan https://goldhuntergaruda.com", err);
        }
      g_ghgNextReport = TimeLocal() + (g_ghgEvery > 1800 ? g_ghgEvery : 1800);   // retry later, trading is not affected
     }
  }
"""


def inject_report(src, job, version, api_base):
    token = job.get('report_token')
    if not token or not job.get('license_id'):
        return src
    url = api_base.rstrip('/') + '/api/ea/report'
    block = (REPORT_BLOCK.replace('__URL__', url).replace('__LIC__', str(int(job['license_id'])))
             .replace('__TOKEN__', re.sub(r'[^A-Za-z0-9_-]', '', token)).replace('__VERSION__', re.sub(r'[^0-9A-Za-z.]', '', version or ''))
             .replace('__EVERY__', str(max(60, min(86400, int(job.get('report_interval') or 1800))))))
    m = re.search(r'^\s*int\s+OnInit\s*\(\s*(void)?\s*\)\s*\{', src, re.M)
    src = src[:m.start()] + block + '\n' + src[m.start():]
    # live-only timer is the best place (no extra work in the tester); otherwise OnTick
    src, n = re.subn(r'(void\s+OnTimer\s*\(\s*(void)?\s*\)\s*\{)', r'\1\n   GHG_Report();', src, count=1)
    if n == 0:
        src, n = re.subn(r'(if\(!GHG_LicenseCheck\(false\)\) return;)', r'\1\n   GHG_Report();', src, count=1)
    return src


# ---------------------------------------------------------------- compile
def read_text(path):
    raw = open(path, 'rb').read()
    for bom, codec in ((b'\xef\xbb\xbf', 'utf-8-sig'), (b'\xff\xfe', 'utf-16'), (b'\xfe\xff', 'utf-16')):
        if raw.startswith(bom):
            return raw.decode(codec)
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1252')


WEB_KEY_DEFINE = re.compile(r'^#define\s+GHG_WEB_KEY\s+"[^"]*"', re.M)


def with_web_key(src, key):
    """Compile the web key into the EA (#define GHG_WEB_KEY). Owner release: the master key; licence build:
    lic.<license_id>.<report_token>. Input 13.2 filled by hand still wins inside the EA."""
    key = re.sub(r'[^0-9A-Za-z._-]', '', str(key or ''))
    if not key or not WEB_KEY_DEFINE.search(src):
        return src
    return WEB_KEY_DEFINE.sub(f'#define GHG_WEB_KEY   "{key}"', src, count=1)


def metaedit(p, target, logfile):
    """MetaEditor needs /compile:"path" with the quote AFTER the colon; a Python argument list quotes the whole
    argument ("/compile:C:\a b.mq5"), which MetaEditor rejects as soon as the path has a space."""
    cmd = f'"{p["metaeditor"]}" /compile:"{target}" /inc:"{p["mql_dir"]}" /log:"{logfile}"'
    subprocess.run(cmd, timeout=240)


def build(cfg, job):
    platform = job['platform']
    p = dict(cfg.get(platform) or {})
    source = p.get('ea_source')
    if platform == 'mt4' and not source:
        import ghg_mt4                                  # MT4 = generated from the MT5 source
        ghg_mt4.generate()
        source = ghg_mt4.OUT
        p.setdefault('mql_dir', '')
        if not p['mql_dir']:
            p['mql_dir'] = ghg_mt4.MT4_DATA + '\\MQL4'
    if not source or not os.path.exists(source):
        raise RuntimeError(f'Source EA untuk {platform.upper()} belum ada ({source or "belum diatur di config.json"}). '
                           f'EA saat ini hanya tersedia untuk MT5.')
    ext = '.mq5' if platform == 'mt5' else '.mq4'
    out_ext = '.ex5' if platform == 'mt5' else '.ex4'
    name = os.path.splitext(os.path.basename(source))[0]

    jobdir = os.path.join(WORK, f"job_{job['id']}")
    shutil.rmtree(jobdir, ignore_errors=True)
    os.makedirs(jobdir)
    # local includes next to the source (if any) + icon
    for mqh in glob.glob(os.path.join(os.path.dirname(source), '*.mqh')):
        shutil.copy2(mqh, jobdir)
    if os.path.exists(ICON):
        shutil.copy2(ICON, jobdir)

    src = read_text(source)
    version = (re.search(r'#property\s+version\s+"([^"]+)"', src) or [None, ''])[1]
    licensed = inject_license(src, job['id'], job['account_number'], job.get('expires_at') or 0)
    licensed = inject_report(licensed, job, version, cfg.get('report_base') or cfg['api_base'])
    if platform == 'mt4':
        licensed = re.sub(r'(?<!C4)TimeTradeServer\(', 'C4TimeTradeServer(', licensed)   # report code is MQL5
    if job.get('license_id') and job.get('report_token'):
        licensed = with_web_key(licensed, f"lic.{job['license_id']}.{job['report_token']}")
    target = os.path.join(jobdir, name + ext)
    with open(target, 'w', encoding='utf-8-sig', newline='\r\n') as f:
        f.write(licensed.replace('\r\n', '\n'))

    logfile = os.path.join(jobdir, 'compile.log')
    metaedit(p, target, logfile)
    compile_log = read_text(logfile) if os.path.exists(logfile) else '(log compile tidak ada)'
    binary = os.path.join(jobdir, name + out_ext)
    m = re.search(r'(\d+)\s+errors?,\s*(\d+)\s+warnings?', compile_log)
    if not os.path.exists(binary) or (m and int(m.group(1)) > 0):
        raise RuntimeError('Compile gagal:\n' + compile_log[-3000:])
    data = open(binary, 'rb').read()
    filename = f"{name}_{job['account_number']}{out_ext}"
    summary = m.group(0) if m else 'compiled'
    return data, filename, version, summary, jobdir


def source_versions(cfg):
    out = {}
    for platform in ('mt5', 'mt4'):
        src = (cfg.get(platform) or {}).get('ea_source')
        if src and os.path.exists(src):
            m = re.search(r'#property\s+version\s+"([^"]+)"', read_text(src))
            out[platform] = m.group(1) if m else '?'
    return out


def handle(cfg, job):
    exp = job.get('expires_at') or 0
    log(f"Build #{job['id']}: {job['platform'].upper()} akun {job['account_number']} berlaku "
        f"{'selamanya' if not exp else datetime.datetime.utcfromtimestamp(exp).date()}")
    try:
        data, filename, version, summary, jobdir = build(cfg, job)
        api(cfg, '/api/builder/result', {
            'id': job['id'], 'ok': True, 'filename': filename, 'ea_version': version,
            'log': f'{summary}; {len(data):,} byte; builder {socket.gethostname()}',
            'data_b64': base64.b64encode(data).decode()})
        shutil.rmtree(jobdir, ignore_errors=True)   # licensed source is not kept
        log(f"Build #{job['id']}: OK {filename} ({len(data):,} byte, v{version})")
    except Exception as e:
        msg = str(e) if isinstance(e, RuntimeError) else traceback.format_exc()
        log(f"Build #{job['id']}: GAGAL - {msg.splitlines()[0]}")
        try:
            api(cfg, '/api/builder/result', {'id': job['id'], 'ok': False, 'log': msg})
        except Exception as e2:
            log(f'  gagal melapor ke web: {e2}')


VPS_STATE = {'warned': '', 'failed_mtime': 0.0}


def vps_paths(cfg):
    p = cfg.get('mt5') or {}
    src = p.get('ea_source') or ''
    name = os.path.splitext(os.path.basename(src))[0]
    ex5 = os.path.splitext(src)[0] + '.ex5'
    pdir = os.path.join(p.get('mql_dir') or '', 'Presets')
    return p, src, name, ex5, sorted(glob.glob(os.path.join(pdir, glob.escape(name) + '*.set')))


def vps_warn(msg):
    if VPS_STATE['warned'] != msg:
        VPS_STATE['warned'] = msg
        log(msg)


def sync_vps_release(cfg, server):
    """Publish GOLD HUNTER GARUDA (.ex5 + all its presets) for the VPS agents.
    Code is published only when #property version changes (an edit without a version bump never reaches the live
    accounts); a version bump that is not compiled yet is compiled here first. Preset-only changes are published too."""
    if (cfg.get('vps') or {}).get('enabled') is False:
        return
    p, src, name, ex5, sets = vps_paths(cfg)
    if not src or not os.path.exists(src):
        return
    if time.time() - os.path.getmtime(src) < 20:          # still being edited / saved
        return
    m = re.search(r'#property\s+version\s+"([^"]+)"', read_text(src))
    version = m.group(1) if m else ''
    sv = server.get('version') or ''
    fresh = os.path.exists(ex5) and os.path.getmtime(ex5) >= os.path.getmtime(src)
    if not fresh:
        if version == sv:
            vps_warn(f'VPS: {name}.mq5 berubah tetapi versi masih v{version}. Naikkan #property version untuk menerbitkan ke VPS.')
            return
        mt = os.path.getmtime(src)
        if VPS_STATE['failed_mtime'] == mt:
            return
        logfile = os.path.join(WORK, 'vps_compile.log')
        os.makedirs(WORK, exist_ok=True)
        key = VPS_STATE.get('ea_key') or ''
        log(f'VPS: versi baru v{version} terdeteksi, compile {name}.mq5 {"(kunci master ditanam)" if key else "(tanpa kunci web bawaan)"} ...')
        if key:
            # compiled from a copy so the master key never lands in the source file
            kdir = os.path.join(WORK, 'vps_src')
            shutil.rmtree(kdir, ignore_errors=True)
            os.makedirs(kdir)
            ksrc = os.path.join(kdir, name + '.mq5')
            with open(ksrc, 'w', encoding='utf-8-sig', newline='\r\n') as f:
                f.write(with_web_key(read_text(src), key).replace('\r\n', '\n'))
            metaedit(p, ksrc, logfile)
            kex5 = os.path.join(kdir, name + '.ex5')
            if os.path.exists(kex5):
                shutil.copy2(kex5, ex5)
                os.utime(ex5, None)
            shutil.rmtree(kdir, ignore_errors=True)
        else:
            metaedit(p, src, logfile)
        out = read_text(logfile) if os.path.exists(logfile) else ''
        mm = re.search(r'(\d+)\s+errors?,\s*(\d+)\s+warnings?', out)
        if not os.path.exists(ex5) or os.path.getmtime(ex5) < mt or (mm and int(mm.group(1)) > 0):
            VPS_STATE['failed_mtime'] = mt
            log('VPS: compile GAGAL, rilis tidak diterbitkan:\n' + out[-1500:])
            return
        log(f'VPS: compile OK ({mm.group(0) if mm else "selesai"})')
        # the MT5 on this PC gets the same release; it is loaded the next time that MT5 starts
        try:
            local = os.path.join(p.get('mql_dir') or '', 'Experts', name + '.ex5')
            if p.get('mql_dir') and os.path.isdir(os.path.dirname(local)):
                shutil.copy2(ex5, local)
                log('VPS: EA juga disalin ke MT5 PC ini (aktif setelah MT5 dibuka ulang)')
        except Exception as e:
            log(f'VPS: gagal menyalin EA ke MT5 PC ini: {e}')
    # MT4 version (Robot Trading\MT4) follows every MT5 build; a failure never blocks the MT5 release
    try:
        import ghg_mt4
        if not os.path.exists(ghg_mt4.OUT_EX4) or os.path.getmtime(ghg_mt4.OUT_EX4) < os.path.getmtime(ex5):
            ghg_mt4.generate(web_key=VPS_STATE.get('ea_key') or '')
            ghg_mt4.make_presets()
            res = ghg_mt4.compile_mt4()
            log(f'MT4: v{version} dibuat ulang ({res[-1].strip() if res else "compile selesai"})')
    except Exception as e:
        log(f'MT4: versi MT4 gagal dibuat: {e}')
    # one EA on every chart: the release is the main .ex5 only (no extra EAs)
    data = open(ex5, 'rb').read()
    sha_ex5 = hashlib.sha256(data).hexdigest()
    presets = [(os.path.basename(f), open(f, 'rb').read()) for f in sets]
    sha_p = hashlib.sha256(b''.join(n.encode('utf-8') + b'\0' + b for n, b in presets)).hexdigest()
    sha = hashlib.sha256(f'{version}|{sha_ex5}|{sha_p}'.encode()).hexdigest()
    if sha == server.get('sha'):
        return
    if sv and version == sv and sha_ex5 != (server.get('sha_ex5') or ''):
        if sha_p == (server.get('sha_presets') or ''):
            vps_warn(f'VPS: {name}.ex5 berubah tetapi versi masih v{version}. Naikkan #property version untuk menerbitkan ke VPS.')
            return
        vps_warn(f'VPS: preset berubah tetapi {name}.ex5 juga berubah tanpa naik versi (v{version}); naikkan versi dulu, rilis ditahan.')
        return
    api(cfg, '/api/builder/vps-release', {
        'version': version, 'sha': sha, 'sha_ex5': sha_ex5, 'sha_presets': sha_p, 'host': socket.gethostname(),
        'ex5_name': name + '.ex5', 'ex5_b64': base64.b64encode(data).decode(),
        'extras': [],
        'presets': [{'name': n, 'b64': base64.b64encode(b).decode()} for n, b in presets]})
    VPS_STATE['warned'] = ''
    log(f'VPS: rilis v{version} diterbitkan ({len(data):,} byte + {len(presets)} preset). Agen VPS memasangnya dalam ±1 menit.')


def sync_content(cfg):
    """Promo videos: take one queued job from the website, render it here (garuda_video.py), keep the MP4 in the
    content folder and hand it to Telegram / social networks through the website. Only educational videos (kind
    'edu') come from the website for now."""
    try:
        res = api(cfg, '/api/builder/content/claim', {})
    except Exception as e:
        log(f'Konten: tidak bisa mengambil antrean ({e})')
        return
    job = res.get('job')
    if res.get('error'):
        log(f'Konten: {res["error"]}')
    if not job:
        return
    import garuda_video
    folder = cfg.get('content_dir') or os.path.join(os.path.expanduser('~'), 'Documents', 'GoldHunter Konten')
    os.makedirs(folder, exist_ok=True)
    name = f"goldhunter-garuda_{datetime.datetime.now():%Y%m%d_%H%M}_{job['kind']}_{job['id']}.mp4"
    out = os.path.join(folder, name)
    try:
        secs = garuda_video.render_video(job, out)
        with open(out[:-4] + '.txt', 'w', encoding='utf-8') as f:
            f.write(job.get('caption') or '')
        size = os.path.getsize(out)
        api(cfg, f"/api/builder/content/{job['id']}/done", {'ok': True, 'file_name': name, 'duration': secs, 'size': size})
        log(f'Konten #{job["id"]}: video {secs:.0f} dtk, {size / 1048576:.1f} MB -> {out}')
        if job.get('send_telegram'):
            req = urllib.request.Request(cfg['api_base'].rstrip('/') + f"/api/builder/content/{job['id']}/telegram", data=open(out, 'rb').read(),
                                         headers={'content-type': 'video/mp4', 'x-builder-token': cfg['token'], 'user-agent': 'GHG-Builder/1.0'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    t = json.loads(r.read().decode())
                log(f'Konten #{job["id"]}: Telegram {"terkirim" if t.get("ok") else "belum terkirim (" + (t.get("error") or "; ".join(t.get("errors") or [])) + ")"}')
            except Exception as e:
                log(f'Konten #{job["id"]}: gagal kirim ke Telegram ({e})')
        names = {'fb': 'Facebook', 'ig': 'Instagram', 'tt': 'TikTok (draft)'}
        for net in job.get('send_social') or []:              # the website posts it with its own tokens
            req = urllib.request.Request(cfg['api_base'].rstrip('/') + f"/api/builder/content/{job['id']}/social/{net}", data=open(out, 'rb').read(),
                                         headers={'content-type': 'video/mp4', 'x-builder-token': cfg['token'], 'user-agent': 'GHG-Builder/1.0'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    t = json.loads(r.read().decode())
                log(f'Konten #{job["id"]}: {names.get(net, net)} {"terkirim" if t.get("ok") else "gagal (" + (t.get("error") or "?") + ")"}')
            except Exception as e:
                log(f'Konten #{job["id"]}: gagal kirim ke {names.get(net, net)} ({e})')
    except Exception as e:
        log(f'Konten #{job["id"]}: GAGAL render - {e}')
        try:
            api(cfg, f"/api/builder/content/{job['id']}/done", {'ok': False, 'error': str(e)[:280]})
        except Exception:
            pass


def main():
    cfg = load_config()
    if '--test' in sys.argv:
        i = sys.argv.index('--test')
        acc = sys.argv[i + 1]
        exp = 0
        if len(sys.argv) > i + 2:
            exp = int(datetime.datetime.strptime(sys.argv[i + 2], '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc).timestamp())
        data, filename, version, summary, jobdir = build(cfg, {'id': 0, 'platform': 'mt5', 'account_number': acc, 'expires_at': exp})
        out = os.path.join(HERE, filename)
        open(out, 'wb').write(data)
        print(f'OK: {out} ({len(data):,} byte, v{version}, {summary}); source berlisensi: {jobdir}')
        return
    once = '--once' in sys.argv
    builder_id = socket.gethostname()
    log(f"GHG Builder aktif -> {cfg['api_base']} (cek tiap {cfg.get('poll_seconds', 15)} detik)")
    while True:
        try:
            res = api(cfg, '/api/builder/claim', {'builder_id': builder_id, 'versions': source_versions(cfg)})
            job = res.get('job')
            if 'ea_key' in res:
                VPS_STATE['ea_key'] = str(res.get('ea_key') or '').strip()
            if 'vps_release' in res:
                try:
                    sync_vps_release(cfg, res.get('vps_release') or {})
                except Exception as e:
                    log(f'VPS: gagal menerbitkan rilis: {e}')
            if job:
                handle(cfg, job)
                continue          # look for the next job right away
            sync_content(cfg)
        except Exception as e:
            log(f'Tidak bisa menghubungi web: {e}')
        if once:
            break
        time.sleep(int(cfg.get('poll_seconds', 15)))


if __name__ == '__main__':
    main()
