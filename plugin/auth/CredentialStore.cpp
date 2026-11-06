#include <iostream>
#include <string>
#include <algorithm>
#if defined(__APPLE__)
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#elif defined(_WIN32)
#include <windows.h>
#include <wincred.h>
#endif

// Secrets travel through private pipes, never command arguments or files.
int main(int argc, char** argv) {
    if (argc != 3) return 2;
    const std::string action(argv[1]), key(argv[2]);
    if (key.size()!=64 || !std::all_of(key.begin(),key.end(),[](char c){return (c>='0'&&c<='9')||(c>='a'&&c<='f');})) return 2;
    if (action!="read" && action!="write" && action!="clear") return 2;
    std::string value;
    if(action=="write") {
        char c;
        while(std::cin.get(c)){if(value.size()>=5120)return 2;value+=c;}
        if(value.empty())return 2;
    }
#if defined(__APPLE__)
    auto query=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    auto account=CFStringCreateWithCString(nullptr,key.c_str(),kCFStringEncodingUTF8);
    CFDictionarySetValue(query,kSecClass,kSecClassGenericPassword);
    CFDictionarySetValue(query,kSecAttrService,CFSTR("audio.sessionstream.oauth"));
    CFDictionarySetValue(query,kSecAttrAccount,account);
    OSStatus status=errSecSuccess;
    if(action=="read"){
        CFDictionarySetValue(query,kSecReturnData,kCFBooleanTrue);
        CFDictionarySetValue(query,kSecMatchLimit,kSecMatchLimitOne);
        CFTypeRef result=nullptr;status=SecItemCopyMatching(query,&result);
        if(status==errSecSuccess && result && CFGetTypeID(result)==CFDataGetTypeID()){
            auto data=static_cast<CFDataRef>(result);
            if(CFDataGetLength(data)<=5120)std::cout.write(reinterpret_cast<const char*>(CFDataGetBytePtr(data)),CFDataGetLength(data));
            else status=errSecParam;
        }
        if(result)CFRelease(result);
    } else if(action=="clear") status=SecItemDelete(query);
    else {
        auto data=CFDataCreate(nullptr,reinterpret_cast<const UInt8*>(value.data()),value.size());
        auto update=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
        CFDictionarySetValue(update,kSecValueData,data);
        status=SecItemUpdate(query,update);
        if(status==errSecItemNotFound){
            CFDictionarySetValue(query,kSecValueData,data);
            CFDictionarySetValue(query,kSecAttrLabel,CFSTR("SessionStream account"));
            CFDictionarySetValue(query,kSecAttrSynchronizable,kCFBooleanFalse);
            status=SecItemAdd(query,nullptr);
        }
        CFRelease(update);CFRelease(data);
    }
    CFRelease(account);CFRelease(query);
    return status==errSecSuccess || (status==errSecItemNotFound && action!="write") ? 0 : 1;
#elif defined(_WIN32)
    const std::wstring target=L"SessionStream/OAuth/"+std::wstring(key.begin(),key.end());
    if(action=="read"){
        PCREDENTIALW credential=nullptr;
        if(!CredReadW(target.c_str(),CRED_TYPE_GENERIC,0,&credential))return GetLastError()==ERROR_NOT_FOUND?0:1;
        const bool valid=credential->CredentialBlobSize<=5120;
        if(valid)std::cout.write(reinterpret_cast<const char*>(credential->CredentialBlob),credential->CredentialBlobSize);
        CredFree(credential);return valid?0:1;
    }
    if(action=="clear")return CredDeleteW(target.c_str(),CRED_TYPE_GENERIC,0)||GetLastError()==ERROR_NOT_FOUND?0:1;
    CREDENTIALW credential{};
    credential.Type=CRED_TYPE_GENERIC;credential.TargetName=const_cast<wchar_t*>(target.c_str());
    credential.UserName=const_cast<wchar_t*>(L"SessionStream");credential.Persist=CRED_PERSIST_LOCAL_MACHINE;
    credential.CredentialBlobSize=static_cast<DWORD>(value.size());credential.CredentialBlob=reinterpret_cast<LPBYTE>(value.data());
    return CredWriteW(&credential,0)?0:1;
#else
    return 1;
#endif
}
