import AppKit
import SwiftUI

@main
@MainActor
struct SessionStreamSetup {
    static func main() {
        let application = NSApplication.shared
        let setup = SetupModel()
        application.setActivationPolicy(.regular)
        application.delegate = setup
        withExtendedLifetime(setup) { application.run() }
    }
}

private final class SetupWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class SetupModel: NSObject, NSApplicationDelegate, ObservableObject {
    enum Phase {
        case ready, working, complete, failed
    }

    static let windowSize = NSSize(width: 620, height: 321)
    private var window: SetupWindow?

    @Published private(set) var phase = Phase.ready
    @Published private(set) var progress: Double?
    @Published private(set) var log = ""
    @Published private(set) var keychainMessage = ""

    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let isUninstaller = Bundle.main.bundleIdentifier == "dev.loyah.sessionstream.uninstall"

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(origin: .zero, size: Self.windowSize)
        let window = SetupWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSHostingController(rootView: SetupView(setup: self))
        host.sizingOptions = []
        window.contentViewController = host
        window.setContentSize(frame.size)
        let appName = isUninstaller ? "Uninstall SessionStream" : "SessionStream Setup"
        window.title = appName
        window.setAccessibilitySubrole(.standardWindow)
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = true
        window.hasShadow = true
        self.window = window

        let menu = NSMenu()
        let applicationMenu = NSMenu(title: appName)
        applicationMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)),
                                keyEquivalent: "q")
        menu.addItem(NSMenuItem())
        menu.items[0].submenu = applicationMenu
        let file = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        file.submenu = NSMenu(title: "File")
        let close = NSMenuItem(title: "Close", action: #selector(closeSetup(_:)), keyEquivalent: "w")
        close.target = self
        file.submenu?.addItem(close)
        menu.addItem(file)
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        edit.submenu = NSMenu(title: "Edit")
        edit.submenu?.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(edit)
        NSApp.mainMenu = menu

        window.center()
        window.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @objc func closeSetup(_ sender: Any?) {
        guard phase != .working else { return }
        window?.close()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        phase == .working ? .terminateCancel : .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func start() {
        guard phase == .ready || phase == .failed else { return }
        progress = nil
        log = ""
        phase = .working

        if isUninstaller {
            Task {
                let result = await Task.detached(priority: .userInitiated) {
                    let home = FileManager.default.homeDirectoryForCurrentUser
                    return uninstallPlugins(in: home)
                }.value
                log = result.log
                phase = result.succeeded ? .complete : .failed
            }
            return
        }

        guard let package = Bundle.main.url(forResource: "SessionStream", withExtension: "pkg") else {
            log = "The bundled SessionStream.pkg is missing."
            phase = .failed
            return
        }

        let release = version
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                await runInstaller(package: package, version: release) { value in
                    await MainActor.run { self.progress = value }
                }
            }.value
            log = result.log
            if result.succeeded {
                let helper = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent("Library/Audio/Plug-Ins/VST3/SessionStream.vst3/Contents/Resources/runtime/bin/account-credentials")
                let access = await Task.detached(priority: .userInitiated) {
                    runKeychainMaintenance(helper: helper, action: "service-check")
                }.value
                if access == 3 {
                    let permission = NSAlert()
                    permission.messageText = "Allow saved SessionStream sign-in?"
                    permission.informativeText = "SessionStream needs permission to read its saved account information in macOS Keychain. macOS may ask you to approve each saved SessionStream entry using your login Keychain password. Choose Always Allow in the macOS prompt to remember access. You can skip this and sign in from the plug-in later."
                    permission.addButton(withTitle: "Allow Keychain Access")
                    permission.addButton(withTitle: "Not Now")
                    if permission.runModal() == .alertFirstButtonReturn {
                        let authorized = await Task.detached(priority: .userInitiated) {
                            runKeychainMaintenance(helper: helper, action: "service-authorize")
                        }.value
                        let verified = authorized == 0 ? await Task.detached(priority: .userInitiated) {
                            runKeychainMaintenance(helper: helper, action: "service-check")
                        }.value : authorized
                        keychainMessage = verified == 0 ? "Saved sign-in access is ready." : "Keychain access was not saved. Sign in from the plug-in and choose Always Allow when macOS asks."
                    } else {
                        keychainMessage = "Keychain access was skipped. You can sign in from the plug-in later."
                    }
                } else if access != 0 {
                    keychainMessage = "Keychain could not be checked. You can sign in from the plug-in later."
                }
            }
            phase = result.succeeded ? .complete : .failed
        }
    }
}

