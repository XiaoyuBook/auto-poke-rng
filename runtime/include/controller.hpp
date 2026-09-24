#pragma once
#include "common.hpp"
#include <array>
#include <atomic>
#include <condition_variable>
#include <set>
#include <thread>

namespace poke {
// Ported from EasyCon.Device/Utils/SwitchReport.cs (GPL-3.0).
struct SwitchReport {
    uint16_t buttons=0;
    uint8_t hat=8,lx=128,ly=128,rx=128,ry=128;
    std::array<uint8_t,8> bytes() const;
};
class ControllerService {
    Emit emit_;
    bool test_mode_, mock_=false;
    Handle serial_;
    std::mutex mutex_, wait_mutex_;
    std::condition_variable wake_;
    std::thread actions_;
    std::atomic<bool> cancelled_{false}, running_{false};
    SwitchReport report_;
    std::set<std::string> directions_;
    Clock::time_point next_report_{};
    std::string port_, owner_, operation_;
    Json state_={{"status","idle"}};
    Json history_=Json::array();
    uint64_t connects_=0;
    void emit_state();
    void check_owner(const Json& args);
    void connected();
    void write(const uint8_t* bytes, size_t size);
    void send();
    void button(const std::string& key,bool down);
    void update_hat();
    void stick(const std::string& side,int x,int y);
    void neutral();
    void disconnect();
    void stop_actions();
    void action_loop(Json actions,std::string operation);
    void validate_action(const Json& action);
public:
    explicit ControllerService(Emit emit,bool test_mode=false) : emit_(std::move(emit)),test_mode_(test_mode) {}
    ~ControllerService();
    Json command(const std::string& method,const Json& args);
    void emergency_release();
};
}
