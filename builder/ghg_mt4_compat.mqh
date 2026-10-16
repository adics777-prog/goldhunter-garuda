//+------------------------------------------------------------------+
//| GOLD HUNTER GARUDA - lapisan MT5 -> MT4                           |
//| Fungsi MQL5 yang dipakai EA ditiru dengan fungsi MQL4, sehingga   |
//| logika EA tetap SATU sumber (GOLD HUNTER GARUDA.mq5).             |
//| - posisi  = order pasar MT4 (OP_BUY / OP_SELL)                    |
//| - deal    = dibentuk dari order: tiket*2 = masuk, tiket*2+1 = keluar|
//| - OnTradeTransaction dipanggil oleh C4Poll() di awal OnTick/OnTimer|
//| - order MT4 selalu sinkron; mode async MT5 ditiru: hasil ditolak  |
//|   dikirim lewat TRADE_TRANSACTION_REQUEST pada poll berikutnya    |
//| - kalender berita tidak ada di MT4: fitur berita tidak aktif      |
//+------------------------------------------------------------------+
#define C4_MT4 1

//--- kode hasil order (sama dengan MT5)
#define TRADE_RETCODE_REQUOTE        10004
#define TRADE_RETCODE_REJECT         10006
#define TRADE_RETCODE_PLACED         10008
#define TRADE_RETCODE_DONE           10009
#define TRADE_RETCODE_DONE_PARTIAL   10010
#define TRADE_RETCODE_INVALID_VOLUME 10014
#define TRADE_RETCODE_INVALID_STOPS  10016
#define TRADE_RETCODE_TRADE_DISABLED 10017
#define TRADE_RETCODE_MARKET_CLOSED  10018
#define TRADE_RETCODE_NO_MONEY       10019
#define TRADE_RETCODE_PRICE_OFF      10021
#define TRADE_RETCODE_TOO_MANY_REQUESTS 10024
#define TRADE_RETCODE_FROZEN         10029
#define TRADE_RETCODE_CONNECTION     10031
#define TRADE_RETCODE_POSITION_CLOSED 10036
#define TRADE_RETCODE_LIMIT_POSITIONS 10040
#define LOG_LEVEL_ERRORS             1
#define ACCOUNT_MARGIN_MODE_RETAIL_HEDGING 2

enum ENUM_POSITION_TYPE { POSITION_TYPE_BUY = 0, POSITION_TYPE_SELL = 1 };
enum ENUM_POSITION_PROPERTY_INTEGER { POSITION_TICKET, POSITION_TIME, POSITION_TIME_MSC, POSITION_TYPE, POSITION_MAGIC, POSITION_IDENTIFIER };
enum ENUM_POSITION_PROPERTY_DOUBLE { POSITION_VOLUME, POSITION_PRICE_OPEN, POSITION_SL, POSITION_TP, POSITION_PRICE_CURRENT, POSITION_SWAP, POSITION_PROFIT };
enum ENUM_POSITION_PROPERTY_STRING { POSITION_SYMBOL, POSITION_COMMENT };
enum ENUM_DEAL_TYPE { DEAL_TYPE_BUY = 0, DEAL_TYPE_SELL = 1, DEAL_TYPE_BALANCE = 2, DEAL_TYPE_CREDIT = 3, DEAL_TYPE_CHARGE = 4, DEAL_TYPE_CORRECTION = 5, DEAL_TYPE_BONUS = 6 };
enum ENUM_DEAL_ENTRY { DEAL_ENTRY_IN = 0, DEAL_ENTRY_OUT = 1, DEAL_ENTRY_INOUT = 2, DEAL_ENTRY_OUT_BY = 3 };
enum ENUM_DEAL_PROPERTY_INTEGER { DEAL_TICKET, DEAL_ORDER, DEAL_TIME, DEAL_TIME_MSC, DEAL_TYPE, DEAL_ENTRY, DEAL_MAGIC, DEAL_POSITION_ID };
enum ENUM_DEAL_PROPERTY_DOUBLE { DEAL_VOLUME, DEAL_PRICE, DEAL_COMMISSION, DEAL_SWAP, DEAL_PROFIT, DEAL_FEE };
enum ENUM_DEAL_PROPERTY_STRING { DEAL_SYMBOL, DEAL_COMMENT };
enum ENUM_TRADE_TRANSACTION_TYPE { TRADE_TRANSACTION_DEAL_ADD = 6, TRADE_TRANSACTION_REQUEST = 10 };
enum ENUM_TRADE_REQUEST_ACTIONS { TRADE_ACTION_DEAL = 1, TRADE_ACTION_SLTP = 6 };

