#include "common.hpp"
#include <dshow.h>
#include <mfapi.h>
#include <mfidl.h>
#include <wrl/client.h>
#include <algorithm>

namespace poke {
using Microsoft::WRL::ComPtr;
struct ComScope {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ComScope() { if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) throw Error("DEVICE_ENUMERATION", "COM initialization failed"); }
    ~ComScope() { if (SUCCEEDED(hr)) CoUninitialize(); }
};
std::string utf8(const std::wstring& value) {
    if (value.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), int(value.size()), nullptr, 0, nullptr, nullptr);
    if (!n) throw Error("INVALID_ARGUMENT", "Invalid UTF-16");
    std::string result(n, 0);
    WideCharToMultiByte(CP_UTF8, 0, value.data(), int(value.size()), result.data(), n, nullptr, nullptr);
    return result;
}
std::wstring wide(const std::string& value) {
    if (value.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), int(value.size()), nullptr, 0);
    if (!n) throw Error("INVALID_ARGUMENT", "Invalid UTF-8");
    std::wstring result(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, value.data(), int(value.size()), result.data(), n);
    return result;
}
std::string uuid() {
    GUID id; if (FAILED(CoCreateGuid(&id))) throw Error("INTERNAL", "Cannot create session ID");
    wchar_t buffer[40]; StringFromGUID2(id, buffer, 40);
    return utf8(buffer);
}
Json video_devices(const std::string& backend) {
    ComScope scope;
    Json result = Json::array();
    if (backend == "msmf") {
        if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_LITE))) throw Error("DEVICE_ENUMERATION", "Media Foundation initialization failed");
        struct Shutdown { ~Shutdown() { MFShutdown(); } } shutdown;
        ComPtr<IMFAttributes> attributes;
        if (FAILED(MFCreateAttributes(&attributes, 1)) || FAILED(attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID)))
            throw Error("DEVICE_ENUMERATION", "Cannot create video device attributes");
        IMFActivate** devices = nullptr; UINT32 count = 0;
        if (FAILED(MFEnumDeviceSources(attributes.Get(), &devices, &count))) throw Error("DEVICE_ENUMERATION", "Cannot enumerate Media Foundation devices");
        struct Devices { IMFActivate** p; UINT32 n; ~Devices() { for (UINT32 i=0; i<n; ++i) p[i]->Release(); CoTaskMemFree(p); } } cleanup{devices,count};
        for (UINT32 i=0; i<count; ++i) {
            wchar_t *name=nullptr, *id=nullptr; UINT32 length;
            devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &name, &length);
            devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &id, &length);
            if (id) result.push_back({{"id",utf8(id)}, {"name", name ? utf8(name) : "Video device"}, {"index",i}, {"backend",backend}});
            CoTaskMemFree(name); CoTaskMemFree(id);
        }
    } else if (backend == "dshow") {
        ComPtr<ICreateDevEnum> enumerator;
        if (FAILED(CoCreateInstance(CLSID_SystemDeviceEnum,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&enumerator)))) throw Error("DEVICE_ENUMERATION", "Cannot enumerate DirectShow devices");
        ComPtr<IEnumMoniker> monikers;
        auto hr=enumerator->CreateClassEnumerator(CLSID_VideoInputDeviceCategory,&monikers,0);
        if (hr == S_FALSE) return result;
        if (FAILED(hr)) throw Error("DEVICE_ENUMERATION", "DirectShow enumeration failed");
        ComPtr<IMoniker> moniker; int index=0;
        while (monikers->Next(1, &moniker, nullptr)==S_OK) {
            ComPtr<IPropertyBag> bag; std::string name="Video device", id;
            if (SUCCEEDED(moniker->BindToStorage(nullptr,nullptr,IID_PPV_ARGS(&bag)))) {
                VARIANT value; VariantInit(&value);
                if (SUCCEEDED(bag->Read(L"FriendlyName",&value,nullptr)) && value.vt==VT_BSTR) name=utf8(value.bstrVal);
                VariantClear(&value);
                if (SUCCEEDED(bag->Read(L"DevicePath",&value,nullptr)) && value.vt==VT_BSTR) id=utf8(value.bstrVal);
                VariantClear(&value);
            }
            if (id.empty()) { LPOLESTR display=nullptr; if (SUCCEEDED(moniker->GetDisplayName(nullptr,nullptr,&display))) { id=utf8(display); CoTaskMemFree(display); } }
            if (!id.empty()) result.push_back({{"id",id},{"name",name},{"index",index},{"backend",backend}});
            ++index; moniker.Reset();
        }
    } else throw Error("INVALID_ARGUMENT", "Unknown capture backend");
    return result;
}
Json serial_devices() {
    Json result=Json::array(); HKEY key=nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"HARDWARE\\DEVICEMAP\\SERIALCOMM",0,KEY_READ,&key)!=ERROR_SUCCESS) return result;
    for (DWORD index=0;;++index) {
        wchar_t name[1024], data[1024]; DWORD nameSize=1024, dataSize=sizeof(data), type;
        auto code=RegEnumValueW(key,index,name,&nameSize,nullptr,&type,reinterpret_cast<BYTE*>(data),&dataSize);
        if (code==ERROR_NO_MORE_ITEMS) break;
        if (code==ERROR_SUCCESS && type==REG_SZ && dataSize>=2 && dataSize<=sizeof(data)) {
            data[1023]=0; auto port=utf8(data); result.push_back({{"id",port},{"name",port}});
        }
    }
    RegCloseKey(key); return result;
}
}
