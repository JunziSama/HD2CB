using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Isolated foreground test fixture, compiled under .qa as helldivers2.exe.
internal static class TestGame
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [STAThread] static void Main()
    {
        Application.EnableVisualStyles();
        Form window = new Form { Text = "HD2CB 焦点测试窗口（非游戏）", Width = 440, Height = 150 };
        window.KeyPreview = true;
        window.KeyDown += delegate(object sender, KeyEventArgs e) { Console.WriteLine("received-key:" + e.KeyCode); Console.Out.Flush(); };
        window.Controls.Add(new Label { Text = "自动检查前台识别与切出隐藏，即将自动关闭。", Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter });
        window.Shown += delegate {
            Console.WriteLine("ready"); Console.Out.Flush();
            Thread input = new Thread(delegate() {
                string command;
                while ((command = Console.ReadLine()) != null) {
                    string action = command;
                    window.BeginInvoke(new Action(delegate {
                        if (action == "minimize") window.WindowState = FormWindowState.Minimized;
                        if (action == "activate") { window.WindowState = FormWindowState.Normal; window.Activate(); }
                        if (action.StartsWith("key:")) {
                            // Never inject test keys into another application.
                            if (GetForegroundWindow() == window.Handle) SendKeys.SendWait(action.Substring(4));
                            else { Console.WriteLine("key skipped: fixture is not foreground"); Console.Out.Flush(); }
                        }
                        if (action == "exit") window.Close();
                    }));
                }
                Environment.Exit(0);
            });
            input.IsBackground = true; input.Start();
            window.Activate();
        };
        Application.Run(window);
    }
}