struct MqlTradeTransaction
  {
   ulong             deal;
   ulong             order;
   string            symbol;
   ENUM_TRADE_TRANSACTION_TYPE type;
   ulong             position;
  };
struct MqlTradeRequest
  {
   ENUM_TRADE_REQUEST_ACTIONS action;
   ulong             magic;
   string            symbol;
   double            volume;
   ulong             position;
  };
struct MqlTradeResult
  {
   uint              retcode;
   ulong             deal;
   ulong             order;
   double            price;
   string            comment;
  };

//--- kalender ekonomi: tidak tersedia di MT4 (fitur berita otomatis mati)
#define CALENDAR_IMPORTANCE_HIGH 3
struct MqlCalendarValue
  {
   ulong             id;
   ulong             event_id;
   datetime          time;
  };
struct MqlCalendarEvent
  {
   ulong             id;
   int               importance;
   string            name;
  };
int  CalendarValueHistory(MqlCalendarValue &v[], datetime from, datetime to, string country, string currency) { ArrayResize(v, 0); return 0; }
bool CalendarEventById(ulong id, MqlCalendarEvent &e) { return false; }

//+------------------------------------------------------------------+
//| array                                                            |
//+------------------------------------------------------------------+
template<typename T>
bool C4ArrayRemove(T &a[], const int start, const int count)
  {
   int n = ArraySize(a);
   if(start < 0 || start >= n || count <= 0)
      return false;
   int c = MathMin(count, n - start);
   for(int i = start; i + c < n; i++)
      a[i] = a[i + c];
   ArrayResize(a, n - c);
   return true;
  }

//+------------------------------------------------------------------+
//| POSISI = order pasar MT4                                         |
//+------------------------------------------------------------------+
int   g_c4Tk[];                 // daftar tiket dari PositionsTotal() terakhir
ulong g_c4Pos = 0;              // posisi yang sedang "dipilih"

bool C4SelPos()
  {
   return g_c4Pos > 0 && OrderSelect((int)g_c4Pos, SELECT_BY_TICKET) && OrderCloseTime() == 0 && OrderType() <= OP_SELL;
  }

int PositionsTotal()
  {
   int n = 0, tot = OrdersTotal();               // dibaca sekali: EA lain di terminal ini bisa menambah order di tengah loop
   ArrayResize(g_c4Tk, tot);
   for(int i = 0; i < tot && n < tot; i++)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderType() <= OP_SELL)
         g_c4Tk[n++] = OrderTicket();
   ArrayResize(g_c4Tk, n);
   return n;
  }

ulong PositionGetTicket(const int i)
  {
   if(i < 0 || i >= ArraySize(g_c4Tk))
      return 0;
   g_c4Pos = (ulong)g_c4Tk[i];
   return C4SelPos() ? g_c4Pos : 0;
  }

string PositionGetSymbol(const int i)
  {
   return PositionGetTicket(i) > 0 ? OrderSymbol() : "";
  }

bool PositionSelectByTicket(const ulong t)
  {
   g_c4Pos = t;
   return C4SelPos();
  }

long PositionGetInteger(const ENUM_POSITION_PROPERTY_INTEGER p)
  {
   if(!C4SelPos())
      return 0;
   switch(p)
     {
      case POSITION_TYPE:
         return OrderType() == OP_BUY ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
      case POSITION_MAGIC:
         return OrderMagicNumber();
      case POSITION_TIME:
         return (long)OrderOpenTime();
      case POSITION_TIME_MSC:
         return (long)OrderOpenTime() * 1000;      // MT4 tanpa milidetik: posisi dalam detik yang sama diurutkan EA menurut tiket
      default:
         return OrderTicket();
     }
  }

