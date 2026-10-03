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
import base64, datetime, glob, json, os, re, shutil, socket, subprocess, sys, time, traceback, urllib.request, urllib.error

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
//| Mengirim balance, equity & profit tertutup hari/minggu/bulan tiap 5 menit.
//| Butuh: Tools > Options > Expert Advisors > Allow WebRequest > https://goldhuntergaruda.com
//+------------------------------------------------------------------+
#define GHG_REPORT_URL   "__URL__"
#define GHG_LIC_ID       __LIC__
#define GHG_REPORT_TOKEN "__TOKEN__"
#define GHG_EA_VERSION   "__VERSION__"
datetime g_ghgNextReport = 0;
bool     g_ghgWebWarned  = false;

void GHG_Report()
  {
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION))
      return;
   if(TimeLocal() < g_ghgNextReport)
      return;
   g_ghgNextReport = TimeLocal() + 300;
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
   string json = StringFormat("{\"lic\":%d,\"token\":\"%s\",\"login\":%I64d,\"server\":\"%s\",\"currency\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"day\":%.2f,\"week\":%.2f,\"month\":%.2f,\"positions\":%d,\"version\":\"%s\"}",
                              GHG_LIC_ID, GHG_REPORT_TOKEN, login, AccountInfoString(ACCOUNT_SERVER), AccountInfoString(ACCOUNT_CURRENCY),
                              AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY), pd, pw, pm, PositionsTotal(), GHG_EA_VERSION);
   char data[], res[];
   string resHeaders;
   int len = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, len > 0 ? len - 1 : 0);
   ResetLastError();
   int code = WebRequest("POST", GHG_REPORT_URL, "Content-Type: application/json\r\n", 5000, data, res, resHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      if(!g_ghgWebWarned)
        {
         g_ghgWebWarned = true;
         PrintFormat("GoldHunter Garuda: laporan profit belum terkirim (error %d). Izinkan WebRequest: Tools > Options > Expert Advisors > centang Allow WebRequest, tambahkan https://goldhuntergaruda.com", err);
        }
      g_ghgNextReport = TimeLocal() + 1800;   // retry later, trading is not affected
     }
  }
"""


def inject_report(src, job, version, api_base):
    token = job.get('report_token')
    if not token or not job.get('license_id'):
        return src
    url = api_base.rstrip('/') + '/api/ea/report'
    block = (REPORT_BLOCK.replace('__URL__', url).replace('__LIC__', str(int(job['license_id'])))
             .replace('__TOKEN__', re.sub(r'[^A-Za-z0-9_-]', '', token)).replace('__VERSION__', re.sub(r'[^0-9A-Za-z.]', '', version or '')))
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


def build(cfg, job):
    platform = job['platform']
    p = cfg.get(platform) or {}
    source = p.get('ea_source')
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
    target = os.path.join(jobdir, name + ext)
    with open(target, 'w', encoding='utf-8-sig', newline='\r\n') as f:
        f.write(licensed.replace('\r\n', '\n'))

    logfile = os.path.join(jobdir, 'compile.log')
    cmd = [p['metaeditor'], f'/compile:{target}', f'/inc:{p["mql_dir"]}', f'/log:{logfile}']
    subprocess.run(cmd, timeout=240)
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
            job = api(cfg, '/api/builder/claim', {'builder_id': builder_id, 'versions': source_versions(cfg)}).get('job')
            if job:
                handle(cfg, job)
                continue          # look for the next job right away
        except Exception as e:
            log(f'Tidak bisa menghubungi web: {e}')
        if once:
            break
        time.sleep(int(cfg.get('poll_seconds', 15)))


if __name__ == '__main__':
    main()
