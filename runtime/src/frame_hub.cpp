#include "frame_hub.hpp"

namespace poke {
std::string FrameHub::reset() {
    std::lock_guard lock(mutex_); frames_.clear(); sequence_=0; session_=uuid(); active_=true;
    changed_.notify_all(); return session_;
}
void FrameHub::stop() { std::lock_guard lock(mutex_); active_=false; frames_.clear(); changed_.notify_all(); }
std::shared_ptr<const Frame> FrameHub::publish(const cv::Mat& bgr) {
    if (bgr.empty() || bgr.type()!=CV_8UC3) throw Error("FRAME_FORMAT", "Expected BGR24 frame");
    // The OpenCV driver may reuse its storage on its next read.
    auto frame=std::make_shared<Frame>(); frame->timestamp_ns=now_ns(); frame->bgr=bgr.clone();
    std::lock_guard lock(mutex_);
    if (!active_) return {};
    frame->session=session_; frame->sequence=++sequence_;
    frames_.push_back(frame);
    // Bound memory to 128 MiB, including when a driver negotiates 4K.
    auto count=std::max<size_t>(2, std::min(capacity_, size_t(128*1024*1024)/frame->bgr.total()/3));
    while (frames_.size()>count) frames_.pop_front();
    changed_.notify_all(); return frame;
}
FrameRead FrameHub::read(uint64_t after, bool next, std::chrono::milliseconds wait, const std::string& session) {
    std::unique_lock lock(mutex_);
    auto ready=[&] { return !active_ || (!session.empty() && session_!=session) || (!frames_.empty() && frames_.back()->sequence>after); };
    if (wait.count()) changed_.wait_for(lock,wait,ready);
    if (!session.empty() && session_!=session) throw Error("SESSION_CHANGED", "Video source session changed");
    if (!active_ || frames_.empty() || frames_.back()->sequence<=after) return {};
    auto frame=frames_.back();
    if (next) for (auto& item:frames_) if (item->sequence>after) { frame=item; break; }
    return {frame, after ? frame->sequence-after-1 : 0};
}
}
