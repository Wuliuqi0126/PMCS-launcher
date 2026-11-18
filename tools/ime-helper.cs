using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int GCS_COMPSTR = 0x0008;
    private const uint IACE_DEFAULT = 0x0010;
    private const int VK_RETURN = 0x0D;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_T = 0x54;
    private const int VK_SLASH = 0xBF;

    private static int targetPid;
    private static IntPtr hook;
    private static IntPtr savedContext = IntPtr.Zero;
    private static bool imeDisabled;
    private static bool chatOpen;
    private static long pendingDisableAt;

    private static long NowMs()
    {
        return DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("imm32.dll")]
    private static extern IntPtr ImmAssociateContext(IntPtr hWnd, IntPtr hIMC);

    [DllImport("imm32.dll")]
    private static extern bool ImmAssociateContextEx(IntPtr hWnd, IntPtr hIMC, uint dwFlags);

    [DllImport("imm32.dll")]
    private static extern IntPtr ImmGetContext(IntPtr hWnd);

    [DllImport("imm32.dll")]
    private static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);

    [DllImport("imm32.dll")]
    private static extern int ImmGetCompositionString(IntPtr hIMC, int dwIndex, byte[] lpBuf, int dwBufLen);

    private static bool IsGameForeground()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        int pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid == targetPid;
    }

    private static bool HasComposition(IntPtr hwnd)
    {
        IntPtr context = ImmGetContext(hwnd);
        if (context == IntPtr.Zero) return false;
        try
        {
            int length = ImmGetCompositionString(context, GCS_COMPSTR, null, 0);
            return length > 0;
        }
        finally
        {
            ImmReleaseContext(hwnd, context);
        }
    }

    private static void DisableIme()
    {
        if (imeDisabled) return;
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        savedContext = ImmAssociateContext(hwnd, IntPtr.Zero);
        imeDisabled = true;
    }

    private static void EnableIme()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        if (imeDisabled)
        {
            if (savedContext != IntPtr.Zero) ImmAssociateContext(hwnd, savedContext);
            else ImmAssociateContextEx(hwnd, IntPtr.Zero, IACE_DEFAULT);
            imeDisabled = false;
        }
        else
        {
            ImmAssociateContextEx(hwnd, IntPtr.Zero, IACE_DEFAULT);
        }
    }

    private static IntPtr KeyboardHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN) && IsGameForeground())
        {
            int vk = Marshal.ReadInt32(lParam);
            if (vk == VK_T || vk == VK_SLASH)
            {
                chatOpen = true;
                pendingDisableAt = 0;
                EnableIme();
            }
            else if (vk == VK_ESCAPE && chatOpen)
            {
                chatOpen = false;
                pendingDisableAt = 0;
                DisableIme();
            }
            else if (vk == VK_RETURN && chatOpen)
            {
                IntPtr hwnd = GetForegroundWindow();
                if (HasComposition(hwnd))
                {
                    pendingDisableAt = NowMs() + 220;
                }
                else
                {
                    chatOpen = false;
                    DisableIme();
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private sealed class HiddenForm : Form
    {
        private readonly Timer timer;

        public HiddenForm()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-20000, -20000);
            Size = new Size(1, 1);
            Opacity = 0;
            timer = new Timer { Interval = 250 };
            timer.Tick += delegate
            {
                try
                {
                    Process.GetProcessById(targetPid);
                }
                catch
                {
                    timer.Stop();
                    Application.Exit();
                    return;
                }
                if (pendingDisableAt > 0 && NowMs() >= pendingDisableAt)
                {
                    pendingDisableAt = 0;
                    chatOpen = false;
                    DisableIme();
                }
                if (IsGameForeground() && !chatOpen) DisableIme();
            };
            timer.Start();
        }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 1 || !int.TryParse(args[0], out targetPid) || targetPid <= 0) return;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardHook, GetModuleHandle(null), 0);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new HiddenForm());
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    }
}
