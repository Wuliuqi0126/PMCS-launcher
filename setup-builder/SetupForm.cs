using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OLSetup
{
    internal sealed class SetupForm : Form
    {
        private string target;
        private readonly TextBox pathBox;
        private readonly Label subtitleLabel;
        private readonly Label statusLabel;
        private readonly ProgressBar progress;
        private readonly Button installButton;
        private readonly Button finishButton;
        private readonly Button closeButton;
        private readonly Button browseButton;
        private readonly CheckBox desktopCheck;
        private bool installing;
        private bool installed;
        private bool isUpdate;

        public SetupForm(string target)
        {
            string installedPath = FindInstalledPath();
            isUpdate = !string.IsNullOrEmpty(installedPath);
            this.target = isUpdate ? installedPath : ResolveInstallPath(target);
            Text = isUpdate
                ? "OL我的世界启动器 1.4.9 更新程序"
                : "OL我的世界启动器 1.4.9 下载程序";
            ClientSize = new Size(620, 430);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = SystemColors.Window;
            ForeColor = SystemColors.WindowText;
            Font = new Font("Microsoft YaHei UI", 9F);
            AcceptButton = null;

            Label title = new Label();
            title.Text = "OL我的世界启动器";
            title.Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(32, 32, 32);
            title.AutoSize = true;
            title.Location = new Point(20, 16);
            Controls.Add(title);

            subtitleLabel = new Label();
            subtitleLabel.Text = "版本 1.4.9  ·  Minecraft Java 版启动器";
            subtitleLabel.Font = new Font("Microsoft YaHei UI", 9F);
            subtitleLabel.ForeColor = Color.FromArgb(100, 100, 100);
            subtitleLabel.AutoSize = true;
            subtitleLabel.Location = new Point(23, 60);
            Controls.Add(subtitleLabel);

            Label line = new Label();
            line.BorderStyle = BorderStyle.Fixed3D;
            line.Location = new Point(20, 86);
            line.Size = new Size(580, 2);
            Controls.Add(line);

            GroupBox locationGroup = new GroupBox();
            locationGroup.Text = "安装位置";
            locationGroup.Location = new Point(20, 100);
            locationGroup.Size = new Size(580, 92);
            locationGroup.ForeColor = SystemColors.WindowText;
            Controls.Add(locationGroup);

            Label pathCaption = new Label();
            pathCaption.Text = "安装目录：";
            pathCaption.AutoSize = true;
            pathCaption.Location = new Point(14, 26);
            locationGroup.Controls.Add(pathCaption);

            pathBox = new TextBox();
            pathBox.Text = this.target;
            pathBox.Location = new Point(14, 50);
            pathBox.Size = new Size(444, 23);
            pathBox.TextChanged += delegate { if (!installing && !installed) this.target = pathBox.Text.Trim(); };
            pathBox.Leave += delegate
            {
                if (installing || installed) return;
                if (string.IsNullOrWhiteSpace(pathBox.Text)) return;
                try
                {
                    this.target = ResolveInstallPath(pathBox.Text);
                    isUpdate = IsInstalledDir(this.target);
                    pathBox.Text = this.target;
                    RefreshMode();
                }
                catch { /* keep raw path; install will report the error */ }
            };
            locationGroup.Controls.Add(pathBox);

            browseButton = new Button();
            browseButton.Text = "浏览...";
            browseButton.Location = new Point(466, 48);
            browseButton.Size = new Size(96, 27);
            browseButton.Click += BrowseClick;
            locationGroup.Controls.Add(browseButton);

            GroupBox optionGroup = new GroupBox();
            optionGroup.Text = "安装选项";
            optionGroup.Location = new Point(20, 202);
            optionGroup.Size = new Size(580, 58);
            optionGroup.ForeColor = SystemColors.WindowText;
            Controls.Add(optionGroup);

            desktopCheck = new CheckBox();
            desktopCheck.Text = "创建桌面快捷方式";
            desktopCheck.Checked = true;
            desktopCheck.AutoSize = true;
            desktopCheck.Location = new Point(14, 22);
            optionGroup.Controls.Add(desktopCheck);

            progress = new ProgressBar();
            progress.Location = new Point(20, 272);
            progress.Size = new Size(580, 14);
            progress.Style = ProgressBarStyle.Continuous;
            Controls.Add(progress);

            statusLabel = new Label();
            statusLabel.Text = isUpdate
                ? "检测到原安装，点击「更新」覆盖程序文件；存档、配置和游戏资源会保留。"
                : "选择父文件夹后，程序会安装到其下的 OL launcher 子文件夹。";
            statusLabel.AutoEllipsis = false;
            statusLabel.ForeColor = Color.FromArgb(80, 80, 80);
            statusLabel.Location = new Point(20, 292);
            statusLabel.Size = new Size(580, 42);
            Controls.Add(statusLabel);

            Label note = new Label();
            note.Text = "安装程序需要管理员权限；不会删除已有存档、配置和游戏资源。";
            note.ForeColor = Color.FromArgb(110, 110, 110);
            note.Location = new Point(20, 340);
            note.Size = new Size(580, 22);
            Controls.Add(note);

            installButton = new Button();
            installButton.Text = isUpdate ? "更新" : "安装";
            installButton.Location = new Point(328, 382);
            installButton.Size = new Size(88, 30);
            installButton.Click += InstallClick;
            Controls.Add(installButton);

            finishButton = new Button();
            finishButton.Text = "完成";
            finishButton.Location = new Point(422, 382);
            finishButton.Size = new Size(88, 30);
            finishButton.Enabled = false;
            finishButton.ForeColor = SystemColors.GrayText;
            finishButton.Click += delegate { if (installed) Close(); };
            Controls.Add(finishButton);

            closeButton = new Button();
            closeButton.Text = "取消";
            closeButton.Location = new Point(516, 382);
            closeButton.Size = new Size(84, 30);
            closeButton.Click += delegate { if (!installing) Close(); };
            Controls.Add(closeButton);

            AcceptButton = installButton;
            CancelButton = closeButton;
            // 必须在所有控件加入后再启用 DPI 缩放，否则高 DPI 下只有窗体变大、
            // 子控件仍按 96 DPI 坐标绘制，会出现右侧/底部大片空白和标题重叠。
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            RefreshMode();
        }

        private static bool IsInstalledDir(string dir)
        {
            try
            {
                return !string.IsNullOrWhiteSpace(dir) &&
                    File.Exists(Path.Combine(Path.GetFullPath(dir), "OL我的世界启动器.exe"));
            }
            catch { return false; }
        }

        private static string ResolveInstallPath(string parent)
        {
            string full = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar);
            if (IsInstalledDir(full)) return full;
            string leaf = Path.GetFileName(full);
            if (string.Equals(leaf, "OL launcher", StringComparison.OrdinalIgnoreCase)) return full;
            return Path.Combine(full, "OL launcher");
        }

        private static string FindInstalledPath()
        {
            string[] registryPaths =
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OLLauncher",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\OLLauncher",
            };
            RegistryKey[] roots = { Registry.CurrentUser, Registry.LocalMachine };
            foreach (RegistryKey root in roots)
            {
                foreach (string subPath in registryPaths)
                {
                    try
                    {
                        using (RegistryKey key = root.OpenSubKey(subPath))
                        {
                            object locationValue = key == null ? null : key.GetValue("InstallLocation");
                            string location = Convert.ToString(locationValue);
                            if (!string.IsNullOrWhiteSpace(location) && IsInstalledDir(location)) return location;
                        }
                    }
                    catch { }
                }
            }

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string[] candidates =
            {
                Path.Combine(local, "Programs", "OL我的世界启动器"),
                Path.Combine(local, "Programs", "OL launcher"),
                Path.Combine(local, "Programs", "OL启动器"),
                Path.Combine(programFiles, "OL我的世界启动器"),
            };
            foreach (string candidate in candidates)
                if (IsInstalledDir(candidate)) return candidate;
            return "";
        }

        private void RefreshMode()
        {
            Text = isUpdate
                ? "OL我的世界启动器 1.4.9 更新程序"
                : "OL我的世界启动器 1.4.9 下载程序";
            subtitleLabel.Text = "版本 1.4.9  ·  Minecraft Java 版启动器";
            installButton.Text = isUpdate ? "更新" : "安装";
            statusLabel.Text = isUpdate
                ? "检测到原安装，点击「更新」覆盖程序文件；存档、配置和游戏资源会保留。"
                : "选择父文件夹后，程序会安装到其下的 OL launcher 子文件夹。";
        }

        private void BrowseClick(object sender, EventArgs e)
        {
            if (installing || installed) return;
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择父文件夹，程序将安装到其下的 OL launcher 子文件夹";
                dialog.SelectedPath = Path.GetDirectoryName(target) ?? target;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath))
                {
                    target = ResolveInstallPath(dialog.SelectedPath);
                    isUpdate = IsInstalledDir(target);
                    pathBox.Text = target;
                    RefreshMode();
                }
            }
        }

        private bool NormalizeTarget()
        {
            string raw = pathBox.Text.Trim().Trim('"');
            if (string.IsNullOrEmpty(raw))
            {
                MessageBox.Show(this, "请先选择安装目录。", "安装目录", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return false;
            }
            string full;
            try { full = Path.GetFullPath(raw); }
            catch (Exception ex)
            {
                MessageBox.Show(this, "安装目录无效：" + ex.Message, "安装目录", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
            string root = Path.GetPathRoot(full) ?? "";
            if (string.Equals(full.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show(this, "不能直接安装到磁盘根目录，请选择子目录。", "安装目录", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            if (File.Exists(full))
            {
                MessageBox.Show(this, "安装目录不能是文件，请选择一个文件夹。", "安装目录", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            target = ResolveInstallPath(full);
            isUpdate = IsInstalledDir(target);
            pathBox.Text = target;
            RefreshMode();
            return true;
        }

        private void InstallClick(object sender, EventArgs e)
        {
            if (installing || installed) return;
            if (!NormalizeTarget()) return;
            if (!isUpdate && Directory.Exists(target) && File.Exists(Path.Combine(target, "OL我的世界启动器.exe")))
            {
                DialogResult answer = MessageBox.Show(this,
                    "检测到该目录已安装 OL我的世界启动器。\n继续会覆盖程序文件，但会保留存档、配置和游戏资源。是否更新？",
                    "覆盖更新", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer != DialogResult.Yes) return;
            }

            installing = true;
            installButton.Enabled = false;
            browseButton.Enabled = false;
            desktopCheck.Enabled = false;
            pathBox.ReadOnly = true;
            closeButton.Enabled = false;
            statusLabel.Text = "正在准备安装…";
            progress.Value = 0;

            bool desktopShortcut = desktopCheck.Checked;
            Thread thread = new Thread(delegate ()
            {
                try
                {
                    Installer.Install(target, delegate (int percent, string message)
                    {
                        if (!IsDisposed)
                        {
                            BeginInvoke((Action)delegate
                            {
                                progress.Value = Math.Max(0, Math.Min(100, percent));
                                statusLabel.Text = message;
                            });
                        }
                    }, desktopShortcut);
                    BeginInvoke((Action)delegate
                    {
                        installing = false;
                        installed = true;
                        progress.Value = 100;
                        statusLabel.Text = isUpdate ? "更新完成，用户数据已保留。" : "安装完成。";
                        installButton.Text = isUpdate ? "已更新" : "已安装";
                        finishButton.Enabled = true;
                        finishButton.ForeColor = SystemColors.ControlText;
                        closeButton.Text = "关闭";
                        closeButton.Enabled = true;
                    });
                }
                catch (Exception ex)
                {
                    BeginInvoke((Action)delegate
                    {
                        installing = false;
                        statusLabel.Text = "安装失败：" + ex.Message;
                        installButton.Enabled = true;
                        browseButton.Enabled = true;
                        desktopCheck.Enabled = true;
                        pathBox.ReadOnly = false;
                        closeButton.Enabled = true;
                        MessageBox.Show(this, ex.Message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    });
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }
    }
}
