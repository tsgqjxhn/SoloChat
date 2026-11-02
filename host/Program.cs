using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SoloChatHost
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            SetupEmbedded();
            MainForm.PurgeLegacyLog(); // F1：删除旧版遗留明文日志
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (s, e) => MainForm.Log("threadex: " + e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => MainForm.Log("appdomain: " + e.ExceptionObject);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(FindAppDir(args)));
        }

        /* 单文件运行时目录：用户私有（非公共 %TEMP%，防本机低权限进程抢占/侧载） */
        static string RuntimeDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage", "runtime"); }
        }

        /* 定位 index.html：
           ① 命令行显式指定目录 → 优先（开发/测试用）
           ② DEBUG 构建才向上层搜索（兼容 dotnet run / 源码布局）
           ③ Release 一律用内嵌资源释放到私有运行时目录
           —— 修复：Release 下不再向上盲搜父目录，避免 Downloads/桌面等位置的恶意 index.html 被劫持为宿主桥页面 */
        static string FindAppDir(string[] args)
        {
            if (args.Length > 0 && File.Exists(Path.Combine(args[0], "index.html")))
                return Path.GetFullPath(args[0]);
#if DEBUG
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            for (int i = 0; i < 8 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir.FullName, "index.html"))) return dir.FullName;
                dir = dir.Parent;
            }
