using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Desktop
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(uint process);

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool first;
        using (var wake = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Moyin.Desktop.Activate", out first))
        {
            if (!first)
            {
                uint process;
                if (GetWindowThreadProcessId(FindWindow(null, "墨隐 · 文档脱敏"), out process) != 0)
                    AllowSetForegroundWindow(process);
                wake.Set();
                return;
            }
            try
            {
                using (var job = new ServiceJob())
                using (var window = new Workspace(job))
                using (var timer = new System.Windows.Forms.Timer { Interval = 200 })
                {
                    timer.Tick += delegate { if (wake.WaitOne(0)) Workspace.Raise(window); };
                    timer.Start();
                    Application.Run(window);
                }
            }
            catch (Exception error) { MessageBox.Show(error.Message, "墨隐启动失败"); }
        }
    }
}

internal sealed class Workspace : Form
{
    private readonly ServiceJob job;
    private readonly Label status = new Label { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12) };
    private readonly WebView2 mainView = new WebView2();
    private Process service;
    private Uri origin;
    private Form formats;
    private bool checkingClose, exiting;
    private readonly string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moyin", "WebView2");

    public Workspace(ServiceJob serviceJob)
    {
        job = serviceJob;
        ConfigureWindow(this, "墨隐 · 文档脱敏");
        status.Text = "正在启动本地工作台…";
        Controls.Add(mainView);
        Controls.Add(status);
        Shown += async delegate
        {
            try
            {
                CoreWebView2Environment.GetAvailableBrowserVersionString();
                origin = await StartService();
                if (IsDisposed) return;
                await OpenView(mainView, "/", this);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                status.Text = "此电脑缺少 Microsoft Edge WebView2 Runtime。请安装 x64 常青版运行时后重新打开墨隐。";
            }
            catch (Exception error) { if (!IsDisposed) status.Text = "工作台启动失败。 " + error.Message; }
        };
        FormClosing += CheckClose;
        FormClosed += delegate
        {
            if (formats != null) formats.Close();
            if (service != null) service.Dispose();
            job.Dispose();
        };
    }

    private static void ConfigureWindow(Form form, string title)
    {
        form.Text = title;
        form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Size = new Size(1280, 860);
        form.MinimumSize = new Size(680, 460);
    }

    internal static void Raise(Form form)
    {
        if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
        form.Show();
        form.Activate();
        form.BringToFront();
    }

    private async Task<Uri> StartService()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        var start = new ProcessStartInfo(Path.Combine(root, @"runtime\node.exe"), "app.cjs --no-browser")
        {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true
        };
        service = Process.Start(start);
        job.Attach(service);
        service.EnableRaisingEvents = true;
        service.Exited += delegate
        {
            if (!IsHandleCreated || IsDisposed) return;
            BeginInvoke((Action)delegate
            {
                status.Text = "本地服务已退出。请先完成当前稿件的回填，再重新打开墨隐。";
                status.Visible = true;
            });
        };
        var ready = service.StandardOutput.ReadLineAsync();
        if (await Task.WhenAny(ready, Task.Delay(15000)) != ready) throw new TimeoutException("本地服务启动超时。");
        Uri url;
        if (!Uri.TryCreate(await ready, UriKind.Absolute, out url) || url.Scheme != "http" ||
            url.Host != "127.0.0.1" || url.Port <= 0 || url.PathAndQuery != "/" || url.UserInfo != "")
            throw new InvalidOperationException("本地服务未返回工作台地址。请检查解压目录是否完整。");
        return url;
    }

    private async Task OpenView(WebView2 view, string path, Form owner)
    {
        view.Dock = DockStyle.Fill;
        view.AllowExternalDrop = false;
        view.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = profile, IsInPrivateModeEnabled = true };
        await view.EnsureCoreWebView2Async();
        if (owner.IsDisposed) return;
        var core = view.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        Uri page = new Uri(origin, path);
        bool loaded = false;
        core.NavigationStarting += (s, e) => { e.Cancel = loaded || e.Uri != page.AbsoluteUri; };
        core.NavigationCompleted += (s, e) =>
        {
            if (loaded) return;
            if (e.IsSuccess) { loaded = true; if (view == mainView) status.Visible = false; }
            else MessageBox.Show(owner, "工作台页面加载失败，请关闭并重新打开墨隐。", "墨隐");
        };
        core.NewWindowRequested += async (s, e) =>
        {
            e.Handled = true;
            if (e.Uri == origin.AbsoluteUri) Raise(this);
            if (e.Uri == new Uri(origin, "/formats/").AbsoluteUri) await ShowFormats();
        };
        core.DownloadStarting += (s, e) =>
        {
            // Leave the source unchanged. Exports always use the location chosen by the employee.
            var deferral = e.GetDeferral();
            BeginInvoke((Action)delegate
            {
                try
                {
                    string name = Path.GetFileName(e.ResultFilePath);
                    string ext = Path.GetExtension(name);
                    using (var save = new SaveFileDialog { FileName = name, Title = "保存墨隐导出文件", RestoreDirectory = true,
                        DefaultExt = ext.TrimStart('.'), Filter = ext.Length > 1 ? "导出文件 (*" + ext + ")|*" + ext : "所有文件|*.*" })
                    {
                        if (save.ShowDialog(owner) == DialogResult.OK)
                        {
                            e.ResultFilePath = save.FileName;
                            var download = e.DownloadOperation;
                            download.StateChanged += delegate
                            {
                                if (download.State == CoreWebView2DownloadState.Interrupted && !owner.IsDisposed)
                                    MessageBox.Show(owner, "保存失败，请重新导出并检查目标目录。 " + download.InterruptReason, "墨隐");
                            };
                        }
                        else e.Cancel = true;
                        e.Handled = true;
                    }
                }
                finally { deferral.Complete(); }
            });
        };
        core.Navigate(page.AbsoluteUri);
    }

    private async Task ShowFormats()
    {
        if (formats != null) { Raise(formats); return; }
        var window = new Form();
        formats = window;
        ConfigureWindow(window, "墨隐 · 文件涂黑");
        var view = new WebView2();
        window.Controls.Add(view);
        window.FormClosed += delegate { formats = null; };
        // Both workspaces can come to the front while export/review state stays intact.
        window.Show();
        try { await OpenView(view, "/formats/", window); }
        catch (Exception error) { if (!window.IsDisposed) { MessageBox.Show(window, error.Message, "文件涂黑启动失败"); window.Close(); } }
    }

    private async void CheckClose(object sender, FormClosingEventArgs e)
    {
        if (exiting || mainView.CoreWebView2 == null) return;
        e.Cancel = true;
        if (checkingClose) return;
        checkingClose = true;
        // Defer until the first FormClosing event has finished.
        await Task.Yield();
        bool needsConfirmation = true;
        try
        {
            var check = mainView.ExecuteScriptAsync(
                "Boolean(document.querySelector('#returnVersion')?.options.length > 1 || " +
                "['body','prompt','policy','externalDraft'].some(id => document.getElementById(id)?.value.trim()) || " +
                "typeof task !== 'undefined' && task)");
            if (await Task.WhenAny(check, Task.Delay(1500)) == check) needsConfirmation = await check != "false";
        }
        catch (Exception) { /* If the renderer cannot answer, ask before discarding the session. */ }
        if (needsConfirmation || formats != null)
        {
            var answer = MessageBox.Show(this, "退出将关闭工作台和文件涂黑窗口。本次输入、核对进度和代号表将被清除。请先完成回填并保存需要的副本。现在退出吗？",
                "退出墨隐", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) { checkingClose = false; return; }
        }
        exiting = true;
        Close();
    }
}