double PositionGetDouble(const ENUM_POSITION_PROPERTY_DOUBLE p)
  {
   if(!C4SelPos())
      return 0.0;
   switch(p)
     {
      case POSITION_VOLUME:
         return OrderLots();
      case POSITION_PRICE_OPEN:
         return OrderOpenPrice();
      case POSITION_SL:
         return OrderStopLoss();
      case POSITION_TP:
         return OrderTakeProfit();
      case POSITION_PRICE_CURRENT:
         return OrderClosePrice();
      case POSITION_SWAP:
         return OrderSwap();
      default:
         return OrderProfit();
     }
  }

string PositionGetString(const ENUM_POSITION_PROPERTY_STRING p)
  {
   if(!C4SelPos())
      return "";
   return p == POSITION_SYMBOL ? OrderSymbol() : OrderComment();
  }

//+------------------------------------------------------------------+
//| DEAL dari order MT4: tiket*2 = masuk, tiket*2+1 = keluar         |
//+------------------------------------------------------------------+
ulong    g_c4Sel[];             // hasil HistorySelect / HistorySelectByPosition
ulong    g_c4DT = 0;            // deal yang terakhir dimuat
long     g_c4DI[8];
double   g_c4DD[6];
string   g_c4DS[2];

bool C4DealLoad(const ulong d)
  {
   if(d == 0)
      return false;
   if(d == g_c4DT)
      return true;
   int t = (int)(d / 2);
   bool out = (d % 2) == 1;
   if(!OrderSelect(t, SELECT_BY_TICKET))
      return false;
   if(OrderType() == 6 || OrderType() == 7)
     {
      //--- deposit / penarikan (6) atau kredit (7): satu deal, tanpa posisi
      if(out)
         return false;
      g_c4DI[DEAL_TICKET] = (long)d;
      g_c4DI[DEAL_ORDER] = t;
      g_c4DI[DEAL_TIME] = (long)OrderOpenTime();
      g_c4DI[DEAL_TIME_MSC] = g_c4DI[DEAL_TIME] * 1000;
      g_c4DI[DEAL_TYPE] = OrderType() == 6 ? DEAL_TYPE_BALANCE : DEAL_TYPE_CREDIT;
      g_c4DI[DEAL_ENTRY] = DEAL_ENTRY_IN;
      g_c4DI[DEAL_MAGIC] = 0;
      g_c4DI[DEAL_POSITION_ID] = 0;
      g_c4DD[DEAL_VOLUME] = 0.0;
      g_c4DD[DEAL_PRICE] = 0.0;
      g_c4DD[DEAL_COMMISSION] = 0.0;
      g_c4DD[DEAL_SWAP] = 0.0;
      g_c4DD[DEAL_PROFIT] = OrderProfit();
      g_c4DD[DEAL_FEE] = 0.0;
      g_c4DS[DEAL_SYMBOL] = "";
      g_c4DS[DEAL_COMMENT] = OrderComment();
      g_c4DT = d;
      return true;
     }
   if(OrderType() > OP_SELL)
      return false;
   if(out && OrderCloseTime() == 0)
      return false;                                // posisi masih terbuka: belum ada deal keluar
   bool buy = OrderType() == OP_BUY;
   g_c4DI[DEAL_TICKET] = (long)d;
   g_c4DI[DEAL_ORDER] = t;
   g_c4DI[DEAL_TIME] = (long)(out ? OrderCloseTime() : OrderOpenTime());
   g_c4DI[DEAL_TIME_MSC] = g_c4DI[DEAL_TIME] * 1000;
   g_c4DI[DEAL_TYPE] = (buy != out) ? DEAL_TYPE_BUY : DEAL_TYPE_SELL;   // deal keluar posisi BUY = SELL
   g_c4DI[DEAL_ENTRY] = out ? DEAL_ENTRY_OUT : DEAL_ENTRY_IN;
   g_c4DI[DEAL_MAGIC] = OrderMagicNumber();
   g_c4DI[DEAL_POSITION_ID] = t;
   g_c4DD[DEAL_VOLUME] = OrderLots();
   g_c4DD[DEAL_PRICE] = out ? OrderClosePrice() : OrderOpenPrice();
   g_c4DD[DEAL_COMMISSION] = out ? OrderCommission() : 0.0;            // komisi MT4 dibukukan saat posisi tutup
   g_c4DD[DEAL_SWAP] = out ? OrderSwap() : 0.0;
   g_c4DD[DEAL_PROFIT] = out ? OrderProfit() : 0.0;
   g_c4DD[DEAL_FEE] = 0.0;
   g_c4DS[DEAL_SYMBOL] = OrderSymbol();
   g_c4DS[DEAL_COMMENT] = OrderComment();
   g_c4DT = d;
   return true;
  }

