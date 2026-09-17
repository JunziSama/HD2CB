using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Reads only the foreground window's public metadata. No game injection or input simulation.
internal static class FocusMonitor
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int length);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static string ProcessName(uint pid)
    {
        IntPtr process = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (process == IntPtr.Zero) return null;
        try {
            StringBuilder name = new StringBuilder(32768);
            int length = name.Capacity;
            return QueryFullProcessImageName(process, 0, name, ref length) ? Path.GetFileName(name.ToString()) : null;
        } finally { CloseHandle(process); }
    }

    static int Main(string[] args)
    {
        int parentId;
        if (args.Length != 1 || !int.TryParse(args[0], out parentId)) return 2;
        Console.OutputEncoding = new UTF8Encoding(false);
        // EOF detects parent crashes even if its PID is immediately reused.
        Thread input = new Thread(delegate() {
            try { while (Console.Read() != -1) {} } catch {}
            Environment.Exit(0);
        });
        input.IsBackground = true;
        input.Start();
        try {
            using (Process parent = Process.GetProcessById(parentId)) {
                JavaScriptSerializer json = new JavaScriptSerializer();
                Stopwatch clock = Stopwatch.StartNew();
                string previous = null;
                long lastSent = -1000;
                while (!parent.HasExited) {
                    string message;
                    try {
                        IntPtr window = GetForegroundWindow();
                        uint pid;
                        GetWindowThreadProcessId(window, out pid);
                        StringBuilder title = new StringBuilder(4096);
                        GetWindowText(window, title, title.Capacity);
                        string name = window == IntPtr.Zero ? null : ProcessName(pid);
                        // Discard a sample if focus changed during the metadata reads.
                        if (GetForegroundWindow() != window) { Thread.Sleep(10); continue; }
                        message = json.Serialize(new { type = "state", hasWindow = window != IntPtr.Zero,
                            minimized = IsIconic(window), processName = name, title = title.ToString(), error = (string)null });
                    } catch (Exception error) {
                        message = json.Serialize(new { type = "state", hasWindow = false, minimized = false,
                            processName = (string)null, title = "", error = error.Message });
                    }
                    if (message != previous || clock.ElapsedMilliseconds - lastSent >= 1000) {
                        Console.WriteLine(message);
                        Console.Out.Flush();
                        previous = message;
                        lastSent = clock.ElapsedMilliseconds;
                    }
                    Thread.Sleep(100);
                }
            }
        } catch { return 1; }
        return 0;
    }
}
