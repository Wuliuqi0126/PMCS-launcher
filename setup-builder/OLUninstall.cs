using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("PMCS launcher 卸载程序")]
[assembly: System.Reflection.AssemblyProduct("PMCS launcher")]
[assembly: System.Reflection.AssemblyCompany("PMCS launcher")]
[assembly: System.Reflection.AssemblyVersion("2.3.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("2.3.0.0")]

namespace OLUninstall
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new UninstallForm());
        }
    }

    internal sealed class UninstallForm : Form
    {
        private readonly string target;
        private readonly string userData;
        private readonly string gameDir;
        private readonly CheckBox deleteResources;
        private readonly CheckBox deleteConfig;
        private readonly CheckBox removeTailscale;
        private readonly Label status;
        private readonly Button uninstallButton;
        private readonly Button cancelButton;
        private bool running;

        public UninstallForm()
        {
            target = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            userData = Path.Combine(appData, "PMCS launcher");
            gameDir = ReadGameDir(userData)
                ?? ReadGameDir(Path.Combine(appData, "ol-launcher"))
                ?? ReadGameDir(Path.Combine(appData, "OL启动器"))
                ?? Path.Combine(appData, ".oasis");

            Text = "卸载 PMCS launcher";
            ClientSize = new Size(590, 420);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = SystemColors.Window;
            ForeColor = SystemColors.WindowText;
            Font = new Font("Microsoft YaHei UI", 9F);

            Label title = new Label();
            title.Text = "卸载 PMCS launcher";
            title.Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(22, 20);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "卸载程序文件，并选择是否同时清理本地资源。";
            subtitle.ForeColor = Color.FromArgb(95, 95, 95);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(25, 58);
            Controls.Add(subtitle);

            GroupBox locationGroup = new GroupBox();
            locationGroup.Text = "安装位置";
            locationGroup.Location = new Point(22, 88);
            locationGroup.Size = new Size(546, 78);
            Controls.Add(locationGroup);

            Label location = new Label();
            location.Text = target;
            location.AutoEllipsis = true;
            location.Location = new Point(14, 26);
            location.Size = new Size(516, 22);
            locationGroup.Controls.Add(location);

            Label resourcePath = new Label();
            resourcePath.Text = "游戏资源：" + gameDir;
            resourcePath.AutoEllipsis = true;
            resourcePath.ForeColor = Color.FromArgb(100, 100, 100);
            resourcePath.Location = new Point(14, 48);
            resourcePath.Size = new Size(516, 20);
            locationGroup.Controls.Add(resourcePath);

            GroupBox optionGroup = new GroupBox();
            optionGroup.Text = "卸载选项";
            optionGroup.Location = new Point(22, 178);
            optionGroup.Size = new Size(546, 108);
            Controls.Add(optionGroup);

            deleteResources = new CheckBox();
            deleteResources.Text = "同时删除本地游戏资源（存档、模组、资源包、版本库）";
            deleteResources.AutoSize = true;
            deleteResources.Location = new Point(14, 24);
            optionGroup.Controls.Add(deleteResources);

            deleteConfig = new CheckBox();
            deleteConfig.Text = "同时删除账户与启动器配置";
            deleteConfig.AutoSize = true;
            deleteConfig.Location = new Point(14, 50);
            optionGroup.Controls.Add(deleteConfig);

            removeTailscale = new CheckBox();
            removeTailscale.Text = "同时卸载 Tailscale（会断开其他 Tailscale 连接）";
            removeTailscale.Checked = true;
            removeTailscale.AutoSize = true;
            removeTailscale.Location = new Point(14, 76);
            optionGroup.Controls.Add(removeTailscale);

            status = new Label();
            status.Text = "默认保留存档/配置，并一并卸载 Tailscale。";
            status.ForeColor = Color.FromArgb(90, 90, 90);
            status.Location = new Point(22, 300);
            status.Size = new Size(546, 34);
            Controls.Add(status);

            uninstallButton = new Button();
            uninstallButton.Text = "卸载";
            uninstallButton.Location = new Point(386, 356);
            uninstallButton.Size = new Size(88, 30);
            uninstallButton.Click += UninstallClick;
            Controls.Add(uninstallButton);

            cancelButton = new Button();
            cancelButton.Text = "取消";
            cancelButton.Location = new Point(480, 356);
            cancelButton.Size = new Size(88, 30);
            cancelButton.Click += delegate { if (!running) Close(); };
            Controls.Add(cancelButton);

            AcceptButton = uninstallButton;
            CancelButton = cancelButton;
        }

        private static string ReadGameDir(string userData)
        {
            try
            {
                string file = Path.Combine(userData, "config.json");
                if (!File.Exists(file)) return null;
                string text = File.ReadAllText(file);
                Match match = Regex.Match(text, "\"gameDir\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
                if (!match.Success) return null;
                string value = Regex.Unescape(match.Groups[1].Value);
                return string.IsNullOrWhiteSpace(value) ? null : Path.GetFullPath(value);
            }
            catch { return null; }
        }

        private void UninstallClick(object sender, EventArgs e)
        {
            if (running) return;
            string extra = deleteResources.Checked ? "\n\n本地游戏资源也会被删除，无法恢复。" : "\n\n本地游戏资源和存档会保留。";
            if (removeTailscale.Checked) extra += "\nTailscale 也会被卸载，其他 Tailscale 连接会断开。";
            if (MessageBox.Show(this, "确定要卸载 PMCS launcher 吗？" + extra, "确认卸载",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;

            running = true;
            uninstallButton.Enabled = false;
            cancelButton.Enabled = false;
            deleteResources.Enabled = false;
            deleteConfig.Enabled = false;
            removeTailscale.Enabled = false;
            status.Text = "正在关闭相关进程…";

            bool resources = deleteResources.Checked;
            bool config = deleteConfig.Checked;
            bool uninstallTailscale = removeTailscale.Checked;
            Thread thread = new Thread(delegate ()
            {
                try
                {
                    StopTailscaleUp();
                    KillAppProcesses();
                    if (uninstallTailscale)
                    {
                        BeginInvoke((Action)delegate { status.Text = "正在卸载 Tailscale…"; });
                        RemoveTailscale();
                    }
                    RemoveFirewallRules();
                    RemoveShortcuts();
                    RemoveRegistry();
                    DeleteProgramFiles(resources);

                    if (resources) DeleteResources(gameDir);
                    if (config) DeleteUserData(userData);

                    BeginInvoke((Action)delegate
                    {
                        status.Text = "卸载完成。";
                        MessageBox.Show(this, "PMCS launcher 已卸载。", "卸载完成",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                        ScheduleSelfDelete();
                        Close();
                    });
                }
                catch (Exception ex)
                {
                    BeginInvoke((Action)delegate
                    {
                        running = false;
                        uninstallButton.Enabled = true;
                        cancelButton.Enabled = true;
                        deleteResources.Enabled = true;
                        deleteConfig.Enabled = true;
                        removeTailscale.Enabled = true;
                        status.Text = "卸载失败：" + ex.Message;
                        MessageBox.Show(this,
                            ex.Message + "\n\n请先完全退出启动器和 Minecraft，再重试。",
                            "卸载失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private static void RemoveTailscale()
        {
            try
            {
                string productCode = FindTailscaleProductCode();
                if (string.IsNullOrEmpty(productCode)) return;

                ProcessStartInfo info = new ProcessStartInfo("msiexec.exe",
                    "/x " + productCode + " /qn /norestart")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                using (Process process = Process.Start(info))
                {
                    if (process != null) process.WaitForExit(120000);
                }

                string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                string dataDir = Path.Combine(programData, "Tailscale");
                if (Directory.Exists(dataDir)) Directory.Delete(dataDir, true);
            }
            catch { /* Tailscale may be absent or locked; continue uninstall */ }
        }

        private static string FindTailscaleProductCode()
        {
            RegistryKey[] roots = { Registry.LocalMachine, Registry.CurrentUser };
            string[] paths =
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            };
            foreach (RegistryKey root in roots)
            {
                foreach (string path in paths)
                {
                    try
                    {
                        using (RegistryKey key = root.OpenSubKey(path))
                        {
                            if (key == null) continue;
                            foreach (string name in key.GetSubKeyNames())
                            {
                                using (RegistryKey sub = key.OpenSubKey(name))
                                {
                                    if (sub == null) continue;
                                    string display = Convert.ToString(sub.GetValue("DisplayName"));
                                    if (string.IsNullOrEmpty(display) ||
                                        display.IndexOf("Tailscale", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    if (name.StartsWith("{", StringComparison.Ordinal) && name.EndsWith("}", StringComparison.Ordinal))
                                        return name;
                                    string uninstall = Convert.ToString(sub.GetValue("UninstallString"));
                                    Match match = Regex.Match(uninstall ?? "", @"\{[0-9A-Fa-f-]{36}\}");
                                    if (match.Success) return match.Value;
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            return "";
        }

        private static void StopTailscaleUp()
        {
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name = 'tailscale.exe'"))
                {
                    foreach (ManagementObject item in searcher.Get())
                    {
                        try
                        {
                            string commandLine = Convert.ToString(item["CommandLine"]);
                            if (string.IsNullOrEmpty(commandLine)) continue;
                            if (!Regex.IsMatch(commandLine, @"(?:^|\s)up(?:\s|$)", RegexOptions.IgnoreCase)) continue;
                            int pid = Convert.ToInt32(item["ProcessId"]);
                            try { Process.GetProcessById(pid).Kill(); } catch { }
                        }
                        catch { }
                    }
                }
            }
            catch { /* WMI may be unavailable */ }
        }

        private static void KillAppProcesses()
        {
            string[] names = { "PMCS launcher", "OL我的世界启动器", "OL启动器" };
            foreach (string name in names)
            {
                foreach (Process process in Process.GetProcessesByName(name))
                {
                    try { process.Kill(); } catch { }
                }
            }
            Thread.Sleep(400);
        }

        private static void RemoveFirewallRules()
        {
            string[] names =
            {
                "PMCS launcher Private",
                "PMCS launcher LAN Discovery",
                "PMCS launcher Save Share",
                "PMCS launcher Save Discovery",
                "PMCS launcher Resource Share",
                "PMCS launcher Resource Discovery",
                "PMCS launcher Network Presence",
                "PMCS launcher Java LAN",
                "PMCS launcher Java 25565",
                "PMCS IPv6 Direct",
                "PMCS IPv6 Resource",
                "PMCS_IPv6_Direct",
                "OL Launcher Private",
                "OL Launcher LAN Discovery",
                "OL Launcher Save Share",
                "OL Launcher Save Discovery",
                "OL Launcher Java LAN",
                "OL Launcher Java 25565",
            };
            foreach (string name in names)
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo("netsh.exe", "advfirewall firewall delete rule name=\"" + name + "\"");
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process process = Process.Start(info))
                    {
                        if (process != null) process.WaitForExit(5000);
                    }
                }
                catch { /* ignore */ }
            }
        }

        private void RemoveShortcuts()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            TryDelete(Path.Combine(desktop, "PMCS launcher.lnk"));
            TryDelete(Path.Combine(desktop, "OL我的世界启动器.lnk"));
            TryDelete(Path.Combine(desktop, "OL启动器.lnk"));

            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string[] groups = { "PMCS launcher", "OL我的世界启动器", "OL启动器" };
            foreach (string group in groups)
            {
                string folder = Path.Combine(programs, group);
                try { if (Directory.Exists(folder)) Directory.Delete(folder, true); } catch { }
            }
        }

        private static void RemoveRegistry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PMCSLauncher", false);
            }
            catch { }
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\OLLauncher", false);
            }
            catch { }
        }

        private void DeleteProgramFiles(bool deleteResources)
        {
            string keepResources = Path.Combine(target, "游戏目录");
            foreach (string entry in Directory.GetFileSystemEntries(target))
            {
                string full = Path.GetFullPath(entry);
                if (string.Equals(full, Application.ExecutablePath, StringComparison.OrdinalIgnoreCase)) continue;
                if (!deleteResources && string.Equals(full, keepResources, StringComparison.OrdinalIgnoreCase)) continue;
                if (deleteResources && string.Equals(full, gameDir, StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    if (Directory.Exists(full)) Directory.Delete(full, true);
                    else File.Delete(full);
                }
                catch (Exception ex)
                {
                    throw new IOException("无法删除 " + full + "：" + ex.Message, ex);
                }
            }
        }

        private static void DeleteResources(string dir)
        {
            if (!IsSafeDataDir(dir)) return;
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }

        private static void DeleteUserData(string dir)
        {
            if (!IsSafeDataDir(dir)) return;
            if (Directory.Exists(dir)) Directory.Delete(dir, true);

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            foreach (string legacy in new[] { "ol-launcher", "OL启动器", "绿洲启动器", "oasis-launcher" })
            {
                string path = Path.Combine(appData, legacy);
                if (IsSafeDataDir(path) && Directory.Exists(path)) Directory.Delete(path, true);
            }
        }

        private static bool IsSafeDataDir(string dir)
        {
            if (string.IsNullOrWhiteSpace(dir)) return false;
            string full = Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar);
            string root = (Path.GetPathRoot(full) ?? "").TrimEnd(Path.DirectorySeparatorChar);
            if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase)) return false;

            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd(Path.DirectorySeparatorChar);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles).TrimEnd(Path.DirectorySeparatorChar);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86).TrimEnd(Path.DirectorySeparatorChar);
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd(Path.DirectorySeparatorChar);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData).TrimEnd(Path.DirectorySeparatorChar);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData).TrimEnd(Path.DirectorySeparatorChar);

            if (string.Equals(full, userProfile, StringComparison.OrdinalIgnoreCase)) return false;
            if (string.Equals(full, appData, StringComparison.OrdinalIgnoreCase)) return false;
            if (string.Equals(full, localAppData, StringComparison.OrdinalIgnoreCase)) return false;
            foreach (string protectedDir in new[] { windows, programFiles, programFilesX86 })
            {
                if (string.Equals(full, protectedDir, StringComparison.OrdinalIgnoreCase)) return false;
                if (full.StartsWith(protectedDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
            }
            return true;
        }

        private static void TryDelete(string file)
        {
            try { if (File.Exists(file)) File.Delete(file); } catch { }
        }

        private void ScheduleSelfDelete()
        {
            try
            {
                string cmd = "/c ping 127.0.0.1 -n 2 >nul & del /f /q \"" + Application.ExecutablePath + "\" & rmdir \"" + target + "\" 2>nul";
                Process.Start(new ProcessStartInfo("cmd.exe", cmd)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            }
            catch { }
        }
    }
}