bool   HistoryDealSelect(const ulong d) { g_c4DT = 0; return C4DealLoad(d); }
long   HistoryDealGetInteger(const ulong d, const ENUM_DEAL_PROPERTY_INTEGER p) { return C4DealLoad(d) ? g_c4DI[p] : 0; }
double HistoryDealGetDouble(const ulong d, const ENUM_DEAL_PROPERTY_DOUBLE p) { return C4DealLoad(d) ? g_c4DD[p] : 0.0; }
string HistoryDealGetString(const ulong d, const ENUM_DEAL_PROPERTY_STRING p) { return C4DealLoad(d) ? g_c4DS[p] : ""; }
int    HistoryDealsTotal() { return ArraySize(g_c4Sel); }
ulong  HistoryDealGetTicket(const int i) { return i >= 0 && i < ArraySize(g_c4Sel) ? g_c4Sel[i] : 0; }

//--- deal antara from..to, urut waktu (riwayat MT4 = isi tab Account History: pilih "All History")
bool HistorySelect(const datetime from, const datetime to)
  {
   long key[];
   ulong tk[];
   int n = 0;
   int nt = OrdersTotal(), nh = OrdersHistoryTotal();
   ArrayResize(key, (nt + nh) * 2);
   ArrayResize(tk, (nt + nh) * 2);
   for(int i = 0; i < nt; i++)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderType() <= OP_SELL && OrderOpenTime() >= from && OrderOpenTime() <= to)
        {
         tk[n] = (ulong)OrderTicket() * 2;
         key[n] = (long)OrderOpenTime() * 4194304 + n;
         n++;
        }
   for(int i = 0; i < nh; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(OrderType() == 6 || OrderType() == 7)
        {
         if(OrderOpenTime() >= from && OrderOpenTime() <= to)
           {
            tk[n] = (ulong)OrderTicket() * 2;          // deposit / kredit
            key[n] = (long)OrderOpenTime() * 4194304 + n;
            n++;
           }
         continue;
        }
      if(OrderType() > OP_SELL)
         continue;
      if(OrderOpenTime() >= from && OrderOpenTime() <= to)
        {
         tk[n] = (ulong)OrderTicket() * 2;
         key[n] = (long)OrderOpenTime() * 4194304 + n;
         n++;
        }
      if(OrderCloseTime() >= from && OrderCloseTime() <= to)
        {
         tk[n] = (ulong)OrderTicket() * 2 + 1;
         key[n] = (long)OrderCloseTime() * 4194304 + n;
         n++;
        }
     }
   ArrayResize(key, n);
   ArraySort(key);
   ArrayResize(g_c4Sel, n);
   for(int i = 0; i < n; i++)
      g_c4Sel[i] = tk[(int)(key[i] % 4194304)];
   g_c4DT = 0;
   return true;
  }

