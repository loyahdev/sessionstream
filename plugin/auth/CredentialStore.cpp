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
#if defined(__APPLE__)
    // Installer maintenance is restricted to this product's exact service.
    // Permission is granted only through macOS, never by rewriting item ACLs.
    if(argc==2){
        const std::string maintenance(argv[1]);
        if(maintenance=="service-check"||maintenance=="service-authorize"||maintenance=="service-reset"){
            const bool prompt=maintenance=="service-authorize";
            if(SecKeychainSetUserInteractionAllowed(prompt)!=errSecSuccess)return 1;
            auto query=CFDictionaryCreateMutable(nullptr,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
            CFDictionarySetValue(query,kSecClass,kSecClassGenericPassword);
            CFDictionarySetValue(query,kSecAttrService,CFSTR("audio.sessionstream.oauth"));
            OSStatus status=errSecSuccess;
            if(maintenance=="service-reset"){
                CFDictionarySetValue(query,kSecMatchLimit,kSecMatchLimitAll);
                status=SecItemDelete(query);
                CFDictionaryRemoveValue(query,kSecMatchLimit);
                if(status==errSecSuccess||status==errSecItemNotFound){
                    CFDictionarySetValue(query,kSecReturnAttributes,kCFBooleanTrue);
                    CFTypeRef remaining=nullptr;status=SecItemCopyMatching(query,&remaining);
                    if(remaining)CFRelease(remaining);
                    if(status==errSecItemNotFound)status=errSecSuccess;
                    else if(status==errSecSuccess)status=errSecInternalComponent;
                }
            }else{
                // Enumerate metadata first: macOS forbids ReturnData + MatchAll.
                CFDictionarySetValue(query,kSecReturnAttributes,kCFBooleanTrue);
                CFDictionarySetValue(query,kSecMatchLimit,kSecMatchLimitAll);
                CFTypeRef matches=nullptr;status=SecItemCopyMatching(query,&matches);
                if(status==errSecSuccess&&matches&&CFGetTypeID(matches)==CFArrayGetTypeID()){
                    auto items=static_cast<CFArrayRef>(matches);
                    CFDictionaryRemoveValue(query,kSecReturnAttributes);
                    CFDictionarySetValue(query,kSecMatchLimit,kSecMatchLimitOne);
                    CFDictionarySetValue(query,kSecReturnData,kCFBooleanTrue);
                    for(CFIndex i=0;i<CFArrayGetCount(items)&&status==errSecSuccess;++i){
                        auto item=static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(items,i));
                        auto key=CFDictionaryGetValue(item,kSecAttrAccount);
                        if(!key){status=errSecParam;break;}
                        CFDictionarySetValue(query,kSecAttrAccount,key);
                        CFTypeRef data=nullptr;status=SecItemCopyMatching(query,&data);
                        if(data)CFRelease(data); // No secrets leave this process.
                    }
                }
                if(matches)CFRelease(matches);
            }
            CFRelease(query);
            if(status==errSecInteractionNotAllowed||status==errSecInteractionRequired||status==errSecAuthFailed||status==errSecUserCanceled)return 3;
            if(status!=errSecSuccess&&status!=errSecItemNotFound)std::cerr<<"Keychain operation failed ("<<status<<")\n";
            return status==errSecSuccess||status==errSecItemNotFound?0:1;
        }
    }
#endif
    if (argc != 3 && argc != 4) return 2;
    const bool interactive=argc==4 && std::string(argv[3])=="--interactive";
    if(argc==4 && !interactive)return 2;
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
    // This is a short-lived helper: never let background refresh open Keychain UI.
    // Legacy login-keychain ACL dialogs also require the process-wide setting.
    if(SecKeychainSetUserInteractionAllowed(interactive)!=errSecSuccess)return 1;
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
    if(status==errSecInteractionNotAllowed || status==errSecInteractionRequired || status==errSecUserCanceled || status==errSecAuthFailed)return 3;
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
