# Restart the MT5 on this PC after a new EA release so the new .ex5 is loaded (MT5 only reads it at start).
# Closed normally (WM_CLOSE to the MT5 main window, like clicking X) so charts, EAs and inputs are saved.
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class GhgWin { public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
[DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }
"@
$target = $Exe.ToLower()
$procs = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower() -eq $target })
if ($procs.Count -eq 0) { 'MT5 PC tidak berjalan: tidak di-restart'; exit 0 }
foreach ($x in $procs) {
  $tp = [uint32]$x.ProcessId
  $script:hw = [IntPtr]::Zero
  [GhgWin]::EnumWindows({ param($h, $l) $p = 0; [void][GhgWin]::GetWindowThreadProcessId($h, [ref]$p)
      if ($p -eq $tp) { $cn = New-Object System.Text.StringBuilder 256; [void][GhgWin]::GetClassName($h, $cn, 256); if ($cn.ToString() -eq 'MetaQuotes::MetaTrader::5.00') { $script:hw = $h } }
      $true }, [IntPtr]::Zero) | Out-Null
  if ($script:hw -eq [IntPtr]::Zero) { "jendela MT5 PID $tp tidak ketemu: tidak di-restart"; continue }
  $argLine = ''
  $cl = [string]$x.CommandLine
  if ($cl) { $cl = $cl.Trim(); if ($cl.StartsWith('"')) { $i = $cl.IndexOf('"', 1); $argLine = $cl.Substring($i + 1).Trim() } }
  [void][GhgWin]::PostMessage($script:hw, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
  $proc = Get-Process -Id $tp -ErrorAction SilentlyContinue
  if ($proc -and -not $proc.WaitForExit(120000)) { "MT5 PID $tp tidak menutup dalam 2 menit: dibiarkan"; continue }
  Start-Sleep -Seconds 3
  if ($argLine) { Start-Process -FilePath $x.ExecutablePath -ArgumentList $argLine -WorkingDirectory (Split-Path $x.ExecutablePath) }
  else { Start-Process -FilePath $x.ExecutablePath -WorkingDirectory (Split-Path $x.ExecutablePath) }
  "MT5 PC ditutup normal dan dibuka lagi (EA versi baru aktif)"
}