bool HistorySelectByPosition(const ulong pid)
  {
   ArrayResize(g_c4Sel, 0);
   g_c4DT = 0;
   if(!OrderSelect((int)pid, SELECT_BY_TICKET))
      return false;
   ArrayResize(g_c4Sel, OrderCloseTime() > 0 ? 2 : 1);
   g_c4Sel[0] = pid * 2;
   if(OrderCloseTime() > 0)
      g_c4Sel[1] = pid * 2 + 1;
   return true;
  }

//+------------------------------------------------------------------+
//| CTrade tiruan (order MT4 sinkron)                                |
//+------------------------------------------------------------------+
MqlTradeRequest g_c4QReq[];     // penolakan yang dikirim ke EA sebagai TRADE_TRANSACTION_REQUEST
MqlTradeResult  g_c4QRes[];

uint C4Code(const int e)
  {
   switch(e)
     {
      case 0:
      case 1:
         return TRADE_RETCODE_DONE;                 // 1 = tidak ada yang berubah (TP sudah sama)
      case 129:
      case 135:
      case 138:
         return TRADE_RETCODE_REQUOTE;
      case 136:
         return TRADE_RETCODE_PRICE_OFF;
      case 130:
         return TRADE_RETCODE_INVALID_STOPS;
      case 131:
         return TRADE_RETCODE_INVALID_VOLUME;
      case 132:
         return TRADE_RETCODE_MARKET_CLOSED;
      case 133:
         return TRADE_RETCODE_TRADE_DISABLED;
      case 134:
         return TRADE_RETCODE_NO_MONEY;
      case 141:
         return TRADE_RETCODE_TOO_MANY_REQUESTS;
      case 145:
         return TRADE_RETCODE_FROZEN;
      case 148:
         return TRADE_RETCODE_LIMIT_POSITIONS;
      case 4108:
         return TRADE_RETCODE_POSITION_CLOSED;
      case 6:
      case 128:
      case 146:
         return TRADE_RETCODE_CONNECTION;
     }
   return TRADE_RETCODE_REJECT;
  }

//--- satu terminal MT4 = satu jalur order: tunggu bila EA lain (12 setup) sedang mengirim
bool C4Ctx(const uint maxMs = 3000)
  {
   uint t0 = GetTickCount();
   while(IsTradeContextBusy() && GetTickCount() - t0 < maxMs)
      Sleep(5);
   RefreshRates();
   return !IsTradeContextBusy();
  }

class CTrade
  {
private:
   int               m_magic;
   int               m_dev;
   bool              m_async;
   uint              m_rc;
   double            m_price;
   string            m_desc;
   void              Fail(const int err, const ENUM_TRADE_REQUEST_ACTIONS act, const string sym, const ulong pos, const double vol)
     {
      m_rc = C4Code(err);
      m_desc = StringFormat("MT4 error %d", err);
      if(!m_async)
         return;
      //--- MT5 async: perintah diterima, hasil penolakan datang belakangan lewat OnTradeTransaction
      int n = ArraySize(g_c4QReq);
      ArrayResize(g_c4QReq, n + 1);
      ArrayResize(g_c4QRes, n + 1);
      g_c4QReq[n].action = act;
      g_c4QReq[n].magic = (ulong)m_magic;
      g_c4QReq[n].symbol = sym;
      g_c4QReq[n].volume = vol;
      g_c4QReq[n].position = pos;
      g_c4QRes[n].retcode = m_rc;
      g_c4QRes[n].comment = m_desc;
      m_rc = TRADE_RETCODE_PLACED;
     }
   bool              Open(const int type, const double lot, const string sym, const string cmt)
     {
      m_price = 0.0;
      for(int a = 0; a < 3; a++)
        {
         if(!C4Ctx())
            continue;
         double px = type == OP_BUY ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID);
         int t = OrderSend(sym, type, lot, NormalizeDouble(px, (int)MarketInfo(sym, MODE_DIGITS)), m_dev, 0, 0, cmt, m_magic, 0, clrNONE);
         if(t > 0)
           {
            m_rc = TRADE_RETCODE_DONE;
            m_desc = "done";
            if(OrderSelect(t, SELECT_BY_TICKET))
               m_price = OrderOpenPrice();
            return true;
           }
         int e = GetLastError();
         if(e != 129 && e != 135 && e != 136 && e != 138 && e != 146)
           {
            Fail(e, TRADE_ACTION_DEAL, sym, 0, lot);
            return m_rc == TRADE_RETCODE_PLACED;
           }
        }
      Fail(138, TRADE_ACTION_DEAL, sym, 0, lot);
      return m_rc == TRADE_RETCODE_PLACED;
     }
