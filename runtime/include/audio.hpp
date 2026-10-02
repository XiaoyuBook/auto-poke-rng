#pragma once
#include "common.hpp"
#include <httplib.h>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <memory>
#include <thread>
#include <vector>

namespace poke {
struct AudioBlock {
    std::string session;
    uint64_t sequence=0, timestamp_ns=0, received_ns=0;
    uint32_t sample_rate=0, channels=0;
    bool discontinuity=false, timestamp_error=false, silent=false;
    std::vector<float> samples; // Interleaved float32 PCM, owned by this block.
};
struct AudioRead { std::shared_ptr<const AudioBlock> block; uint64_t skipped=0; };
class AudioHub {
    std::mutex mutex_;
    std::condition_variable changed_;
    std::deque<std::shared_ptr<const AudioBlock>> blocks_;
    size_t capacity_, bytes_=0;
    std::string session_;
    uint64_t sequence_=0;
    bool active_=false;
public:
    explicit AudioHub(size_t capacity=512) : capacity_(capacity) {}
    std::string reset();
    void stop();
    std::shared_ptr<const AudioBlock> publish(AudioBlock block);
    AudioRead read(uint64_t after=0, bool next=false, std::chrono::milliseconds wait=0ms, const std::string& session={});
};
// Convert WASAPI's native mix format to a common consumer format without resampling.
std::vector<float> audio_pcm(const unsigned char* data, size_t samples, int bits, bool floating, bool silent);
class AudioService {
    Emit emit_;
    bool test_mode_;
    AudioHub hub_;
    std::atomic<bool> stop_{true};
    std::thread capture_, http_;
    mutable std::mutex state_mutex_;
    Json state_={{"status","idle"}};
    httplib::Server server_;
    std::string token_;
    int port_=0;
    void state(Json value);
    void capture_loop(Json config);
    void routes();
public:
    explicit AudioService(Emit emit, bool test_mode=false);
    ~AudioService();
    Json command(const std::string& method, const Json& args);
    Json status() const;
    void stop();
};
}
