#include "capture.hpp"
#include "controller.hpp"
#include "pokefinder_static.hpp"
#include <iostream>

int main(int argc,char** argv) {
    using namespace poke;
    bool test_mode=false; DWORD parent=0; std::string role="video";
    for (int i=1;i<argc;++i) {
        if (std::string(argv[i])=="--test-mode") test_mode=true;
        if (std::string(argv[i])=="--parent-pid" && i+1<argc) parent=std::stoul(argv[++i]);
        if (std::string(argv[i])=="--role" && i+1<argc) role=argv[++i];
    }
    std::mutex output;
    Emit emit=[&](const Json& value) { std::lock_guard lock(output); std::cout<<value.dump()<<std::endl; };
    try {
        if (role!="video" && role!="controller" && role!="rng") throw Error("INVALID_ARGUMENT","Unknown runtime role");
        std::unique_ptr<CaptureService> capture;
        std::unique_ptr<ControllerService> controller;
        std::unique_ptr<PokeFinderStaticService> rng;
        if (role=="video") capture=std::make_unique<CaptureService>(emit,test_mode);
        else if (role=="controller") controller=std::make_unique<ControllerService>(emit,test_mode);
        else rng=std::make_unique<PokeFinderStaticService>();
        Handle parent_handle(parent ? OpenProcess(SYNCHRONIZE,FALSE,parent) : nullptr);
        if (parent && !parent_handle.get()) throw Error("PARENT_MISSING","Cannot observe parent process");
        std::jthread guard([&](std::stop_token stop) {
            while (!stop.stop_requested()) {
                if (parent_handle.get() && WaitForSingleObject(parent_handle.get(),100)==WAIT_OBJECT_0) {
                    // Best-effort neutral release; an unplugged or wedged controller cannot acknowledge it.
                    if(controller) {
                        std::atomic<bool> released=false;
                        std::thread([&] {controller->emergency_release();released=true;}).detach();
                        auto deadline=Clock::now()+2s;
                        while(!released && Clock::now()<deadline) std::this_thread::sleep_for(10ms);
                        ExitProcess(0); // Also bounds a wedged serial driver during emergency release.
                    }
                    ExitProcess(0);
                }
                if (!parent_handle.get()) std::this_thread::sleep_for(100ms);
            }
        });
        emit({{"event","runtime.ready"},{"protocol",1},{"role",role}});
        std::string line;
        while (std::getline(std::cin,line)) {
            Json id=nullptr;
            try {
                if (line.size()>1024*1024) throw Error("INVALID_ARGUMENT","Request too large");
                auto request=Json::parse(line); id=request.at("id");
                if (request.value("version",0)!=1) throw Error("PROTOCOL_VERSION","Unsupported protocol version");
                auto method=request.at("method").get<std::string>();
                if (method=="shutdown") { emit({{"id",id},{"ok",true},{"result",Json::object()}}); break; }
                auto params=request.value("params",Json::object());
                auto result=capture ? capture->command(method,params) : controller ? controller->command(method,params) : rng->command(method,params);
                emit({{"id",id},{"ok",true},{"result",std::move(result)}});
            } catch (const Error& error) { emit({{"id",id},{"ok",false},{"error",{{"code",error.code},{"message",error.what()}}}}); }
              catch (const std::exception& error) { emit({{"id",id},{"ok",false},{"error",{{"code","INVALID_ARGUMENT"},{"message",error.what()}}}}); }
        }
    } catch (const std::exception& error) { emit({{"event","runtime.fatal"},{"message",error.what()}}); return 1; }
    return 0;
}