public:
                     CTrade() : m_magic(0), m_dev(10), m_async(false), m_rc(0), m_price(0.0), m_desc("") {}
   void              SetExpertMagicNumber(const ulong m) { m_magic = (int)m; }
   void              SetDeviationInPoints(const ulong d) { m_dev = (int)d; }
   void              SetTypeFillingBySymbol(const string s) {}
   void              SetMarginMode() {}
   void              LogLevel(const int l) {}
   void              SetAsyncMode(const bool a) { m_async = a; }
   uint              ResultRetcode() { return m_rc; }
   string            ResultRetcodeDescription() { return m_desc; }
   double            ResultPrice() { return m_price; }
   bool              Buy(const double lot, const string sym, const double price, const double sl, const double tp, const string cmt) { return Open(OP_BUY, lot, sym, cmt); }
   bool              Sell(const double lot, const string sym, const double price, const double sl, const double tp, const string cmt) { return Open(OP_SELL, lot, sym, cmt); }
   bool              PositionClose(const ulong ticket)
     {
      for(int a = 0; a < 3; a++)
        {
         if(!OrderSelect((int)ticket, SELECT_BY_TICKET) || OrderCloseTime() > 0)
           {
            Fail(4108, TRADE_ACTION_DEAL, _Symbol, ticket, 0.0);
            return m_rc == TRADE_RETCODE_PLACED;
           }
         if(!C4Ctx())
            continue;
         if(!OrderSelect((int)ticket, SELECT_BY_TICKET))
            continue;
         string sym = OrderSymbol();
         double px = OrderType() == OP_BUY ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
         if(OrderClose((int)ticket, OrderLots(), NormalizeDouble(px, (int)MarketInfo(sym, MODE_DIGITS)), m_dev, clrNONE))
           {
            m_rc = m_async ? TRADE_RETCODE_PLACED : TRADE_RETCODE_DONE;
            m_desc = "done";
            return true;
           }
         int e = GetLastError();
         if(e != 129 && e != 135 && e != 136 && e != 138 && e != 146)
           {
            Fail(e, TRADE_ACTION_DEAL, sym, ticket, OrderLots());
            return m_rc == TRADE_RETCODE_PLACED;
           }
        }
      Fail(138, TRADE_ACTION_DEAL, _Symbol, ticket, 0.0);
      return m_rc == TRADE_RETCODE_PLACED;
     }
   bool              PositionModify(const ulong ticket, const double sl, const double tp)
     {
      if(!OrderSelect((int)ticket, SELECT_BY_TICKET) || OrderCloseTime() > 0)
        {
         Fail(4108, TRADE_ACTION_SLTP, _Symbol, ticket, 0.0);
         return m_rc == TRADE_RETCODE_PLACED;
        }
      string sym = OrderSymbol();
      int dg = (int)MarketInfo(sym, MODE_DIGITS);
      double op = OrderOpenPrice();
      if(!C4Ctx(300))
        {
         Fail(146, TRADE_ACTION_SLTP, sym, ticket, 0.0);   // jalur order dipakai EA lain: TP dikirim lagi tick berikutnya
         return m_rc == TRADE_RETCODE_PLACED;
        }
      if(OrderModify((int)ticket, op, NormalizeDouble(sl, dg), NormalizeDouble(tp, dg), 0, clrNONE))
        {
         m_rc = m_async ? TRADE_RETCODE_PLACED : TRADE_RETCODE_DONE;
         m_desc = "done";
         return true;
        }
      int e = GetLastError();
      if(e == 1)
        {
         m_rc = m_async ? TRADE_RETCODE_PLACED : TRADE_RETCODE_DONE;
         return true;
        }
      Fail(e, TRADE_ACTION_SLTP, sym, ticket, 0.0);
      return m_rc == TRADE_RETCODE_PLACED;
     }
  };

