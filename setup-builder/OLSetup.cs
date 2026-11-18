using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("PMCS launcher 安装程序")]
[assembly: AssemblyProduct("PMCS launcher")]
[assembly: AssemblyCompany("PMCS launcher")]
[assembly: AssemblyDescription("PMCS launcher 2.0.0 安装程序")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

namespace OLSetup
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool silent = false;
            string target = null;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "/SILENT", StringComparison.OrdinalIgnoreCase)) silent = true;
                if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase)) target = arg.Substring(5).Trim('"');
            }
            if (string.IsNullOrEmpty(target))
                target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PMCS launcher");

            if (silent)
            {
                try { Installer.Install(target, null); Environment.Exit(0); }
                catch (Exception ex) { Console.Error.WriteLine(ex.ToString()); Environment.Exit(1); }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(target));
        }
    }

    internal static class Installer
    {
        private static readonly byte[] Magic = Encoding.ASCII.GetBytes("OLSETUP1");

        public static void Install(string target, Action<int, string> progress)
        {
            Install(target, progress, true);
        }

        public static void Install(string target, Action<int, string> progress, bool desktopShortcut)
        {
            StopTailscaleUp();
            string self = Application.ExecutablePath;
            long zipOffset;
            long zipLength;
            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (fs.Length < 24) throw new InvalidOperationException("安装包数据不完整");
                fs.Seek(-24, SeekOrigin.End);
                byte[] footer = new byte[24];
                fs.Read(footer, 0, footer.Length);
                for (int i = 0; i < Magic.Length; i++)
                    if (footer[i] != Magic[i]) throw new InvalidOperationException("安装包格式错误");
                zipOffset = BitConverter.ToInt64(footer, 8);
                zipLength = BitConverter.ToInt64(footer, 16);
                if (zipOffset <= 0 || zipLength <= 0 || zipOffset + zipLength > fs.Length) throw new InvalidOperationException("安装包数据无效");
            }

            string fullTarget = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            Directory.CreateDirectory(fullTarget);
            EnsureWritable(fullTarget);

            int total;
            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                using (SubStream sub = new SubStream(fs, zipOffset, zipLength))
                using (ZipArchive zip = new ZipArchive(sub, ZipArchiveMode.Read))
                {
                    total = zip.Entries.Count;
                    int done = 0;
                    foreach (ZipArchiveEntry entry in zip.Entries)
                    {
                        done++;
                        string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        if (string.IsNullOrEmpty(name)) continue;
                        string dest = Path.GetFullPath(Path.Combine(fullTarget, name));
                        if (!dest.StartsWith(fullTarget, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("安装包包含非法路径");
                        if (name.EndsWith(Path.DirectorySeparatorChar.ToString())) { Directory.CreateDirectory(dest); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(dest));
                        if (File.Exists(dest))
                        {
                            FileAttributes attributes = File.GetAttributes(dest);
                            if ((attributes & FileAttributes.ReadOnly) != 0)
                                File.SetAttributes(dest, attributes & ~FileAttributes.ReadOnly);
                        }
                        try
                        {
                            entry.ExtractToFile(dest, true);
                        }
                        catch (UnauthorizedAccessException ex)
                        {
                            throw new UnauthorizedAccessException(
                                "无法写入 " + dest + "。请先关闭正在运行的 PMCS launcher；如果目录属于系统保护位置，请换一个可写目录。",
                                ex);
                        }
                        if (progress != null) progress((int)(done * 90.0 / Math.Max(1, total)), "正在安装：" + name);
                    }
                }
            }

            if (progress != null) progress(93, "正在创建快捷方式…");
            string exe = Path.Combine(fullTarget, "PMCS launcher.exe");
            string uninstaller = Path.Combine(fullTarget, "Uninstall.exe");
            string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "PMCS launcher");
            try { File.Delete(Path.Combine(fullTarget, "Uninstall.cmd")); } catch { /* old uninstaller */ }
            foreach (string legacyExe in new string[] { "OL我的世界启动器.exe", "OL启动器.exe" })
            {
                try { File.Delete(Path.Combine(fullTarget, legacyExe)); } catch { /* keep old file if locked */ }
            }
            if (desktopShortcut)
            {
                try
                {
                    CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PMCS launcher.lnk"), exe, fullTarget);
                }
                catch { /* the application is still installed if shell integration is blocked */ }
            }
            try
            {
                Directory.CreateDirectory(programs);
                CreateShortcut(Path.Combine(programs, "PMCS launcher.lnk"), exe, fullTarget);
            }
            catch { /* keep the installed files usable */ }
            RemoveLegacyShortcuts();
            if (progress != null) progress(96, "正在配置 Windows 防火墙…");
            ConfigureFirewall(exe);
            if (progress != null) progress(98, "正在写入卸载信息…");
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PMCSLauncher"))
                {
                    key.SetValue("DisplayName", "PMCS launcher");
                    key.SetValue("DisplayVersion", "2.0.0");
                    key.SetValue("Publisher", "PMCS launcher");
                    key.SetValue("InstallLocation", fullTarget);
                    key.SetValue("DisplayIcon", exe);
                    key.SetValue("UninstallString", "\"" + uninstaller + "\"");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
            catch { /* registry can be restricted by policy */ }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\OLLauncher", false); } catch { }
            if (progress != null) progress(100, "安装完成。");
        }

        private static void ConfigureFirewall(string exe)
        {
            foreach (string legacy in new string[]
            {
                "OL Launcher Private", "OL Launcher LAN Discovery", "OL Launcher Save Share",
                "OL Launcher Save Discovery", "OL Launcher Java LAN", "OL Launcher Java 25565",
            })
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo("netsh.exe", "advfirewall firewall delete rule name=\"" + legacy + "\"");
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process process = Process.Start(info))
                    {
                        if (process != null) process.WaitForExit(5000);
                    }
                }
                catch { }
            }
            string[] rules =
            {
                "name=\"PMCS launcher Private\" dir=in action=allow program=\"" + exe + "\" profile=private,domain enable=yes",
                "name=\"PMCS launcher LAN Discovery\" dir=in action=allow protocol=UDP localport=24454 profile=private,domain enable=yes",
                "name=\"PMCS launcher Save Share\" dir=in action=allow protocol=TCP localport=24455 profile=private,domain enable=yes",
                "name=\"PMCS launcher Save Discovery\" dir=in action=allow protocol=UDP localport=24456 profile=private,domain enable=yes",
                "name=\"PMCS launcher Resource Share\" dir=in action=allow protocol=TCP localport=24460 profile=private,domain enable=yes",
                "name=\"PMCS launcher Resource Discovery\" dir=in action=allow protocol=UDP localport=24461 profile=private,domain enable=yes",
                "name=\"PMCS launcher Network Presence\" dir=in action=allow protocol=UDP localport=24457 profile=private,domain enable=yes",
                "name=\"PMCS launcher Java LAN\" dir=in action=allow protocol=TCP localport=49152-65535 profile=private,domain enable=yes",
                "name=\"PMCS launcher Java 25565\" dir=in action=allow protocol=TCP localport=25565 profile=private,domain enable=yes",
            };
            foreach (string rule in rules)
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo("netsh.exe", "advfirewall firewall add rule " + rule);
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process process = Process.Start(info))
                    {
                        if (process != null) process.WaitForExit(8000);
                    }
                }
                catch { /* firewall policy may be managed by the organization */ }
            }
        }

        private static void RemoveLegacyShortcuts()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            foreach (string name in new string[] { "OL我的世界启动器", "OL启动器", "OL launcher" })
            {
                try
                {
                    string link = Path.Combine(desktop, name + ".lnk");
                    if (File.Exists(link)) File.Delete(link);
                }
                catch { }
                try
                {
                    string group = Path.Combine(programs, name);
                    if (Directory.Exists(group)) Directory.Delete(group, true);
                }
                catch { }
            }
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
            catch { /* WMI may be unavailable; installation can continue */ }
        }

        private static void EnsureWritable(string target)
        {
            string probe = Path.Combine(target, ".ol-write-test-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    stream.WriteByte(0);
            }
            catch (Exception ex)
            {
                throw new UnauthorizedAccessException(
                    "安装目录不可写：" + target + "。请选择 D 盘或用户目录下的可写文件夹，或以管理员身份运行安装器。",
                    ex);
            }
            // Some antivirus scanners briefly hold a newly created file. A failed
            // cleanup must not turn a writable directory into a false negative.
            try { File.Delete(probe); } catch { }
        }

        private static void CreateShortcut(string link, string exe, string workDir)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { exe });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { exe + ",0" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        private static void WriteUninstaller(string target, string programs)
        {
            string root = target.TrimEnd(Path.DirectorySeparatorChar);
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenu = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string script = "@echo off\r\n" +
                "cd /d \"%TEMP%\"\r\n" +
                "del \"" + Path.Combine(desktop, "PMCS launcher.lnk") + "\"\r\n" +
                "del \"" + Path.Combine(desktop, "OL我的世界启动器.lnk") + "\"\r\n" +
                "del \"" + Path.Combine(desktop, "OL启动器.lnk") + "\"\r\n" +
                "rmdir /s /q \"" + programs + "\"\r\n" +
                "rmdir /s /q \"" + Path.Combine(startMenu, "OL我的世界启动器") + "\"\r\n" +
                "rmdir /s /q \"" + Path.Combine(startMenu, "OL启动器") + "\"\r\n" +
                "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PMCSLauncher\" /f\r\n" +
                "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OLLauncher\" /f\r\n" +
                "del /f /q \"" + Path.Combine(root, "PMCS launcher.exe") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "OL我的世界启动器.exe") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "OL启动器.exe") + "\"\r\n" +
                "rmdir /s /q \"" + Path.Combine(root, "resources") + "\"\r\n" +
                "rmdir /s /q \"" + Path.Combine(root, "locales") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "*.pak") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "*.dll") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "*.bin") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "*.dat") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "*.json") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "LICENSE*") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "version") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "使用说明.txt") + "\"\r\n" +
                "del /f /q \"" + Path.Combine(root, "Uninstall.cmd") + "\"\r\n" +
                "rmdir \"" + root + "\" 2>nul\r\n";
            File.WriteAllText(Path.Combine(target, "Uninstall.cmd"), script, Encoding.Default);
        }
    }

    internal sealed class SubStream : Stream
    {
        private readonly FileStream baseStream;
        private readonly long start;
        private readonly long length;
        private long position;

        public SubStream(FileStream stream, long start, long length)
        {
            this.baseStream = stream;
            this.start = start;
            this.length = length;
            this.position = 0;
        }

        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return true; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return length; } }
        public override long Position
        {
            get { return position; }
            set { position = value; }
        }
        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = length - position;
            if (remaining <= 0) return 0;
            if (count > remaining) count = (int)remaining;
            baseStream.Seek(start + position, SeekOrigin.Begin);
            int read = baseStream.Read(buffer, offset, count);
            position += read;
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            long next = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? position + offset : length + offset;
            position = Math.Max(0, Math.Min(length, next));
            return position;
        }
        public override void Flush() { }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
}