// Run the installed helper so macOS approves the same executable the plug-in uses.
// The helper checks only SessionStream's service and never emits secret values.
private func runKeychainMaintenance(helper: URL, action: String) -> Int32 {
    guard FileManager.default.isExecutableFile(atPath: helper.path) else { return -1 }
    let process = Process()
    process.executableURL = helper
    process.arguments = [action]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return -1 }
    let deadline = Date().addingTimeInterval(action == "service-authorize" ? 120 : 15)
    while process.isRunning {
        if Date() >= deadline { process.terminate(); return -1 }
        Thread.sleep(forTimeInterval: 0.1)
    }
    process.waitUntilExit()
    return process.terminationStatus
}

private let pluginPaths = ["VST3/SessionStream.vst3", "Components/SessionStream.component"]

private func uninstallPlugins(in home: URL) -> (succeeded: Bool, log: String) {
    let fm = FileManager.default
    let root = home.resolvingSymlinksInPath().appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true)
    var removed = false
    var errors: [String] = []

    for name in pluginPaths {
        let plugin = root.appendingPathComponent(name)
        do {
            _ = try fm.attributesOfItem(atPath: plugin.path)
            let folder = plugin.deletingLastPathComponent()
            guard folder.resolvingSymlinksInPath().path == folder.path else {
                errors.append("\(name): The plug-in folder is redirected.")
                continue
            }
            try fm.trashItem(at: plugin, resultingItemURL: nil)
            removed = true
        } catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile {
            continue
        } catch {
            errors.append("\(name): \(error.localizedDescription)")
        }
    }

    if !errors.isEmpty { return (false, errors.joined(separator: "\n")) }
    return (true, removed ? "You can reopen your DAW." : "SessionStream was already uninstalled.")
}

private func runInstaller(
    package: URL,
    version: String,
    onProgress: (Double) async -> Void
) async -> (succeeded: Bool, log: String) {
    let output = Pipe()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/installer")
    process.arguments = ["-pkg", package.path, "-target", "CurrentUserHomeDirectory", "-verboseR"]
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"]
    process.standardOutput = output
    process.standardError = output

    do {
        try process.run()
    } catch {
        return (false, error.localizedDescription)
    }

    var lines: [String] = []
    do {
        for try await line in output.fileHandleForReading.bytes.lines {
            lines.append(line)
            if line.hasPrefix("installer:%"), let percent = Double(line.dropFirst("installer:%".count)),
               percent.isFinite, (0...100).contains(percent) {
                await onProgress(percent / 100)
            }
        }
    } catch {
        lines.append(error.localizedDescription)
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { return (false, lines.joined(separator: "\n")) }

    let root = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Audio/Plug-Ins", isDirectory: true)
    for name in pluginPaths {
        let bundle = Bundle(url: root.appendingPathComponent(name))
        let installedVersion = bundle?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        if installedVersion != version {
            lines.append("Expected SessionStream \(version) at \(name). Found \(installedVersion ?? "no plugin").")
            return (false, lines.joined(separator: "\n"))
        }
        let runtime = root.appendingPathComponent(name + "/Contents/Resources/runtime")
        for path in ["bin/cloudflared", "bin/node", "bin/account-credentials"] {
            if !FileManager.default.isExecutableFile(atPath: runtime.appendingPathComponent(path).path) {
                lines.append("Missing or unreadable executable in \(name): \(path)")
                return (false, lines.joined(separator: "\n"))
            }
        }
        let webRTC = runtime.appendingPathComponent("node_modules/@roamhq/wrtc-darwin-arm64/wrtc.node")
        if !FileManager.default.isReadableFile(atPath: webRTC.path) {
            lines.append("Missing or unreadable WebRTC runtime in \(name).")
            return (false, lines.joined(separator: "\n"))
        }
    }
    return (true, lines.joined(separator: "\n"))
}
