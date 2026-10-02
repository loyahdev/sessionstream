// Windows SIGTERM is a forced termination. A job object ensures that killing
// this supervisor or its Node parent cannot leave cloudflared running.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <cstdio>

static std::wstring quote(const std::wstring& argument){
    std::wstring result=L"\"";size_t slashes=0;
    for(const auto c:argument){
        if(c==L'\\'){++slashes;continue;}
        if(c==L'\"'){result.append(slashes*2+1,L'\\');result+=c;}
        else{result.append(slashes,L'\\');result+=c;}
        slashes=0;
    }
    result.append(slashes*2,L'\\');return result+L"\"";
}
int wmain(int argc,wchar_t** argv){
    if(argc<3)return 2;
    wchar_t* end=nullptr;const auto parentID=wcstoul(argv[1],&end,10);
    if(!parentID||!end||*end)return 2;
    const auto parent=OpenProcess(SYNCHRONIZE,FALSE,parentID);
    const auto job=CreateJobObjectW(nullptr,nullptr);
    if(!parent||!job){if(parent)CloseHandle(parent);if(job)CloseHandle(job);return 3;}
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))){CloseHandle(job);CloseHandle(parent);return 4;}
    std::wstring command;
    for(int i=2;i<argc;++i){if(i>2)command+=L' ';command+=quote(argv[i]);}
    std::vector<wchar_t> buffer(command.begin(),command.end());buffer.push_back(0);
    STARTUPINFOW startup{};startup.cb=sizeof(startup);
    startup.dwFlags=STARTF_USESTDHANDLES;
    startup.hStdInput=GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError=GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION child{};
    if(!CreateProcessW(argv[2],buffer.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW,nullptr,nullptr,&startup,&child)){
        std::fprintf(stderr,"Cannot start tunnel: Windows error %lu\n",GetLastError());CloseHandle(job);CloseHandle(parent);return 5;
    }
    if(!AssignProcessToJobObject(job,child.hProcess)){
        TerminateProcess(child.hProcess,1);CloseHandle(child.hThread);CloseHandle(child.hProcess);CloseHandle(job);CloseHandle(parent);return 6;
    }
    if(ResumeThread(child.hThread)==static_cast<DWORD>(-1)){
        CloseHandle(child.hThread);CloseHandle(child.hProcess);CloseHandle(job);CloseHandle(parent);return 7;
    }
    CloseHandle(child.hThread);
    const HANDLE handles[]={child.hProcess,parent};
    const auto result=WaitForMultipleObjects(2,handles,FALSE,INFINITE);
    DWORD exitCode=0;
    if(result==WAIT_OBJECT_0)GetExitCodeProcess(child.hProcess,&exitCode);
    else if(result!=WAIT_OBJECT_0+1)exitCode=8;
    // Closing the sole job handle terminates the entire tunnel process tree.
    CloseHandle(job);CloseHandle(child.hProcess);CloseHandle(parent);
    return static_cast<int>(exitCode);
}