bool OrderCalcMargin(const int type, const string sym, const double lot, const double price, double &margin)
  {
   margin = MarketInfo(sym, MODE_MARGINREQUIRED) * lot;
   return margin > 0.0;
  }

//+------------------------------------------------------------------+
//| indikator: handle iMA tiruan + CopyBuffer                        |
//+------------------------------------------------------------------+
string g_c4IS[];
int    g_c4IT[], g_c4IP[], g_c4IM[], g_c4IA[];

int C4iMA(const string sym, const ENUM_TIMEFRAMES tf, const int per, const int shift, const ENUM_MA_METHOD m, const int ap)
  {
   int n = ArraySize(g_c4IS);
   ArrayResize(g_c4IS, n + 1);
   ArrayResize(g_c4IT, n + 1);
   ArrayResize(g_c4IP, n + 1);
   ArrayResize(g_c4IM, n + 1);
   ArrayResize(g_c4IA, n + 1);
   g_c4IS[n] = sym;
   g_c4IT[n] = (int)tf;
   g_c4IP[n] = per;
   g_c4IM[n] = (int)m;
   g_c4IA[n] = ap;
   return n;
  }

bool C4Release(const int h) { return true; }

int C4CopyBuffer(const int h, const int buf, const int start, int count, double &arr[])
  {
   if(h < 0 || h >= ArraySize(g_c4IS))
      return -1;
   int bars = iBars(g_c4IS[h], g_c4IT[h]);
   if(start + count > bars)
      count = bars - start;
   if(count <= 0 || bars < g_c4IP[h])
      return -1;
   if(ArraySize(arr) < count)
      ArrayResize(arr, count);
   bool ser = ArrayGetAsSeries(arr);
   int sz = ArraySize(arr);
   for(int i = 0; i < count; i++)
     {
      double v = iMA(g_c4IS[h], g_c4IT[h], g_c4IP[h], 0, g_c4IM[h], g_c4IA[h], start + i);
      if(ser)
         arr[i] = v;
      else
         arr[count - 1 - i] = v;
     }
   return count;
  }

//+------------------------------------------------------------------+
//| OnTradeTransaction tiruan: posisi baru / posisi tertutup          |
//+------------------------------------------------------------------+
int  g_c4Prev[];
bool g_c4Seeded = false;
int  g_c4Miss[];                // posisi hilang tapi belum ada di riwayat: berapa kali sudah dicoba
int  g_c4MissT[];

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result);

void C4Emit(const ulong deal, const string sym, const ulong pos)
  {
   MqlTradeTransaction tr;
   MqlTradeRequest rq;
   MqlTradeResult rs;
   tr.type = TRADE_TRANSACTION_DEAL_ADD;
   tr.deal = deal;
   tr.order = pos;
   tr.symbol = sym;
   tr.position = pos;
   OnTradeTransaction(tr, rq, rs);
  }

bool C4Has(const int &a[], const int v)
  {
   for(int i = ArraySize(a) - 1; i >= 0; i--)
      if(a[i] == v)
         return true;
   return false;
  }

