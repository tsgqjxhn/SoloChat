using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
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
        QuickBarForm quickBar;
        NotifyIcon tray;
        bool realExit;
        bool hotReg;
        bool memLow;
        IntPtr hotHwnd;
        const int WM_HOTKEY = 0x0312;
        const int HOTKEY_ID = 0x5C1;
        readonly ConcurrentDictionary<string, CancellationTokenSource> inflight =
            new ConcurrentDictionary<string, CancellationTokenSource>();
        static readonly HttpClient Http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
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
            var env = await CoreWebView2Environment.CreateAsync(null, userData,
                new CoreWebView2EnvironmentOptions(DebugArgs));
            await wv.EnsureCoreWebView2Async(env);

            var s = wv.CoreWebView2.Settings;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.AreDevToolsEnabled = DevMode;
            s.AreBrowserAcceleratorKeysEnabled = false; // 浏览器内置快捷键（Ctrl+N 等）交给页面处理

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
        void SyncMemTarget() { SetMemTarget(!Visible || WindowState == FormWindowState.Minimized); }
        void SetMemTarget(bool low)
        {
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
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);

        protected override void WndProc(ref Message m)
        {
            /* 全出血客户区（去标题栏 v1.2）：吞掉 NCCALCSIZE 消除边框留白（顶部深色边与四周空隙）；
               最大化时按缩放边宽度内缩补偿 THICKFRAME 外扩，避免内容被顶出屏幕 */
            if (m.Msg == 0x0083 && m.WParam != IntPtr.Zero) // WM_NCCALCSIZE
            {
                if (WindowState == FormWindowState.Maximized)
                {
                    int fx = GetSystemMetrics(32) + GetSystemMetrics(92); // SM_CXSIZEFRAME + SM_CXPADDEDBORDER
                    int fy = GetSystemMetrics(33) + GetSystemMetrics(92); // SM_CYSIZEFRAME + SM_CXPADDEDBORDER
                    var rc = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
                    rc.L += fx; rc.T += fy; rc.R -= fx; rc.B -= fy;
                    Marshal.StructureToPtr(rc, m.LParam, false);
                }
                m.Result = IntPtr.Zero;
                return;
            }
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt64() == HOTKEY_ID)
            {
                if (quickBar != null) quickBar.Toggle(); // 热键 = 显隐切换，不是聚焦
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
            try
            {
                // 仅放行 http/https 外链，防 file://、UNC、ms-msdt:、search-ms: 等被 Shell 直接执行
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri u) &&
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
                    else if (t == "quick.answer")
                    {
                        var qaText = root.TryGetProperty("text", out JsonElement ta) ? ta.GetString() : "";
                        bool qaDone = root.TryGetProperty("done", out JsonElement td) && td.GetBoolean();
                        var qb2 = quickBar; var qaCopy = qaText;
                        BeginInvoke((Action)(() => qb2.ShowAnswer(qaCopy, qaDone)));
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

        /* F1：Release 构建日志整体禁用（宏剥离）；DEBUG 构建脱敏 + 限长。旧版曾明文写入，启动即删除。 */
        public static void Log(string s)
        {
#if DEBUG
            try
            {
                var p = Path.Combine(Path.GetTempPath(), "solo-host.log");
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
                    var body = req.TryGetProperty("body", out JsonElement bEl) ? bEl.GetString() : null;
                    if (!string.IsNullOrEmpty(body))
                        m.Content = new StringContent(body, Encoding.UTF8, "application/json");

                    using (var resp = await Http.SendAsync(m, HttpCompletionOption.ResponseHeadersRead, cts.Token))
                    {
                        Post(id, "http.meta", null, null, (int)resp.StatusCode);
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
        static void NoReparse(string full, string prefix)
        {
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

        void FsWrite(JsonElement req, string id)
        {
            string rel = req.GetProperty("path").GetString() ?? "";
            string p = GuardPath(ReqRoot(req), rel);
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
            string dir = Path.GetDirectoryName(p);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir); // 自动建父目录
            File.WriteAllText(p, data, bom ? new UTF8Encoding(true) : FsUtf8);
            Log("fs write ok: " + rel + " bytes=" + n);
            PostFs(id, "fs.done", JsonSerializer.Serialize(new { path = rel, bytes = n }), null);
        }

        void PickRoot(string id)
        {
            try
            {
                using (var dlg = new FolderBrowserDialog { Description = "选择本会话的工作区根目录" })
                {
                    var owner = Visible ? (IWin32Window)this : null;
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
        readonly TextBox answer;
        readonly Button send;
        readonly Panel pad;
        const string PH = "快捷提问，Enter 发送，Esc 隐藏";
        bool ph;

        public QuickBarForm(MainForm main)
        {
            this.main = main;
            FormBorderStyle = FormBorderStyle.None;
            TopMost = true;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(480, 44);
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

            send = new Button();
            send.Text = "问";
            send.FlatStyle = FlatStyle.Flat;
            send.FlatAppearance.BorderSize = 0;
            send.Dock = DockStyle.Right;
            send.Width = 44;
            send.Cursor = Cursors.SizeAll;
            send.Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold);
            /* 问按钮：单击发送，按住拖动可移动输入条位置 */
            Point mouse0 = Point.Empty, form0 = Point.Empty;
            bool dragHit = false, dragged = false;
            send.MouseDown += (s, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                dragHit = true; dragged = false;
                mouse0 = Control.MousePosition; form0 = Location;
            };
            send.MouseMove += (s, e) =>
            {
                if (!dragHit) return;
                var m2 = Control.MousePosition;
                int dx = m2.X - mouse0.X, dy = m2.Y - mouse0.Y;
                if (!dragged && Math.Abs(dx) + Math.Abs(dy) < 6) return;
                dragged = true;
                Location = new Point(form0.X + dx, form0.Y + dy);
            };
            send.MouseUp += (s, e) =>
            {
                if (!dragHit) return;
                dragHit = false;
                if (dragged) main.SaveQuickbarPos(Location);
                else Send();
            };

            pad = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10, 11, 6, 11) };
            pad.Controls.Add(input);

            /* 简要回答区：页面流式回传直接显示在此，不切回主窗（Dock 布局最后加入的先处理） */
            answer = new TextBox();
            answer.Multiline = true;
            answer.ReadOnly = true;
            answer.BorderStyle = BorderStyle.None;
            answer.ScrollBars = ScrollBars.Vertical;
            answer.Font = new Font("Microsoft YaHei UI", 9.5f);
            answer.Dock = DockStyle.Bottom;
            answer.Height = 180;
            answer.Visible = false;

            Opacity = 0.5; // 输入条整体半透明
            Controls.Add(send);
            Controls.Add(pad);
            Controls.Add(answer);
            ApplyTheme("light");
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
            if (show && !Visible) { Reposition(); Show(); }
            else if (!show && Visible) Hide();
            ReassertTopMost();
        }

        /* 托盘菜单召唤：显示并聚焦输入框（全局热键走 Toggle 显隐切换） */
        public void Summon()
        {
            if (!Visible) { Reposition(); Show(); }
            ReassertTopMost();
            FocusInput();
        }

        /* 全局热键：显隐切换（再按一次隐藏） */
        public void Toggle()
        {
            if (Visible) { Hide(); main.QuickbarSync(false); }
            else { Reposition(); Show(); ReassertTopMost(); FocusInput(); main.QuickbarSync(true); }
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

        /* 页面流式回传：在输入条内直接简要显示（不切回主窗） */
        public void ShowAnswer(string text, bool done)
        {
            if (!Visible || IsDisposed) return;
            bool has = !string.IsNullOrEmpty(text);
            answer.Visible = has;
            Height = has ? 224 : 44;
            if (has)
            {
                answer.Text = text;
                answer.SelectionStart = answer.TextLength;
                answer.ScrollToCaret();
            }
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
                if (!IsDisposed && Visible)
                    SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            };
            topTimer.Start();
        }

        const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr h);

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
            send.BackColor = Hx(d ? "#5e6ad2" : "#cc785c");
            send.ForeColor = Color.White;
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
