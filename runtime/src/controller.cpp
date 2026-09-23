#include "controller.hpp"
#include <algorithm>
#include <map>
#include <regex>

namespace poke {
std::array<uint8_t,8> SwitchReport::bytes() const {
    std::array<uint8_t,7> data{uint8_t(buttons>>8),uint8_t(buttons),hat,lx,ly,rx,ry};
    std::array<uint8_t,8> packet{}; uint64_t accumulator=0; unsigned bits=0,index=0;
    for (auto byte:data) {
        accumulator=(accumulator<<8)|byte; bits+=8;
        while(bits>=7) { bits-=7; packet[index++]=uint8_t((accumulator>>bits)&0x7f); accumulator&=(uint64_t(1)<<bits)-1; }
    }
    packet.back()|=0x80; return packet;
}
static const std::map<std::string,uint16_t> buttons={{"Y",1},{"B",2},{"A",4},{"X",8},{"L",16},{"R",32},{"ZL",64},{"ZR",128},
    {"MINUS",256},{"PLUS",512},{"LCLICK",1024},{"RCLICK",2048},{"HOME",4096},{"CAPTURE",8192}};
static const std::map<std::string,unsigned> hats={{"UP",1},{"TOP",1},{"DOWN",2},{"LEFT",4},{"RIGHT",8},
    {"TOP_RIGHT",9},{"UP_RIGHT",9},{"UPRIGHT",9},{"DOWN_RIGHT",10},{"DOWNRIGHT",10},{"DOWN_LEFT",6},{"DOWNLEFT",6},{"TOP_LEFT",5},{"UP_LEFT",5},{"UPLEFT",5}};
static std::string key_name(std::string key) {
    std::transform(key.begin(),key.end(),key.begin(),[](unsigned char c){return char(std::toupper(c));});
    if (key=="+") key="PLUS"; if (key=="-") key="MINUS"; return key;
}
void ControllerService::emit_state() {
    state_["running"]=running_.load(); state_["owned"]=!owner_.empty();
    state_["report"]={{"buttons",report_.buttons},{"hat",report_.hat},{"lx",report_.lx},{"ly",report_.ly},{"rx",report_.rx},{"ry",report_.ry}};
    emit_({{"event","controller.state"},{"state",state_}});
}
void ControllerService::connected() {
    if (state_.value("status","")!="connected") throw Error("NOT_CONNECTED","请先连接伊机控");
}
void ControllerService::check_owner(const Json& args) {
    connected();
    if (args.value("owner",std::string())!=owner_) throw Error("BUSY","伊机控正在被脚本使用");
}
void ControllerService::write(const uint8_t* bytes,size_t size) {
    if (mock_) return;
    DWORD written=0;
    if (!WriteFile(serial_.get(),bytes,DWORD(size),&written,nullptr) || written!=size) {
        serial_.reset(); state_={{"status","failed"},{"message","伊机控串口写入失败，请重新连接"}}; emit_state();
        throw Error("SERIAL_WRITE","伊机控串口写入失败，请重新连接");
    }
}
void ControllerService::send() {
    connected();
    // Original EasyCon firmware report loop requires at least 30ms between reports.
    std::this_thread::sleep_until(next_report_);
    auto packet=report_.bytes(); write(packet.data(),packet.size()); next_report_=Clock::now()+30ms;
    if (test_mode_) { history_.push_back({{"bytes",packet},{"timestampNs",std::to_string(now_ns())}}); if(history_.size()>256) history_.erase(history_.begin()); }
}
void ControllerService::button(const std::string& raw,bool down) {
    auto key=key_name(raw);
    if (auto found=buttons.find(key);found!=buttons.end()) { if(down) report_.buttons|=found->second; else report_.buttons&=uint16_t(~found->second); }
    else if(auto direction=hats.find(key);direction!=hats.end()) {
        if(down) directions_|=direction->second;else directions_&=~direction->second;
        bool up=(directions_&1)&&!(directions_&2),bottom=(directions_&2)&&!(directions_&1),left=(directions_&4)&&!(directions_&8),right=(directions_&8)&&!(directions_&4);
        report_.hat=up ? (left?7:right?1:0) : bottom ? (left?5:right?3:4) : left?6:right?2:8;
    } else throw Error("INVALID_ARGUMENT","不支持的按键: "+raw);
    send(); emit_state();
}
void ControllerService::stick(const std::string& side,int x,int y) {
    if(side=="LS") {report_.lx=uint8_t(x);report_.ly=uint8_t(y);} else if(side=="RS") {report_.rx=uint8_t(x);report_.ry=uint8_t(y);}
    else throw Error("INVALID_ARGUMENT","摇杆必须是 LS 或 RS");
    send(); emit_state();
}
void ControllerService::neutral() { report_={}; directions_=0; if(state_.value("status","")=="connected") send(); emit_state(); }
void ControllerService::stop_actions() {
    cancelled_=true; wake_.notify_all();
    if(actions_.joinable()) actions_.join();
    running_=false;
}
void ControllerService::disconnect() {
    stop_actions(); std::lock_guard lock(mutex_);
    try { neutral(); } catch(...) {}
    serial_.reset(); port_.clear();owner_.clear();mock_=false;
    state_={{"status","idle"}}; emit_state();
}
ControllerService::~ControllerService() { disconnect(); }
void ControllerService::emergency_release() { stop_actions(); std::lock_guard lock(mutex_); try { neutral(); } catch(...) {} }
void ControllerService::validate_action(const Json& action) {
    auto kind=action.at("kind").get<std::string>();
    if(kind=="wait") integer(action,"duration_ms",0,0,24*60*60*1000);
    else if(kind=="button") {
        auto key=key_name(action.at("key").get<std::string>());
        if(!buttons.contains(key)&&!hats.contains(key)) throw Error("INVALID_ARGUMENT","不支持的按键: "+key);
        if(!action.at("down").is_boolean()) throw Error("INVALID_ARGUMENT","down 必须是布尔值");
    } else if(kind=="stick") {
        auto side=action.at("side").get<std::string>();
        if(side!="LS"&&side!="RS") throw Error("INVALID_ARGUMENT","摇杆必须是 LS 或 RS");
        integer(action,"x",128,0,255);integer(action,"y",128,0,255);
    } else throw Error("INVALID_ARGUMENT","不支持的控制动作");
}
void ControllerService::action_loop(Json actions,std::string operation) {
    std::string outcome="completed",message;
    try {
        for(const auto& action:actions) {
            if(cancelled_) {outcome="cancelled";break;}
            auto kind=action["kind"].get<std::string>();
            if(kind=="wait") {
                std::unique_lock lock(wait_mutex_);
                wake_.wait_for(lock,std::chrono::milliseconds(action.value("duration_ms",0)),[&]{return cancelled_.load();});
            } else {
                std::lock_guard lock(mutex_);
                if(cancelled_) {outcome="cancelled";break;}
                if(kind=="button") button(action["key"],action["down"]);
                else stick(action["side"],action.value("x",128),action.value("y",128));
            }
        }
        if(cancelled_) outcome="cancelled";
    } catch(const std::exception& error) {outcome="failed";message=error.what();}
    {
        std::lock_guard lock(mutex_);
        if(outcome!="completed") try { neutral(); } catch(...) {}
        running_=false; emit_state();
    }
    emit_({{"event","controller.action.done"},{"operation",operation},{"status",outcome},{"message",message}});
}
Json ControllerService::command(const std::string& method,const Json& args) {
    if(method=="controller.list") {auto list=serial_devices();if(test_mode_) list.push_back({{"id","mock"},{"name","测试手柄（模拟）"}});return list;}
    if(method=="controller.disconnect") {disconnect();return {{"status","idle"}};}
    if(method=="controller.stop") {stop_actions();std::lock_guard lock(mutex_);neutral();owner_.clear();emit_state();return state_;}
    if(method=="controller.connect") {
        auto port=args.at("port").get<std::string>();
        if(port!="mock" && !std::regex_match(port,std::regex("COM[1-9][0-9]{0,3}",std::regex::icase))) throw Error("INVALID_ARGUMENT","串口名称无效");
        if(port=="mock"&&!test_mode_) throw Error("INVALID_ARGUMENT","模拟设备仅供测试");
        { std::lock_guard lock(mutex_);
          if(state_.value("status","")=="connected") {if(port==port_) return state_; throw Error("BUSY","请先断开当前串口");} }
        disconnect(); std::lock_guard lock(mutex_);
        state_={{"status","connecting"},{"name",port}};emit_state();
        mock_=port=="mock";
        for(int baud:{115200,9600}) {
            if(!mock_) {
                serial_.reset(CreateFileW(wide("\\\\.\\"+port).c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr));
                if(serial_.get()==INVALID_HANDLE_VALUE) {serial_.reset();break;}
                DCB dcb{};dcb.DCBlength=sizeof(dcb);
                if(!GetCommState(serial_.get(),&dcb)) {serial_.reset();break;}
                dcb.BaudRate=baud;dcb.ByteSize=8;dcb.Parity=NOPARITY;dcb.StopBits=ONESTOPBIT;dcb.fBinary=TRUE;dcb.fParity=FALSE;
                dcb.fOutxCtsFlow=FALSE;dcb.fOutxDsrFlow=FALSE;dcb.fDtrControl=DTR_CONTROL_DISABLE;dcb.fRtsControl=RTS_CONTROL_DISABLE;
                dcb.fOutX=FALSE;dcb.fInX=FALSE;dcb.fDsrSensitivity=FALSE;dcb.fAbortOnError=FALSE;
                COMMTIMEOUTS timeouts{MAXDWORD,0,20,0,500};
                if(!SetCommState(serial_.get(),&dcb)||!SetCommTimeouts(serial_.get(),&timeouts)) {serial_.reset();break;}
                PurgeComm(serial_.get(),PURGE_RXCLEAR|PURGE_TXCLEAR);
                const uint8_t hello[]={0xa5,0xa5,0x81};write(hello,3);
                bool received=false; auto deadline=Clock::now()+1s;
                while(Clock::now()<deadline) {uint8_t buffer[256];DWORD count=0;if(!ReadFile(serial_.get(),buffer,256,&count,nullptr)) break;for(DWORD i=0;i<count;++i) if(buffer[i]==0x80) received=true;if(received)break;}
                if(!received) {serial_.reset();std::this_thread::sleep_for(100ms);continue;}
            }
            port_=port; ++connects_; state_={{"status","connected"},{"name",port},{"baudrate",baud}};report_={};directions_=0;
            send();emit_state();return state_;
        }
        state_={{"status","failed"},{"message","伊机控握手失败，请检查串口占用、固件和设备连接"}};emit_state();
        throw Error("CONNECT_FAILED",state_["message"]);
    }
    if(method=="controller.sequence") {
        auto actions=args.at("actions");
        if(!actions.is_array()||actions.empty()||actions.size()>10000) throw Error("INVALID_ARGUMENT","动作序列必须包含 1 至 10000 项");
        for(const auto& action:actions)validate_action(action);
        {std::lock_guard lock(mutex_);check_owner(args);if(running_)throw Error("BUSY","已有控制动作正在执行");}
        if(actions_.joinable())actions_.join();
        std::lock_guard lock(mutex_); cancelled_=false;running_=true;operation_=uuid();emit_state();
        actions_=std::thread([this,actions,operation=operation_]{action_loop(actions,operation);});return {{"operation",operation_}};
    }
    std::lock_guard lock(mutex_);
    if(method=="controller.status") {
        if(!mock_&&state_.value("status","")=="connected") {DWORD errors=0;COMSTAT stats{};if(!ClearCommError(serial_.get(),&errors,&stats)){serial_.reset();state_={{"status","failed"},{"message","伊机控串口已断开"}};emit_state();}}
        return state_;
    }
    if(method=="controller.debug"&&test_mode_)return {{"history",history_},{"connects",connects_},{"report",report_.bytes()}};
    if(method=="controller.acquire") {
        connected();if(!owner_.empty()||running_)throw Error("BUSY","伊机控已被占用");neutral();owner_=uuid();emit_state();return {{"owner",owner_}};
    }
    check_owner(args);
    if(running_)throw Error("BUSY","已有控制动作正在执行");
    if(method=="controller.release") {neutral();owner_.clear();emit_state();return state_;}
    if(method=="controller.key") {validate_action({{"kind","button"},{"key",args.at("key")},{"down",args.at("down")}});button(args["key"],args["down"]);}
    else if(method=="controller.stick") {validate_action({{"kind","stick"},{"side",args.at("side")},{"x",args.value("x",128)},{"y",args.value("y",128)}});stick(args["side"],args.value("x",128),args.value("y",128));}
    else if(method=="controller.reset") neutral();
    else throw Error("METHOD_NOT_FOUND","Unknown controller method");
    return state_;
}
}
