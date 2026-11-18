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
    private static HookProc hookProc;
    private static IntPtr savedContext = IntPtr.Zero;
    private static IntPtr originalLayout = IntPtr.Zero;
    private static IntPtr englishLayout = IntPtr.Zero;
    private static IntPtr chineseLayout = IntPtr.Zero;
    private static bool imeDisabled;
    private static bool chatImeEnabled;
    private static long lastOpenCheck;
    private static IntPtr lastDisabledHwnd = IntPtr.Zero;
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

    [DllImport("imm32.dll")]
    private static extern bool ImmSetOpenStatus(IntPtr hIMC, bool fOpen);

    [DllImport("imm32.dll")]
    private static extern bool ImmSetConversionStatus(IntPtr hIMC, int fdwConversion, int fdwSentence);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadKeyboardLayout(string pwszKLID, uint flags);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private const uint WM_INPUTLANGCHANGEREQUEST = 0x0050;
    private const uint KLF_ACTIVATE = 0x00000001;
    private const int IME_CMODE_ALPHANUMERIC = 0x0000;
    private const int IME_SMODE_NONE = 0x0000;

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
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        int pid;
        uint threadId = GetWindowThreadProcessId(hwnd, out pid);
        if (pid != targetPid) return;

        // Once the game window has been handled, do not keep re-associating
        // the IME context or re-posting WM_INPUTLANGCHANGEREQUEST every tick.
        // Repeating that while WASD is held makes Minecraft miss key events.
        if (imeDisabled && hwnd == lastDisabledHwnd)
        {
            if (NowMs() - lastOpenCheck < 2000) return;
            lastOpenCheck = NowMs();
            IntPtr openContext = ImmGetContext(hwnd);
            if (openContext != IntPtr.Zero)
            {
                ImmSetOpenStatus(openContext, false);
                ImmReleaseContext(hwnd, openContext);
            }
            return;
        }
        if (hwnd != lastDisabledHwnd)
        {
            imeDisabled = false;
            chatImeEnabled = false;
            savedContext = IntPtr.Zero;
            originalLayout = IntPtr.Zero;
        }

        IntPtr context = ImmGetContext(hwnd);
        if (context != IntPtr.Zero)
        {
            ImmSetOpenStatus(context, false);
            ImmSetConversionStatus(context, IME_CMODE_ALPHANUMERIC, IME_SMODE_NONE);
            ImmReleaseContext(hwnd, context);
        }
        savedContext = ImmAssociateContext(hwnd, IntPtr.Zero);
        imeDisabled = true;
        lastDisabledHwnd = hwnd;
        lastOpenCheck = NowMs();

        // One layout switch per game focus. The old loop switched every
        // 250ms and caused intermittent movement lockups.
        if (originalLayout == IntPtr.Zero) originalLayout = GetKeyboardLayout(threadId);
        if (englishLayout == IntPtr.Zero) englishLayout = LoadKeyboardLayout("00000409", KLF_ACTIVATE);
        if (englishLayout != IntPtr.Zero)
        {
            PostMessage(hwnd, WM_INPUTLANGCHANGEREQUEST, IntPtr.Zero, englishLayout);
        }
    }

    private static void EnableIme()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        int pid;
        uint threadId = GetWindowThreadProcessId(hwnd, out pid);
        if (pid != targetPid) return;
        if (chatImeEnabled && !imeDisabled) return;
        if (imeDisabled)
        {
            if (savedContext != IntPtr.Zero) ImmAssociateContext(hwnd, savedContext);
            else ImmAssociateContextEx(hwnd, IntPtr.Zero, IACE_DEFAULT);
            imeDisabled = false;
        }
        lastDisabledHwnd = IntPtr.Zero;
        IntPtr context = ImmGetContext(hwnd);
        if (context != IntPtr.Zero)
        {
            ImmSetOpenStatus(context, true);
            ImmReleaseContext(hwnd, context);
        }
        if (chineseLayout == IntPtr.Zero) chineseLayout = LoadKeyboardLayout("00000804", KLF_ACTIVATE);
        IntPtr restore = chineseLayout != IntPtr.Zero ? chineseLayout : originalLayout != IntPtr.Zero ? originalLayout : GetKeyboardLayout(threadId);
        if (restore != IntPtr.Zero)
        {
            PostMessage(hwnd, WM_INPUTLANGCHANGEREQUEST, IntPtr.Zero, restore);
        }
        chatImeEnabled = true;
    }

    private static IntPtr KeyboardHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN) && IsGameForeground())
        {
            int vk = Marshal.ReadInt32(lParam);
            if (vk == VK_T || vk == VK_SLASH)
            {
                if (!chatOpen)
                {
                    chatOpen = true;
                    pendingDisableAt = 0;
                    EnableIme();
                }
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
        hookProc = KeyboardHook;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new HiddenForm());
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    }
}
