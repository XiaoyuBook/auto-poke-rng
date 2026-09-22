#pragma once
#include "common.hpp"
#include <opencv2/core.hpp>
#include <condition_variable>
#include <deque>
#include <memory>

namespace poke {
struct Frame {
    std::string session;
    uint64_t sequence=0, timestamp_ns=0;
    cv::Mat bgr;
};
struct FrameRead { std::shared_ptr<const Frame> frame; uint64_t skipped=0; };
// Frames are immutable after publication. Each caller owns its own cursor.
class FrameHub {
    mutable std::mutex mutex_;
    std::condition_variable changed_;
    std::deque<std::shared_ptr<const Frame>> frames_;
    size_t capacity_;
    std::string session_;
    uint64_t sequence_=0;
    bool active_=false;
public:
    explicit FrameHub(size_t capacity=8) : capacity_(capacity) {}
    std::string reset();
    void stop();
    std::shared_ptr<const Frame> publish(const cv::Mat& bgr);
    FrameRead read(uint64_t after=0, bool next=false, std::chrono::milliseconds wait=0ms, const std::string& session={});
};
}
