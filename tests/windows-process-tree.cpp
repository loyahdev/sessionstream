#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>
#include <string>
#include <vector>

struct Process {
    PROCESS_INFORMATION info{};
    ~Process(){if(info.hProcess){if(WaitForSingleObject(info.hProcess,0)==WAIT_TIMEOUT)TerminateProcess(info.hProcess,1);CloseHandle(info.hThread);CloseHandle(info.hProcess);}}
    bool start(const std::wstring& binary,const std::wstring& args=L""){
        auto command=L"\""+binary+L"\" "+args;std::vector<wchar_t> text(command.begin(),command.end());text.push_back(0);
        STARTUPINFOW startup{};startup.cb=sizeof(startup);
        return CreateProcessW(binary.c_str(),text.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&info)!=FALSE;
    }
};
static DWORD readPID(const std::wstring& file){
    for(int n=0;n<300;++n){FILE* input=nullptr;DWORD pid=0;if(_wfopen_s(&input,file.c_str(),L"r")==0){std::fscanf(input,"%lu",&pid);std::fclose(input);}if(pid)return pid;Sleep(50);}
    return 0;
}
int wmain(int argc,wchar_t** argv){
    if(argc!=3)return 1;
    wchar_t temp[32768]{};GetTempPathW(32768,temp);
    const auto directory=std::wstring(temp)+L"SessionStream process test "+std::to_wstring(GetCurrentProcessId());
    CreateDirectoryW(directory.c_str(),nullptr);
    const auto fake=directory+L"\\fake tunnel.exe",pidFile=directory+L"\\tunnel.pid";
    if(!CopyFileW(argv[2],fake.c_str(),FALSE))return 2;
    const auto check=[&](bool killSupervisor){
        DeleteFileW(pidFile.c_str());SetEnvironmentVariableW(L"SESSIONSTREAM_TEST_TUNNEL_PID",nullptr);
        Process parent,supervisor;if(!parent.start(fake))return false;
        SetEnvironmentVariableW(L"SESSIONSTREAM_TEST_TUNNEL_PID",pidFile.c_str());
        if(!supervisor.start(argv[1],std::to_wstring(parent.info.dwProcessId)+L" \""+fake+L"\" \"argument with spaces\""))return false;
        const auto pid=readPID(pidFile);if(!pid)return false;
        const auto child=OpenProcess(SYNCHRONIZE,FALSE,pid);if(!child)return false;
        const auto alive=WaitForSingleObject(child,0)==WAIT_TIMEOUT;
        TerminateProcess(killSupervisor?supervisor.info.hProcess:parent.info.hProcess,9);
        const auto supervisorExited=WaitForSingleObject(supervisor.info.hProcess,5000)==WAIT_OBJECT_0;
        const auto childExited=WaitForSingleObject(child,5000)==WAIT_OBJECT_0;
        const auto unrelatedParentSurvived=!killSupervisor||WaitForSingleObject(parent.info.hProcess,0)==WAIT_TIMEOUT;
        CloseHandle(child);return alive&&supervisorExited&&childExited&&unrelatedParentSurvived;
    };
    const auto parentCrash=check(false),supervisorCrash=check(true);
    SetEnvironmentVariableW(L"SESSIONSTREAM_TEST_TUNNEL_PID",nullptr);DeleteFileW(pidFile.c_str());DeleteFileW(fake.c_str());RemoveDirectoryW(directory.c_str());
    if(!parentCrash||!supervisorCrash){std::fprintf(stderr,"FAIL: parent crash=%d, supervisor crash=%d\n",parentCrash,supervisorCrash);return 3;}
    std::puts("PASS: parent crash and forced supervisor termination kill the tunnel process tree; paths with spaces work; unrelated parent survives");
}