#endif
            var rt = RuntimeDir;
            try
            {
                Directory.CreateDirectory(rt);
                using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("emb.index.html"))
                using (var fs = File.Create(Path.Combine(rt, "index.html"))) { st.CopyTo(fs); }
            }
            catch { if (!File.Exists(Path.Combine(rt, "index.html"))) throw; }
            return rt;
        }

        /* 单文件模式支撑：托管依赖从嵌入资源按需加载；native WebView2Loader 始终释放到私有目录并设为 DLL 搜索路径
           —— 修复：不再信任 exe 同目录（如 Downloads）的 WebView2Loader.dll，防 DLL 侧载 */
        static void SetupEmbedded()
        {
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                try
                {
                    var n = new AssemblyName(e.Name).Name + ".dll";
                    using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("emb." + n))
                    {
                        if (st == null) return null;
                        using (var ms = new MemoryStream()) { st.CopyTo(ms); return Assembly.Load(ms.ToArray()); }
                    }
                }
                catch { return null; }
            };
            var dir = RuntimeDir;
            try
            {
                Directory.CreateDirectory(dir);
                using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("emb.WebView2Loader.dll"))
                using (var fs = File.Create(Path.Combine(dir, "WebView2Loader.dll"))) { st.CopyTo(fs); }
                SetDllDirectory(dir);
            }
            catch { }
        }

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool SetDllDirectory(string path);
    }

    public class MainForm : Form
    {
        /* F2：调试端口与 DevTools 仅 DEBUG 构建可用；Release 不开 9222、不开 DevTools（本机威胁模型：任意本机进程可附加读 Key） */
#if DEBUG
        const bool DevMode = true;
        const string DebugArgs = "--remote-debugging-port=9222 --enable-precise-memory-info --disable-gpu --in-process-gpu --js-flags=--expose-gc";
#else
        const bool DevMode = false;
        const string DebugArgs = "--disable-gpu --in-process-gpu";
#endif

        readonly string appDir;
        WebView2 wv;
        CoreWebView2Environment env; // v0.2.3：播放窗口复用同一环境（共享 cookie/登录态）
        QuickBarForm quickBar;
        NotifyIcon tray;
        bool realExit;
        bool hotReg;
        int lastHotTick; // v0.2.0：热键去抖（一次按键只处理一次）
        bool memLow;
        bool busy; // v2.2：页面有生成在跑（busy 消息），期间不进低内存态
        IntPtr hotHwnd;
        const int WM_HOTKEY = 0x0312;
        const int HOTKEY_ID = 0x5C1;
        readonly ConcurrentDictionary<string, CancellationTokenSource> inflight =
            new ConcurrentDictionary<string, CancellationTokenSource>();
        static readonly HttpClient Http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        /* 页面 设置 → 代理：留空走系统默认（Http 原样）；按值缓存，配置变化即重建 handler */
        static volatile HttpClient proxyHttp;
        static volatile string proxyKey;
        /* v3.0：直连客户端（忽略系统与显式代理），供「直连例外」域名使用 */
        static readonly HttpClient DirectHttp = new HttpClient(new HttpClientHandler { UseProxy = false })
        { Timeout = Timeout.InfiniteTimeSpan };
        /* v1.0.1：命令审计 —— 每次执行（含拒绝/超时）落一行，限长滚动 */
    static readonly object AuditLock = new object();
    static string AuditPath
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage", "logs", "solo-cmd.log"); }
    }
    static void Audit(string cwd, string cmdline, string result)
    {
        try
        {
            lock (AuditLock)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(AuditPath));
                if (File.Exists(AuditPath) && new FileInfo(AuditPath).Length > 512 * 1024) File.Delete(AuditPath);
                File.AppendAllText(AuditPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\tcwd=" + cwd + "\t" + result + "\t" + cmdline + "\n", Encoding.UTF8);
            }
        }
        catch { }
    }
    static string[] ReadAudit(int max)
    {
        try
        {
            if (!File.Exists(AuditPath)) return new string[0];
            string[] all;
            lock (AuditLock) all = File.ReadAllLines(AuditPath, Encoding.UTF8);
            if (all.Length <= max) return all;
            var tail = new string[max];
            Array.Copy(all, all.Length - max, tail, 0, max);
            return tail;
        }
        catch { return new string[0]; }
    }

    /* v1.0.0：回环/内网域名走直连，别被用户代理设置挡掉 */
    static bool IsLoopbackHost(string url)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(url)) return false;
            var u = new Uri(url);
            string h = u.Host.ToLowerInvariant();
            if (h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" || h.EndsWith(".local")) return true;
            if (System.Net.IPAddress.TryParse(u.Host, out var ip))
                return System.Net.IPAddress.IsLoopback(ip);
            return false;
        }
        catch { return false; }
    }

    static HttpClient ClientFor(string proxy)
        {
            proxy = (proxy ?? "").Trim();
            if (proxy.Length == 0) return Http;
            if (proxy.IndexOf("://", StringComparison.Ordinal) < 0) proxy = "http://" + proxy;
            if (string.Equals(proxy, proxyKey, StringComparison.Ordinal)) return proxyHttp ?? Http;
            try
            {
                var uri = new Uri(proxy);
                var addr = uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.Unescaped);
                var handler = new HttpClientHandler { UseProxy = true, Proxy = new System.Net.WebProxy(addr) };
                if (uri.UserInfo.Length > 0)
                {
                    var up = uri.UserInfo.Split(new[] { ':' }, 2);
                    handler.Proxy.Credentials = new System.Net.NetworkCredential(
                        Uri.UnescapeDataString(up[0]), up.Length > 1 ? Uri.UnescapeDataString(up[1]) : "");
                }
                var c = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
                proxyKey = proxy; proxyHttp = c;
                return c;
            }
            catch (Exception ex)
            {
                Log("proxy invalid (" + ex.GetType().Name + ")，回退系统代理");
                proxyKey = proxy; proxyHttp = null;
                return Http;
            }
        }
        static readonly List<string> wsRoots = new List<string>(); // 已授权工作区根目录（只能经宿主对话框添加，页面按会话引用其一）
        static Point? qbPos;  // 快速输入条自绘位置（记住上次消失的位置）

        public MainForm(string appDir)
        {
            this.appDir = appDir;
            LoadHostCfg();
            FormBorderStyle = FormBorderStyle.None; // v1.2：去原生标题栏，窗控移入页面顶栏右上角
            Text = "SoloChat · AI 对话";
            ClientSize = new System.Drawing.Size(1280, 840);
            StartPosition = FormStartPosition.CenterScreen;
            wv = new WebView2();
            wv.Dock = DockStyle.Fill;
            Controls.Add(wv);
            try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            /* 内存压缩（v1.2.2）：隐藏到托盘/最小化 → Low（Chromium 激进释放）；恢复显示 → Normal */
            Resize += (s, e) => SyncMemTarget();
            VisibleChanged += (s, e) => SyncMemTarget();
            Load += async (s, e) => await InitAsync();
        }

        async Task InitAsync()
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "OpenPage", "WebView2"); // 目录名沿用旧项目名：内含用户全部数据（IndexedDB/localStorage），改名即清档，故保留
            env = await CoreWebView2Environment.CreateAsync(null, userData,
                new CoreWebView2EnvironmentOptions(DebugArgs));
            await wv.EnsureCoreWebView2Async(env);

            var s = wv.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.AreDevToolsEnabled = DevMode;
            s.AreBrowserAcceleratorKeysEnabled = true;  // 必须开：关掉会连 Ctrl+C/V/X/A 一起失效（回答复制不了）

            var core = wv.CoreWebView2;
            /* 关键：虚拟主机映射 → origin 为 https://app.local（安全上下文，IDB/crypto.subtle 可用） */
            core.SetVirtualHostNameToFolderMapping(
                "app.local", appDir, CoreWebView2HostResourceAccessKind.DenyCors);
            core.WebMessageReceived += OnWebMessage;
            core.NewWindowRequested += OnNewWindow;
            core.NavigationStarting += (o, e) =>
            {
                // 防导航逃逸：仅允许虚拟主机内的页面（精确校验 scheme + host，防 app.local.evil.com 子域名绕过）
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri u) ||
                    u.Scheme != "https" ||
                    !string.Equals(u.Host, "app.local", StringComparison.OrdinalIgnoreCase))
                {
                    e.Cancel = true;
                }
            };
            wv.Source = new Uri("https://app.local/index.html");
            quickBar = new QuickBarForm(this); // 可见性由页面 cfg（quickbar 消息）驱动
        }

        /* 无边框但保留缩放边（WS_THICKFRAME）：四边仍可拉伸，无标题栏 */
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.Style |= 0x00040000; return cp; }
        }

        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();

        /* 页面顶栏窗控：min / max / close(隐藏到托盘) / drag(HTCAPTION 拖动，双击最大化、支持 Aero Snap) */
        void WinAct(string act)
        {
            if (act == "min") WindowState = FormWindowState.Minimized;
            else if (act == "max")
            {
                MaximizedBounds = Screen.FromControl(this).WorkingArea;
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            }
            else if (act == "close") { Hide(); try { EnsureTray(); } catch { } }
            else if (act == "drag") { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)0x2, IntPtr.Zero); }
            else if (act == "datadir")   /* v3.0：设置 → 关于「打开数据目录」 */
            {
                try
                {
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage");
                    if (Directory.Exists(dir))
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = dir, UseShellExecute = true });
                }
                catch (Exception ex) { Log("open datadir failed: " + ex.Message); }
            }
        }

        /* 页面 → 宿主的自由消息（快速提问等） */
        public void PostRaw(string json)
        {
            try { BeginInvoke((Action)(() => wv.CoreWebView2.PostWebMessageAsJson(json))); }
            catch { }
        }

        /* 快速输入条显隐结果静默同步回页面（持久化 cfg.quickbar，下次启动保持一致） */
        public void QuickbarSync(bool show)
        {
            PostRaw(JsonSerializer.Serialize(new { t = "quickbar.sync", show }));
        }

        public Point? LoadQuickbarPos() { return qbPos; }
        public void SaveQuickbarPos(Point p) { if (!qbPos.HasValue || qbPos.Value != p) { qbPos = p; SaveHostCfg(); } }

        /* ---- 关闭即托盘常驻：X 隐藏窗口，托盘菜单里才是真退出 ---- */
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            MainForm.Log("formclosing reason=" + e.CloseReason + " realExit=" + realExit);
            /* 除系统关机与程序调用退出外，一律隐藏到托盘；真退出走托盘菜单「退出」 */
            if (!realExit && e.CloseReason != CloseReason.WindowsShutDown && e.CloseReason != CloseReason.ApplicationExitCall)
            {
                e.Cancel = true;
                Hide();
                try { EnsureTray(); } catch (Exception ex) { MainForm.Log("tray err: " + ex); }
                MainForm.Log("close -> tray");
                return;
            }
            if (tray != null) { tray.Visible = false; tray.Dispose(); tray = null; }
            if (hotReg) UnregisterHotKey(Handle, HOTKEY_ID);
            base.OnFormClosing(e);
        }

        void EnsureTray()
        {
            if (tray != null) { tray.Visible = true; return; }
            tray = new NotifyIcon
            {
                Icon = Icon,
                Text = "SoloChat",
                Visible = true
            };
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示主窗", null, (s, e) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
            menu.Items.Add("显示快速输入条", null, (s, e) => quickBar.Summon());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, (s, e) => { realExit = true; Close(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => { Show(); WindowState = FormWindowState.Normal; Activate(); };
        }

        /* ---- 内存压缩：仅状态切换时下发，避免 Resize 高频重复设置 ---- */
        [System.Runtime.InteropServices.DllImport("psapi.dll")]
        static extern int EmptyWorkingSet(System.IntPtr hProc);
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern System.IntPtr GetCurrentProcess();
        void SyncMemTarget() { SetMemTarget(!busy && (!Visible || WindowState == FormWindowState.Minimized)); }
        void SetMemTarget(bool low)
        {
            if (busy) low = false; // v2.2：有生成在跑 → 保持 Normal，别把 WebView 压进低内存态
            if (low == memLow) return;
            memLow = low;
            try
            {
                if (wv == null || wv.CoreWebView2 == null) return;
                wv.CoreWebView2.MemoryUsageTargetLevel = low
                    ? CoreWebView2MemoryUsageTargetLevel.Low
                    : CoreWebView2MemoryUsageTargetLevel.Normal;
                Log("memtarget -> " + (low ? "low" : "normal"));
                if (low)
                {
                    // 隐藏时追加两刀：① 渲染进程 JS 堆强制 GC（--js-flags=--expose-gc，仅 DEBUG 构建注入该 flag）② 宿主自身工作集压出
#if DEBUG
                    try { _ = wv.CoreWebView2.ExecuteScriptAsync("window.gc && window.gc()"); } catch { }
#endif
                    try { EmptyWorkingSet(GetCurrentProcess()); } catch { }
                }
            }
            catch (Exception ex) { Log("memtarget err: " + ex.Message); }
        }

        /* ---- 全局热键：召唤快速输入条（组合键由页面 cfg 下发） ---- */
        public void ApplyHotkey(string combo)
        {
            try
            {
                if (hotReg) { UnregisterHotKey(Handle, HOTKEY_ID); hotReg = false; }
                hotHwnd = Handle;
                uint mods, vk;
                hotReg = TryParseCombo(combo, out mods, out vk) && RegisterHotKey(Handle, HOTKEY_ID, mods, vk);
                if (!hotReg)
                {
                    var err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
                    MainForm.Log("hotkey '" + combo + "' FAILED err=" + err + " (1409=已被占用)");
                    PostRaw(JsonSerializer.Serialize(new { t = "hotkey.result", ok = false, combo = combo ?? "", err = err }));
                }
                else
                {
                    MainForm.Log("hotkey '" + combo + "' registered");
                    PostRaw(JsonSerializer.Serialize(new { t = "hotkey.result", ok = true, combo = combo ?? "" }));
                }
            }
            catch (Exception ex) { MainForm.Log("hotkey err: " + ex.Message); }
        }

        static bool TryParseCombo(string combo, out uint mods, out uint vk)
        {
            mods = 0; vk = 0;
            if (string.IsNullOrEmpty(combo)) return false;
            uint m = 0; string key = null;
            foreach (var part in combo.Split('+'))
            {
                var s = part.Trim();
                if (s.Equals("Ctrl", StringComparison.OrdinalIgnoreCase)) m |= 2;       // MOD_CONTROL
                else if (s.Equals("Alt", StringComparison.OrdinalIgnoreCase)) m |= 1;   // MOD_ALT
                else if (s.Equals("Shift", StringComparison.OrdinalIgnoreCase)) m |= 4; // MOD_SHIFT
                else if (s.Equals("Meta", StringComparison.OrdinalIgnoreCase) || s.Equals("Win", StringComparison.OrdinalIgnoreCase)) m |= 8; // MOD_WIN
                else key = s;
            }
            if (key == null || m == 0) return false;
            if (key.Length == 1)
            {
                var c = char.ToUpper(key[0]);
                if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) vk = (uint)c;
                else return false;
            }
            else if (key.Length >= 2 && (key[0] == 'F' || key[0] == 'f') &&
                     int.TryParse(key.Substring(1), out var f) && f >= 1 && f <= 24) vk = (uint)(0x70 + f - 1);
            else if (key.Equals("Space", StringComparison.OrdinalIgnoreCase)) vk = 0x20;
            else return false;
            mods = m;
            return true;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
        [DllImport("user32.dll")]
        static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [StructLayout(LayoutKind.Sequential)]
        internal struct RECT { public int L, T, R, B; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct POINTL { public int x, y; }
        [StructLayout(LayoutKind.Sequential)]
        internal struct MINMAXINFO { public POINTL ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize; }
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
        static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
        static extern int GetWindowLong32(IntPtr h, int i);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
        static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
        static extern int SetWindowLong32(IntPtr h, int i, int v);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

        const int GWL_STYLE = -16;
        const long WS_CAPTION = 0x00C00000L; // WS_BORDER | WS_DLGFRAME
        const uint SWP_FRAMECHANGED = 0x0020, SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001,
                   SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

        long GetStyle() { return IntPtr.Size == 8 ? GetWindowLongPtr(Handle, GWL_STYLE).ToInt64() : GetWindowLong32(Handle, GWL_STYLE); }
        void SetWinStyle(long v)
        {
            if (IntPtr.Size == 8) SetWindowLongPtr(Handle, GWL_STYLE, new IntPtr(v));
            else SetWindowLong32(Handle, GWL_STYLE, (int)v);
        }

        /* v1.9：最大化时给窗口补回 WS_CAPTION 样式位（还原时移除）。
           根因（本机对照实测）：FormBorderStyle.None 让最大化窗口缺 WS_CAPTION，
           Explorer 据此把「铺满屏幕且无标题栏样式」的前台窗口判为全屏应用，抑制自适应
           任务栏的悬停弹出。同一 rect 下，带 WS_CAPTION 的标准可缩放窗能正常弹出、
           本窗口不能；运行时补上该位后立即恢复弹出（client 仍 1536×864 全出血）。
           客户区由 WM_NCCALCSIZE 钉在工作区，故补样式位不会长出标题栏、视觉不变。 */
        void SyncCaptionForMax()
        {
            if (!IsHandleCreated) return;
            long st = GetStyle();
            bool zoomed = IsZoomed(Handle) || (st & 0x01000000L) != 0; // WS_MAXIMIZE
            bool hasCap = (st & WS_CAPTION) != 0;
            if (zoomed == hasCap) return; // 状态已一致
            SetWinStyle(zoomed ? (st | WS_CAPTION) : (st & ~WS_CAPTION));
            SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }

        protected override void WndProc(ref Message m)
        {
            /* 全出血客户区（去标题栏 v1.2）：吞掉 NCCALCSIZE 消除边框留白（顶部深色边与四周空隙） */
            if (m.Msg == 0x0083 && m.WParam != IntPtr.Zero) // WM_NCCALCSIZE
            {
                if (WindowState == FormWindowState.Maximized)
                {
                    /* v1.8：客户区直接钉到目标显示器的工作区（原按边宽盲目内缩）。
                       修：Win11 自适应任务栏悬停底部不弹——保证屏幕底边像素归属客户区，
                       鼠标贴底收到的是客户区 WM_MOUSEMOVE（任务栏弹出检测依赖它），
                       非客户死区条不会再把底边热区吃掉。 */
                    var rc = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
                    var wa = Screen.FromRectangle(new Rectangle(rc.L, rc.T, rc.R - rc.L, rc.B - rc.T)).WorkingArea;
                    rc.L = wa.Left; rc.T = wa.Top; rc.R = wa.Right; rc.B = wa.Bottom;
                    Marshal.StructureToPtr(rc, m.LParam, false);
                }
                m.Result = IntPtr.Zero;
                return;
            }
            if (m.Msg == 0x0024) // WM_GETMINMAXINFO
            {
                base.WndProc(ref m); // 先让 WinForms 按 MaximizedBounds/工作区填好
                /* v1.8：最大化矩形按标准窗口做法外扩边框宽度（起点 -fx,-fy，尺寸 +2fx,+2fy），
                   使窗口矩形不再「精确等于屏幕」——精确等大时系统按全屏应用处理，
                   抑制自适应任务栏的悬停弹出（SO#137005 同款成因）。
                   客户区仍由上面的 WM_NCCALCSIZE 钉回工作区，视觉不变（全出血）。 */
                try
                {
                    var mi = (MINMAXINFO)Marshal.PtrToStructure(m.LParam, typeof(MINMAXINFO));
                    int fxi = GetSystemMetrics(32) + GetSystemMetrics(92);
                    int fyi = GetSystemMetrics(33) + GetSystemMetrics(92);
                    mi.ptMaxPosition.x -= fxi; mi.ptMaxPosition.y -= fyi;
                    mi.ptMaxSize.x += 2 * fxi; mi.ptMaxSize.y += 2 * fyi;
                    Marshal.StructureToPtr(mi, m.LParam, false);
                }
                catch { }
                return;
            }
            if (m.Msg == 0x0005) // WM_SIZE：最大化/还原切换时同步 WS_CAPTION（修任务栏悬停不弹）
            {
                base.WndProc(ref m);
                SyncCaptionForMax();
                return;
            }
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt64() == HOTKEY_ID)
            {
                /* 一次按键可能收到两条 WM_HOTKEY（键盘软件、重复注册、长按自动重复）：
                   250ms 内的后续消息直接吞掉，否则「显示→立刻隐藏」，看起来就是按了没反应 */
                int now = Environment.TickCount;
                if (unchecked(now - lastHotTick) >= 250)
                {
                    lastHotTick = now;
                    if (quickBar != null) quickBar.Toggle();
                }
            }
            if (m.Msg == 0x0018 && IsHandleCreated)
            {
                /* 外部 ShowWindow 时 WinForms.Visible 可能不同步：直接信 wParam（1=显示 0=隐藏） */
                bool show = m.WParam != IntPtr.Zero;
                try { BeginInvoke((Action)(() => SetMemTarget(!show || WindowState == FormWindowState.Minimized))); } catch { }
            }
            base.WndProc(ref m);
        }

        void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        }

        /* 仅放行 http/https（防 file://、UNC、ms-msdt: 等被 Shell 直接执行），交给系统默认浏览器 */
        void OpenExternal(string uri)
        {
            try
            {
                if (Uri.TryCreate(uri, UriKind.Absolute, out Uri u) &&
                    (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps))
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = u.AbsoluteUri,
                        UseShellExecute = true
                    });
                }
            }
            catch { }
        }

        /* v0.2.3：播放窗口 —— 独立 WebView2 顶层窗口（同一 user data，带 cookie/登录态）。
           为什么需要：站内「预览」是 iframe + 本地 origin，没有 Referer，视频站一律拒绝内嵌
           （表现为「已阻止此内容，请与网站所有者联系」）。顶层窗口就是正常浏览器上下文，能直接播放。 */
        void OpenWebWindow(string url)
        {
            try
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out Uri u) ||
                    (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps)) return;
                var f = new Form
                {
                    Text = "SoloChat · 播放",
                    Width = 1120, Height = 740,
                    StartPosition = FormStartPosition.CenterScreen,
                    BackColor = System.Drawing.Color.FromArgb(18, 18, 18),
                    Icon = Icon
                };
                var w2 = new WebView2 { Dock = DockStyle.Fill };
                f.Controls.Add(w2);
                f.FormClosed += (a, b) => { try { w2.Dispose(); } catch { } };
                f.Shown += async (a, b) =>
                {
                    try
                    {
                        await w2.EnsureCoreWebView2Async(env);
                        w2.CoreWebView2.Settings.AreDevToolsEnabled = false;
                        w2.CoreWebView2.Settings.IsStatusBarEnabled = false;
                        w2.CoreWebView2.NewWindowRequested += (o, ev) => { ev.Handled = true; OpenExternal(ev.Uri); };
                        w2.CoreWebView2.Navigate(u.AbsoluteUri);
                    }
                    catch (Exception ex) { Log("playwin: " + ex.Message); OpenExternal(url); }
                };
                f.Show(this);
            }
            catch (Exception ex) { Log("playwin: " + ex.Message); OpenExternal(url); }
        }

        /* ---- 宿主桥（§7.2）：http / http.abort → http.meta / chunk / done / error ---- */
        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                using (var doc = JsonDocument.Parse(e.WebMessageAsJson))
                {
                    var root = doc.RootElement;
                    var t = root.GetProperty("t").GetString();
                    /* id 仅 http/http.abort/fs 消息携带；quickbar 等控制消息没有 */
                    var id = root.TryGetProperty("id", out JsonElement idEl) ? idEl.GetString() : null;
                    var fsOp = t == "fs" && root.TryGetProperty("op", out JsonElement opEl) ? opEl.GetString() : null;
                    /* F1 日志卫生：绝不记录消息原文（http 消息含 API Key/聊天正文，fs 含文件内容/路径）。
                       仅记类型与 id；http 额外记 method。headers/body/url/query 一律不进日志。 */
                    if (t == "fs") Log("msg: fs op=" + fsOp + " id=" + id);
                    else if (t == "http")
                    {
                        var mth = root.TryGetProperty("method", out JsonElement mEl) ? mEl.GetString() : "";
                        Log("msg: http id=" + id + " method=" + mth);
                    }
                    else Log("msg: t=" + t + " id=" + id);
                    if (t == "http")
                    {
                        var idCopy = id;
                        var reqCopy = root.Clone(); // 独立副本，脱离 using 作用域；避免二次 Parse 的 ArrayPool 泄漏
                        Task.Run(() => RunHttpAsync(reqCopy, idCopy));
                    }
                    else if (t == "copy") /* v1.11：页面复制走宿主剪贴板（WebView2 的 clipboard API 会卡死） */
            {
                var txt = root.TryGetProperty("text", out JsonElement tx) ? tx.GetString() : null;
                if (!string.IsNullOrEmpty(txt)) CopyToClipboard(txt);
            }
            else if (t == "http.abort")
                    {
                        CancellationTokenSource cts;
                        if (inflight.TryRemove(id, out cts)) cts.Cancel();
                    }
                    else if (t == "fs")
                    {
                        var idCopy = id;
                        var reqCopy = root.Clone();
                        Task.Run(() => RunFsAsync(fsOp, reqCopy, idCopy));
                    }
                    else if (t == "cmd.audit") /* v1.0.1：命令审计回读 */
                    {
                        var auditId = id;
                        Task.Run(() =>
                        {
                            try { Post(auditId, "cmd.audit.done", JsonSerializer.Serialize(ReadAudit(200)), null, 200); }
                            catch (Exception ex) { Post(auditId, "cmd.audit.done", null, ex.Message, 400); }
                        });
                    }
                    else if (t == "cmd") /* v0.9.0：命令执行（白名单 + 授权 cwd + 超时） */
                    {
                        var idCopy5 = id;
                        var reqCopy5 = root.Clone();
                        Task.Run(() => RunCmdAsync(reqCopy5, idCopy5));
                    }
                    else if (t == "file") /* v0.2.8：通用 URL→磁盘（图片/PDF/Office/压缩包等） */
            {
                var idCopy3 = id;
                var reqCopy3 = root.Clone();
                Task.Run(() => RunFileAsync(reqCopy3, idCopy3));
            }
            else if (t == "media") /* v0.2.4：把视频下载成 mp4 落到 下载SoloChat（宿主持有 Referer/UA，页面做不到） */
            {
                var idCopy2 = id;
                var reqCopy2 = root.Clone();
                Task.Run(() => RunMediaAsync(reqCopy2, idCopy2));
            }
            else if (t == "pkg") /* v1.23：扩展包导出（页面给文件名+文本，宿主落到桌面/下载） */
            {
                var pkgCopy = root.Clone();
                var pkgId = id;
                Task.Run(() => RunPkgAsync(pkgCopy, pkgId));
            }
            else if (t == "reveal") /* 在资源管理器中定位下载的文件 */
            {
                string rp = root.TryGetProperty("path", out JsonElement rpEl) ? rpEl.GetString() : "";
                if (!string.IsNullOrEmpty(rp))
                {
                    var rpCopy = rp;
                    BeginInvoke((Action)(() =>
                    {
                        try
                        {
                            if (File.Exists(rpCopy)) System.Diagnostics.Process.Start("explorer.exe", "/select,\"" + rpCopy + "\"");
                            else if (Directory.Exists(rpCopy)) System.Diagnostics.Process.Start("explorer.exe", "\"" + rpCopy + "\"");
                        }
                        catch { }
                    }));
                }
            }
            else if (t == "open") /* v0.2.3：页面请求打开外部地址；mode=window 用应用内播放窗口 */
            {
                string ou = root.TryGetProperty("url", out JsonElement ouEl) ? ouEl.GetString() : "";
                string om = root.TryGetProperty("mode", out JsonElement omEl) ? omEl.GetString() : "browser";
                if (!string.IsNullOrEmpty(ou))
                {
                    var ouCopy = ou;
                    if (om == "window") BeginInvoke((Action)(() => OpenWebWindow(ouCopy)));
                    else BeginInvoke((Action)(() => OpenExternal(ouCopy)));
                }
            }
            else if (t == "hotkey")
                    {
                        string combo = root.TryGetProperty("combo", out JsonElement cEl) ? cEl.GetString() : "";
                        var f = this;
                        BeginInvoke((Action)(() => f.ApplyHotkey(combo)));
                    }
                    else if (t == "quickbar")
                    {
                        bool show = root.GetProperty("show").GetBoolean();
                        string th = root.TryGetProperty("theme", out JsonElement thEl) ? thEl.GetString() : "light";
                        Log("quickbar branch: show=" + show + " theme=" + th);
                        var qb = quickBar;
                        BeginInvoke((Action)(() => qb.Apply(show, th)));
                    }
                    else if (t == "busy") // v2.2：页面告知有生成在跑 → 隐藏/最小化时不压内存（避免后台生成被打断）
                    {
                        bool bz = root.TryGetProperty("on", out JsonElement bzEl) && bzEl.ValueKind == JsonValueKind.True;
                        BeginInvoke((Action)(() => { busy = bz; SyncMemTarget(); }));
                    }
                    else if (t == "quick.answer")
                    {
                        var qaText = root.TryGetProperty("text", out JsonElement ta) ? ta.GetString() : "";
                        bool qaDone = root.TryGetProperty("done", out JsonElement td) && td.GetBoolean();
                        var qb2 = quickBar; var qaCopy = qaText;
                        BeginInvoke((Action)(() => qb2.ShowAnswer(qaCopy, qaDone)));
                    }
                    else if (t == "quick.cmd") // 小窗按钮 → 页面动作（文件/联网/Agent/新建/设置）
                    {
                        var qCmd = root.TryGetProperty("cmd", out JsonElement qc) ? qc.GetString() : "";
                        PostRaw(JsonSerializer.Serialize(new { t = "quick.cmd", cmd = qCmd }));
                    }
                    else if (t == "quick.state") // 页面 → 小窗状态回显（联网/Agent/附件数）
                    {
                        bool qw = root.TryGetProperty("web", out JsonElement qwE) && qwE.ValueKind == JsonValueKind.True;
                        bool qa2 = root.TryGetProperty("agent", out JsonElement qaE) && qaE.ValueKind == JsonValueKind.True;
                        int qf = root.TryGetProperty("files", out JsonElement qfE) && qfE.ValueKind == JsonValueKind.Number ? qfE.GetInt32() : 0;
                        var qb3 = quickBar;
                        BeginInvoke((Action)(() => qb3.ApplyState(qw, qa2, qf)));
                    }
                    else if (t == "secret") // F4：密钥保险库（DPAPI），apiKey/searchKey 不落明文 localStorage
                    {
                        var idCopy = id;
                        var sOp = root.TryGetProperty("op", out JsonElement sE) ? sE.GetString() : "get";
                        var sName = root.TryGetProperty("name", out JsonElement nE) ? nE.GetString() : "";
                        var sVal = root.TryGetProperty("value", out JsonElement vE) ? vE.GetString() : null;
                        Task.Run(() => RunSecretAsync(idCopy, sOp, sName, sVal));
                    }
                    else if (t == "win")
                    {
                        var wAct = root.TryGetProperty("act", out JsonElement wa) ? wa.GetString() : "";
                        BeginInvoke((Action)(() => WinAct(wAct)));
                    }
                }
            }
            catch (Exception ex)
            {
                Log("OnWebMessage ERR: " + ex);
            }
        }

        static readonly Regex RxSecrets = new Regex(
            "(Authorization[\"']?\\s*[:=]\\s*[\"']?Bearer\\s+)[A-Za-z0-9._\\-]+" +
            "|(X-API-KEY[\"']?\\s*[:=]\\s*[\"']?)[^\"'\\s,}\\\\]+" +
            "|(api_key[\"']?\\s*[:=]\\s*[\"']?)[^\"'\\s,}\\\\]+" +
            "|(Bearer\\s+)[A-Za-z0-9._\\-]{8,}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /* v2.0（D4）：日志目录迁出 %TEMP% → LocalAppData\OpenPage\logs（零临时文件口径） */
        static string LogDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage", "logs"); }
        }

        /* F1：Release 构建日志整体禁用（宏剥离）；DEBUG 构建脱敏 + 限长。旧版曾明文写入，启动即删除。 */
        /* v1.11：剪贴板写入必须在 UI 线程（Clipboard 是 STA 组件） */
        public void CopyToClipboard(string text)
        {
            try
            {
                if (InvokeRequired) BeginInvoke(new Action(() => { try { Clipboard.SetText(text); } catch { } }));
                else { try { Clipboard.SetText(text); } catch { } }
            }
            catch { }
        }

        public static void Log(string s)
        {
#if DEBUG
            try
            {
                Directory.CreateDirectory(LogDir);
                var p = Path.Combine(LogDir, "solo-host.log");
                if (File.Exists(p) && new FileInfo(p).Length > 1024 * 1024) File.Delete(p); // 限长：超过 1MB 滚动删除
                File.AppendAllText(p, DateTime.Now.ToString("HH:mm:ss.fff ") + Redact(s) + "\n");
            } catch { }
#endif
        }

        static string Redact(string s)
        {
            return string.IsNullOrEmpty(s) ? s : RxSecrets.Replace(s, "$1$2$3$4***");
        }

        /* F1：升级时清除旧版遗留的明文日志（含历史 API Key），避免用户本机残留敏感文件 */
        public static void PurgeLegacyLog()
        {
            try { var p = Path.Combine(Path.GetTempPath(), "solo-host.log"); if (File.Exists(p)) File.Delete(p); } catch { }
        }

        async Task RunHttpAsync(JsonElement req, string id)
        {
            var cts = new CancellationTokenSource();
            inflight[id] = cts;
            try
            {
                var method = new HttpMethod(req.GetProperty("method").GetString());
                var url = req.GetProperty("url").GetString();
                var proxy = req.TryGetProperty("proxy", out JsonElement px) ? px.GetString() : null;
                // v3.0：直连例外（页面 设置 → 代理按域名分流）→ 本次请求绕过代理
                var direct = req.TryGetProperty("direct", out JsonElement dx) && dx.ValueKind == JsonValueKind.True;
                // 仅放行 http/https 绝对 URI，防 file://、gopher:// 等被滥用
                if (!Uri.TryCreate(url, UriKind.Absolute, out Uri uri) ||
                    (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                    throw new Exception("仅支持 http/https 请求");
                using (var m = new HttpRequestMessage(method, url))
                {
                    JsonElement hs;
                    if (req.TryGetProperty("headers", out hs) && hs.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var p in hs.EnumerateObject())
                        {
                            var v = p.Value.GetString();
                            if (v != null && !p.Name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                                m.Headers.TryAddWithoutValidation(p.Name, v);
                        }
                    }
                    /* v1.5：bodyB64 + contentType 支持二进制上传（文档 OCR 等）；body 仍为 JSON 文本 */
                    var ct = req.TryGetProperty("contentType", out JsonElement ctEl) ? ctEl.GetString() : null;
                    string b64 = null;
                    if (req.TryGetProperty("bodyB64", out JsonElement b64El) && b64El.ValueKind == JsonValueKind.String)
                        b64 = b64El.GetString();
                    if (!string.IsNullOrEmpty(b64))
                    {
                        var bc = new ByteArrayContent(Convert.FromBase64String(b64));
                        if (!string.IsNullOrEmpty(ct)) bc.Headers.TryAddWithoutValidation("Content-Type", ct);
                        m.Content = bc;
                    }
                    else
                    {
                        var body = req.TryGetProperty("body", out JsonElement bEl) ? bEl.GetString() : null;
                        if (!string.IsNullOrEmpty(body))
                            m.Content = new StringContent(body, Encoding.UTF8, ct ?? "application/json");
                    }

                    using (var resp = await (direct || IsLoopbackHost(url) ? DirectHttp : ClientFor(proxy)).SendAsync(m, HttpCompletionOption.ResponseHeadersRead, cts.Token))
                    {
                        Post(id, "http.meta", RespHeadersJson(resp), null, (int)resp.StatusCode);
                        using (var stream = await resp.Content.ReadAsStreamAsync())
                        using (var sr = new StreamReader(stream, new UTF8Encoding(false), false, 4096))
                        {
                            /* 关键：按字符读流（附录 B）。StreamReader 内部处理不完整的多字节序列，
                               直接对 byte[] 做 UTF8.GetString 会把中文/emoji 从中间切坏 */
                            var buf = new char[2048];
                            int n;
                            while ((n = await sr.ReadAsync(buf, 0, buf.Length)) > 0)
                                Post(id, "http.chunk", new string(buf, 0, n), null, 0);
                        }
                        Post(id, "http.done", null, null, (int)resp.StatusCode);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                Post(id, "http.error", null, "aborted", 0);
            }
            catch (Exception ex)
            {
                Post(id, "http.error", null, ex.Message, 0);
            }
            finally
            {
                CancellationTokenSource ignored;
                inflight.TryRemove(id, out ignored);
            }
        }

        /* v1.5：把关键响应头带回页面——Azure 文档智能异步轮询需要 operation-location，content-type 用于判别错误体 */
        static string RespHeadersJson(HttpResponseMessage resp)
        {
            var sb = new StringBuilder("{");
            bool first = true;
            Action<string, IEnumerable<string>> add = (k, vs) =>
            {
                if (vs == null) return;
                var v = string.Join(",", vs);
                if (string.IsNullOrEmpty(v)) return;
                if (!first) sb.Append(',');
                first = false;
                sb.Append(JsonSerializer.Serialize(k)).Append(':').Append(JsonSerializer.Serialize(v));
            };
            foreach (var h in resp.Headers)
                if (h.Key.Equals("Operation-Location", StringComparison.OrdinalIgnoreCase) ||
                    h.Key.Equals("Retry-After", StringComparison.OrdinalIgnoreCase))
                    add(h.Key.ToLowerInvariant(), h.Value);
            foreach (var h in resp.Content.Headers)
                if (h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                    add(h.Key.ToLowerInvariant(), h.Value);
            sb.Append('}');
            return sb.ToString();
        }

        /* ---- v0.2.4：视频下载（B 站）----
           为什么必须由宿主做：playurl 与 CDN 都校验 Referer + UA，页面侧（app.local）既设不了 Referer，
           也过不了 CORS；DASH 分片需要 ffmpeg 合并，所以走 fnval=0&platform=html5 的 durl 单文件 mp4。
           落盘位置：%USERPROFILE%\Downloads\SoloChat */
        const string MediaUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

        HttpClient MediaClient(string proxy)
        {
            var handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = new System.Net.CookieContainer(),
                AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate
            };
            if (!string.IsNullOrEmpty(proxy))
            {
                handler.Proxy = new System.Net.WebProxy(proxy);
                handler.UseProxy = true;
            }
            var hc = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(20) };
            hc.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", MediaUA);
            hc.DefaultRequestHeaders.TryAddWithoutValidation("Referer", "https://www.bilibili.com/");
            hc.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "*/*");
            return hc;
        }

        static string SafeName(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "video";
            var sb = new StringBuilder();
            foreach (var ch in s)
            {
                if (sb.Length >= max) break;
                sb.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), ch) >= 0 || ch == '\\' || ch == '/' ? '_' : ch);
            }
            var r = sb.ToString().Trim().TrimEnd('.');
            return r.Length == 0 ? "video" : r;
        }

        /* 把「视频页 / 短链」解析成 BV 号：直链里带 BV 直接用；b23.tv 短链跟随跳转；再不行扫 HTML */
        async Task<string> ResolveBvidAsync(HttpClient hc, string url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            var m = Regex.Match(url, "(BV[0-9A-Za-z]{10})");
            if (m.Success) return m.Groups[1].Value;
            if (!Regex.IsMatch(url, "b23\\.tv|bilibili\\.com", RegexOptions.IgnoreCase)) return null;
            try
            {
                using (var resp = await hc.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                {
                    var mediaType = resp.Content.Headers.ContentType != null && resp.Content.Headers.ContentType.MediaType != null
                        ? resp.Content.Headers.ContentType.MediaType.ToLowerInvariant() : "";
                    var finalUri = resp.RequestMessage != null && resp.RequestMessage.RequestUri != null
                        ? resp.RequestMessage.RequestUri.ToString() : url;
                    var m2 = Regex.Match(finalUri, "(BV[0-9A-Za-z]{10})");
                    if (m2.Success) return m2.Groups[1].Value;
                    if (mediaType.Contains("html"))
                    {
                        var html = await resp.Content.ReadAsStringAsync();
                        if (html.Length > 262144) html = html.Substring(0, 262144);
                        var m3 = Regex.Match(html, "(BV[0-9A-Za-z]{10})");
                        if (m3.Success) return m3.Groups[1].Value;
                    }
                }
            }
            catch { }
            return null;
        }

        async Task RunMediaAsync(JsonElement req, string id)
        {
            HttpClient hc = null;
            try
            {
                string action = req.TryGetProperty("action", out JsonElement aEl) ? aEl.GetString() : "url";
                string bvid = req.TryGetProperty("bvid", out JsonElement bvEl) && bvEl.ValueKind == JsonValueKind.String ? bvEl.GetString() : "";
                string url = req.TryGetProperty("url", out JsonElement uEl) && uEl.ValueKind == JsonValueKind.String ? uEl.GetString() : "";
                string proxy = req.TryGetProperty("proxy", out JsonElement pxEl) && pxEl.ValueKind == JsonValueKind.String ? pxEl.GetString() : "";
                int qn = req.TryGetProperty("qn", out JsonElement qEl) && qEl.ValueKind == JsonValueKind.Number ? qEl.GetInt32() : 64;

                string mediaUrl = url, title = "", quality = "", referer = "https://www.bilibili.com/";
                long sizeHint = 0;

                hc = MediaClient(proxy);

                /* v0.2.6：不是 B 站直传的，先判断它到底是「视频页/短链」还是可下载的媒体文件 ——
                   否则拿到的会是网页（html）或音频流，保存成 .mp4 就是假文件 */
                if (action != "bili")
                {
                    var found = await ResolveBvidAsync(hc, url);
                    if (found != null){ action = "bili"; bvid = found; }
                }

                if (action == "bili")
                {
                    if (string.IsNullOrEmpty(bvid))
                    {
                        var m0 = Regex.Match(url ?? "", "(BV[0-9A-Za-z]{10})");
                        if (m0.Success) bvid = m0.Groups[1].Value;
                    }
                    if (string.IsNullOrEmpty(bvid)) throw new Exception("没找到 BV 号（首行给视频页 URL 或 BV 号）");

                    /* 先访问一次首页拿 buvid 等 cookie，降低风控概率 */
                    try { await hc.GetAsync("https://www.bilibili.com/"); } catch { }

                    var viewJson = await hc.GetStringAsync("https://api.bilibili.com/x/web-interface/view?bvid=" + bvid);
                    using (var vd = JsonDocument.Parse(viewJson))
                    {
                        var root2 = vd.RootElement;
                        int vcode = root2.GetProperty("code").GetInt32();
                        if (vcode != 0) throw new Exception("视频信息接口返回 code=" + vcode + "（可能已删除 / 需要登录 / 触发风控）");
                        var data = root2.GetProperty("data");
                        title = data.TryGetProperty("title", out JsonElement tEl) ? tEl.GetString() : "";
                        long cid = data.GetProperty("cid").GetInt64();
                        int pages = data.TryGetProperty("videos", out JsonElement vEl) ? vEl.GetInt32() : 1;

                        var pu = "https://api.bilibili.com/x/player/playurl?bvid=" + bvid + "&cid=" + cid + "&qn=" + qn + "&fnval=0&platform=html5&high_quality=1";
                        var pj = await hc.GetStringAsync(pu);
                        using (var pd = JsonDocument.Parse(pj))
                        {
                            var pr = pd.RootElement;
                            int pcode = pr.GetProperty("code").GetInt32();
                            if (pcode != 0) throw new Exception("取播放地址失败 code=" + pcode + "（可能需要登录或版权限制）");
                            var pdata = pr.GetProperty("data");
                            if (!pdata.TryGetProperty("durl", out JsonElement durl) || durl.GetArrayLength() == 0)
                                throw new Exception("该视频没有单文件 mp4 流（可能只有 DASH 分片，需要合并）");
                            var d0 = durl[0];
                            mediaUrl = d0.GetProperty("url").GetString();
                            sizeHint = d0.TryGetProperty("size", out JsonElement szEl) ? szEl.GetInt64() : 0;
                            if (pdata.TryGetProperty("quality", out JsonElement qqEl) && qqEl.ValueKind == JsonValueKind.Number)
                                quality = QnName(qqEl.GetInt32());
                            if (pages > 1) title += "（P1）";
                        }
                    }
                }
                else
                {
                    if (string.IsNullOrEmpty(mediaUrl)) throw new Exception("缺少 url");
                    referer = req.TryGetProperty("referer", out JsonElement rfEl) && rfEl.ValueKind == JsonValueKind.String ? rfEl.GetString() : "";
                    if (!string.IsNullOrEmpty(referer)) hc.DefaultRequestHeaders.Remove("Referer");
                    if (!string.IsNullOrEmpty(referer)) hc.DefaultRequestHeaders.TryAddWithoutValidation("Referer", referer);
                }

                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "SoloChat");
                Directory.CreateDirectory(dir);

                using (var resp = await hc.GetAsync(mediaUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    if (!resp.IsSuccessStatusCode) throw new Exception("下载失败 HTTP " + (int)resp.StatusCode + "（CDN 拒绝，可能需要登录 cookie）");

                    var ctype = resp.Content.Headers.ContentType != null && resp.Content.Headers.ContentType.MediaType != null
                        ? resp.Content.Headers.ContentType.MediaType.ToLowerInvariant() : "";
                    if (ctype.Contains("mpegurl") || Regex.IsMatch(mediaUrl, "\\.m3u8(\\?|#|$)", RegexOptions.IgnoreCase))
                        throw new Exception("这是 HLS 分片清单（.m3u8），需要先合并成文件，暂不支持；请给 mp4 直链");

                    long total = resp.Content.Headers.ContentLength ?? sizeHint;
                    var buf = new byte[1 << 16];

                    using (var st = await resp.Content.ReadAsStreamAsync())
                    {
                        int first = await st.ReadAsync(buf, 0, buf.Length);
                        if (first <= 0) throw new Exception("服务器返回空内容");

                        /* v0.2.6：嗅探真实内容 —— 网页 / JSON 一律当失败，别把 html 存成 .mp4 */
                        var headText = Encoding.ASCII.GetString(buf, 0, Math.Min(first, 400)).TrimStart();
                        bool looksText = ctype.Contains("html") || ctype.Contains("json") || ctype.Contains("xml")
                            || headText.StartsWith("<") || headText.StartsWith("{") || headText.StartsWith("[");
                        if (looksText)
                        {
                            var host = ""; try { host = new Uri(mediaUrl).Host; } catch { }
                            throw new Exception("这个地址返回的是网页/接口数据（" + host + "），不是视频文件。目前只认两种：B 站视频页/短链（自动解析），或能直接下到文件的媒体直链（.mp4/.mp3）；其它站点需要各写解析器");
                        }

                        /* 扩展名跟着真实类型走：音频就给 .mp3/.m4a，别把音频存成 .mp4 */
                        var ext = ".mp4";
                        if (ctype.Contains("mpegurl")) ext = ".m3u8";
                        else if (ctype.Contains("webm")) ext = ".webm";
                        else if (ctype.Contains("flv")) ext = ".flv";
                        else if (ctype.Contains("mpeg") || Regex.IsMatch(mediaUrl, "\\.mp3(\\?|#|$)", RegexOptions.IgnoreCase)) ext = ".mp3";
                        else if (ctype.StartsWith("audio/")) ext = ".m4a";

                        var baseName = string.IsNullOrEmpty(title)
                            ? SafeName(Path.GetFileNameWithoutExtension(new Uri(mediaUrl).AbsolutePath), 60)
                            : SafeName(title, 70);
                        if (string.IsNullOrEmpty(baseName) || baseName == "video") baseName = "video";
                        var fileName = baseName + (string.IsNullOrEmpty(quality) ? "" : "_" + quality) + "_" + DateTime.Now.ToString("HHmmss") + ext;
                        var path = Path.Combine(dir, fileName);

                        using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true))
                        {
                            await fs.WriteAsync(buf, 0, first);
                            long got = first;
                            int lastTick = 0, n;
                            while ((n = await st.ReadAsync(buf, 0, buf.Length)) > 0)
                            {
                                await fs.WriteAsync(buf, 0, n);
                                got += n;
                                var now = Environment.TickCount;
                                if (now - lastTick > 500)
                                {
                                    lastTick = now;
                                    Post(id, "media.progress", "{\"got\":" + got + ",\"total\":" + total + "}", null, 0);
                                }
                            }
                            sizeHint = got;
                        }
                        Log("media ok: " + path + " (" + sizeHint + " B)");
                        Post(id, "media.done", "{\"path\":" + JsonSerializer.Serialize(path) + ",\"size\":" + sizeHint +
                             ",\"title\":" + JsonSerializer.Serialize(title) + ",\"quality\":" + JsonSerializer.Serialize(quality) + "}", null, 0);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("media err: " + ex.Message);
                Post(id, "media.error", null, ex.Message, 0);
            }
            finally
            {
                if (hc != null) hc.Dispose();
            }
        }

        /* ---- v0.2.8：通用抓取落盘（图片/PDF/Office/压缩包/音视频直链都走这里）----
           和 media 的区别：media 走 B 站解析并只收媒体流；file 只做「URL → 磁盘」，按真实类型命名。 */
        static string ExtFor(string mediaType, Uri uri, byte[] head)
        {
            var pathExt = Path.GetExtension(uri != null ? uri.AbsolutePath : "").ToLowerInvariant();
            var ok = new[] { ".pdf", ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".zip", ".rar", ".7z",
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".ico", ".avif",
                ".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac", ".mp4", ".webm", ".flv", ".mov", ".mkv",
                ".json", ".txt", ".md", ".csv", ".xml", ".html", ".htm", ".yaml", ".yml", ".rtf", ".epub", ".srt" };
            foreach (var e in ok) if (pathExt == e) return e;

            var mt = (mediaType ?? "").ToLowerInvariant();
            if (mt.Contains("pdf")) return ".pdf";
            if (mt.Contains("wordprocessingml")) return ".docx";
            if (mt.Contains("spreadsheetml")) return ".xlsx";
            if (mt.Contains("presentationml")) return ".pptx";
            if (mt.Contains("png")) return ".png";
            if (mt.Contains("jpeg") || mt.Contains("jpg")) return ".jpg";
            if (mt.Contains("webp")) return ".webp";
            if (mt.Contains("gif")) return ".gif";
            if (mt.Contains("svg")) return ".svg";
            if (mt.Contains("json")) return ".json";
            if (mt.Contains("html")) return ".html";
            if (mt.Contains("markdown")) return ".md";
            if (mt.Contains("csv")) return ".csv";
            if (mt.Contains("zip")) return ".zip";
            if (mt.Contains("mpeg") && mt.Contains("audio")) return ".mp3";
            if (mt.StartsWith("audio/")) return ".m4a";
            if (mt.Contains("webm")) return ".webm";
            if (mt.Contains("mp4")) return ".mp4";

            /* 兜底看文件头 */
            if (head != null && head.Length >= 5)
            {
                if (head[0] == 0x25 && head[1] == 0x50 && head[2] == 0x44 && head[3] == 0x46) return ".pdf";
                if (head[0] == 0x50 && head[1] == 0x4B) return ".zip";
                if (head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47) return ".png";
                if (head[0] == 0xFF && head[1] == 0xD8) return ".jpg";
                var h5 = Encoding.ASCII.GetString(head, 0, Math.Min(head.Length, 12));
                if (h5.StartsWith("GIF8")) return ".gif";
                if (h5.StartsWith("RIFF") && h5.Contains("WEBP")) return ".webp";
                if (h5.Length >= 8 && h5.Substring(4, 4) == "ftyp") return ".mp4";
                if (h5.StartsWith("ID3")) return ".mp3";
            }
            return ".bin";
        }

        static string UniquePath(string dir, string name)
        {
            var p = Path.Combine(dir, name);
            if (!File.Exists(p)) return p;
            var stem = Path.GetFileNameWithoutExtension(name);
            var ext = Path.GetExtension(name);
            for (int i = 2; i < 1000; i++)
            {
                p = Path.Combine(dir, stem + "_" + i + ext);
                if (!File.Exists(p)) return p;
            }
            return p;
        }

        /* ---- v0.2.9：HLS（.m3u8）下载 —— 按清单逐片抓取再拼接。
           TS 分片直接拼成 .ts；fMP4（EXT-X-MAP）先写 init 段再拼分片成 .mp4。
           支持 master 清单选最高码率、AES-128 加密分片。 ---- */
        static string[] M3u8Lines(string text)
        {
            return text.Replace("\r", "").Split('\n');
        }

        static bool IsM3u8(string mediaType, Uri uri)
        {
            return (mediaType ?? "").IndexOf("mpegurl", StringComparison.OrdinalIgnoreCase) >= 0
                || uri.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase);
        }

        static string Attr(string line, string name)
        {
            var m = System.Text.RegularExpressions.Regex.Match(line, name + "=(\"[^\"]*\"|[^,]*)");
            return m.Success ? m.Groups[1].Value.Trim('"') : null;
        }

        async Task<string> DownloadHlsAsync(HttpClient hc, string m3u8Url, string dir, string baseName, string id)
        {
            var text = await hc.GetStringAsync(m3u8Url);
            var lines = M3u8Lines(text);

            /* master 清单：取 BANDWIDTH 最大的变体 */
            if (text.IndexOf("#EXT-X-STREAM-INF", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                string best = null; long bestBw = -1;
                for (int i = 0; i < lines.Length; i++)
                {
                    if (!lines[i].StartsWith("#EXT-X-STREAM-INF")) continue;
                    long bw = 0; long.TryParse(Attr(lines[i], "BANDWIDTH"), out bw);
                    for (int j = i + 1; j < lines.Length; j++)
                    {
                        var l = lines[j].Trim();
                        if (l.Length == 0 || l[0] == '#') continue;
                        if (bw > bestBw) { bestBw = bw; best = l; }
                        break;
                    }
                }
                if (string.IsNullOrEmpty(best)) throw new Exception("HLS master 清单里没有可用的变体");
                var vurl = new Uri(new Uri(m3u8Url), best).ToString();
                return await DownloadHlsAsync(hc, vurl, dir, baseName, id);
            }

            var baseUri = new Uri(m3u8Url);
            var segs = new List<string>();
            string keyUri = null, ivHex = null, mapUri = null;
            foreach (var raw in lines)
            {
                var l = raw.Trim();
                if (l.Length == 0) continue;
                if (l.StartsWith("#EXT-X-KEY"))
                {
                    var mth = Attr(l, "METHOD");
                    if (mth != null && mth.ToUpperInvariant() == "AES-128") { keyUri = Attr(l, "URI"); ivHex = Attr(l, "IV"); }
                    else if (mth != null && mth.ToUpperInvariant() == "NONE") keyUri = null;
                }
                else if (l.StartsWith("#EXT-X-MAP")) mapUri = Attr(l, "URI");
                else if (l[0] != '#') segs.Add(new Uri(baseUri, l).ToString());
            }
            if (segs.Count == 0) throw new Exception("HLS 清单里没有分片");

            byte[] key = null;
            if (!string.IsNullOrEmpty(keyUri)) key = await hc.GetByteArrayAsync(new Uri(baseUri, keyUri).ToString());

            bool fmp4 = !string.IsNullOrEmpty(mapUri) || Text_of(segs[0]).EndsWith(".m4s", StringComparison.OrdinalIgnoreCase);
            var ext = fmp4 ? ".mp4" : ".ts";
            var outPath = UniquePath(dir, baseName + ext);
            long got = 0, expectAll = 0;

            using (var fs = new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                if (!string.IsNullOrEmpty(mapUri))
                {
                    var init = await hc.GetByteArrayAsync(new Uri(baseUri, mapUri).ToString());
                    await fs.WriteAsync(init, 0, init.Length);
                    got += init.Length;
                }
                for (int i = 0; i < segs.Count; i++)
                {
                    var buf = await hc.GetByteArrayAsync(segs[i]);
                    if (key != null)
                    {
                        byte[] iv = new byte[16];
                        if (!string.IsNullOrEmpty(ivHex))
                        {
                            var h = ivHex.StartsWith("0x") || ivHex.StartsWith("0X") ? ivHex.Substring(2) : ivHex;
                            for (int k = 0; k < 16 && k * 2 + 1 < h.Length; k++)
                                iv[k] = Convert.ToByte(h.Substring(k * 2, 2), 16);
                        }
                        else
                        {
                            var seq = BitConverter.GetBytes((long)i);
                            if (BitConverter.IsLittleEndian) Array.Reverse(seq);
                            Array.Copy(seq, 0, iv, 8, 8);
                        }
                        using (var aes = System.Security.Cryptography.Aes.Create())
                        {
                            aes.Mode = System.Security.Cryptography.CipherMode.CBC;
                            aes.Padding = System.Security.Cryptography.PaddingMode.PKCS7;
                            aes.Key = key;
                            aes.IV = iv;
                            using (var dec = aes.CreateDecryptor())
                            {
                                try { buf = dec.TransformFinalBlock(buf, 0, buf.Length); }
                                catch { /* 分片未加密或长度非块整数倍：原样写入 */ }
                            }
                        }
                    }
                    await fs.WriteAsync(buf, 0, buf.Length);
                    got += buf.Length; expectAll += buf.Length;
                    if (i % 5 == 0) Post(id, "media.progress", "{\"got\":" + got + ",\"total\":" + (fmp4 ? got : got) + ",\"seg\":" + (i + 1) + ",\"segs\":" + segs.Count + "}", null, 0);
                }
            }
            Log("hls ok: " + outPath + " (" + got + " B, " + segs.Count + " 片)");
            return outPath;
        }

        static string Text_of(string s) { return s ?? ""; }

        async Task RunFileAsync(JsonElement req, string id)
        {
            HttpClient hc = null;
            try
            {
                string url = req.TryGetProperty("url", out JsonElement uEl) && uEl.ValueKind == JsonValueKind.String ? uEl.GetString() : "";
                string want = req.TryGetProperty("name", out JsonElement nEl) && nEl.ValueKind == JsonValueKind.String ? nEl.GetString() : "";
                string proxy = req.TryGetProperty("proxy", out JsonElement pxEl) && pxEl.ValueKind == JsonValueKind.String ? pxEl.GetString() : "";
                bool readBack = req.TryGetProperty("readBack", out JsonElement rbEl) && rbEl.ValueKind == JsonValueKind.True;
                if (string.IsNullOrEmpty(url)) throw new Exception("缺少 url");
                var uri = new Uri(url);

                hc = MediaClient(proxy);
                using (var resp = await hc.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                {
                    if (!resp.IsSuccessStatusCode) throw new Exception("下载失败 HTTP " + (int)resp.StatusCode + " " + resp.ReasonPhrase);
                    var mediaType = resp.Content.Headers.ContentType != null && resp.Content.Headers.ContentType.MediaType != null
                        ? resp.Content.Headers.ContentType.MediaType : "";
                    long total = resp.Content.Headers.ContentLength ?? 0;
                    if (IsM3u8(mediaType, uri))
                    {
                        var dirH = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "SoloChat");
                        Directory.CreateDirectory(dirH);
                        var baseH = SafeName(string.IsNullOrEmpty(want) ? Path.GetFileNameWithoutExtension(uri.AbsolutePath) : want, 60);
                        if (string.IsNullOrEmpty(baseH)) baseH = "hls";
                        var pHls = await DownloadHlsAsync(hc, url, dirH, baseH, id);
                        var fHls = new FileInfo(pHls);
                        Post(id, "file.done", "{\"path\":" + JsonSerializer.Serialize(pHls) +
                            ",\"size\":" + fHls.Length + ",\"mime\":" + JsonSerializer.Serialize(mediaType) +
                            ",\"ext\":" + JsonSerializer.Serialize(fHls.Extension) +
                            ",\"name\":" + JsonSerializer.Serialize(fHls.Name) + "}", null, 0);
                        return;
                    }
                    if (total > 200L * 1024 * 1024) throw new Exception("文件太大（" + (total / 1048576) + " MB），超过 200 MB 上限");

                    byte[] bytes;
                    using (var st = await resp.Content.ReadAsStreamAsync())
                    using (var ms = new MemoryStream())
                    {
                        var buf = new byte[1 << 16];
                        int lastTick = 0, n;
                        while ((n = await st.ReadAsync(buf, 0, buf.Length)) > 0)
                        {
                            ms.Write(buf, 0, n);
                            var now = Environment.TickCount;
                            if (now - lastTick > 500)
                            {
                                lastTick = now;
                                Post(id, "media.progress", "{\"got\":" + ms.Length + ",\"total\":" + total + "}", null, 0);
                            }
                        }
                        bytes = ms.ToArray();
                    }
                    if (bytes.Length == 0) throw new Exception("服务器返回空内容");
                    if (bytes.Length > 200L * 1024 * 1024) throw new Exception("文件太大（超过 200 MB 上限）");

                    var ext = ExtFor(mediaType, uri, bytes);
                    /* 内容处置里的文件名优先 */
                    string disp = resp.Content.Headers.ContentDisposition != null && resp.Content.Headers.ContentDisposition.FileName != null
                        ? resp.Content.Headers.ContentDisposition.FileName.Trim('"') : "";
                    var baseName = !string.IsNullOrEmpty(disp) ? disp
                        : (!string.IsNullOrEmpty(want) ? want : Path.GetFileName(uri.AbsolutePath));
                    baseName = SafeName(Path.GetFileNameWithoutExtension(baseName), 70);
                    if (string.IsNullOrEmpty(baseName)) baseName = "file";

                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "SoloChat");
                    Directory.CreateDirectory(dir);
                    var path = UniquePath(dir, baseName + ext);
                    File.WriteAllBytes(path, bytes);
                    Log("file ok: " + path + " (" + bytes.Length + " B, " + mediaType + ")");

                    /* 可提取文本的类型（docx/xlsx/pptx/pdf/rtf + 纯文本）→ 回传 base64 让页面用现有解析器读 */
                    string[] docExts = { ".pdf", ".docx", ".xlsx", ".pptx", ".rtf", ".epub", ".md", ".txt", ".json", ".csv", ".html", ".htm", ".xml", ".yml", ".yaml" };
                    bool wantText = Array.IndexOf(docExts, ext) >= 0 && bytes.Length <= 16 * 1024 * 1024;
                    /* v0.2.9：图片也回传字节 —— 页面转 data URL 附给多模态模型真正「看」 */
                    bool isImg = mediaType.StartsWith("image/") || ext == ".png" || ext == ".jpg" || ext == ".jpeg"
                        || ext == ".webp" || ext == ".gif" || ext == ".bmp" || ext == ".avif";
                    bool wantB64 = (wantText || isImg) && bytes.Length <= 16 * 1024 * 1024;
                    var payload = "{\"path\":" + JsonSerializer.Serialize(path) +
                        ",\"size\":" + bytes.Length +
                        ",\"mime\":" + JsonSerializer.Serialize(mediaType) +
                        ",\"ext\":" + JsonSerializer.Serialize(ext) +
                        ",\"name\":" + JsonSerializer.Serialize(Path.GetFileName(path)) + "}";
                    if (isImg) payload = payload.Substring(0, payload.Length - 1) + ",\"img\":true}";
                    if (readBack && wantB64 && (wantText || isImg))
                    {
                        payload = payload.Substring(0, payload.Length - 1) +
                            ",\"b64\":" + JsonSerializer.Serialize(Convert.ToBase64String(bytes)) + "}";
                    }
                    Post(id, "file.done", payload, null, 0);
                }
            }
            catch (Exception ex)
            {
                Log("file err: " + ex.Message);
                Post(id, "file.error", null, ex.Message, 0);
            }
            finally
            {
                if (hc != null) hc.Dispose();
            }
        }

        static string QnName(int qn)
        {
            switch (qn)
            {
                case 16: return "360p";
                case 32: return "480p";
                case 64: return "720p";
                case 74: return "720p60";
                case 80: return "1080p";
                case 112: return "1080p+";
                case 116: return "1080p60";
                case 120: return "4K";
                default: return qn + "p";
            }
        }

        /* PostWebMessageAsJson 必须在 UI 线程调用；手工拼 JSON 规避 3.1 运行时类型序列化限制 */
        void Post(string id, string t, string data, string message, int status)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"").Append(t).Append("\",\"id\":").Append(JsonSerializer.Serialize(id));
            if (status != 0) sb.Append(",\"status\":").Append(status);
            if (data != null) sb.Append(",\"data\":").Append(JsonSerializer.Serialize(data));
            if (message != null) sb.Append(",\"message\":").Append(JsonSerializer.Serialize(message));
            sb.Append('}');
            var json = sb.ToString();
            try { BeginInvoke((Action)(() => wv.CoreWebView2.PostWebMessageAsJson(json))); }
            catch { }
        }

        /* ---- 文件 Agent 桥（规范 v1.1 / §7.2 扩展）：{t:'fs',op,path,data} → fs.done / fs.error ----
           安全模型：工作区根目录仅本文件持有（host.json），页面无法自授权；所有 IO 前必经 GuardPath；
           写操作由页面 UI 显式确认后发起，宿主再做一次路径与大小校验。 */
        static readonly Encoding FsUtf8 = new UTF8Encoding(false);
        const int FsMaxBytes = 256 * 1024; // 单文件读写上限
        const int FsListMax = 500;         // 目录列举条数上限

        static string HostCfgPath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage", "host.json"); }
        }

        static void LoadHostCfg()
        {
            try
            {
                if (!File.Exists(HostCfgPath)) return;
                using (var doc = JsonDocument.Parse(File.ReadAllText(HostCfgPath)))
                {
                    /* v1.2 多根白名单；兼容 v1.1 单根旧格式迁移 */
                    if (doc.RootElement.TryGetProperty("workspaceRoots", out JsonElement rs) && rs.ValueKind == JsonValueKind.Array)
                        foreach (var e in rs.EnumerateArray())
                        {
                            var s = e.GetString();
                            if (!string.IsNullOrEmpty(s) && wsRoots.IndexOf(s) < 0) wsRoots.Add(s);
                        }
                    else if (doc.RootElement.TryGetProperty("workspaceRoot", out JsonElement r))
                    {
                        var s = r.GetString();
                        if (!string.IsNullOrEmpty(s)) wsRoots.Add(s);
                    }
                    if (doc.RootElement.TryGetProperty("quickbarPos", out JsonElement q) && q.ValueKind == JsonValueKind.Object)
                    {
                        int x = q.TryGetProperty("x", out JsonElement xe) ? xe.GetInt32() : -9999;
                        int y = q.TryGetProperty("y", out JsonElement ye) ? ye.GetInt32() : -9999;
                        if (x > -9999 && y > -9999) qbPos = new Point(x, y);
                    }
                }
            }
            catch (Exception ex) { Log("hostcfg load err: " + ex.Message); }
        }

        static void SaveHostCfg()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(HostCfgPath));
                object pos = qbPos.HasValue ? (object)new { x = qbPos.Value.X, y = qbPos.Value.Y } : null;
                File.WriteAllText(HostCfgPath, JsonSerializer.Serialize(new { workspaceRoots = wsRoots, quickbarPos = pos }));
            }
            catch (Exception ex) { Log("hostcfg save err: " + ex.Message); }
        }

        /* 规范化根目录：保留盘符根的结尾反斜杠（如 D:\），其余去掉结尾分隔符 */
        static string NormalizeRoot(string r)
        {
            string full = Path.GetFullPath(r).TrimEnd('\\', '/');
            if (full.Length == 2 && full[1] == ':') full += "\\"; // 盘符根目录保留如 D:\
            return full;
        }

    /* v0.9.0：Agent 命令执行（宿主侧）—— 白名单 + 工作区内 cwd + 超时 + 输出截断
       只允许开发工具链；不接受 shell 元字符展开（进程直接启动，参数逐个传递，不经过 cmd.exe）。 */
    /* net48 没有 ArgumentList，这里按 Windows 命令行规则手工转义 */
    static string QuoteArg(string a)
    {
        if (a == null) return "\"\"";
        if (a.Length == 0) return "\"\"";
        if (a.IndexOfAny(new char[] { ' ', '\t', '"', '\n', '\v' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int bs = 0;
        foreach (char ch in a)
        {
            if (ch == '\\') bs++;
            else if (ch == '"') { sb.Append('\\', bs * 2 + 1).Append('"'); bs = 0; }
            else { if (bs > 0) { sb.Append('\\', bs); bs = 0; } sb.Append(ch); }
        }
        if (bs > 0) sb.Append('\\', bs * 2);
        sb.Append('"');
        return sb.ToString();
    }

    static readonly HashSet<string> CmdAllow = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "git", "node", "npm", "npx", "pnpm", "yarn", "python", "python3", "py",
        "dotnet", "tsc", "pytest", "cargo", "go", "mvn", "gradle"
    };

    async Task RunCmdAsync(JsonElement req, string id)
    {
        try
        {
            string cmd = req.TryGetProperty("cmd", out JsonElement cEl) ? cEl.GetString() : null;
            var args = new List<string>();
            if (req.TryGetProperty("args", out JsonElement aEl) && aEl.ValueKind == JsonValueKind.Array)
                foreach (JsonElement x in aEl.EnumerateArray())
                    if (x.ValueKind == JsonValueKind.String) args.Add(x.GetString());
            string cwd = req.TryGetProperty("cwd", out JsonElement wEl) ? wEl.GetString() : null;
            int timeoutMs = 60000;
            if (req.TryGetProperty("timeoutMs", out JsonElement tEl) && tEl.TryGetInt32(out int tv))
                timeoutMs = Math.Min(Math.Max(tv, 1000), 300000);

            if (string.IsNullOrWhiteSpace(cmd))
            {
                Post(id, "cmd.done", null, "命令为空", 400);
                return;
            }
            string exeName = Path.GetFileNameWithoutExtension(cmd.Trim());
            if (!CmdAllow.Contains(exeName))
            {
                Audit("", cmd + " " + string.Join(" ", args.ToArray()), "denied(白名单)");
                Post(id, "cmd.done", null, "不在命令白名单：" + cmd + "（允许：" + string.Join("/", CmdAllow) + "）", 403);
                return;
            }
            string cwdFull;
            try
            {
                cwdFull = FsRootFull(string.IsNullOrWhiteSpace(cwd) ? null : cwd);
            }
            catch (Exception ex)
            {
                Audit("", cmd + " " + string.Join(" ", args.ToArray()), "denied(cwd)");
                Post(id, "cmd.done", null, ex.Message, 403);
                return;
            }

            var psi = new ProcessStartInfo
            {
                FileName = cmd.Trim(),
                WorkingDirectory = cwdFull,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            if (args.Count > 0) psi.Arguments = string.Join(" ", args.ConvertAll(new Converter<string, string>(QuoteArg)).ToArray());

            var sbOut = new StringBuilder();
            var sbErr = new StringBuilder();
            Process p = new Process { StartInfo = psi };
            try
            {
                p.OutputDataReceived += (s, e) =>
                {
                    if (e.Data == null) return;
                    lock (sbOut) { if (sbOut.Length < 200000) sbOut.AppendLine(e.Data); }
                };
                p.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data == null) return;
                    lock (sbErr) { if (sbErr.Length < 60000) sbErr.AppendLine(e.Data); }
                };
                if (!p.Start())
                {
                    Post(id, "cmd.done", null, "进程启动失败", 500);
                    return;
                }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                bool exited = p.WaitForExit(timeoutMs);
                if (!exited)
                {
                    Audit(cwdFull, cmd + " " + string.Join(" ", args.ToArray()), "timeout>" + timeoutMs + "ms");
                    try { p.Kill(); } catch { }
                    string tout = "";
                    lock (sbOut) tout = sbOut.ToString();
                    Post(id, "cmd.done", JsonSerializer.Serialize(new { code = -1, stdout = tout, stderr = "", timeout = true }), "超时（>" + timeoutMs + "ms）", 408);
                    return;
                }
                Audit(cwdFull, cmd + " " + string.Join(" ", args.ToArray()), "exit=" + p.ExitCode);
                string so, se;
                lock (sbOut) so = sbOut.ToString();
                lock (sbErr) se = sbErr.ToString();
                int code = p.ExitCode;
                var data = JsonSerializer.Serialize(new { code = code, stdout = so, stderr = se, timeout = false });
                if (code != 0)
                    Post(id, "cmd.done", data, "退出码 " + code, 200);
                else
                    Post(id, "cmd.done", data, null, 200);
            }
            finally
            {
                try { p.Dispose(); } catch { }
            }
        }
        catch (Exception ex)
        {
            Post(id, "cmd.done", null, ex.Message, 400);
        }
        await Task.CompletedTask;
    }

    /* 路径安全闸：root 必须是已授权根目录之一（页面按会话引用），rel 是其内相对路径 */
        static string FsRootFull(string root)
        {
            string r = string.IsNullOrWhiteSpace(root) ? (wsRoots.Count == 1 ? wsRoots[0] : null) : root.Trim();
            string match = string.IsNullOrEmpty(r)
                ? null
                : wsRoots.Find(x => string.Equals(NormalizeRoot(x), NormalizeRoot(r), StringComparison.OrdinalIgnoreCase));
            if (match == null)
                throw new Exception(wsRoots.Count == 0 ? "未选择工作区（输入区右侧工作区按钮）" : "工作区未授权（请重新通过工作区按钮选择）");
            return NormalizeRoot(match);
        }

        static string GuardPath(string root, string rel)
        {
            if (string.IsNullOrWhiteSpace(rel)) throw new Exception("路径为空");
            rel = rel.Trim().Replace('/', '\\');
            if (Path.IsPathRooted(rel)) throw new Exception("必须使用工作区内相对路径");
            string rootFull = FsRootFull(root);
            // 盘符根（D:\）结尾已带 \；普通根补 \ 作为前缀边界
            string prefix = rootFull.EndsWith("\\", StringComparison.Ordinal) ? rootFull : rootFull + "\\";
            string full = Path.GetFullPath(Path.Combine(prefix, rel));
            if (!full.Equals(rootFull.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) &&
                !full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new Exception("路径越出工作区范围");
            NoReparse(full, prefix);
            return full;
        }

        /* 路径每一级都不允许穿过符号链接 / 联接点（防白名单外内容被链入工作区） */
        static void NoReparse(string full, string prefix)        {
            var rootFull = prefix.TrimEnd('\\');
            var di = new DirectoryInfo(rootFull);
            if (!di.Exists) throw new Exception("工作区目录不存在");
            if ((di.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("工作区目录不能是符号链接");
            if (full.Length <= prefix.Length) return;
            string cur = rootFull;
            foreach (var seg in full.Substring(prefix.Length).Split('\\'))
            {
                if (seg.Length == 0) continue;
                cur = Path.Combine(cur, seg);
                FileSystemInfo fsi = Directory.Exists(cur) ? (FileSystemInfo)new DirectoryInfo(cur)
                                    : File.Exists(cur) ? (FileSystemInfo)new FileInfo(cur) : null;
                if (fsi != null && (fsi.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new Exception("路径经过符号链接/联接点，已拒绝");
            }
        }

        /* v1.4 工作区外写入闸：页面确认框已展示「位置+操作内容」，此处仍强制
           ① 已选过工作区（否则文件 Agent 整体不可用）② 完整绝对路径
           ③ 禁系统目录（Windows / Program Files）④ 逐级禁符号链接/联接点 ⑤ 大小仍受 FsMaxBytes 限制 */
        static string GuardOutPath(string abs)
        {
            if (wsRoots.Count == 0) throw new Exception("未选择工作区，无法发起工作区外写入");
            if (string.IsNullOrWhiteSpace(abs)) throw new Exception("路径为空");
            abs = abs.Trim().Replace('/', '\\');
            if (!Path.IsPathRooted(abs)) throw new Exception("工作区外写入必须提供完整绝对路径（含盘符）");
            string full = Path.GetFullPath(abs);
            string root = Path.GetPathRoot(full);
            if (string.IsNullOrEmpty(root)) throw new Exception("无法解析目标路径");
            string[] deny = {
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData\\Roaming\\Microsoft\\Windows\\Start Menu"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData\\Local\\Microsoft\\Windows")
            };
            foreach (var d in deny)
                if (!string.IsNullOrEmpty(d) &&
                    full.StartsWith(d.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
                    throw new Exception("系统目录禁止写入：" + d);
            /* 逐级检查已有路径不含符号链接/联接点 */
            string acc = root; // "C:\" 或 UNC 根
            foreach (var seg in full.Substring(root.Length).Split('\\'))
            {
                if (seg.Length == 0) continue;
                acc = Path.Combine(acc, seg);
                FileSystemInfo fsi = Directory.Exists(acc) ? (FileSystemInfo)new DirectoryInfo(acc)
                                  : File.Exists(acc) ? (FileSystemInfo)new FileInfo(acc) : null;
                if (fsi != null && (fsi.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new Exception("路径经过符号链接/联接点，已拒绝：" + acc);
            }
            return full;
        }

        /* v1.23：扩展包导出 —— 只接受「相对路径 + 文本」，限制在目标文件夹内，不覆盖目录外文件 */
        void RunPkgAsync(JsonElement req, string id)
        {
            try
            {
                string name = req.TryGetProperty("name", out JsonElement nm) ? (nm.GetString() ?? "") : "";
                string where = req.TryGetProperty("where", out JsonElement wh) ? (wh.GetString() ?? "desktop") : "desktop";
                foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '-');
                name = name.Trim().TrimEnd('.', ' ');
                if (name.Length == 0) name = "扩展包";
                string baseDir = where == "downloads"
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")
                    : Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string root = Path.Combine(baseDir, name);
                string rootFull = Path.GetFullPath(root);
                Directory.CreateDirectory(rootFull);
                int count = 0;
                if (req.TryGetProperty("files", out JsonElement arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement f in arr.EnumerateArray())
                    {
                        string rel = f.GetProperty("rel").GetString() ?? "";
                        string text = f.TryGetProperty("text", out JsonElement tx) ? (tx.GetString() ?? "") : "";
                        if (string.IsNullOrWhiteSpace(rel)) continue;
                        string full = Path.GetFullPath(Path.Combine(rootFull, rel.Replace('/', Path.DirectorySeparatorChar)));
                        if (!full.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        File.WriteAllText(full, text, new UTF8Encoding(false));
                        count++;
                    }
                }
                PostFs(id, "pkg.done", JsonSerializer.Serialize(new { dir = rootFull, files = count }), null);
            }
            catch (Exception ex) { PostFs(id, "pkg.error", null, ex.Message); }
        }

        void RunFsAsync(string op, JsonElement req, string id)
        {
            try
            {
                switch (op)
                {
                    case "roots":
                        PostFs(id, "fs.done", JsonSerializer.Serialize(new { roots = wsRoots }), null);
                        break;
                    case "addroot":
                        BeginInvoke((Action)(() => PickRoot(id))); // 目录选择对话框必须在 UI(STA) 线程
                        break;
                    case "rmroot":
                        string rp = req.GetProperty("path").GetString() ?? "";
                        wsRoots.RemoveAll(x => string.Equals(NormalizeRoot(x), NormalizeRoot(rp.Trim()), StringComparison.OrdinalIgnoreCase));
                        SaveHostCfg();
                        PostFs(id, "fs.done", JsonSerializer.Serialize(new { roots = wsRoots }), null);
                        break;
                    case "read": FsRead(req, id); break;
                    case "list": FsList(req, id); break;
                    case "write": FsWrite(req, id); break;
      case "restore": FsRestore(req, id); break;   /* v1.28.4：撤销上次写入 */
                    case "delete": FsDelete(req, id); break; /* v1.13：面板里删文件（只限工作区内、非空目录不删） */
                    default:
                        PostFs(id, "fs.error", null, "未知文件操作: " + op);
                        break;
                }
            }
            catch (Exception ex) { PostFs(id, "fs.error", null, ex.Message); }
        }

        static string ReqRoot(JsonElement req)
        {
            return req.TryGetProperty("root", out JsonElement rt) ? rt.GetString() : null;
        }

        void FsRead(JsonElement req, string id)
        {
            string rel = req.GetProperty("path").GetString() ?? "";
            string p = GuardPath(ReqRoot(req), rel);
            var fi = new FileInfo(p);
            if (!fi.Exists) { PostFs(id, "fs.error", null, "文件不存在: " + rel); return; }
            if (fi.Length > FsMaxBytes) { PostFs(id, "fs.error", null, "文件超过 256KB，不支持读取"); return; }
            byte[] bytes = File.ReadAllBytes(p);
            int sniff = (int)Math.Min((long)bytes.Length, 8192);
            for (int i = 0; i < sniff; i++)
                if (bytes[i] == 0) { PostFs(id, "fs.error", null, "二进制文件不支持读取"); return; }
            string text = FsUtf8.GetString(bytes);
            PostFs(id, "fs.done", JsonSerializer.Serialize(new
            {
                path = rel, text = text, bytes = bytes.Length,
                lines = text.Length == 0 ? 0 : text.Split('\n').Length
            }), null);
        }

        void FsList(JsonElement req, string id)
        {
            string rel = req.GetProperty("path").GetString() ?? "";
            string p = rel.Trim().Length == 0 ? FsRootFull(ReqRoot(req)) : GuardPath(ReqRoot(req), rel);
            var di = new DirectoryInfo(p);
            if (!di.Exists) { PostFs(id, "fs.error", null, "目录不存在: " + rel); return; }
            var infos = new List<FileSystemInfo>(di.EnumerateFileSystemInfos());
            infos.Sort((a, b) =>
            {
                bool da = (a.Attributes & FileAttributes.Directory) != 0, db = (b.Attributes & FileAttributes.Directory) != 0;
                if (da != db) return da ? -1 : 1;
                return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
            });
            bool truncated = infos.Count > FsListMax;
            if (truncated) infos.RemoveRange(FsListMax, infos.Count - FsListMax);
            var entries = new List<object>();
            foreach (var e in infos)
            {
                bool isDir = (e.Attributes & FileAttributes.Directory) != 0;
                entries.Add(new { n = e.Name, d = isDir, s = isDir ? 0L : ((FileInfo)e).Length });
            }
            PostFs(id, "fs.done", JsonSerializer.Serialize(new { path = rel, entries = entries, truncated = truncated }), null);
        }

        void FsDelete(JsonElement req, string id)
        {
            string rel = req.GetProperty("path").GetString() ?? "";
            if (rel.Trim().Length == 0) { PostFs(id, "fs.error", null, "拒绝删除工作区根目录"); return; }
            string p;
            try { p = GuardPath(ReqRoot(req), rel); }
            catch (Exception ex) { PostFs(id, "fs.error", null, ex.Message); return; }
            try
            {
                if (File.Exists(p)) File.Delete(p);
                else if (Directory.Exists(p))
                {
                    if (Directory.GetFileSystemEntries(p).Length > 0) { PostFs(id, "fs.error", null, "目录非空，拒绝删除: " + rel); return; }
                    Directory.Delete(p);
                }
                else { PostFs(id, "fs.error", null, "不存在: " + rel); return; }
                Log("fs delete ok: " + rel);
                PostFs(id, "fs.done", JsonSerializer.Serialize(new { path = rel, deleted = true }), null);
            }
            catch (Exception ex) { PostFs(id, "fs.error", null, ex.Message); }
        }

        /* v1.28.4：写前快照 —— 覆盖已有文件前留一份原件，支持「撤销这次写入」 */
        static string SnapDir
        {
          get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SoloChat", "backups"); }
        }
        
        string SnapshotFile(string full)
        {
          try
          {
            if (!File.Exists(full)) return "";
            Directory.CreateDirectory(SnapDir);
            string id = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            File.Copy(full, Path.Combine(SnapDir, id + ".bak"), true);
            File.WriteAllText(Path.Combine(SnapDir, id + ".json"),
              JsonSerializer.Serialize(new { path = full, ts = DateTime.Now.ToString("o") }), new UTF8Encoding(false));
            PruneSnaps();
            return id;
          }
          catch { return ""; }
        }
        
        void PruneSnaps()
        {
          try
          {
            var di = new DirectoryInfo(SnapDir);
            if (!di.Exists) return;
            var list = new List<FileInfo>(di.GetFiles("*.bak"));
            list.Sort((a, b) => b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc));
            long total = 0;
            for (int k = 0; k < list.Count; k++)
            {
              total += list[k].Length;
              if (k >= 500 || total > 200L * 1024 * 1024)
              {
                try { File.Delete(list[k].FullName); File.Delete(Path.ChangeExtension(list[k].FullName, ".json")); } catch { }
              }
            }
          }
          catch { }
        }
        
        void FsRestore(JsonElement req, string id)
        {
          try
          {
            string snap = req.TryGetProperty("data", out JsonElement sn) ? (sn.GetString() ?? "") : "";
            if (!Regex.IsMatch(snap, "^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$")) { PostFs(id, "fs.error", null, "快照编号无效"); return; }
            string bak = Path.Combine(SnapDir, snap + ".bak"), meta = Path.Combine(SnapDir, snap + ".json");
            if (!File.Exists(bak) || !File.Exists(meta)) { PostFs(id, "fs.error", null, "快照已过期或被清理"); return; }
            string orig = "";
            using (var doc = JsonDocument.Parse(File.ReadAllText(meta)))
            {
              if (doc.RootElement.TryGetProperty("path", out JsonElement pe)) orig = pe.GetString() ?? "";
            }
            if (string.IsNullOrEmpty(orig)) { PostFs(id, "fs.error", null, "快照元数据缺失"); return; }
            string rel = req.GetProperty("path").GetString() ?? "";
            bool outRoot = req.TryGetProperty("out", out JsonElement oEl) && oEl.ValueKind == JsonValueKind.True;
            string p = outRoot ? GuardOutPath(rel) : GuardPath(ReqRoot(req), rel);
            if (!string.Equals(Path.GetFullPath(p), Path.GetFullPath(orig), StringComparison.OrdinalIgnoreCase))
            { PostFs(id, "fs.error", null, "快照与目标路径不一致，拒绝恢复"); return; }
            File.Copy(bak, p, true);
            Log("fs restore: " + rel + " snap=" + snap);
            PostFs(id, "fs.done", JsonSerializer.Serialize(new { path = rel, restored = true, bytes = new FileInfo(p).Length }), null);
          }
          catch (Exception ex) { PostFs(id, "fs.error", null, ex.Message); }
        }
        
        void FsWrite(JsonElement req, string id)
        {
            string rel = req.GetProperty("path").GetString() ?? "";
            /* v1.4 工作区外写入：页面已弹「位置+操作内容」确认并带 out=1，此处再做路径闸 */
            bool outRoot = req.TryGetProperty("out", out JsonElement oEl) && oEl.ValueKind == JsonValueKind.True;
            string p = outRoot ? GuardOutPath(rel) : GuardPath(ReqRoot(req), rel);
            string data = req.TryGetProperty("data", out JsonElement dEl) ? (dEl.GetString() ?? "") : "";
            int n = FsUtf8.GetByteCount(data);
            if (n > FsMaxBytes) { PostFs(id, "fs.error", null, "内容超过 256KB，拒绝写入"); return; }
            bool bom = false;
            if (File.Exists(p))
            {
                using (var fs = File.OpenRead(p))
                {
                    int a = fs.ReadByte(), b = fs.ReadByte(), c = fs.ReadByte();
                    bom = a == 0xEF && b == 0xBB && c == 0xBF; // 已有 BOM 的文件保持其 BOM
                }
            }
            string snap = File.Exists(p) ? SnapshotFile(p) : "";
      string dir = Path.GetDirectoryName(p);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir); // 自动建父目录
            File.WriteAllText(p, data, bom ? new UTF8Encoding(true) : FsUtf8);
            Log("fs write ok: " + rel + " bytes=" + n);
            PostFs(id, "fs.done", JsonSerializer.Serialize(new { path = rel, bytes = n, snap = snap }), null);
        }

        void PickRoot(string id)
        {
            try
            {
                using (var dlg = new FolderBrowserDialog { Description = "选择本会话的工作区根目录" })
                {
                    // 快速条可见时以其为宿主（TopMost），避免选目录对话框被压在小窗后面
                    var owner = (quickBar != null && quickBar.Visible) ? (IWin32Window)quickBar
                              : Visible ? (IWin32Window)this : null;
                    if (dlg.ShowDialog(owner) == DialogResult.OK)
                    {
                        // 大小写不敏感去重（Windows 路径）
                        if (!wsRoots.Exists(x => string.Equals(NormalizeRoot(x), NormalizeRoot(dlg.SelectedPath), StringComparison.OrdinalIgnoreCase)))
                            wsRoots.Add(dlg.SelectedPath); // 加入授权白名单
                        SaveHostCfg();
                        Log("fs addroot: " + dlg.SelectedPath);
                        PostFs(id, "fs.done", JsonSerializer.Serialize(new { root = dlg.SelectedPath, roots = wsRoots }), null);
                    }
                    else PostFs(id, "fs.error", null, "已取消选择");
                }
            }
            catch (Exception ex) { PostFs(id, "fs.error", null, ex.Message); }
        }

        /* 结构化结果回发：dataRaw 为已序列化 JSON，直接拼入（不二次转义） */
        void PostFs(string id, string t, string dataRaw, string message)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"").Append(t).Append("\",\"id\":").Append(JsonSerializer.Serialize(id));
            if (dataRaw != null) sb.Append(",\"data\":").Append(dataRaw);
            if (message != null) sb.Append(",\"message\":").Append(JsonSerializer.Serialize(message));
            sb.Append('}');
            var json = sb.ToString();
            try { BeginInvoke((Action)(() => wv.CoreWebView2.PostWebMessageAsJson(json))); }
            catch { }
        }

        /* ---- F4：DPAPI 密钥保险库 ----
           apiKey/searchKey 不再明文存 localStorage。宿主用 DPAPI（CurrentUser）加密落盘
           %LOCALAPPDATA%\OpenPage\secrets\{name}.bin；页面内存持有占位/回读明文仅在请求时注入。
           页面无法自读文件——只有本宿主（同一 Windows 账户）可解密。 */
        static string SecretDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenPage", "secrets"); }
        }

        static string SecretPath(string name)
        {
            var safe = Regex.Replace(name ?? "", "[^A-Za-z0-9._-]", "_");
            if (string.IsNullOrEmpty(safe)) safe = "unnamed";
            return Path.Combine(SecretDir, safe + ".bin");
        }

        void RunSecretAsync(string id, string op, string name, string value)
        {
            try
            {
                Directory.CreateDirectory(SecretDir);
                var p = SecretPath(name);
                if (op == "set")
                {
                    if (string.IsNullOrEmpty(value)) { if (File.Exists(p)) File.Delete(p); Post(id, "secret.done", null, null, 0); return; }
                    var enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
                    File.WriteAllBytes(p, enc);
                    Post(id, "secret.done", null, null, 0);
                }
                else
                {
                    if (!File.Exists(p)) { Post(id, "secret.done", null, null, 404); return; }
                    var dec = ProtectedData.Unprotect(File.ReadAllBytes(p), null, DataProtectionScope.CurrentUser);
                    Post(id, "secret.done", Encoding.UTF8.GetString(dec), null, 0);
                }
            }
            catch (Exception ex) { Post(id, "secret.error", null, ex.Message, 0); }
        }
    }

    /* 任务栏快速输入条：常驻置顶的小输入窗（方案 A，原生控件，约 +1~3MB） */
    public class QuickBarForm : Form
    {
        readonly MainForm main;
        readonly TextBox input;
        readonly RichTextBox answer; // v1.8：原 TextBox 显示裸 Markdown（**星号**），改 RTF 渲染
        readonly Panel pad;
        readonly Panel tools;          // 左侧与原「问」同大的 44×44 框，四格各占 1/4（22×22）
        readonly Button bFile, bWeb, bMore;
        readonly Button clearBtn;      // 回答区右侧「清空」图标按钮（v1.4.1）
        readonly Panel ansPanel;       // 回答区容器（Dock Bottom，含 answer + clearBtn）
        readonly Label grip;           // 第四格：拖动把手（原「问」按钮的拖动职责移交至此）
        readonly ComboBox mode;        // 右侧模式选择：Chat / Agent（选 Agent 自动弹文件夹选择）
        readonly ContextMenuStrip moreMenu;
        const string PH = "快捷提问，Enter 发送，Esc 隐藏";
        bool ph;
        bool syncState, webOn, agentOn; // syncState：页面回写状态时抑制 SelectedIndexChanged 上抛
        int filesN;
        readonly ToolTip tip = new ToolTip();

        public QuickBarForm(MainForm main)
        {
            this.main = main;
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(560, 44);
            try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            input = new TextBox();
            input.BorderStyle = BorderStyle.None;
            input.Font = new Font("Microsoft YaHei UI", 10.5f);
            input.Dock = DockStyle.Fill;
            /* net48 的 TextBox 无 PlaceholderText，用占位标记模拟 */
            SetPh();
            input.Enter += (s, e) => { if (ph) { ph = false; input.Text = ""; input.ForeColor = ThemeFg(); } };
            input.Leave += (s, e) => { if (ph || input.Text.Length == 0) SetPh(); };
            input.KeyDown += (s, e) =>
            {
                if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Send(); }
                else if (e.KeyCode == Keys.Escape) { RequestHide(); }
            };

            /* —— 左侧 44×44 框：四格（文件 / 联网搜索 / 更多 / 拖动把手），各 22×22 = 问框面积的 1/4。
               v1.4.1：全部改 GDI+ 矢量图标（等价 SVG 路径输出），不再用文字字符 —— */
            tools = new Panel { Dock = DockStyle.Left, Width = 44 };
            bFile = NewCell(0, 0, "file");
            bWeb = NewCell(22, 0, "web");
            bMore = NewCell(0, 22, "more");
            grip = new Label
            {
                Bounds = new Rectangle(22, 22, 22, 22),
                Text = "",
                Cursor = Cursors.SizeAll
            };
            tools.Controls.Add(bFile); tools.Controls.Add(bWeb); tools.Controls.Add(bMore); tools.Controls.Add(grip);

            bFile.Click += (s, e) => Cmd("attach");   // 打开文件选择（页面 #file-input）
            bWeb.Click += (s, e) => Cmd("web");       // 联网搜索开关
            bMore.Click += (s, e) =>
            {
                moreMenu.Show(bMore, new Point(0, bMore.Height)); // 更多：小菜单（新建/主窗/设置）
            };

            /* 拖动把手：与原「问」按钮同一套按下-移动-松开逻辑 */
            Point mouse0 = Point.Empty, form0 = Point.Empty;
            bool dragHit = false, dragged = false;
            grip.MouseDown += (s, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                dragHit = true; dragged = false;
                mouse0 = Control.MousePosition; form0 = Location;
            };
            grip.MouseMove += (s, e) =>
            {
                if (!dragHit) return;
                var m2 = Control.MousePosition;
                int dx = m2.X - mouse0.X, dy = m2.Y - mouse0.Y;
                if (!dragged && Math.Abs(dx) + Math.Abs(dy) < 6) return;
                dragged = true;
                Location = new Point(form0.X + dx, form0.Y + dy);
            };
            grip.MouseUp += (s, e) =>
            {
                if (!dragHit) return;
                dragHit = false;
                if (dragged) main.SaveQuickbarPos(Location);
            };

            /* —— 右侧模式选择：Chat / Agent（原「问」按钮位置） —— */
            mode = new ComboBox
            {
                Dock = DockStyle.Right, Width = 88,
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat, Font = new Font("Microsoft YaHei UI", 9.5f),
                Cursor = Cursors.SizeAll // 该区也可按住拖动
            };
            mode.Items.AddRange(new object[] { "Chat", "Agent" });
            mode.SelectedIndex = 0;
            mode.SelectedIndexChanged += (s, e) =>
            {
                if (syncState) return;
                bool ag = mode.SelectedIndex == 1;
                if (ag == agentOn) return;
                Cmd(ag ? "agent" : "chat"); // 选 Agent：页面回开文件夹选择提示框（默认文件夹免确认）
            };
            Point mm0 = Point.Empty, mf0 = Point.Empty;
            bool mHit = false, mDrag = false;
            mode.MouseDown += (s, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                mHit = true; mDrag = false; mm0 = Control.MousePosition; mf0 = Location;
            };
            mode.MouseMove += (s, e) =>
            {
                if (!mHit) return;
                var m2 = Control.MousePosition;
                int dx = m2.X - mm0.X, dy = m2.Y - mm0.Y;
                if (!mDrag && Math.Abs(dx) + Math.Abs(dy) < 6) return;
                mDrag = true;
                Location = new Point(mf0.X + dx, mf0.Y + dy);
            };
            mode.MouseUp += (s, e) => { if (mHit) { mHit = false; if (mDrag) main.SaveQuickbarPos(Location); } };

            /* 更多菜单（v1.4：替代原「问」按钮的次要动作） */
            moreMenu = new ContextMenuStrip { Font = new Font("Microsoft YaHei UI", 9.5f) };
            moreMenu.Items.Add("新建会话", null, (s, e) => Cmd("new"));
            moreMenu.Items.Add("打开主窗", null, (s, e) => OpenMain());
            moreMenu.Items.Add("设置", null, (s, e) => Cmd("settings"));
            moreMenu.Items.Add(new ToolStripSeparator());
            moreMenu.Items.Add("隐藏快速条 (Esc)", null, (s, e) => RequestHide());

            pad = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10, 11, 6, 11) };
            pad.Controls.Add(input);

            /* 简要回答区：页面流式回传直接显示在此，不切回主窗。
               v1.4.1：回答区外层 ansPanel（Dock Bottom），右侧带「清空」矢量图标按钮，一键回到原状态 */
            /* v1.8：回答区改 RichTextBox（只读），配合 MdToRtf 做轻量 Markdown 渲染：
               标题/粗斜体/行内码/代码块/列表/引用/表格/链接，不再出现裸星号 */
            answer = new RichTextBox();
            answer.ReadOnly = true;
            answer.BorderStyle = BorderStyle.None;
            answer.ScrollBars = RichTextBoxScrollBars.Vertical;
            answer.Font = new Font("Microsoft YaHei UI", 9.5f);
            answer.Dock = DockStyle.Fill;
            answer.DetectUrls = false;
            answer.Visible = true;

            clearBtn = new Button
            {
                Dock = DockStyle.Right, Width = 22,
                FlatStyle = FlatStyle.Flat, FlatAppearance = { BorderSize = 0 },
                Cursor = Cursors.Hand, TabStop = false, UseMnemonic = false, Text = ""
            };
            tip.SetToolTip(clearBtn, "清空回答，回到初始状态");
            clearBtn.Click += (s, e) => ClearAnswer();

            ansPanel = new Panel { Dock = DockStyle.Bottom, Height = 0, Visible = false };
            ansPanel.Controls.Add(answer);
            ansPanel.Controls.Add(clearBtn); // 最后加入 → 先参与 Dock（右侧 22px）

            Opacity = 0.5; // 输入条整体半透明（有回答时提高到 0.98 便于阅读）
            /* Dock 顺序：最后加入的最先参与布局 —— ansPanel 底 → tools 左 → mode 右 → pad 填充中间 */
            Controls.Add(pad);
            Controls.Add(mode);
            Controls.Add(tools);
            Controls.Add(ansPanel);
            ApplyTheme("light");
        }

        Button NewCell(int x, int y, string kind)
        {
            return new Button
            {
                Name = kind,
                Bounds = new Rectangle(x, y, 22, 22),
                FlatStyle = FlatStyle.Flat, FlatAppearance = { BorderSize = 0 },
                Cursor = Cursors.Default, TabStop = false, UseMnemonic = false, Text = ""
            };
        }

        /* 矢量图标（GDI+ 路径绘制，等价 SVG 输出；无文字字符），按 22×22 逻辑坐标绘制 */
        static void PaintIcon(Control c, string kind, Color fg, bool badge)
        {
            var bmp = new Bitmap(Math.Max(8, c.Width), Math.Max(8, c.Height));
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var pen = new Pen(fg, 1.4f))
                using (var brush = new SolidBrush(fg))
                {
                    if (kind == "file") /* 文件：折角文档 + 三行内容线；badge=有附件时右上角圆点 */
                    {
                        var p = new GraphicsPath();
                        p.AddLine(6, 3.5f, 12.5f, 3.5f);
                        p.AddLine(12.5f, 3.5f, 15.5f, 6.5f);
                        p.AddLine(15.5f, 6.5f, 15.5f, 18.5f);
                        p.AddLine(15.5f, 18.5f, 6, 18.5f);
                        p.CloseFigure();
                        g.DrawPath(pen, p);
                        g.DrawLine(pen, 12.5f, 3.5f, 12.5f, 6.5f);
                        g.DrawLine(pen, 12.5f, 6.5f, 15.5f, 6.5f);
                        g.DrawLine(pen, 8, 10, 13.5f, 10);
                        g.DrawLine(pen, 8, 12.5f, 13.5f, 12.5f);
                        g.DrawLine(pen, 8, 15, 11.5f, 15);
                        if (badge) g.FillEllipse(brush, 13.5f, 2, 6, 6);
                    }
                    else if (kind == "web") /* 联网：地球（外圆 + 经线椭圆 + 赤道） */
                    {
                        g.DrawEllipse(pen, 4, 4, 14, 14);
                        g.DrawEllipse(pen, 8.5f, 4, 5, 14);
                        g.DrawLine(pen, 4, 11, 18, 11);
                    }
                    else if (kind == "more") /* 更多：三点 */
                    {
                        g.FillEllipse(brush, 3.8f, 9.7f, 2.6f, 2.6f);
                        g.FillEllipse(brush, 9.7f, 9.7f, 2.6f, 2.6f);
                        g.FillEllipse(brush, 15.6f, 9.7f, 2.6f, 2.6f);
                    }
                    else if (kind == "grip") /* 拖动把手：3×3 点阵 */
                    {
                        for (int i = 0; i < 3; i++)
                            for (int j = 0; j < 3; j++)
                                g.FillEllipse(brush, 5.5f + i * 5, 5.5f + j * 5, 2, 2);
                    }
                    else if (kind == "clear") /* 清空：× */
                    {
                        g.DrawLine(pen, 6, 6, 15.5f, 15.5f);
                        g.DrawLine(pen, 15.5f, 6, 6, 15.5f);
                    }
                }
            }
            var old = c.BackgroundImage;
            c.BackgroundImage = bmp;
            c.BackgroundImageLayout = ImageLayout.Center;
            if (old != null) old.Dispose();
        }

        void ClearAnswer()
        {
            lastAns = "";
            if (!IsDisposed) PaintAnswer(); // 回到初始状态：收起回答区、半透明、高度 44
        }

        void Cmd(string cmd)
        {
            main.PostRaw(JsonSerializer.Serialize(new { t = "quick.cmd", cmd }));
        }

        void OpenMain()
        {
            try
            {
                main.Show();
                if (main.WindowState == FormWindowState.Minimized) main.WindowState = FormWindowState.Normal;
                main.Activate();
            }
            catch { }
        }

        /* 页面状态回显：联网开关 / Agent 模式 / 待发附件数（页面 quick.state 推送） */
        public void ApplyState(bool web, bool agent, int files)
        {
            if (IsDisposed) return;
            syncState = true;
            try { mode.SelectedIndex = agent ? 1 : 0; } finally { syncState = false; }
            webOn = web; agentOn = agent; filesN = files;
            PaintState();
        }

        void PaintState()
        {
            Color accent = BackColor.GetBrightness() < 0.5f ? Hx("#5e6ad2") : Hx("#cc785c");
            Color baseBg = pad.BackColor, baseFg = ThemeFg();
            bWeb.BackColor = webOn ? accent : baseBg;
            bWeb.ForeColor = webOn ? Color.White : baseFg;
            bFile.BackColor = filesN > 0 ? accent : baseBg;
            bFile.ForeColor = filesN > 0 ? Color.White : baseFg;
            mode.BackColor = agentOn ? accent : baseBg;
            mode.ForeColor = agentOn ? Color.White : baseFg;
            grip.BackColor = baseBg;
            tools.BackColor = baseBg;
            /* v1.4.1：矢量图标按当前主题/状态重绘（无文字字符） */
            PaintIcon(bFile, "file", filesN > 0 ? Color.White : baseFg, filesN > 0);
            PaintIcon(bWeb, "web", webOn ? Color.White : baseFg, false);
            PaintIcon(bMore, "more", baseFg, false);
            PaintIcon(grip, "grip", baseFg, false);
            PaintIcon(clearBtn, "clear", baseFg, false);
            tip.SetToolTip(bFile, filesN > 0 ? ("待发附件 " + filesN + " 个 · 点击继续添加") : "文件：添加图片/文本/文档");
            tip.SetToolTip(bWeb, webOn ? "联网搜索：开（点击关闭）" : "联网搜索：关（点击开启）");
            tip.SetToolTip(bMore, "更多：新建会话 / 打开主窗 / 设置");
            tip.SetToolTip(grip, "按住拖动移动快速条");
            tip.SetToolTip(mode, agentOn ? "Agent 模式：文件读写（工作区内免确认，区外逐次确认）" : "Chat 模式：常规对话。点选 Agent 可选择工作区文件夹");
        }

        /* 不抢主窗焦点地显示 */
        protected override bool ShowWithoutActivation { get { return true; } }

        void Reposition()
        {
            Point? saved = main.LoadQuickbarPos();
            if (saved.HasValue && OnAnyScreen(saved.Value)) { Location = saved.Value; return; } // 记住上次消失的位置
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + 8); // 默认顶部居中
        }

        static bool OnAnyScreen(Point p)
        {
            var vs = SystemInformation.VirtualScreen;
            return p.X >= vs.Left - 40 && p.Y >= vs.Top - 40 && p.X < vs.Right - 100 && p.Y < vs.Bottom - 60;
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (!Visible && !IsDisposed) main.SaveQuickbarPos(Location); // 消失时记住位置
        }

        public void Apply(bool show, string theme)
        {
            ApplyTheme(theme == "dark" ? "dark" : "light");
            if (show && !Visible) { Reposition(); Show(); if (lastAns.Length > 0) PaintAnswer(); PinTop(); } // 重新呼出时恢复上一轮回答
            else if (!show && Visible) Hide();
            ReassertTopMost();
        }

        /* 托盘菜单召唤：显示并聚焦输入框（全局热键走 Toggle） */
        public void Summon()
        {
            if (!Visible) { Reposition(); Show(); }
            PinTop();
            ReassertTopMost();
            try { BeginInvoke((Action)(() => FocusInput())); } catch { FocusInput(); }
        }

        /* 全局热键：一次按下必然「召唤」
           - 不可见 → 显示 + 聚焦
           - 可见但焦点不在条上（被别的窗口盖住 / 用户在别的应用里）→ 拉到最前 + 聚焦，不隐藏
           - 焦点已经在条上 → 隐藏
           这样不会再出现「按一次没反应、按两次才出来」的观感问题（v0.2.0） */
        public void Toggle()
        {
            if (!Visible) { ShowAndFocus(); return; }
            if (GetForegroundWindow() != Handle) { ShowAndFocus(); return; }
            Hide(); main.QuickbarSync(false);
        }

        /* 显示 + 立即置顶 + 排到消息队尾再抢焦点（Show() 当下窗口还没真正映射，同步 Activate 会失败） */
        void ShowAndFocus()
        {
            if (!Visible) { Reposition(); Show(); }
            PinTop();
            main.QuickbarSync(true);
            try { BeginInvoke((Action)(() => { PinTop(); FocusInput(); })); }
            catch { FocusInput(); }
        }

        /* 立即把窗口插到置顶层（任务栏之下），不等 2s 定时器 */
        void PinTop()
        {
            if (!Visible || IsDisposed) return;
            IntPtr tray = FindWindow("Shell_TrayWnd", null);
            SetWindowPos(Handle, tray != IntPtr.Zero ? tray : HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        /* ShowWithoutActivation 窗口不会自动获得焦点，需显式激活后聚焦输入框（v1.2.3：Alt+Space 后直接可打字） */
        void FocusInput()
        {
            try
            {
                Activate();
                SetForegroundWindow(Handle);
                input.Focus();
                input.SelectAll();
            }
            catch { }
        }

        /* 页面流式回传：在输入条内直接简要显示（不切回主窗）。
           v1.4：即使回答到达时小窗已被隐藏也先记住，重新呼出时仍显示；
           总高 = min(268, 屏幕工作区 1/3)，保证不遮挡其它应用超过三分之一屏；
           v1.4.1：回答区右侧带「清空」图标按钮，一键回到初始状态。 */
        string lastAns = "";

        public void ShowAnswer(string text, bool done)
        {
            lastAns = text ?? "";
            if (!Visible || IsDisposed) return;
            PaintAnswer();
        }

        /* v2.1：回答区是否已贴着底部（决定流式刷新要不要跟随滚动） */
        bool AnswerAtBottom()
        {
            if (answer.TextLength == 0) return true;
            try
            {
                var pt = answer.GetPositionFromCharIndex(answer.TextLength - 1);
                return pt.Y <= answer.ClientSize.Height - 4;
            }
            catch { return true; }
        }

        void PaintAnswer()
        {
            bool has = !string.IsNullOrEmpty(lastAns);
            int third = Screen.FromControl(this).WorkingArea.Height / 3;
            int full = has ? Math.Min(268, Math.Max(60, third)) : 44;
            if (has)
            {
                /* v2.1：流式刷新不再无条件拽到底 —— 重设 RTF 会重置滚动条，
                   故先记下"是否贴底"与用户当前视口首字符，重设后按需还原。 */
                bool atBottom = AnswerAtBottom();
                int keepIdx = -1;
                if (!atBottom) { try { keepIdx = answer.GetCharIndexFromPosition(new Point(2, 2)); } catch { keepIdx = -1; } }
                answer.Rtf = MdToRtf(lastAns); // v1.8：轻量 Markdown → RTF
                if (atBottom)
                {
                    answer.SelectionStart = answer.TextLength;
                    answer.ScrollToCaret();
                }
                else if (keepIdx >= 0 && keepIdx < answer.TextLength)
                {
                    answer.SelectionStart = keepIdx; // 用户自由滚动 → 保持原视口，不被流式更新打扰
                    answer.ScrollToCaret();
                }
                answer.SelectionLength = 0;
            }
            else answer.Text = "";
            Opacity = has ? 0.98 : 0.5; // 有回答时提高不透明度，便于在半透明条上直接阅读
            ansPanel.Height = Math.Max(0, full - 44);
            ansPanel.Visible = has;
            Height = full;
        }

        /* —— v1.8 轻量 Markdown → RTF（回答区） ——
           支持：#~#### 标题、**粗**、*斜*、`行内码`、``` 代码块、-/1. 列表、> 引用、|表格|、--- 分隔线、[文本](链接)。
           非 ASCII 一律走 \uN? 转义（N 为带符号 16 位），不依赖代码页。
           colortbl 色表（按主题）：1=代码底 2=链接 3=次要 4=正文；正文基线 \fs19 = 9.5pt。 */
        string MdToRtf(string md) // 实例方法：主题色取自本窗 BackColor
        {
            bool dark = BackColor.GetBrightness() < 0.5f;
            var sb = new StringBuilder(md.Length * 2 + 256);
            sb.Append(@"{\rtf1\ansi\uc1{\fonttbl{\f0\fnil\fcharset134 Microsoft YaHei UI;}{\f1\fnil Consolas;}}");
            sb.Append(dark ? @"{\colortbl;\red42\green44\blue48;\red127\green179\blue255;\red154\green160\blue170;\red208\green214\blue224;}"
                           : @"{\colortbl;\red228\green228\blue224;\red42\green106\blue208;\red119\green119\blue111;\red61\green61\blue58;}");
            sb.Append(@"\cf4\f0\fs19 ");

            var lines = md.Replace("\r\n", "\n").Split('\n');
            bool inCode = false;
            for (int i = 0; i < lines.Length; i++)
            {
                var ln = lines[i];
                if (ln.TrimStart().StartsWith("```"))
                {
                    inCode = !inCode;
                    if (!inCode) sb.Append(@"\par ");
                    continue;
                }
                if (inCode) { sb.Append(@"{\f1\cb1\cf4 ").Append(Esc(ln)).Append(@"\cb0\cf4}\line "); continue; }

                var t = ln.Trim();
                if (t.Length == 0) { sb.Append(@"\par "); continue; }

                var h = Regex.Match(t, @"^(#{1,4})\s+(.*)$");
                if (h.Success)
                {
                    string[] fs = { "", @"\fs28\b", @"\fs24\b", @"\fs21\b", @"\fs19\b" };
                    sb.Append(fs[h.Groups[1].Value.Length]).Append(' ')
                      .Append(Inline(h.Groups[2].Value)).Append(@"\b0\par ");
                    continue;
                }
                if (Regex.IsMatch(t, @"^(-{3,}|\*{3,})$")) { sb.Append(@"\emdash\emdash\emdash\par "); continue; }

                var li = Regex.Match(t, @"^([-*+]|\d+\.)\s+(.*)$");
                if (li.Success)
                {
                    string mk = li.Groups[1].Value;
                    sb.Append(mk == "-" || mk == "*" || mk == "+" ? @"\u8226? " : mk + " ");
                    sb.Append(Inline(li.Groups[2].Value)).Append(@"\par ");
                    continue;
                }
                if (t.StartsWith(">")) { sb.Append(@"{\i\cf3 ").Append(Inline(t.TrimStart('>', ' '))).Append(@"\i0\cf4}\par "); continue; }
                if (t.StartsWith("|"))
                {
                    var cells = t.Trim('|').Split('|');
                    for (int c2 = 0; c2 < cells.Length; c2++)
                    {
                        if (c2 > 0) sb.Append(@" \u9474? "); // │
                        sb.Append(Inline(cells[c2].Trim()));
                    }
                    sb.Append(@"\par ");
                    continue;
                }
                sb.Append(Inline(ln)).Append(@"\par "); // 普通行保留原始缩进
            }
            sb.Append('}'); // RTF 根组收尾
            return sb.ToString();
        }

        /* 行内标记：先转义 → 代码段抽占位防误伤 → 链接/粗/斜 → 还原代码段。
           RTF 的格式开关写在 { } 组内，出组自动失效，无需手工复位。 */
        static string Inline(string s)
        {
            s = Esc(s);
            var codes = new List<string>();
            s = Regex.Replace(s, "`([^`\n]+)`", m => { codes.Add(m.Groups[1].Value); return "\uE001" + (codes.Count - 1) + "\uE001"; });
            s = Regex.Replace(s, @"\[([^\]]+)\]\((https?://[^\s)]+)\)", @"{\cf2\ul $1\ul0\cf4}");
            s = Regex.Replace(s, @"\*\*([^*]+)\*\*", @"{\b $1}");
            s = Regex.Replace(s, @"(^|[^*])\*([^*\n]+)\*(?!\*)", @"$1{\i $2}");
            s = Regex.Replace(s, "\uE001(\\d+)\uE001", m => @"{\f1\cb1\cf4 " + codes[int.Parse(m.Groups[1].Value)] + @"\cb0\cf4}");
            return s;
        }

        /* RTF 转义：\{ } 与控制符；非 ASCII → \uN?（带符号 16 位，带 '?' 兜底字符） */
        static string Esc(string s)
        {
            var sb = new StringBuilder(s.Length + 16);
            foreach (char c in s)
            {
                if (c == '\\' || c == '{' || c == '}') sb.Append('\\').Append(c);
                else if (c == '\t') sb.Append(@"\tab ");
                else if (c < 32) sb.Append(' ');
                else if (c < 127) sb.Append(c);
                else sb.Append(@"\u").Append((short)c).Append('?');
            }
            return sb.ToString();
        }

        /* 小组件源（MicrosoftStartFeedProvider）等全屏 TopMost 窗会压过先创建的置顶窗，
           周期性重申置顶保证输入条始终可见（2s 定时器，开销可忽略） */
        System.Windows.Forms.Timer topTimer;

        void ReassertTopMost()
        {
            if (topTimer != null) return;
            topTimer = new System.Windows.Forms.Timer { Interval = 2000 };
            topTimer.Tick += (s, e) =>
            {
                if (IsDisposed || !Visible) return;
                /* v1.8：插到 Shell_TrayWnd（任务栏）正下方——仍在置顶层、照旧盖过小组件源等全屏置顶窗，
                   但把任务栏让到我们上面；快速条停在屏幕底部时不再跟自适应任务栏抢 z 序 */
                PinTop();
            };
            topTimer.Start();
        }

        const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        static Color Hx(string h) { return ColorTranslator.FromHtml(h); }

        void SetPh() { ph = true; input.Text = PH; input.ForeColor = SystemColors.GrayText; }
        Color ThemeFg() { return Hx(this.BackColor.GetBrightness() < 0.5f ? "#f7f8f8" : "#141413"); }

        void ApplyTheme(string t)
        {
            bool d = t == "dark";
            BackColor = Hx(d ? "#34343a" : "#e6dfd8");           // 1px 边框色
            pad.BackColor = Hx(d ? "#141516" : "#faf9f5");
            input.BackColor = pad.BackColor;
            input.ForeColor = ph ? SystemColors.GrayText : Hx(d ? "#f7f8f8" : "#141413");
            answer.BackColor = pad.BackColor;
            answer.ForeColor = Hx(d ? "#d0d6e0" : "#3d3d3a");
            if (lastAns.Length > 0) { try { answer.Rtf = MdToRtf(lastAns); } catch { } } // 主题色变化随 RTF 色表刷新
            moreMenu.BackColor = pad.BackColor;
            moreMenu.ForeColor = input.ForeColor;
            PaintState(); // 左侧四格 + 模式选择按主题重绘
        }

        void Send()
        {
            if (ph) return;
            var text = input.Text.Trim();
            if (text.Length == 0) return;
            input.Clear();
            ShowAnswer("", false); // 收起上一轮回答区
            main.PostRaw(JsonSerializer.Serialize(new { t = "quick.ask", text }));
        }

        void RequestHide()
        {
            Hide();
            main.PostRaw("{\"t\":\"quickbar.hidden\"}");
        }
    }
}
