#include <chrono>
#include <cstdlib>
#include <fstream>
#include <thread>
#if defined(_WIN32)
#include <windows.h>
#endif
int main(){
   #if defined(_WIN32)
    wchar_t file[32768]{};
    if(GetEnvironmentVariableW(L"SESSIONSTREAM_TEST_TUNNEL_PID",file,32768)){
        FILE* output=nullptr;
        if(_wfopen_s(&output,file,L"w")==0){std::fprintf(output,"%lu",GetCurrentProcessId());std::fclose(output);}
    }
   #endif
    for(;;)std::this_thread::sleep_for(std::chrono::seconds(1));
}
