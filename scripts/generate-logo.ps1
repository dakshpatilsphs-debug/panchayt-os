# Generates public/logo.png - the society emblem used in the app and Excel exports.
Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Rounded-square base with a deep green gradient
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 110
$path.AddArc(0, 0, $radius, $radius, 180, 90)
$path.AddArc($size - $radius, 0, $radius, $radius, 270, 90)
$path.AddArc($size - $radius, $size - $radius, $radius, $radius, 0, 90)
$path.AddArc(0, $size - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()

$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255, 30, 84, 62), [System.Drawing.Color]::FromArgb(255, 14, 48, 37), 55)
$g.FillPath($grad, $path)

# Inner hairline ring
$ring = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 255, 255, 255), 4)
$g.DrawPath($ring, $path)

# Brass sun
$sunBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 201, 162, 75))
$g.FillEllipse($sunBrush, 330, 96, 74, 74)

# Skyline / housing blocks
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillRectangle($white, 120, 250, 66, 148)          # tall block
$g.FillRectangle($white, 200, 214, 84, 184)          # tall block
$g.FillRectangle($white, 298, 268, 84, 130)          # wide矮 block

# Windows in the centre block
$win = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 84, 62))
foreach ($row in 0..3) {
  foreach ($col in 0..1) {
    $g.FillRectangle($win, (214 + $col * 34), (234 + $row * 40), 22, 22)
  }
}

# Roof line
$roofPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 12)
$roofPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$roofPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($roofPen, 96, 250, 232, 168)
$g.DrawLine($roofPen, 232, 168, 404, 268)

$g.Flush()
$out = Join-Path $PSScriptRoot "..\public\logo.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $grad.Dispose(); $sunBrush.Dispose(); $white.Dispose(); $win.Dispose(); $roofPen.Dispose(); $ring.Dispose(); $grad.Dispose()
Write-Host "Logo written to $out"
