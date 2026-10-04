#include "audio.hpp"
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace poke {
using Microsoft::WRL::ComPtr;
namespace {
void check(HRESULT hr, const char* action) {
    if (FAILED(hr)) throw Error(hr==AUDCLNT_E_DEVICE_INVALIDATED ? "AUDIO_DEVICE_REMOVED" : "AUDIO_DEVICE",
        std::string(action)+"（Windows 错误 "+std::to_string(static_cast<uint32_t>(hr))+"）");
}
struct ComScope {
    HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    ComScope() { check(hr,"无法初始化音频设备"); }
    ~ComScope() { if (SUCCEEDED(hr)) CoUninitialize(); }
};
ComPtr<IMMDeviceEnumerator> enumerator() {
    ComPtr<IMMDeviceEnumerator> value;
    check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&value)),"无法枚举音频设备");
    return value;
}
std::string device_name(IMMDevice* device) {
    ComPtr<IPropertyStore> properties;
    check(device->OpenPropertyStore(STGM_READ,&properties),"无法读取音频设备名称");
    PROPVARIANT value; PropVariantInit(&value);
    auto hr=properties->GetValue(PKEY_Device_FriendlyName,&value);
    std::string name=SUCCEEDED(hr) && value.vt==VT_LPWSTR ? utf8(value.pwszVal) : "音频输入";
    PropVariantClear(&value); return name;
}
Json audio_devices() {
    ComScope scope; auto source=enumerator(); ComPtr<IMMDeviceCollection> devices;
    check(source->EnumAudioEndpoints(eCapture,DEVICE_STATE_ACTIVE,&devices),"无法枚举音频输入");
    UINT count=0; check(devices->GetCount(&count),"无法读取音频设备数量");
    Json result=Json::array();
    for (UINT i=0;i<count;++i) {
        ComPtr<IMMDevice> device; check(devices->Item(i,&device),"无法读取音频设备");
        LPWSTR id=nullptr; check(device->GetId(&id),"无法读取音频设备标识");
        std::string device_id=utf8(id); CoTaskMemFree(id);
        result.push_back({{"id",device_id},{"name",device_name(device.Get())},{"backend","wasapi"}});
    }
    return result;
}
}