void C4Poll()
  {
   //--- penolakan order (mode async) dikirim lebih dulu
   int nq = ArraySize(g_c4QReq);
   if(nq > 0)
     {
      MqlTradeRequest rq[];
      MqlTradeResult rs[];
      ArrayResize(rq, nq);
      ArrayResize(rs, nq);
      for(int i = 0; i < nq; i++)
        {
         rq[i] = g_c4QReq[i];
         rs[i] = g_c4QRes[i];
        }
      ArrayResize(g_c4QReq, 0);
      ArrayResize(g_c4QRes, 0);
      for(int i = 0; i < nq; i++)
        {
         MqlTradeTransaction tr;
         tr.type = TRADE_TRANSACTION_REQUEST;
         tr.symbol = rq[i].symbol;
         tr.position = rq[i].position;
         OnTradeTransaction(tr, rq[i], rs[i]);
        }
     }
   int cur[];
   string csym[];
   int n = 0, tot = OrdersTotal();
   ArrayResize(cur, tot);
   ArrayResize(csym, tot);
   for(int i = 0; i < tot && n < tot; i++)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderType() <= OP_SELL)
        {
         cur[n] = OrderTicket();
         csym[n] = OrderSymbol();
         n++;
        }
   ArrayResize(cur, n);
   if(!g_c4Seeded)
     {
      ArrayCopy(g_c4Prev, cur);
      ArrayResize(g_c4Prev, n);
      g_c4Seeded = true;
      return;
     }
   //--- posisi baru -> deal masuk
   for(int i = 0; i < n; i++)
      if(!C4Has(g_c4Prev, cur[i]))
         C4Emit((ulong)cur[i] * 2, csym[i], (ulong)cur[i]);
   //--- posisi hilang -> deal keluar (dari riwayat)
   int keep[];
   ArrayResize(keep, 0);
   for(int i = 0; i < ArraySize(g_c4Prev); i++)
     {
      int t = g_c4Prev[i];
      if(C4Has(cur, t))
         continue;
      if(OrderSelect(t, SELECT_BY_TICKET) && OrderCloseTime() > 0)
        {
         g_c4DT = 0;
         C4Emit((ulong)t * 2 + 1, OrderSymbol(), (ulong)t);
        }
      else
        {
         int m = -1;
         for(int q = 0; q < ArraySize(g_c4MissT); q++)
            if(g_c4MissT[q] == t)
               m = q;
         if(m < 0)
           {
            m = ArraySize(g_c4MissT);
            ArrayResize(g_c4MissT, m + 1);
            ArrayResize(g_c4Miss, m + 1);
            g_c4MissT[m] = t;
            g_c4Miss[m] = 0;
           }
         if(++g_c4Miss[m] > 600)
           {
            PrintFormat("MT4: posisi #%d sudah tertutup tapi tidak ada di riwayat akun. Atur tab Account History = All History.", t);
            continue;
           }
         int k = ArraySize(keep);
         ArrayResize(keep, k + 1);
         keep[k] = t;                              // riwayat belum terisi: dicek lagi poll berikutnya
        }
     }
   ArrayCopy(g_c4Prev, cur);
   ArrayResize(g_c4Prev, n);
   for(int i = 0; i < ArraySize(keep); i++)
     {
      int k = ArraySize(g_c4Prev);
      ArrayResize(g_c4Prev, k + 1);
      g_c4Prev[k] = keep[i];
     }
  }

//+------------------------------------------------------------------+
//| jam server: selisih broker dipelajari dari tick yang hidup (OnTick)|
//+------------------------------------------------------------------+
void C4SrvOffTick()
  {
   static datetime last = 0;
   if(TimeLocal() - last < 60)
      return;
   last = TimeLocal();
   GlobalVariableSet("GHG_SRVOFF", MathRound((TimeCurrent() - TimeGMT()) / 900.0) * 900);
  }

datetime C4TimeTradeServer()
  {
   long off = GlobalVariableCheck("GHG_SRVOFF") ? (long)GlobalVariableGet("GHG_SRVOFF") : (long)MathRound((TimeCurrent() - TimeGMT()) / 900.0) * 900;
   return TimeGMT() + (datetime)off;
  }

//--- catatan khusus MT4 saat EA dipasang
bool C4InitCheck(const long magic, const bool newsHold)
  {
   if(magic > 2147483647 || magic < 0)
     {
      Alert("GOLD HUNTER GARUDA MT4: nomor EA (1.1) maksimal 2147483647.");
      return false;
     }
   Print("MT4: tab Account History di terminal harus = All History, supaya profit, anggaran & laporan web lengkap.");
   if(newsHold)
      Print("MT4: kalender berita tidak ada di MT4 -> mode TAHAN berita (10.1) tidak bekerja, EA tetap trading saat berita.");
   return true;
  }
