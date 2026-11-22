import AppKit
import SwiftUI

struct SetupView: View {
    @ObservedObject var setup: SetupModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var panelVisible = false

    private let paper = Color(red: 0.90, green: 0.93, blue: 0.85)
    private let ink = Color(red: 0.041, green: 0.067, blue: 0.051)
    private let muted = Color(red: 0.26, green: 0.32, blue: 0.26)
    private let lime = Color(red: 0.76, green: 0.91, blue: 0.47)
    private let coverWidth: CGFloat = 322
    private let coverImage = Bundle.main.url(forResource: "Cover", withExtension: "png")
        .flatMap { NSImage(contentsOf: $0) }

    private var title: String {
        switch setup.phase {
        case .ready: setup.isUninstaller ? "Uninstall SessionStream?" : "Install plug-in"
        case .working: setup.isUninstaller ? "Uninstalling" : "Installing"
        case .account: "Sign in"
        case .complete: setup.isUninstaller ? "Uninstall complete" : "Ready to stream"
        case .failed: setup.isUninstaller ? "Uninstall interrupted" : "Installation interrupted"
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            cover
            controls
        }
        .frame(width: SetupModel.windowSize.width, height: SetupModel.windowSize.height)
        .foregroundStyle(ink)
        .preferredColorScheme(.light)
        .onAppear {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.34)) {
                panelVisible = true
            }
        }
    }

    private var cover: some View {
        ZStack {
            WindowDragRegion()
                .accessibilityHidden(true)
            if let coverImage {
                Image(nsImage: coverImage)
                    .resizable()
                    .allowsHitTesting(false)
                    .accessibilityLabel("SessionStream. Your DAW. Their browser.")
            }
        }
        .frame(width: coverWidth, height: SetupModel.windowSize.height)
        .background(ink)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Spacer(minLength: 10)
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.system(size: 28, weight: .semibold))
                    .tracking(-0.85)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Group {
                    phaseDetails
                }
                .font(.system(size: 14))
            }
            Spacer(minLength: 16)
            if setup.phase == .ready && !setup.isUninstaller {
                Text("Close your DAW before installing.")
                    .font(.system(size: 12))
                    .foregroundStyle(muted)
                    .padding(.bottom, 9)
            }
            action
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .opacity(panelVisible ? 1 : 0)
        .background(paper)
    }

    private var header: some View {
        HStack {
            Spacer()
            Button {
                setup.closeSetup(nil)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(muted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            .keyboardShortcut(.cancelAction)
            .disabled(setup.phase == .working)
        }
        .background(WindowDragRegion())
    }

    @ViewBuilder
    private var phaseDetails: some View {
        switch setup.phase {
        case .ready:
            if setup.isUninstaller {
                Text("Close your DAW before uninstalling.")
                    .foregroundStyle(muted)
            } else {
                Text("Audio Units + VST3")
                    .fontWeight(.semibold)
                Text("Add SessionStream to a track or your master bus. Start a stream and share the invite link.")
                    .foregroundStyle(muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .working:
            Text("Audio Units + VST3")
                .foregroundStyle(muted)
        case .account:
            Text("A free account includes 15 streaming hours each month. Your sign-in is saved for the plug-in.")
                .foregroundStyle(muted)
                .fixedSize(horizontal: false, vertical: true)
            if !setup.keychainMessage.isEmpty {
                Text(setup.keychainMessage).font(.system(size: 12)).foregroundStyle(muted)
            }
        case .complete:
            Text(setup.isUninstaller
                 ? setup.log
                 : "Reopen your DAW and add SessionStream to a track or your master bus. Start a stream to get your invite link.")
                .foregroundStyle(muted)
                .fixedSize(horizontal: false, vertical: true)
            if !setup.isUninstaller && !setup.keychainMessage.isEmpty {
                Text(setup.keychainMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .failed:
            Text("Close your DAW and try again.")
                .foregroundStyle(muted)
            ScrollView {
                Text(setup.log)
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(8)
            .frame(height: 58)
            .background(ink.opacity(0.06))
            .accessibilityLabel("Details")
        }
    }

    @ViewBuilder
    private var action: some View {
        if setup.phase == .working {
            installMeter
        } else {
            Button {
                if setup.phase == .complete { NSApp.terminate(nil) } else if setup.phase == .account { setup.signIn() } else { setup.start() }
            } label: {
                HStack {
                    Text(actionTitle)
                    Spacer()
                    Image(systemName: actionIcon)
                        .accessibilityHidden(true)
                }
            }
            .disabled(setup.signingIn)
            .buttonStyle(InstallSwitchStyle(lime: lime, ink: ink))
            .keyboardShortcut(setup.isUninstaller && setup.phase != .complete ? nil : .defaultAction)
        }
    }

    private var actionTitle: String {
        switch setup.phase {
        case .account: setup.signingIn ? "Waiting for sign-in…" : "Sign in"
        case .complete: "Done"
        case .failed: "Try Again"
        default: setup.isUninstaller ? "Uninstall" : "Install"
        }
    }

    private var actionIcon: String {
        if setup.phase == .complete { return "checkmark" }
        return setup.isUninstaller ? "trash" : "arrow.right"
    }

    private var installMeter: some View {
        HStack(spacing: 12) {
            if let progress = setup.progress {
                HStack(spacing: 3) {
                    ForEach(0..<24) { segment in
                        Rectangle().fill(Double(segment + 1) / 24 <= progress ? muted : ink.opacity(0.14))
                    }
                }
                .frame(height: 10)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: progress)
                Text(progress, format: .percent.precision(.fractionLength(0)))
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .frame(width: 42, alignment: .trailing)
            } else {
                ProgressView().controlSize(.small)
                Spacer()
            }
        }
        .frame(height: 48)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(setup.isUninstaller ? "Uninstall progress" : "Installation progress")
        .accessibilityValue(setup.progress.map { $0.formatted(.percent.precision(.fractionLength(0))) }
                            ?? (setup.isUninstaller ? "Uninstalling" : "Installing"))
    }
}

private struct WindowDragRegion: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ view: NSView, context: Context) {}

    private final class DragView: NSView {
        override func mouseDown(with event: NSEvent) {
            window?.performDrag(with: event)
        }
    }
}

private struct InstallSwitchStyle: ButtonStyle {
    let lime: Color
    let ink: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(ink)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(lime)
            .brightness(configuration.isPressed ? -0.07 : 0)
            .contentShape(Rectangle())
    }
}