std::string AudioHub::reset() {
    std::lock_guard lock(mutex_); blocks_.clear(); bytes_=0; sequence_=0; session_=uuid(); active_=true;
    changed_.notify_all(); return session_;
}
void AudioHub::stop() { std::lock_guard lock(mutex_); active_=false; blocks_.clear(); bytes_=0; changed_.notify_all(); }
std::shared_ptr<const AudioBlock> AudioHub::publish(AudioBlock block) {
    if (!block.channels || block.channels>32 || block.sample_rate<8000 || block.sample_rate>384000 || block.samples.empty()
        || block.samples.size()%block.channels || block.samples.size()*sizeof(float)>16*1024*1024)
        throw Error("AUDIO_FORMAT","音频块格式无效");
    block.received_ns=now_ns();
    auto item=std::make_shared<AudioBlock>(std::move(block));
    std::lock_guard lock(mutex_); if (!active_) return {};
    item->session=session_; item->sequence=++sequence_; bytes_+=item->samples.size()*sizeof(float);
    blocks_.push_back(item);
    // Evict old history before it becomes stale at the HTTP boundary. A slow
    // next-block reader can catch up and see skipped, instead of retrying the
    // same expired block forever while the live source is healthy.
    while (blocks_.size()>1 && (blocks_.size()>capacity_ || bytes_>16*1024*1024
        || item->received_ns-blocks_.front()->received_ns>2'000'000'000ULL)) {
        bytes_-=blocks_.front()->samples.size()*sizeof(float); blocks_.pop_front();
    }
    changed_.notify_all(); return item;
}
AudioRead AudioHub::read(uint64_t after, bool next, std::chrono::milliseconds wait, const std::string& session) {
    std::unique_lock lock(mutex_);
    changed_.wait_for(lock,wait,[&] { return !active_ || (!session.empty() && session!=session_) || (!blocks_.empty() && blocks_.back()->sequence>after); });
    if (!session.empty() && session!=session_) throw Error("SESSION_CHANGED","音频源会话已变化");
    if (!active_ || blocks_.empty() || blocks_.back()->sequence<=after) return {};
    auto block=blocks_.back();
    if (next) for (const auto& candidate:blocks_) if (candidate->sequence>after) { block=candidate; break; }
    return {block,after ? block->sequence-after-1 : 0};
}
std::vector<AudioRead> AudioHub::read_batch(uint64_t after, size_t limit, std::chrono::milliseconds wait, const std::string& session) {
    if (!limit || limit>64) throw Error("INVALID_ARGUMENT","Invalid audio batch size");
    std::unique_lock lock(mutex_);
    changed_.wait_for(lock,wait,[&] { return !active_ || (!session.empty() && session!=session_) || (!blocks_.empty() && blocks_.back()->sequence>after); });
    if (!session.empty() && session!=session_) throw Error("SESSION_CHANGED","音频源会话已变化");
    std::vector<AudioRead> result;
    size_t bytes=0;
    if (!active_) return result;
    for (const auto& block:blocks_) {
        if (block->sequence<=after) continue;
        const auto size=block->samples.size()*sizeof(float);
        if (result.size()==limit || bytes+size>16*1024*1024) break;
        result.push_back({block,after ? block->sequence-after-1 : 0});
        bytes+=size; after=block->sequence;
    }
    return result;
}
std::vector<float> audio_pcm(const unsigned char* data,size_t samples,int bits,bool floating,bool silent) {
    if ((floating && bits!=32) || (!floating && bits!=8 && bits!=16 && bits!=24 && bits!=32))
        throw Error("AUDIO_FORMAT","不支持此音频采样格式");
    std::vector<float> output(samples,0);
    if (silent) return output; // WASAPI permits a null buffer for silence.
    if (!data) throw Error("AUDIO_FORMAT","音频缓冲区为空");
    for (size_t i=0;i<samples;++i) {
        const auto* p=data+i*(bits/8); float value=0;
        if (floating) std::memcpy(&value,p,4);
        else if (bits==8) value=(int(*p)-128)/128.f;
        else if (bits==16) { int16_t v; std::memcpy(&v,p,2); value=v/32768.f; }
        else if (bits==24) { int32_t v=int32_t(p[0])|(int32_t(p[1])<<8)|(int32_t(p[2])<<16); if (v&0x800000) v-=0x1000000; value=v/8388608.f; }
        else { int32_t v; std::memcpy(&v,p,4); value=static_cast<float>(v/2147483648.0); }
        output[i]=std::isfinite(value) ? std::clamp(value,-1.f,1.f) : 0.f;
    }
    return output;
}

AudioService::AudioService(Emit emit,bool test_mode) : emit_(std::move(emit)),test_mode_(test_mode),token_(uuid()+uuid()) {
    server_.new_task_queue=[] { return new httplib::ThreadPool(6,16); };
    server_.set_read_timeout(2,0); server_.set_write_timeout(2,0); server_.set_payload_max_length(4096);
    routes(); port_=server_.bind_to_any_port("127.0.0.1");
    if (port_<=0) throw Error("AUDIO_SERVER","无法启动音频读取服务");
    http_=std::thread([this] { server_.listen_after_bind(); });
}
AudioService::~AudioService() { stop(); server_.stop(); if (http_.joinable()) http_.join(); }
Json AudioService::status() const { std::lock_guard lock(state_mutex_); return state_; }
void AudioService::state(Json value) {
    { std::lock_guard lock(state_mutex_); state_=value; }
    emit_({{"event","audio.state"},{"state",std::move(value)}});
}
void AudioService::stop() {
    stop_=true; hub_.stop(); if (capture_.joinable()) capture_.join();
    state({{"status","idle"}});
}
Json AudioService::command(const std::string& method,const Json& args) {
    if (method=="audio.list") {
        auto list=audio_devices();
        if (test_mode_) list.push_back({{"id","synthetic"},{"name","测试音频（模拟）"},{"backend","wasapi"}});
        return list;
    }
    if (method=="audio.status") return status();
    if (method=="audio.stop") { stop(); return status(); }
    if (method=="audio.start") {
        if (!args.is_object() || !args.contains("deviceId") || !args["deviceId"].is_string() || args["deviceId"].get<std::string>().empty())
            throw Error("INVALID_ARGUMENT","请选择音频输入设备");
        if (status().value("status","")=="connected" || !stop_) throw Error("BUSY","请先断开当前音频源");
        if (args["deviceId"]=="synthetic" && !test_mode_) throw Error("INVALID_ARGUMENT","模拟音频仅供测试");
        stop(); hub_.reset(); stop_=false;
        state({{"status","connecting"},{"deviceId",args["deviceId"]},{"backend","wasapi"}});
        capture_=std::thread([this,args] { capture_loop(args); }); return {{"accepted",true}};
    }
    throw Error("METHOD_NOT_FOUND","Unknown audio method");
}
void AudioService::capture_loop(Json config) {
    auto publish=[&,announced=false,last_meter=Clock::now()-1s](AudioBlock block,const std::string& name) mutable {
        auto item=hub_.publish(std::move(block)); if (!item || stop_) return;
        if (!announced) {
            state({{"status","connected"},{"deviceId",config["deviceId"]},{"name",name},{"backend","wasapi"},
                {"session",item->session},{"sampleRate",item->sample_rate},{"channels",item->channels},{"format","f32le"},{"batchVersion",1},
                {"baseUrl","http://127.0.0.1:"+std::to_string(port_)},{"token",token_}});
            announced=true;
        }
        if (Clock::now()-last_meter>=100ms) {
            double square=0,peak=0;
            for (auto value:item->samples) { square+=double(value)*value; peak=std::max(peak,std::abs(double(value))); }
            emit_({{"event","audio.level"},{"session",item->session},{"sequence",item->sequence},
                {"peak",peak},{"rms",std::sqrt(square/item->samples.size())},{"silent",peak<0.00001},
                {"discontinuity",item->discontinuity}});
            last_meter=Clock::now();
        }
    };
    try {
        if (config["deviceId"]=="synthetic") {
            const auto rate=config.value("sampleRate",48000),channels=config.value("channels",2),packet_ms=config.value("packetMs",20);
            if (rate<8000 || rate>384000 || channels<1 || channels>32 || packet_ms<5 || packet_ms>100)
                throw Error("INVALID_ARGUMENT","Invalid synthetic audio format");
            const auto frames=static_cast<size_t>(rate)*packet_ms/1000;
            uint64_t position=0;
            const auto started=Clock::now();
            const auto started_ns=now_ns();
            while (!stop_) {
                const auto elapsed_ns=(position/rate)*1'000'000'000ULL + (position%rate)*1'000'000'000ULL/rate;
                AudioBlock block; block.sample_rate=rate; block.channels=channels; block.timestamp_ns=started_ns+elapsed_ns;
                // Silence is a valid connected input, distinct from a stalled source.
                block.silent=config.value("silent",false); block.samples.resize(frames*channels);
                for (size_t i=0;i<frames;++i) {
                    auto value=block.silent ? 0.f : float(.25*std::sin(2*3.141592653589793*1000*double(position+i)/rate));
                    for (int channel=0;channel<channels;++channel) block.samples[i*channels+channel]=value;
                }
                position+=frames; publish(std::move(block),"测试音频（模拟）");
                // Absolute pacing catches up after a coarse Windows timer wake.
                // Packet timestamps follow the sample clock, like WASAPI, rather
                // than simulating missing samples on every delayed sleep.
                const auto next_ns=(position/rate)*1'000'000'000ULL + (position%rate)*1'000'000'000ULL/rate;
                std::this_thread::sleep_until(started+std::chrono::nanoseconds(next_ns));
            }
        } else {
            ComScope scope; auto source=enumerator(); ComPtr<IMMDevice> device;
            check(source->GetDevice(wide(config["deviceId"].get<std::string>()).c_str(),&device),"音频设备已移除，请刷新设备列表");
            ComPtr<IMMEndpoint> endpoint; check(device.As(&endpoint),"无法读取音频设备类型");
            EDataFlow flow; check(endpoint->GetDataFlow(&flow),"无法读取音频设备类型");
            if (flow!=eCapture) throw Error("INVALID_ARGUMENT","请选择录音输入设备");
            auto name=device_name(device.Get()); ComPtr<IAudioClient> client;
            check(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(client.GetAddressOf())),"无法打开音频输入");
            WAVEFORMATEX* raw=nullptr; check(client->GetMixFormat(&raw),"无法读取音频格式");
            std::unique_ptr<WAVEFORMATEX,decltype(&CoTaskMemFree)> format(raw,CoTaskMemFree);
            bool floating=raw->wFormatTag==WAVE_FORMAT_IEEE_FLOAT,pcm=raw->wFormatTag==WAVE_FORMAT_PCM;
            if (raw->wFormatTag==WAVE_FORMAT_EXTENSIBLE && raw->cbSize>=22) {
                const auto* ext=reinterpret_cast<WAVEFORMATEXTENSIBLE*>(raw);
                floating=IsEqualGUID(ext->SubFormat,KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
                pcm=IsEqualGUID(ext->SubFormat,KSDATAFORMAT_SUBTYPE_PCM);
            }
            if ((!floating && !pcm) || !raw->nChannels || raw->nChannels>32 || raw->nSamplesPerSec<8000 || raw->nSamplesPerSec>384000
                || raw->nBlockAlign!=raw->nChannels*(raw->wBitsPerSample/8)) throw Error("AUDIO_FORMAT","音频设备输出了不支持的格式");
            audio_pcm(nullptr,0,raw->wBitsPerSample,floating,true); // Validate even on silent endpoints.
            check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,0,1000000,0,raw,nullptr),"无法共享采集音频，请检查设备占用和 Windows 麦克风权限");
            ComPtr<IAudioCaptureClient> capture; check(client->GetService(IID_PPV_ARGS(&capture)),"无法创建音频采集通道");
            check(client->Start(),"无法启动音频采集");
            struct Stop { IAudioClient* client; ~Stop() { client->Stop(); } } cleanup{client.Get()};
            auto last_data=Clock::now();
            while (!stop_) {
                UINT32 available=0; check(capture->GetNextPacketSize(&available),"音频输入已断开");
                if (!available) {
                    if (Clock::now()-last_data>3s) throw Error("NO_AUDIO","音频输入没有新数据，请检查连接");
                    std::this_thread::sleep_for(5ms); continue;
                }
                BYTE* data=nullptr; UINT32 frames=0; DWORD flags=0; UINT64 position=0,qpc=0;
                check(capture->GetBuffer(&data,&frames,&flags,&position,&qpc),"读取音频失败");
                struct Release { IAudioCaptureClient* capture; UINT32 frames; ~Release() { capture->ReleaseBuffer(frames); } } release{capture.Get(),frames};
                AudioBlock block; block.sample_rate=raw->nSamplesPerSec; block.channels=raw->nChannels;
                block.silent=(flags&AUDCLNT_BUFFERFLAGS_SILENT)!=0;
                block.discontinuity=(flags&AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY)!=0;
                block.timestamp_error=(flags&AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)!=0;
                block.timestamp_ns=block.timestamp_error ? now_ns() : qpc*100; // WASAPI QPC is in 100 ns units.
                if (frames>raw->nSamplesPerSec) throw Error("AUDIO_FORMAT","音频块超过一秒，采集异常");
                block.samples=audio_pcm(data,size_t(frames)*raw->nChannels,raw->wBitsPerSample,floating,block.silent);
                publish(std::move(block),name); last_data=Clock::now();
            }
        }
    } catch (const Error& error) { if (!stop_) state({{"status","failed"},{"code",error.code},{"message",error.what()}}); }
      catch (const std::exception& error) { if (!stop_) state({{"status","failed"},{"code","AUDIO_FAILED"},{"message",error.what()}}); }
    stop_=true; hub_.stop();
}
void AudioService::routes() {
    server_.set_pre_routing_handler([this](const auto& request,auto& response) {
        if (request.get_header_value("Authorization")!="Bearer "+token_) {
            response.status=401; return httplib::Server::HandlerResponse::Handled;
        }
        response.set_header("Cache-Control","no-store"); return httplib::Server::HandlerResponse::Unhandled;
    });
    server_.Get("/audio",[this](const auto& request,auto& response) {
        try {
            const auto session=request.get_param_value("session"),mode=request.get_param_value("mode");
            if (session.empty() || (!mode.empty() && mode!="next" && mode!="latest" && mode!="batch")) throw Error("INVALID_ARGUMENT","Invalid audio session or mode");
            uint64_t after=0;
            if (request.has_param("after")) {
                auto value=request.get_param_value("after");
                if (value.empty() || value.size()>19 || value.find_first_not_of("0123456789")!=std::string::npos) throw Error("INVALID_ARGUMENT","Invalid audio cursor");
                after=std::stoull(value);
            }
            if (mode=="batch") {
                size_t limit=64;
                if (request.has_param("max_blocks")) {
                    const auto value=request.get_param_value("max_blocks");
                    if (value.empty() || value.size()>2 || value.find_first_not_of("0123456789")!=std::string::npos)
                        throw Error("INVALID_ARGUMENT","Invalid audio batch size");
                    limit=std::stoul(value);
                }
                auto blocks=hub_.read_batch(after,limit,200ms,session);
                if (blocks.empty()) { response.status=stop_ ? 503 : 204; return; }
                if (now_ns()-blocks.back().block->received_ns>3'000'000'000ULL) { response.status=503; return; }
                // Keep each packet's timestamp and loss flags. Do not concatenate
                // through an overrun or turn discontinuous PCM into valid audio.
                Json metadata={{"version",1},{"blocks",Json::array()}};
                for (const auto& read:blocks) {
                    const auto& b=*read.block;
                    metadata["blocks"].push_back({{"session",b.session},{"sequence",b.sequence},{"skipped",read.skipped},
                        {"timestamp_ns",b.timestamp_ns},{"received_ns",b.received_ns},
                        {"sample_rate",b.sample_rate},{"channels",b.channels},{"frames",b.samples.size()/b.channels},
                        {"discontinuity",b.discontinuity},{"timestamp_error",b.timestamp_error},{"silent",b.silent}});
                }
                const auto header=metadata.dump();
                std::string body;
                const auto length=static_cast<uint32_t>(header.size());
                for (unsigned i=0;i<4;++i) body.push_back(static_cast<char>((length>>(i*8))&255));
                body+=header;
                for (const auto& read:blocks) {
                    const auto& samples=read.block->samples;
                    body.append(reinterpret_cast<const char*>(samples.data()),samples.size()*sizeof(float));
                }
                response.set_header("X-Audio-Format","f32le-batch-v1");
                response.set_content(std::move(body),"application/octet-stream");
                return;
            }
            auto read=hub_.read(after,mode=="next",200ms,session);
            if (!read.block) { response.status=stop_ ? 503 : 204; return; }
            const auto& b=*read.block;
            if (now_ns()-b.received_ns>3'000'000'000ULL) { response.status=503; return; }
            response.set_header("X-Audio-Session",b.session);
            response.set_header("X-Audio-Sequence",std::to_string(b.sequence));
            response.set_header("X-Audio-Skipped",std::to_string(read.skipped));
            response.set_header("X-Audio-Timestamp-Ns",std::to_string(b.timestamp_ns));
            response.set_header("X-Audio-Received-Ns",std::to_string(b.received_ns));
            response.set_header("X-Audio-Sample-Rate",std::to_string(b.sample_rate));
            response.set_header("X-Audio-Channels",std::to_string(b.channels));
            response.set_header("X-Audio-Frames",std::to_string(b.samples.size()/b.channels));
            response.set_header("X-Audio-Format","f32le");
            response.set_header("X-Audio-Discontinuity",b.discontinuity ? "1" : "0");
            response.set_header("X-Audio-Timestamp-Error",b.timestamp_error ? "1" : "0");
            response.set_header("X-Audio-Silent",b.silent ? "1" : "0");
            response.set_content(reinterpret_cast<const char*>(b.samples.data()),b.samples.size()*sizeof(float),"application/octet-stream");
        } catch (const Error& error) {
            response.status=error.code=="SESSION_CHANGED" ? 409 : 400;
            response.set_content(Json({{"code",error.code},{"message",error.what()}}).dump(),"application/json");
        }
    });
}
}
