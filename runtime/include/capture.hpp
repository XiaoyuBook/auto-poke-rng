#pragma once
#include "shared_frames.hpp"
#include <httplib.h>
#include <atomic>
#include <thread>

namespace poke {
class CaptureService {
    Emit emit_;
    bool test_mode_;
    FrameHub hub_;
    std::atomic<bool> stop_{true};
    std::thread capture_, encoder_, http_;
    mutable std::mutex state_mutex_, jpeg_mutex_;
    std::condition_variable jpeg_changed_;
    Json state_={{"status","idle"}};
    struct Preview { std::vector<unsigned char> jpeg; std::string session; uint64_t sequence; };
    std::shared_ptr<const Preview> preview_;
    httplib::Server server_;
    std::string token_;
    int port_=0;
    std::atomic<int> streams_{0};
    void state(Json value);
    void capture_loop(Json config);
    void encode_loop();
    void routes();
public:
    explicit CaptureService(Emit emit, bool test_mode=false);
    ~CaptureService();
    Json command(const std::string& method, const Json& args);
    Json status() const;
    void stop();
};
}
