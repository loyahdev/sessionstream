cmake_minimum_required(VERSION 3.22)
project(SessionStream VERSION 0.30.0)
set(CMAKE_CXX_STANDARD 17)
if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded" CACHE STRING "Windows static C++ runtime")
endif()
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "13.5" CACHE STRING "Minimum macOS")
    set(SESSIONSTREAM_WORKER_SOURCE plugin/src/WorkerThread.mm)
else()
    set(SESSIONSTREAM_WORKER_SOURCE plugin/src/WorkerThread.cpp)
endif()
set(SESSIONSTREAM_FORMATS VST3 Standalone)
set(SESSIONSTREAM_VST3_AUTO_MANIFEST TRUE)
if(WIN32)
    # Windows/ARM64 helper executables cannot run on every build host.
    # moduleinfo.json is optional; hosts discover the exported VST3 factory.
    set(SESSIONSTREAM_VST3_AUTO_MANIFEST FALSE)
endif()
if(APPLE)
    list(APPEND SESSIONSTREAM_FORMATS AU)
endif()
add_subdirectory(vendor/JUCE)
juce_add_plugin(SessionStream
    COMPANY_NAME "SessionStream" BUNDLE_ID "audio.sessionstream.sender"
    PLUGIN_MANUFACTURER_CODE Ssau PLUGIN_CODE Ssst
    FORMATS ${SESSIONSTREAM_FORMATS} PRODUCT_NAME "SessionStream"
    VST3_AUTO_MANIFEST ${SESSIONSTREAM_VST3_AUTO_MANIFEST}
    IS_SYNTH FALSE NEEDS_MIDI_INPUT FALSE NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE COPY_PLUGIN_AFTER_BUILD FALSE)
if(WIN32)
    # JUCE's resource command otherwise keeps an old version on incremental
    # builds. Regenerate the Windows version resource when metadata changes.
    get_target_property(sessionstream_generated SessionStream JUCE_GENERATED_SOURCES_DIRECTORY)
    add_custom_command(OUTPUT "${sessionstream_generated}/SessionStream_resources.rc"
        APPEND DEPENDS "${sessionstream_generated}/Info.txt")
endif()
target_sources(SessionStream PRIVATE plugin/src/Processor.cpp plugin/src/Processor.h plugin/src/Transport.h plugin/src/Controller.h plugin/src/UpdateChecker.h plugin/src/HostActivity.h plugin/src/WorkerThread.h ${SESSIONSTREAM_WORKER_SOURCE} plugin/src/InviteQR.h plugin/third_party/qrcodegen.cpp)
target_compile_definitions(SessionStream PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(SessionStream PRIVATE juce::juce_audio_utils PUBLIC juce::juce_recommended_config_flags)
add_executable(plugin-smoke tests/plugin-smoke.cpp)
target_link_libraries(plugin-smoke PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(plugin-smoke PRIVATE plugin/src)
add_executable(plugin-stream tests/plugin-stream.cpp)
target_link_libraries(plugin-stream PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(plugin-stream PRIVATE plugin/src)
add_executable(vst3-probe tests/vst3-probe.cpp)
target_link_libraries(vst3-probe PRIVATE juce::juce_audio_utils)
target_compile_definitions(vst3-probe PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_AU=$<BOOL:${APPLE}> JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)

add_executable(update-check tests/update-check.cpp)
target_link_libraries(update-check PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(update-check PRIVATE plugin/src)

add_executable(update-editor tests/update-editor.cpp)
target_link_libraries(update-editor PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(update-editor PRIVATE plugin/src)

add_executable(controller-probe tests/controller-probe.cpp ${SESSIONSTREAM_WORKER_SOURCE})
target_link_libraries(controller-probe PRIVATE juce::juce_core)
target_compile_definitions(controller-probe PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_include_directories(controller-probe PRIVATE plugin/src)

add_executable(host-lifecycle tests/host-lifecycle.cpp)
target_link_libraries(host-lifecycle PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(host-lifecycle PRIVATE plugin/src)

add_executable(seek-reset tests/seek-reset.cpp)
target_link_libraries(seek-reset PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(seek-reset PRIVATE plugin/src)

add_executable(qr-code tests/qr-code.cpp)
target_link_libraries(qr-code PRIVATE SessionStream juce::juce_gui_basics)
target_include_directories(qr-code PRIVATE plugin/src)

add_executable(invite-editor tests/invite-editor.cpp)
target_link_libraries(invite-editor PRIVATE SessionStream juce::juce_audio_utils)
target_include_directories(invite-editor PRIVATE plugin/src)

add_executable(controller-protected-recovery tests/controller-protected-recovery.cpp ${SESSIONSTREAM_WORKER_SOURCE})
target_link_libraries(controller-protected-recovery PRIVATE juce::juce_core)
target_compile_definitions(controller-protected-recovery PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_include_directories(controller-protected-recovery PRIVATE plugin/src)

if(WIN32)
    add_executable(fake-tunnel tests/fake-tunnel.cpp)
    add_executable(windows-tunnel-supervisor plugin/windows/TunnelSupervisor.cpp)
    add_executable(windows-process-tree tests/windows-process-tree.cpp)
endif()
