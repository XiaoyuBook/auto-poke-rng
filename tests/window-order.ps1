param(
  [Parameter(Mandatory = $true)][long]$MainHandle,
  [Parameter(Mandatory = $true)][long]$ToolHandle
)

# Read the native stacking order of the test's own Electron windows.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PanelWindowOrder {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@

$mainWindowHandle = [IntPtr]::new($MainHandle)
$toolWindowHandle = [IntPtr]::new($ToolHandle)
$windowAbove = [PanelWindowOrder]::GetWindow($mainWindowHandle, 3)
$aboveMain = $false
$visited = [System.Collections.Generic.HashSet[long]]::new()
while ($windowAbove -ne [IntPtr]::Zero -and $visited.Add($windowAbove.ToInt64())) {
  if ($windowAbove -eq $toolWindowHandle) { $aboveMain = $true; break }
  $windowAbove = [PanelWindowOrder]::GetWindow($windowAbove, 3)
}
[ordered]@{
  aboveMain = $aboveMain
  minimized = [PanelWindowOrder]::IsIconic($toolWindowHandle)
  visible = [PanelWindowOrder]::IsWindowVisible($toolWindowHandle)
} | ConvertTo-Json -Compress
