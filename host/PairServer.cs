using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace SoloChatHost
{
    /// <summary>
    /// 手机 ↔ 电脑 配对/传输服务（仅桌面宿主启用）。
    /// 只暴露三个记忆文件 + 配置快照；配对码 6 位，配对后拿随机 token；不写相册、不依赖云。
    /// 用 TcpListener 自己实现极简 HTTP，避免 Windows HttpListener 的 URL ACL / 管理员权限问题。
    /// </summary>
    public class PairServer
    {
        TcpListener listener;
        CancellationTokenSource cts;
        Action<string> notify;
        string token = "";
        string configJson = "";
        string configMode = "union";
        public string Code { get; private set; }
        public int Port { get; private set; }
        readonly string memRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "SoloChat", "memory");
        static readonly string[] Names = { "USER.md", "MEMORY.md", "DREAMS.md" };
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        public bool Running { get { return listener != null; } }

        public void Start(int preferPort, Action<string> onNotify)
        {
            Stop();
            notify = onNotify;
            Code = (new Random(Guid.NewGuid().GetHashCode()).Next(100000, 999999)).ToString();
            token = Guid.NewGuid().ToString("N");
            configJson = "";
            configMode = "union";
            for (int p = preferPort; p < preferPort + 20; p++)
            {
                try
                {
                    var l = new TcpListener(IPAddress.Any, p);
                    l.Start();
                    listener = l; Port = p; break;
                }
                catch { }
            }
            if (listener == null) throw new Exception("端口 8788-8807 都被占用");
            cts = new CancellationTokenSource();
            Task.Run(() => AcceptLoop(cts.Token));
        }

        public void Stop()
        {
            try { if (cts != null) cts.Cancel(); } catch { }
            try { if (listener != null) listener.Stop(); } catch { }
            listener = null; cts = null;
        }

        public void SetConfig(string json, string mode)
        {
            if (string.IsNullOrWhiteSpace(json)) return;
            configJson = json;
            configMode = (mode == "remote") ? "remote" : "union";
        }

        public string[] LanIps()
        {
            var list = new List<string>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        var a = ua.Address;
                        if (a.AddressFamily != AddressFamily.InterNetwork) continue;
                        var s = a.ToString();
                        if (s.StartsWith("169.254.")) continue;
                        if (!list.Contains(s)) list.Add(s);
                    }
                }
            }
            catch { }
            if (!list.Contains("127.0.0.1")) list.Add("127.0.0.1");
            return list.ToArray();
        }

        async Task AcceptLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                TcpClient c = null;
                try { c = await listener.AcceptTcpClientAsync(); }
                catch { if (ct.IsCancellationRequested) return; continue; }
                var cc = c;
                Task.Run(() => Handle(cc));
            }
        }

        static int FindHeaderEnd(List<byte> b)
        {
            for (int i = 0; i + 3 < b.Count; i++)
                if (b[i] == 13 && b[i + 1] == 10 && b[i + 2] == 13 && b[i + 3] == 10) return i;
            return -1;
        }

        void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 8000;
                    var s = client.GetStream();
                    var buf = new List<byte>();
                    var tmp = new byte[4096];
                    int hdr = -1;
                    while (buf.Count < 131072)
                    {
                        int n = s.Read(tmp, 0, tmp.Length);
                        if (n <= 0) return;
                        for (int i = 0; i < n; i++) buf.Add(tmp[i]);
                        hdr = FindHeaderEnd(buf);
                        if (hdr >= 0) break;
                    }
                    if (hdr < 0) return;
                    string head = Encoding.ASCII.GetString(buf.ToArray(), 0, hdr);
                    var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    if (lines.Length == 0) return;
                    var first = lines[0].Split(' ');
                    if (first.Length < 2) return;
                    string method = first[0].ToUpperInvariant();
                    string target = first[1];
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i < lines.Length; i++)
                    {
                        int c = lines[i].IndexOf(':');
                        if (c > 0) headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
                    }
                    int clen = 0;
                    string cls;
                    if (headers.TryGetValue("Content-Length", out cls)) int.TryParse(cls, out clen);
                    if (clen < 0 || clen > 4 * 1024 * 1024) return;
                    int bodyStart = hdr + 4;
                    int have = buf.Count - bodyStart;
                    var body = new byte[clen];
                    if (have > 0) Array.Copy(buf.ToArray(), bodyStart, body, 0, Math.Min(have, clen));
                    int got = Math.Max(0, Math.Min(have, clen));
                    while (got < clen)
                    {
                        int n = s.Read(body, got, clen - got);
                        if (n <= 0) break;
                        got += n;
                    }

                    string path = target, query = "";
                    int qi = target.IndexOf('?');
                    if (qi >= 0) { path = target.Substring(0, qi); query = target.Substring(qi + 1); }

                    if (method == "OPTIONS") { Write(s, 204, "", "text/plain"); return; }

                    if (path == "/api/hello" && method == "GET")
                    {
                        Write(s, 200, Json(new { app = "SoloChat", ver = "pair-1", device = "desktop", port = Port }), "application/json");
                        return;
                    }
                    if (path == "/api/pair" && method == "POST")
                    {
                        string code = "";
                        try { using (var d = JsonDocument.Parse(Encoding.UTF8.GetString(body, 0, got))) { JsonElement e; if (d.RootElement.TryGetProperty("code", out e)) code = e.GetString() ?? ""; } } catch { }
                        if (code != Code) { Write(s, 403, Json(new { ok = false, err = "配对码不正确" }), "application/json"); return; }
                        Write(s, 200, Json(new { ok = true, token = token, device = "desktop", port = Port }), "application/json");
                        return;
                    }

                    string auth = "";
                    headers.TryGetValue("Authorization", out auth);
                    if (auth == null || auth != "Bearer " + token)
                    {
                        Write(s, 401, Json(new { ok = false, err = "未配对或 token 失效" }), "application/json");
                        return;
                    }

                    if (path == "/api/config" && method == "GET")
                    {
                        if (string.IsNullOrEmpty(configJson)) { Write(s, 404, Json(new { ok = false, err = "电脑还没有发送配置" }), "application/json"); return; }
                        Write(s, 200, configJson, "application/json");
                        return;
                    }
                    if (path == "/api/config" && method == "POST")
                    {
                        string mode = "union";
                        if (query.IndexOf("mode=remote", StringComparison.OrdinalIgnoreCase) >= 0) mode = "remote";
                        SetConfig(Encoding.UTF8.GetString(body, 0, got), mode);
                        if (notify != null) notify("{\"t\":\"pair.event\",\"kind\":\"config\",\"mode\":" + Json(mode) + ",\"data\":" + configJson + "}");
                        Write(s, 200, Json(new { ok = true }), "application/json");
                        return;
                    }
                    if (path == "/api/files" && method == "GET")
                    {
                        var arr = new List<object>();
                        Directory.CreateDirectory(memRoot);
                        foreach (var n in Names)
                        {
                            var f = Path.Combine(memRoot, n);
                            if (File.Exists(f))
                            {
                                var fi = new FileInfo(f);
                                arr.Add(new { name = n, bytes = fi.Length, mtime = fi.LastWriteTimeUtc.ToString("o") });
                            }
                        }
                        Write(s, 200, JsonSerializer.Serialize(new { ok = true, files = arr }), "application/json");
                        return;
                    }
                    if (path == "/api/file")
                    {
                        string name = QueryValue(query, "name");
                        if (!IsAllowed(name)) { Write(s, 400, Json(new { ok = false, err = "文件名不在白名单" }), "application/json"); return; }
                        var f = Path.Combine(memRoot, name);
                        if (method == "GET")
                        {
                            if (!File.Exists(f)) { Write(s, 404, Json(new { ok = false, err = "文件不存在" }), "application/json"); return; }
                            Write(s, 200, File.ReadAllText(f, Utf8), "text/markdown; charset=utf-8");
                            return;
                        }
                        if (method == "PUT")
                        {
                            Directory.CreateDirectory(memRoot);
                            File.WriteAllText(f, Encoding.UTF8.GetString(body, 0, got), Utf8);
                            if (notify != null) notify("{\"t\":\"pair.event\",\"kind\":\"file\",\"name\":" + Json(name) + "}");
                            Write(s, 200, Json(new { ok = true, name = name }), "application/json");
                            return;
                        }
                    }

                    Write(s, 404, Json(new { ok = false, err = "not found" }), "application/json");
                }
                catch { }
            }
        }

        static bool IsAllowed(string name)
        {
            foreach (var n in Names) if (n == name) return true;
            return false;
        }

        static string QueryValue(string query, string key)
        {
            foreach (var pair in (query ?? "").Split('&'))
            {
                int eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                if (pair.Substring(0, eq) != key) continue;
                try { return Uri.UnescapeDataString(pair.Substring(eq + 1).Replace("+", " ")); } catch { return pair.Substring(eq + 1); }
            }
            return "";
        }

        static string Json(object s)
        {
            return JsonSerializer.Serialize(s);
        }

        static void Write(NetworkStream s, int status, string body, string type)
        {
            byte[] b = Utf8.GetBytes(body ?? "");
            string reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Error";
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            sb.Append("Content-Type: ").Append(type).Append("\r\n");
            sb.Append("Content-Length: ").Append(b.Length).Append("\r\n");
            sb.Append("Access-Control-Allow-Origin: *\r\n");
            sb.Append("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n");
            sb.Append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n");
            sb.Append("Cache-Control: no-store\r\n");
            sb.Append("Connection: close\r\n\r\n");
            var h = Encoding.ASCII.GetBytes(sb.ToString());
            s.Write(h, 0, h.Length);
            if (b.Length > 0) s.Write(b, 0, b.Length);
            s.Flush();
        }
    }
}
