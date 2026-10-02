param([ValidateSet('x64','arm64','all')][string]$Architecture='all', [switch]$SkipInstaller)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Invoke-Checked([string]$Program,[string[]]$Arguments) {
    & $Program @Arguments
    if($LASTEXITCODE -ne 0){throw "$Program failed with exit code $LASTEXITCODE"}
}
if(!(Test-Path vendor/JUCE/CMakeLists.txt)){
    New-Item -ItemType Directory -Force vendor | Out-Null
    $archive=Join-Path $env:TEMP 'sessionstream-juce-8.0.12.tar.gz'
    Invoke-WebRequest 'https://codeload.github.com/juce-framework/JUCE/tar.gz/refs/tags/8.0.12' -OutFile $archive
    if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'dec1a8baee5aaec4502b717a421b850e257ab7e9c2efd03766185ec1957cf102'){throw 'JUCE archive checksum mismatch'}
    Invoke-Checked tar @('-xf',$archive,'-C','vendor')
    Move-Item vendor/JUCE-8.0.12 vendor/JUCE
}
Invoke-Checked node @('scripts/bundle-windows-runtime.mjs','--prepare')
Invoke-Checked cmake @('-S','.','-B','build-windows-x64','-G','Visual Studio 17 2022','-A','x64','-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
Invoke-Checked cmake @('--build','build-windows-x64','--config','Release','--target','windows-tunnel-supervisor','--parallel','4')
$targets=if($Architecture -eq 'all'){@('x64','arm64')}else{@($Architecture)}
foreach($arch in $targets){
    $cmakeArch=if($arch -eq 'arm64'){'ARM64'}else{'x64'}
    Invoke-Checked cmake @('-S','.','-B',"build-windows-$arch",'-G','Visual Studio 17 2022','-A',$cmakeArch,'-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
    Invoke-Checked cmake @('--build',"build-windows-$arch",'--config','Release','--target','SessionStream_VST3','vst3-probe','plugin-smoke','fake-tunnel','host-lifecycle','seek-reset','qr-code','windows-process-tree','--parallel','4')
    Invoke-Checked node @('scripts/bundle-windows-runtime.mjs',"build-windows-$arch")
}
if(!$SkipInstaller){
    if($Architecture -ne 'all'){throw 'The combined installer requires both architectures; use -Architecture all or -SkipInstaller'}
    if(!$env:MAKENSIS_PATH){$env:MAKENSIS_PATH=Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe'}
    Invoke-Checked node @('scripts/build-windows-installer.mjs')
}
